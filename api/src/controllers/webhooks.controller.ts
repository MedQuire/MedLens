import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import FlutterwaveService from '../services/flutterwave.service';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase configuration missing');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const PERIOD_DAYS: Record<string, number> = {
  PREMIUM_MONTHLY: 30,
  PREMIUM_YEARLY: 365,
};

async function processChargeCompleted(payload: any, res: Response) {
  const supabase = getSupabase();
  const txRef = payload.data?.tx_ref;
  const transactionId = payload.data?.id;

  // 1. Check required fields
  if (!txRef || !transactionId) {
    console.warn('[Webhook] Missing tx_ref or transaction id');
    return res.status(200).json({ status: 'ignored', reason: 'missing_fields' });
  }

  // 2. Check idempotency (gateway_reference already exists?)
  const { data: existingPayment } = await supabase
    .from('payments')
    .select('id')
    .eq('gateway_reference', String(transactionId))
    .maybeSingle();

  if (existingPayment) {
    console.log('[Webhook] Duplicate webhook — already processed:', transactionId);
    return res.status(200).json({ status: 'duplicate' });
  }

  // 3. Verify transaction with Flutterwave
  let verification;
  try {
    verification = await FlutterwaveService.verifyTransaction(transactionId);
  } catch (error: any) {
    console.error('[Webhook] Transaction verification failed:', error.message);
    return res.status(500).json({ error: 'Verification failed' });
  }

  // 4. Validate verification result
  if (verification.status !== 'success' || verification.data?.status !== 'successful') {
    console.warn('[Webhook] Transaction not successful:', verification.data?.status);
    return res.status(200).json({ status: 'ignored', reason: 'transaction_not_successful' });
  }

  // 5. Lookup subscription by tx_ref
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('tx_ref', verification.data.tx_ref)
    .maybeSingle();

  if (!subscription) {
    console.warn('[Webhook] Subscription not found for tx_ref:', verification.data.tx_ref);
    return res.status(200).json({ status: 'ignored', reason: 'subscription_not_found' });
  }

  // 6. Validate amount and currency match
  const expectedAmount = subscription.plan === 'PREMIUM_MONTHLY' ? 9.99 : 89.99;
  if (
    Number(verification.data.amount) !== expectedAmount ||
    verification.data.currency !== 'USD'
  ) {
    console.warn('[Webhook] Amount/currency mismatch:', {
      expected: `${expectedAmount} USD`,
      actual: `${verification.data.amount} ${verification.data.currency}`,
    });
    return res.status(200).json({ status: 'ignored', reason: 'amount_mismatch' });
  }

  // 7. Determine if this is a first payment or renewal
  const isFirstPayment = subscription.status === 'PENDING';
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setDate(periodEnd.getDate() + (PERIOD_DAYS[subscription.plan] || 30));

  if (isFirstPayment) {
    // First-time activation
    const { error: rpcError } = await supabase.rpc('process_subscription_payment', {
      p_user_id: subscription.user_id,
      p_subscription_id: subscription.id,
      p_amount: Number(verification.data.amount),
      p_currency: verification.data.currency,
      p_gateway_reference: String(transactionId),
      p_current_period_start: now.toISOString(),
      p_current_period_end: periodEnd.toISOString(),
    });

    if (rpcError) {
      console.error('[Webhook] Activation RPC error:', rpcError.message);
      return res.status(500).json({ error: 'Database error' });
    }

    // Update flutterwave IDs on subscription
    await supabase
      .from('subscriptions')
      .update({
        flutterwave_customer_id: verification.data.customer?.id ? String(verification.data.customer.id) : null,
        flutterwave_subscription_id: payload.data?.id ? String(payload.data.id) : null,
      })
      .eq('id', subscription.id);

    console.log('[Webhook] Subscription activated:', subscription.id);
  } else {
    // Renewal
    const { error: rpcError } = await supabase.rpc('process_subscription_renewal', {
      p_subscription_id: subscription.id,
      p_amount: Number(verification.data.amount),
      p_currency: verification.data.currency,
      p_gateway_reference: String(transactionId),
      p_current_period_start: now.toISOString(),
      p_current_period_end: periodEnd.toISOString(),
    });

    if (rpcError) {
      console.error('[Webhook] Renewal RPC error:', rpcError.message);
      return res.status(500).json({ error: 'Database error' });
    }

    console.log('[Webhook] Subscription renewed:', subscription.id);
  }

  return res.status(200).json({ status: 'success' });
}

export async function handleFlutterwaveWebhook(req: Request, res: Response) {
  try {
    // 1. Verify webhook signature
    const signature = req.headers['verif-hash'] as string | undefined;
    if (!FlutterwaveService.verifyWebhookSignature(signature)) {
      console.warn('[Webhook] Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = req.body;
    const event = payload.event || 'unknown';

    console.log(`[Webhook] Received event: ${event}`);

    // 2. Route based on event type
    switch (event) {
      case 'charge.completed':
      case 'subscriptization.completed':
        await processChargeCompleted(payload, res);
        break;

      case 'subscription.payment':
        // Renewal payment
        await processChargeCompleted(payload, res);
        break;

      case 'subscription.failed':
        // Mark as PAST_DUE
        const supabase = getSupabase();
        const txRef = payload.data?.tx_ref;
        if (txRef) {
          const { data: sub } = await supabase
            .from('subscriptions')
            .select('id')
            .eq('tx_ref', txRef)
            .maybeSingle();

          if (sub) {
            await supabase.rpc('mark_subscription_past_due', {
              p_subscription_id: sub.id,
              p_gateway_reference: String(payload.data?.id || `${txRef}_failed`),
            });
            console.log('[Webhook] Subscription marked PAST_DUE:', sub.id);
          }
        }
        return res.status(200).json({ status: 'past_due' });

      case 'subscription.cancelled':
        // Mark as CANCELLED
        const supabase2 = getSupabase();
        const fwSubId = payload.data?.id;
        if (fwSubId) {
          const { data: sub } = await supabase2
            .from('subscriptions')
            .select('id')
            .eq('flutterwave_subscription_id', String(fwSubId))
            .maybeSingle();

          if (sub) {
            await supabase2.rpc('cancel_subscription', {
              p_subscription_id: sub.id,
            });
            console.log('[Webhook] Subscription cancelled:', sub.id);
          }
        }
        return res.status(200).json({ status: 'cancelled' });

      default:
        console.log('[Webhook] Unhandled event type:', event);
        return res.status(200).json({ status: 'unhandled' });
    }
  } catch (error: any) {
    console.error('[Webhook] Error:', error.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
