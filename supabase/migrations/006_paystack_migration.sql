-- MedQuire Paystack Migration
-- Rename Flutterwave columns to Paystack, update RPCs

-- 1. Rename columns on subscriptions table
ALTER TABLE subscriptions RENAME COLUMN flutterwave_customer_id TO paystack_customer_code;
ALTER TABLE subscriptions RENAME COLUMN flutterwave_subscription_id TO paystack_subscription_code;

-- 2. Update payments gateway default
ALTER TABLE payments ALTER COLUMN gateway SET DEFAULT 'paystack';

-- 3. Recreate RPCs with 'paystack' as gateway
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
  VALUES (p_user_id, p_subscription_id, p_amount, p_currency, 'paystack', p_gateway_reference, 'paid');

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
  SELECT user_id, id, p_amount, p_currency, 'paystack', p_gateway_reference, 'paid'
  FROM subscriptions WHERE id = p_subscription_id;

  UPDATE subscriptions
  SET status = 'ACTIVE',
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      updated_at = NOW()
  WHERE id = p_subscription_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mark_subscription_past_due(
  p_subscription_id UUID,
  p_gateway_reference TEXT
) RETURNS void AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM subscriptions WHERE id = p_subscription_id;

  INSERT INTO payments (user_id, subscription_id, amount, currency, gateway, gateway_reference, status)
  VALUES (v_user_id, p_subscription_id, 0, 'USD', 'paystack', p_gateway_reference, 'failed');

  UPDATE subscriptions
  SET status = 'PAST_DUE',
      updated_at = NOW()
  WHERE id = p_subscription_id;
END;
$$ LANGUAGE plpgsql;
