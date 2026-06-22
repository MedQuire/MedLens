import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import PaystackService from '../services/paystack.service';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase configuration missing');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const SUBSCRIPTION_PRICES: Record<string, Record<string, number>> = {
  PREMIUM_MONTHLY: { NGN: 1500, USD: 9.99 },
  PREMIUM_YEARLY: { NGN: 13500, USD: 89.99 },
};

const SUBSCRIPTION_PLANS: Record<string, string | undefined> = {
  PREMIUM_MONTHLY: process.env.PAYSTACK_PLAN_MONTHLY,
  PREMIUM_YEARLY: process.env.PAYSTACK_PLAN_YEARLY,
};

export async function createSubscription(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { plan, currency } = req.body;
    if (!plan || !['PREMIUM_MONTHLY', 'PREMIUM_YEARLY'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Must be PREMIUM_MONTHLY or PREMIUM_YEARLY.' });
    }

    const selectedCurrency = currency === 'NGN' ? 'NGN' : 'USD';

    const supabase = getSupabase();

    // Check if user already has an active subscription
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('id, status')
      .eq('user_id', userId)
      .in('status', ['ACTIVE', 'PENDING'])
      .maybeSingle();

    if (existing) {
      if (existing.status === 'ACTIVE') {
        return res.status(409).json({
          error: 'Active subscription exists',
          message: 'You already have an active Premium subscription.',
        });
      }

      // PENDING subscription from a previous incomplete payment — clean it up
      await supabase.from('subscriptions').delete().eq('id', existing.id);
    }

    // Generate unique reference
    const reference = `medquire_sub_${userId}_${Date.now()}`;

    // Get user email from public.users
    const { data: user } = await supabase
      .from('users')
      .select('email')
      .eq('id', userId)
      .single();

    const amount = SUBSCRIPTION_PRICES[plan][selectedCurrency];
    const amountInSmallestUnit = Math.round(amount * 100);

    // Create pending subscription record
    const { data: subscription, error: insertError } = await supabase
      .from('subscriptions')
      .insert({
        user_id: userId,
        plan,
        status: 'PENDING',
        tx_ref: reference,
      })
      .select()
      .single();

    if (insertError || !subscription) {
      console.error('[Subscriptions] Failed to create pending subscription:', insertError?.message);
      return res.status(500).json({ error: 'Failed to initiate subscription' });
    }

    // Call Paystack to initialize transaction
    try {
      const paystackPayload: any = {
        email: user?.email || 'user@medquire.app',
        amount: amountInSmallestUnit,
        currency: selectedCurrency,
        reference,
        callback_url: process.env.PAYSTACK_REDIRECT_URL || 'https://medquire.app/payment-success',
        metadata: {
          user_id: userId,
          plan,
        },
      };

      const planCode = SUBSCRIPTION_PLANS[plan];
      if (planCode) {
        paystackPayload.plan = planCode;
      }

      const paystackResponse = await PaystackService.initializeTransaction(paystackPayload);

      return res.json({
        checkout_url: paystackResponse.data.authorization_url,
        subscription_id: subscription.id,
        tx_ref: reference,
      });
    } catch (paystackError: any) {
      // Clean up pending subscription if Paystack call fails
      await supabase.from('subscriptions').delete().eq('id', subscription.id);
      console.error('[Subscriptions] Paystack error:', paystackError?.response?.data || paystackError.message);
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

    // Cancel via Paystack if we have a subscription code
    if (subscription.paystack_subscription_code) {
      try {
        await PaystackService.disableSubscription(subscription.paystack_subscription_code);
      } catch (psError: any) {
        console.warn('[Subscriptions] Paystack cancel warning:', psError?.response?.data || psError.message);
        // Continue with local cancellation even if Paystack call fails
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
