-- =========================================================================
-- GKB TECHNOLOGIES — SMART LIGHT CONTROL SYSTEM (MULTI-CHANNEL)
-- HARDENED PRODUCTION / LAB SQL SETUP SCRIPT (ENTERPRISE-GRADE)
-- =========================================================================
-- Comprehensive Security Architecture:
-- 1. Table Schema: public.light_control_status (supports 4, 6, and 8 channel devices)
-- 2. Idempotent Schema Migration: Checks both table_schema = 'public' and table_name.
-- 3. Default Seeds: light_01 (4-ch), light_02 (6-ch), light_03 (8-ch).
-- 4. Principle of Least Privilege:
--    - REVOKE ALL from PUBLIC, anon, and authenticated.
--    - GRANT SELECT on table to anon, authenticated.
--    - GRANT UPDATE ONLY on the channel boolean columns (ch1..ch8) - prevents
--      clients from modifying device_id, channel_count, or timestamps.
-- 5. Comprehensive RLS Reset: Dynamically queries pg_policies and drops ALL
--    prior policies on the table to eliminate rogue or permissive bypasses.
-- 6. Row-Level Security Policies:
--    - SELECT: Open read for monitoring dashboards.
--    - UPDATE: Enforces device_id whitelist (light_01, light_02, light_03).
-- 7. BEFORE UPDATE Trigger Guardrail:
--    - Resets NEW.device_id = OLD.device_id and NEW.channel_count = OLD.channel_count.
--    - Automatically forces out-of-range channels (e.g. ch5 on 4-ch board) to false.
--    - Automatically refreshes NEW.updated_at = now().
-- 8. Secure Postgres RPC Function: public.set_light_channel()
--    - Validates device exists and channel is within device's channel_count bounds.
--    - Atomic and tamper-proof command routing.
-- =========================================================================

-- 1. Create table for multi-channel relay states
CREATE TABLE IF NOT EXISTS public.light_control_status (
  device_id text PRIMARY KEY,
  channel_count integer NOT NULL DEFAULT 4,
  ch1 boolean NOT NULL DEFAULT false,
  ch2 boolean NOT NULL DEFAULT false,
  ch3 boolean NOT NULL DEFAULT false,
  ch4 boolean NOT NULL DEFAULT false,
  ch5 boolean NOT NULL DEFAULT false,
  ch6 boolean NOT NULL DEFAULT false,
  ch7 boolean NOT NULL DEFAULT false,
  ch8 boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

-- 2. Ensure columns exist idempotently with explicit table_schema = 'public' check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'light_control_status' 
      AND column_name = 'ch5'
  ) THEN
    ALTER TABLE public.light_control_status ADD COLUMN ch5 boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'light_control_status' 
      AND column_name = 'ch6'
  ) THEN
    ALTER TABLE public.light_control_status ADD COLUMN ch6 boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'light_control_status' 
      AND column_name = 'ch7'
  ) THEN
    ALTER TABLE public.light_control_status ADD COLUMN ch7 boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'light_control_status' 
      AND column_name = 'ch8'
  ) THEN
    ALTER TABLE public.light_control_status ADD COLUMN ch8 boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- 3. Seed initial records for fleet devices
INSERT INTO public.light_control_status (device_id, channel_count, ch1, ch2, ch3, ch4)
VALUES ('light_01', 4, false, false, false, false)
ON CONFLICT (device_id) DO NOTHING;

INSERT INTO public.light_control_status (device_id, channel_count, ch1, ch2, ch3, ch4, ch5, ch6)
VALUES ('light_02', 6, false, false, false, false, false, false)
ON CONFLICT (device_id) DO NOTHING;

INSERT INTO public.light_control_status (device_id, channel_count, ch1, ch2, ch3, ch4, ch5, ch6, ch7, ch8)
VALUES ('light_03', 8, false, false, false, false, false, false, false, false)
ON CONFLICT (device_id) DO NOTHING;

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.light_control_status ENABLE ROW LEVEL SECURITY;

-- 5. Revoke all privileges from PUBLIC and API roles to enforce clean slate
REVOKE ALL ON public.light_control_status FROM PUBLIC;
REVOKE ALL ON public.light_control_status FROM anon, authenticated;

-- 6. Grant granular least-privilege permissions:
--    - SELECT: Read relay status
--    - UPDATE: Constrained strictly to the channel boolean columns (cannot alter device_id or channel_count)
GRANT SELECT ON public.light_control_status TO anon, authenticated;
GRANT UPDATE (ch1, ch2, ch3, ch4, ch5, ch6, ch7, ch8) ON public.light_control_status TO anon, authenticated;

-- 7. Clean dynamic drop of ALL existing policies on this table
--    (Guarantees no orphaned, permissive, or duplicate policies remain)
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'light_control_status'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.light_control_status', pol.policyname);
  END LOOP;
END $$;

-- 8. Policy: Read access for status monitoring
CREATE POLICY light_control_read_policy
  ON public.light_control_status
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- 9. Policy: Hardened direct update policy (Lab / Pilot Mode)
--    Enforces that only registered fleet device IDs can be targeted
CREATE POLICY light_control_update_policy
  ON public.light_control_status
  FOR UPDATE
  TO anon, authenticated
  USING (device_id IN ('light_01', 'light_02', 'light_03'))
  WITH CHECK (device_id IN ('light_01', 'light_02', 'light_03'));

-- 10. Trigger: Auto-update timestamp & enforce immutability of system columns
CREATE OR REPLACE FUNCTION update_light_control_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  -- Always set updated_at to current server timestamp
  NEW.updated_at = now();

  -- Immutable Column Guardrails:
  -- Prevent client from mutating device_id or channel_count via any UPDATE query
  NEW.device_id = OLD.device_id;
  NEW.channel_count = OLD.channel_count;

  -- Channel Boundary Enforcement:
  -- Ensure inactive channels beyond the hardware channel_count cannot be set to true
  IF NEW.channel_count < 5 THEN NEW.ch5 = false; END IF;
  IF NEW.channel_count < 6 THEN NEW.ch6 = false; END IF;
  IF NEW.channel_count < 7 THEN NEW.ch7 = false; END IF;
  IF NEW.channel_count < 8 THEN NEW.ch8 = false; END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_light_control_timestamp ON public.light_control_status;
CREATE TRIGGER trg_update_light_control_timestamp
  BEFORE UPDATE ON public.light_control_status
  FOR EACH ROW
  EXECUTE FUNCTION update_light_control_timestamp();

-- 11. Secure Atomic RPC Command Endpoint: public.set_light_channel()
--     Recommended approach for production web clients and microservices:
--     Validates channel count and device ID before applying updates.
CREATE OR REPLACE FUNCTION public.set_light_channel(
  p_device_id text,
  p_channel integer,
  p_state boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Validate registered device
  SELECT channel_count INTO v_count
  FROM public.light_control_status
  WHERE device_id = p_device_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Device "%" is not a registered light controller.', p_device_id;
  END IF;

  -- Validate channel boundary for this device
  IF p_channel < 1 OR p_channel > v_count THEN
    RAISE EXCEPTION 'Channel % is out of bounds for device "%" (max channels: %).', p_channel, p_device_id, v_count;
  END IF;

  -- Apply targeted channel update
  CASE p_channel
    WHEN 1 THEN UPDATE public.light_control_status SET ch1 = p_state, updated_at = now() WHERE device_id = p_device_id;
    WHEN 2 THEN UPDATE public.light_control_status SET ch2 = p_state, updated_at = now() WHERE device_id = p_device_id;
    WHEN 3 THEN UPDATE public.light_control_status SET ch3 = p_state, updated_at = now() WHERE device_id = p_device_id;
    WHEN 4 THEN UPDATE public.light_control_status SET ch4 = p_state, updated_at = now() WHERE device_id = p_device_id;
    WHEN 5 THEN UPDATE public.light_control_status SET ch5 = p_state, updated_at = now() WHERE device_id = p_device_id;
    WHEN 6 THEN UPDATE public.light_control_status SET ch6 = p_state, updated_at = now() WHERE device_id = p_device_id;
    WHEN 7 THEN UPDATE public.light_control_status SET ch7 = p_state, updated_at = now() WHERE device_id = p_device_id;
    WHEN 8 THEN UPDATE public.light_control_status SET ch8 = p_state, updated_at = now() WHERE device_id = p_device_id;
  END CASE;

  RETURN jsonb_build_object(
    'success', true,
    'device_id', p_device_id,
    'channel', p_channel,
    'state', p_state,
    'timestamp', now()
  );
END;
$$;

-- Secure function permissions
REVOKE ALL ON FUNCTION public.set_light_channel(text, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_light_channel(text, integer, boolean) TO anon, authenticated;

-- =========================================================================
-- PRODUCTION HARDENING NOTE:
-- When moving from open pilot testing to strict user-authenticated production:
-- Simply run:
--   DROP POLICY light_control_update_policy ON public.light_control_status;
--   REVOKE UPDATE ON public.light_control_status FROM anon;
--   REVOKE EXECUTE ON FUNCTION public.set_light_channel FROM anon;
-- This immediately restricts relay switching strictly to authenticated users.
-- =========================================================================

-- 12. Verification Query
SELECT * FROM public.light_control_status;
