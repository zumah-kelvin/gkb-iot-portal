-- =====================================================================================
-- GKB TECHNOLOGIES — SMART HOME SECURITY SYSTEM v1 (PIR SENSOR + SIREN RELAY + BUZZER)
-- Schema Setup, Row-Level Security (RLS), and Initial Fleet Seeding
-- =====================================================================================

-- 1. Create the home_security_status table
CREATE TABLE IF NOT EXISTS public.home_security_status (
  device_id TEXT PRIMARY KEY DEFAULT 'security_01',
  device_key TEXT NOT NULL DEFAULT 'GKBSEC-00106',
  armed_mode TEXT NOT NULL DEFAULT 'away' CHECK (armed_mode IN ('away', 'stay', 'disarmed')),
  alarm_state TEXT NOT NULL DEFAULT 'IDLE' CHECK (alarm_state IN ('IDLE', 'TRIPPED', 'MUTED')),
  motion_detected BOOLEAN NOT NULL DEFAULT false,
  siren_active BOOLEAN NOT NULL DEFAULT false,
  buzzer_active BOOLEAN NOT NULL DEFAULT false,
  sound_muted BOOLEAN NOT NULL DEFAULT false,
  pir_sensitivity TEXT NOT NULL DEFAULT 'high' CHECK (pir_sensitivity IN ('low', 'medium', 'high')),
  last_tripped_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  paired_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Seed initial primary fleet record: security_01
INSERT INTO public.home_security_status (
  device_id,
  device_key,
  armed_mode,
  alarm_state,
  motion_detected,
  siren_active,
  buzzer_active,
  sound_muted,
  pir_sensitivity,
  last_tripped_at
)
VALUES (
  'security_01',
  'GKBSEC-00106',
  'away',
  'IDLE',
  false,
  false,
  false,
  false,
  'high',
  timezone('utc'::text, now())
)
ON CONFLICT (device_id) DO NOTHING;

-- 3. Enable Row-Level Security (RLS)
ALTER TABLE public.home_security_status ENABLE ROW LEVEL SECURITY;

-- 4. Grant table privileges to anon and authenticated roles
GRANT SELECT, UPDATE, INSERT ON public.home_security_status TO anon, authenticated;

-- 5. Read policy: Allow public read access to fleet security devices
DROP POLICY IF EXISTS security_select_policy ON public.home_security_status;
CREATE POLICY security_select_policy
  ON public.home_security_status
  FOR SELECT
  TO anon, authenticated
  USING (device_id = 'security_01');

-- 6. Update policy: Allow updating security state, arming modes, and alarms
DROP POLICY IF EXISTS security_update_policy ON public.home_security_status;
CREATE POLICY security_update_policy
  ON public.home_security_status
  FOR UPDATE
  TO anon, authenticated
  USING (device_id = 'security_01')
  WITH CHECK (device_id = 'security_01');

-- 7. Timestamp Auto-Update Trigger
CREATE OR REPLACE FUNCTION update_security_status_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_security_status_timestamp ON public.home_security_status;
CREATE TRIGGER trg_update_security_status_timestamp
  BEFORE UPDATE ON public.home_security_status
  FOR EACH ROW
  EXECUTE FUNCTION update_security_status_timestamp();

-- 8. Enable Realtime Replication
ALTER PUBLICATION supabase_realtime ADD TABLE public.home_security_status;

-- 9. RPC: Set Armed Mode ('away', 'stay', 'disarmed')
CREATE OR REPLACE FUNCTION public.set_security_armed_mode(p_mode TEXT)
RETURNS JSON AS $$
DECLARE
  v_updated RECORD;
BEGIN
  IF p_mode NOT IN ('away', 'stay', 'disarmed') THEN
    RAISE EXCEPTION 'Invalid armed mode: %. Must be away, stay, or disarmed', p_mode;
  END IF;

  -- If disarming, automatically clear active alarms and sirens
  IF p_mode = 'disarmed' THEN
    UPDATE public.home_security_status
    SET armed_mode = p_mode,
        alarm_state = 'IDLE',
        siren_active = false,
        buzzer_active = false,
        updated_at = timezone('utc'::text, now())
    WHERE device_id = 'security_01'
    RETURNING * INTO v_updated;
  ELSE
    UPDATE public.home_security_status
    SET armed_mode = p_mode,
        updated_at = timezone('utc'::text, now())
    WHERE device_id = 'security_01'
    RETURNING * INTO v_updated;
  END IF;

  RETURN row_to_json(v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.set_security_armed_mode(TEXT) TO anon, authenticated;

-- 10. RPC: Clear Alarm / Silence Siren
CREATE OR REPLACE FUNCTION public.clear_security_alarm()
RETURNS JSON AS $$
DECLARE
  v_updated RECORD;
BEGIN
  UPDATE public.home_security_status
  SET alarm_state = 'IDLE',
      siren_active = false,
      buzzer_active = false,
      motion_detected = false,
      updated_at = timezone('utc'::text, now())
  WHERE device_id = 'security_01'
  RETURNING * INTO v_updated;

  RETURN row_to_json(v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.clear_security_alarm() TO anon, authenticated;

-- 11. RPC: Panic Button / Manual Alarm Trigger
CREATE OR REPLACE FUNCTION public.trigger_security_panic()
RETURNS JSON AS $$
DECLARE
  v_updated RECORD;
BEGIN
  UPDATE public.home_security_status
  SET alarm_state = 'TRIPPED',
      siren_active = true,
      buzzer_active = true,
      motion_detected = true,
      last_tripped_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE device_id = 'security_01'
  RETURNING * INTO v_updated;

  RETURN row_to_json(v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.trigger_security_panic() TO anon, authenticated;
