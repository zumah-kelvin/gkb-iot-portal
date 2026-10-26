-- =========================================================================
-- GKB TECHNOLOGIES — ESP32 SMART RELAY PILOT: ENABLE CLOUD ACTUATION
-- =========================================================================
-- This script grants the public portal (anon publishable key) permission to
-- read and toggle relay_01 state directly, enabling instant web actuation
-- without requiring user sign-in or manual pairing.
--
-- How to apply:
-- 1. Open your Supabase Dashboard: https://supabase.com/dashboard/project/ditnksmvcacnzdguqcgz
-- 2. Click "SQL Editor" in the left sidebar.
-- 3. Click "New Query", paste this entire script, and click "Run".
-- =========================================================================

-- 1. Ensure table and columns exist
CREATE TABLE IF NOT EXISTS public.relay_status (
  device_id text PRIMARY KEY,
  state text NOT NULL DEFAULT 'OFF',
  updated_at timestamptz DEFAULT now()
);

-- 2. Ensure initial relay_01 record exists
INSERT INTO public.relay_status (device_id, state, updated_at)
VALUES ('relay_01', 'OFF', now())
ON CONFLICT (device_id) DO NOTHING;

-- 3. Grant SELECT and UPDATE permissions to anon and authenticated roles
GRANT SELECT, UPDATE (state, updated_at) ON public.relay_status TO anon, authenticated;

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.relay_status ENABLE ROW LEVEL SECURITY;

-- 5. Drop conflicting restrictive policies
DROP POLICY IF EXISTS relay_01_anon_read ON public.relay_status;
DROP POLICY IF EXISTS relay_01_anon_update ON public.relay_status;
DROP POLICY IF EXISTS relay_01_owner_update ON public.relay_status;
DROP POLICY IF EXISTS relay_01_owner_read ON public.relay_status;

-- 6. Create permissive read and update policies for relay_01
CREATE POLICY relay_01_anon_read
  ON public.relay_status
  FOR SELECT
  TO anon, authenticated
  USING (device_id = 'relay_01');

CREATE POLICY relay_01_anon_update
  ON public.relay_status
  FOR UPDATE
  TO anon, authenticated
  USING (device_id = 'relay_01')
  WITH CHECK (device_id = 'relay_01');

-- 7. Verification: Confirm relay_01 is accessible
SELECT device_id, state, updated_at FROM public.relay_status WHERE device_id = 'relay_01';
