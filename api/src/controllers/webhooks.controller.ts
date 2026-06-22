import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import PaystackService from '../services/paystack.service';

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

async function processChargeSuccess(payload: any, res: Response) {
  const supabase = getSupabase();
  const reference = payload.data?.reference;

  if (!reference) {
    console.warn('[Webhook] Missing reference');
    return res.status(200).json({ status: 'ignored', reason: 'missing_reference' });
  }

  // Idempotency check
  const { data: existingPayment } = await supabase
    .from('payments')
    .select('id')
    .eq('gateway_reference', reference)
    .maybeSingle();

  if (existingPayment) {
    console.log('[Webhook] Duplicate webhook — already processed:', reference);
    return res.status(200).json({ status: 'duplicate' });
  }

  // Verify transaction with Paystack
  let verification;
  try {
    verification = await PaystackService.verifyTransaction(reference);
  } catch (error: any) {
    console.error('[Webhook] Transaction verification failed:', error.message);
    return res.status(500).json({ error: 'Verification failed' });
  }

  if (!verification.status || verification.data?.status !== 'success') {
    console.warn('[Webhook] Transaction not successful:', verification.data?.status);
    return res.status(200).json({ status: 'ignored', reason: 'transaction_not_successful' });
  }

  // Lookup subscription by tx_ref (reference)
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('tx_ref', reference)
    .maybeSingle();

  if (!subscription) {
    console.warn('[Webhook] Subscription not found for reference:', reference);
    return res.status(200).json({ status: 'ignored', reason: 'subscription_not_found' });
  }

  // Validate amount and currency (Paystack amounts are in cents)
  const expectedAmount = subscription.plan === 'PREMIUM_MONTHLY' ? 999 : 8999;
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

  // Determine if this is a first payment or renewal
  const isFirstPayment = subscription.status === 'PENDING';
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setDate(periodEnd.getDate() + (PERIOD_DAYS[subscription.plan] || 30));

  if (isFirstPayment) {
    const { error: rpcError } = await supabase.rpc('process_subscription_payment', {
      p_user_id: subscription.user_id,
      p_subscription_id: subscription.id,
      p_amount: Number(verification.data.amount) / 100,
      p_currency: verification.data.currency,
      p_gateway_reference: reference,
      p_current_period_start: now.toISOString(),
      p_current_period_end: periodEnd.toISOString(),
    });

    if (rpcError) {
      console.error('[Webhook] Activation RPC error:', rpcError.message);
      return res.status(500).json({ error: 'Database error' });
    }

    // Store Paystack customer code on subscription
    const customerCode = verification.data.customer?.customer_code;
    if (customerCode) {
      await supabase
        .from('subscriptions')
        .update({ paystack_customer_code: customerCode })
        .eq('id', subscription.id);
    }

    console.log('[Webhook] Subscription activated:', subscription.id);
  } else {
    const { error: rpcError } = await supabase.rpc('process_subscription_renewal', {
      p_subscription_id: subscription.id,
      p_amount: Number(verification.data.amount) / 100,
      p_currency: verification.data.currency,
      p_gateway_reference: reference,
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

export async function handlePaystackWebhook(req: Request, res: Response) {
  try {
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const signature = req.headers['x-paystack-signature'] as string | undefined;

    if (!PaystackService.verifyWebhookSignature(signature, rawBody)) {
      console.warn('[Webhook] Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = req.body;
    const event = payload.event || 'unknown';

    console.log(`[Webhook] Received event: ${event}`);

    switch (event) {
      case 'charge.success':
        await processChargeSuccess(payload, res);
        break;

      case 'subscription.disable':
        const supabase = getSupabase();
        const subCode = payload.data?.subscription_code;
        if (subCode) {
          const { data: sub } = await supabase
            .from('subscriptions')
            .select('id')
            .eq('paystack_subscription_code', subCode)
            .maybeSingle();

          if (sub) {
            await supabase.rpc('cancel_subscription', {
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
