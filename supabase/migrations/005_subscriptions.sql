-- MedQuire Subscriptions & Payments Schema
-- Based on implementation-plan-flutterwave.md Phase 1

-- 1. Add plan column to users (if using public.users; otherwise rely on auth.users metadata)
-- Note: If you use auth.users metadata instead, adjust accordingly.
-- We add to a public users table or profiles table here:
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  plan TEXT NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE', 'PREMIUM')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert existing auth users into public.users on first migration (idempotent)
INSERT INTO public.users (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- 2. Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  plan TEXT NOT NULL CHECK (plan IN ('PREMIUM_MONTHLY', 'PREMIUM_YEARLY')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED')),

  tx_ref TEXT NOT NULL UNIQUE,

  flutterwave_customer_id TEXT,
  flutterwave_subscription_id TEXT,

  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tx_ref ON subscriptions(tx_ref);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- 3. Payments table
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,

  amount NUMERIC(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',

  gateway TEXT NOT NULL DEFAULT 'flutterwave',
  gateway_reference TEXT NOT NULL UNIQUE,

  status TEXT NOT NULL CHECK (status IN ('paid', 'failed')),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_subscription_id ON payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payments_gateway_reference ON payments(gateway_reference);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- 4. RPC: process_subscription_payment (first-time activation)
CREATE OR REPLACE FUNCTION process_subscription_payment(
  p_user_id UUID,
  p_subscription_id UUID,
  p_amount NUMERIC,
  p_currency TEXT,
  p_gateway_reference TEXT,
  p_current_period_start TIMESTAMPTZ,
  p_current_period_end TIMESTAMPTZ
) RETURNS void AS $$
BEGIN
  INSERT INTO payments (user_id, subscription_id, amount, currency, gateway, gateway_reference, status)
  VALUES (p_user_id, p_subscription_id, p_amount, p_currency, 'flutterwave', p_gateway_reference, 'paid');

  UPDATE subscriptions
  SET status = 'ACTIVE',
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      updated_at = NOW()
  WHERE id = p_subscription_id;

  UPDATE public.users
  SET plan = 'PREMIUM'
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- 5. RPC: process_subscription_renewal
CREATE OR REPLACE FUNCTION process_subscription_renewal(
  p_subscription_id UUID,
  p_amount NUMERIC,
  p_currency TEXT,
  p_gateway_reference TEXT,
  p_current_period_start TIMESTAMPTZ,
  p_current_period_end TIMESTAMPTZ
) RETURNS void AS $$
BEGIN
  INSERT INTO payments (user_id, subscription_id, amount, currency, gateway, gateway_reference, status)
  SELECT user_id, id, p_amount, p_currency, 'flutterwave', p_gateway_reference, 'paid'
  FROM subscriptions WHERE id = p_subscription_id;

  UPDATE subscriptions
  SET status = 'ACTIVE',
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      updated_at = NOW()
  WHERE id = p_subscription_id;
END;
$$ LANGUAGE plpgsql;

-- 6. RPC: mark_subscription_past_due
CREATE OR REPLACE FUNCTION mark_subscription_past_due(
  p_subscription_id UUID,
  p_gateway_reference TEXT
) RETURNS void AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM subscriptions WHERE id = p_subscription_id;

  INSERT INTO payments (user_id, subscription_id, amount, currency, gateway, gateway_reference, status)
  VALUES (v_user_id, p_subscription_id, 0, 'USD', 'flutterwave', p_gateway_reference, 'failed');

  UPDATE subscriptions
  SET status = 'PAST_DUE',
      updated_at = NOW()
  WHERE id = p_subscription_id;
END;
$$ LANGUAGE plpgsql;

-- 7. RPC: cancel_subscription
CREATE OR REPLACE FUNCTION cancel_subscription(
  p_subscription_id UUID
) RETURNS void AS $$
BEGIN
  UPDATE subscriptions
  SET status = 'CANCELLED',
      updated_at = NOW()
  WHERE id = p_subscription_id
    AND status IN ('ACTIVE', 'PAST_DUE');
END;
$$ LANGUAGE plpgsql;

-- 8. RPC: expire_past_due_subscriptions (call daily via cron)
CREATE OR REPLACE FUNCTION expire_past_due_subscriptions() RETURNS void AS $$
BEGIN
  UPDATE subscriptions
  SET status = 'EXPIRED', updated_at = NOW()
  WHERE status = 'PAST_DUE'
    AND current_period_end < NOW() - INTERVAL '7 days';

  UPDATE public.users
  SET plan = 'FREE'
  WHERE id IN (
    SELECT user_id FROM subscriptions
    WHERE status = 'EXPIRED' AND updated_at > NOW() - INTERVAL '1 minute'
  );
END;
$$ LANGUAGE plpgsql;

-- 9. Trigger: auto-update updated_at on subscriptions
CREATE OR REPLACE FUNCTION update_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_subscriptions_updated_at();

-- 10. RLS Policies
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Subscriptions: users can view their own
CREATE POLICY "Users can view own subscriptions"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Subscriptions: service role manages all (for backend)
CREATE POLICY "Service role manages all subscriptions"
  ON subscriptions FOR ALL
  USING (auth.role() = 'service_role');

-- Payments: users can view their own
CREATE POLICY "Users can view own payments"
  ON payments FOR SELECT
  USING (auth.uid() = user_id);

-- Payments: service role manages all
CREATE POLICY "Service role manages all payments"
  ON payments FOR ALL
  USING (auth.role() = 'service_role');
