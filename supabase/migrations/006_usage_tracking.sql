-- MedQuire Free vs Pro Usage Tracking
-- Based on freemium feature gating requirements

-- 1. Usage tracking table
-- Stores per-user, per-feature daily counters
CREATE TABLE IF NOT EXISTS usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL CHECK (feature IN ('search', 'interaction', 'save')),
  count INT NOT NULL DEFAULT 0,
  last_reset_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, feature)
);

CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_id ON usage_tracking(user_id);

-- 2. RLS
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage"
  ON usage_tracking FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages all usage"
  ON usage_tracking FOR ALL
  USING (auth.role() = 'service_role');

-- 3. RPC: increment usage counter (handles reset and insert)
CREATE OR REPLACE FUNCTION increment_usage(
  p_user_id UUID,
  p_feature TEXT
) RETURNS TABLE(current_count INT, limit_reached BOOLEAN) AS $$
DECLARE
  v_reset_interval INTERVAL;
  v_limit INT;
  v_current_count INT;
BEGIN
  -- Determine reset interval and limit per feature
  IF p_feature = 'search' THEN
    v_reset_interval := INTERVAL '24 hours';
    v_limit := 5;
  ELSIF p_feature = 'interaction' THEN
    v_reset_interval := INTERVAL '24 hours';
    v_limit := 2;
  ELSIF p_feature = 'save' THEN
    v_reset_interval := NULL; -- no auto-reset for saves
    v_limit := 3;
  END IF;

  -- Upsert: insert or update row
  INSERT INTO usage_tracking (user_id, feature, count, last_reset_at)
  VALUES (p_user_id, p_feature, 1, NOW())
  ON CONFLICT (user_id, feature) DO UPDATE SET
    count = CASE
      -- If reset interval elapsed, reset to 1
      WHEN v_reset_interval IS NOT NULL
        AND usage_tracking.last_reset_at < NOW() - v_reset_interval
      THEN 1
      -- Otherwise increment
      ELSE usage_tracking.count + 1
    END,
    last_reset_at = CASE
      WHEN v_reset_interval IS NOT NULL
        AND usage_tracking.last_reset_at < NOW() - v_reset_interval
      THEN NOW()
      ELSE usage_tracking.last_reset_at
    END,
    updated_at = NOW()
  RETURNING count INTO v_current_count;

  -- Check if limit reached
  RETURN QUERY
  SELECT
    v_current_count AS current_count,
    v_current_count > v_limit AS limit_reached;
END;
$$ LANGUAGE plpgsql;

-- 4. RPC: get usage counters for a user
CREATE OR REPLACE FUNCTION get_usage_counts(p_user_id UUID)
RETURNS TABLE(feature TEXT, count INT, limit INT, resets_at TIMESTAMPTZ) AS $$
DECLARE
  v_save_count INT;
BEGIN
  -- Search usage
  RETURN QUERY
  SELECT
    ut.feature,
    ut.count,
    CASE
      WHEN ut.feature = 'search' THEN 5
      WHEN ut.feature = 'interaction' THEN 2
      WHEN ut.feature = 'save' THEN 3
    END AS limit,
    CASE
      WHEN ut.feature IN ('search', 'interaction') THEN ut.last_reset_at + INTERVAL '24 hours'
      ELSE NULL
    END AS resets_at
  FROM usage_tracking ut
  WHERE ut.user_id = p_user_id;

  -- If no save row exists yet, count from cabinet_items
  SELECT COUNT(*) INTO v_save_count
  FROM cabinet_items
  WHERE user_id = p_user_id AND deleted_at IS NULL;

  -- Return save count as synthetic row if not in usage_tracking
  IF NOT EXISTS (SELECT 1 FROM usage_tracking WHERE user_id = p_user_id AND feature = 'save') THEN
    RETURN QUERY SELECT
      'save'::TEXT,
      v_save_count::INT,
      3::INT,
      NULL::TIMESTAMPTZ;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 5. RPC: check if user can perform an action (without incrementing)
CREATE OR REPLACE FUNCTION check_usage_limit(
  p_user_id UUID,
  p_feature TEXT
) RETURNS TABLE(allowed BOOLEAN, current_count INT, max_limit INT) AS $$
DECLARE
  v_max INT;
  v_count INT;
BEGIN
  v_max := CASE
    WHEN p_feature = 'search' THEN 5
    WHEN p_feature = 'interaction' THEN 2
    WHEN p_feature = 'save' THEN 3
    ELSE 0
  END;

  -- Get current count (respecting resets for daily features)
  SELECT COALESCE(
    (SELECT
      CASE
        WHEN ut.last_reset_at < NOW() - INTERVAL '24 hours' AND ut.feature IN ('search', 'interaction')
        THEN 0
        ELSE ut.count
      END
    FROM usage_tracking ut
    WHERE ut.user_id = p_user_id AND ut.feature = p_feature),
    0
  ) INTO v_count;

  -- For saves, also count from cabinet_items
  IF p_feature = 'save' AND v_count = 0 THEN
    SELECT COUNT(*) INTO v_count
    FROM cabinet_items
    WHERE user_id = p_user_id AND deleted_at IS NULL;
  END IF;

  RETURN QUERY SELECT
    v_count < v_max AS allowed,
    v_count::INT AS current_count,
    v_max::INT AS max_limit;
END;
$$ LANGUAGE plpgsql;

-- 6. Trigger: auto-update updated_at
CREATE TRIGGER trg_usage_tracking_updated_at
  BEFORE UPDATE ON usage_tracking
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
