-- =========================================================================
-- GKB TECHNOLOGIES — SMART LIGHT CONTROL SYSTEM (MULTI-CHANNEL)
-- =========================================================================
-- This script creates the light_control_status table and grants public
-- read/write access for the ESP32 multi-channel light controller and web portal.
--
-- Run this in your Supabase Dashboard -> SQL Editor -> Click 'Run'.
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

-- 2. Insert initial record for light_01 (4-channel default)
INSERT INTO public.light_control_status (device_id, channel_count, ch1, ch2, ch3, ch4)
VALUES ('light_01', 4, false, false, false, false)
ON CONFLICT (device_id) DO NOTHING;

-- Also insert records for v2 (6-channel) and v3 (8-channel)
INSERT INTO public.light_control_status (device_id, channel_count, ch1, ch2, ch3, ch4, ch5, ch6)
VALUES ('light_02', 6, false, false, false, false, false, false)
ON CONFLICT (device_id) DO NOTHING;

INSERT INTO public.light_control_status (device_id, channel_count, ch1, ch2, ch3, ch4, ch5, ch6, ch7, ch8)
VALUES ('light_03', 8, false, false, false, false, false, false, false, false)
ON CONFLICT (device_id) DO NOTHING;

-- 3. Grant SELECT and UPDATE permissions to anon and authenticated roles
GRANT SELECT, UPDATE ON public.light_control_status TO anon, authenticated;

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.light_control_status ENABLE ROW LEVEL SECURITY;

-- 5. Drop conflicting policies if any exist
DROP POLICY IF EXISTS light_control_anon_read ON public.light_control_status;
DROP POLICY IF EXISTS light_control_anon_update ON public.light_control_status;

-- 6. Create permissive read and update policies
CREATE POLICY light_control_anon_read
  ON public.light_control_status
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY light_control_anon_update
  ON public.light_control_status
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Verification:
SELECT * FROM public.light_control_status;
