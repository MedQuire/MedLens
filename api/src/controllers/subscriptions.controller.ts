import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import FlutterwaveService from '../services/flutterwave.service';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase configuration missing');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const SUBSCRIPTION_PRICES: Record<string, number> = {
  PREMIUM_MONTHLY: 9.99,
  PREMIUM_YEARLY: 89.99,
};

export async function createSubscription(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { plan } = req.body;
    if (!plan || !['PREMIUM_MONTHLY', 'PREMIUM_YEARLY'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Must be PREMIUM_MONTHLY or PREMIUM_YEARLY.' });
    }

    const supabase = getSupabase();

    // Check if user already has an active subscription
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('id, status')
      .eq('user_id', userId)
      .in('status', ['ACTIVE', 'PENDING'])
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        error: 'Active subscription exists',
        message: existing.status === 'ACTIVE'
          ? 'You already have an active Premium subscription.'
          : 'A subscription is already being processed. Please complete the pending payment.',
      });
    }

    // Generate unique tx_ref
    const txRef = `medquire_sub_${userId}_${Date.now()}`;

    // Get user email from public.users
    const { data: user } = await supabase
      .from('users')
      .select('email')
      .eq('id', userId)
      .single();

    const amount = SUBSCRIPTION_PRICES[plan];
    const amountInCents = amount; // Flutterwave uses float amounts (already correct)

    // Create pending subscription record
    const { data: subscription, error: insertError } = await supabase
      .from('subscriptions')
      .insert({
        user_id: userId,
        plan,
        status: 'PENDING',
        tx_ref: txRef,
      })
      .select()
      .single();

    if (insertError || !subscription) {
      console.error('[Subscriptions] Failed to create pending subscription:', insertError?.message);
      return res.status(500).json({ error: 'Failed to initiate subscription' });
    }

    // Call Flutterwave to create checkout
    try {
      const flutterwaveResponse = await FlutterwaveService.createSubscription({
        tx_ref: txRef,
        amount: amount,
        currency: 'USD',
        redirect_url: 'https://medquire.app/payment-success',
        customer: {
          email: user?.email || 'user@medquire.app',
          name: 'MedQuire User',
        },
        customizations: {
          title: 'MedQuire Premium',
          description: plan === 'PREMIUM_MONTHLY' ? 'Monthly Premium Subscription' : 'Yearly Premium Subscription',
        },
        meta: {
          user_id: userId,
          plan,
        },
      });

      return res.json({
        checkout_url: flutterwaveResponse.data.link,
        subscription_id: subscription.id,
        tx_ref: txRef,
      });
    } catch (flutterwaveError: any) {
      // Clean up pending subscription if Flutterwave call fails
      await supabase.from('subscriptions').delete().eq('id', subscription.id);
      console.error('[Subscriptions] Flutterwave error:', flutterwaveError?.response?.data || flutterwaveError.message);
      return res.status(502).json({
        error: 'Payment gateway error',
        message: 'Failed to initiate payment. Please try again later.',
      });
    }
  } catch (error: any) {
    console.error('[Subscriptions] create error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getCurrentSubscription(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const supabase = getSupabase();

    // Get user plan from public.users
    const { data: user } = await supabase
      .from('users')
      .select('plan')
      .eq('id', userId)
      .single();

    if (!user || user.plan === 'FREE') {
      return res.json({
        plan: 'FREE',
        status: 'NONE',
        current_period_end: null,
      });
    }

    // Get the latest subscription record
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('plan, status, current_period_end')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!subscription) {
      return res.json({ plan: 'FREE', status: 'NONE', current_period_end: null });
    }

    return res.json({
      plan: subscription.plan,
      status: subscription.status,
      current_period_end: subscription.current_period_end,
    });
  } catch (error: any) {
    console.error('[Subscriptions] getCurrent error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function cancelSubscription(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const supabase = getSupabase();

    // Find active subscription
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['ACTIVE', 'PAST_DUE'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!subscription) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    // Cancel via Flutterwave if we have a subscription ID
    if (subscription.flutterwave_subscription_id) {
      try {
        // Flutterwave cancel subscription endpoint
        const axios = require('axios');
        await axios.post(
          `https://api.flutterwave.com/v3/subscriptions/${subscription.flutterwave_subscription_id}/cancel`,
          {},
          {
            headers: {
              Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
            },
          }
        );
      } catch (fwError: any) {
        console.warn('[Subscriptions] Flutterwave cancel warning:', fwError?.response?.data || fwError.message);
        // Continue with local cancellation even if Flutterwave call fails
      }
    }

    // Update local subscription status using RPC
    const { error: rpcError } = await supabase.rpc('cancel_subscription', {
      p_subscription_id: subscription.id,
    });

    if (rpcError) {
      console.error('[Subscriptions] Cancel RPC error:', rpcError.message);
      return res.status(500).json({ error: 'Failed to cancel subscription' });
    }

    return res.json({
      status: 'CANCELLED',
      access_until: subscription.current_period_end,
    });
  } catch (error: any) {
    console.error('[Subscriptions] cancel error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
