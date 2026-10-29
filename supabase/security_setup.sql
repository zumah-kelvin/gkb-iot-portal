-- =====================================================================================
-- GKB TECHNOLOGIES — SMART HOME SECURITY SYSTEM v1 (PIR + SIREN RELAY + BUZZER + GSM SIM800L)
-- Schema Setup, Row-Level Security (RLS), GSM Telemetry Seeding & Helper RPCs
-- =====================================================================================

-- 1. Create the home_security_status table (if not exists)
CREATE TABLE IF NOT EXISTS public.home_security_status (
  device_id TEXT PRIMARY KEY DEFAULT 'security_01',
  device_key TEXT NOT NULL DEFAULT 'GKB-SEC-0001',
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

-- 2. Add GSM Cellular Modem Subsystem Columns (Idempotent for existing databases)
ALTER TABLE public.home_security_status
  ADD COLUMN IF NOT EXISTS gsm_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS gsm_signal_csq INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS gsm_network_operator TEXT NOT NULL DEFAULT 'MTN-GH',
  ADD COLUMN IF NOT EXISTS gsm_sim_status TEXT NOT NULL DEFAULT 'READY',
  ADD COLUMN IF NOT EXISTS gsm_call_state TEXT NOT NULL DEFAULT 'IDLE',
  ADD COLUMN IF NOT EXISTS gsm_last_sms_status TEXT NOT NULL DEFAULT 'IDLE',
  ADD COLUMN IF NOT EXISTS primary_phone TEXT NOT NULL DEFAULT '+233256905290',
  ADD COLUMN IF NOT EXISTS secondary_phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sms_on_alarm BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS call_on_alarm BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_on_arm_disarm BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_sms_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_call_made_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gsm_test_requested TEXT DEFAULT 'NONE';

-- 3. Seed initial primary fleet record: security_01
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
  last_tripped_at,
  gsm_enabled,
  gsm_signal_csq,
  gsm_network_operator,
  gsm_sim_status,
  gsm_call_state,
  gsm_last_sms_status,
  primary_phone,
  secondary_phone,
  sms_on_alarm,
  call_on_alarm,
  sms_on_arm_disarm
)
VALUES (
  'security_01',
  'GKB-SEC-0001',
  'away',
  'IDLE',
  false,
  false,
  false,
  false,
  'high',
  timezone('utc'::text, now()),
  true,
  24,
  'MTN-GH',
  'READY',
  'IDLE',
  'IDLE',
  '+233256905290',
  '',
  true,
  true,
  false
)
ON CONFLICT (device_id) DO UPDATE SET
  device_key = EXCLUDED.device_key,
  gsm_enabled = COALESCE(public.home_security_status.gsm_enabled, EXCLUDED.gsm_enabled),
  primary_phone = EXCLUDED.primary_phone,
  sms_on_alarm = COALESCE(public.home_security_status.sms_on_alarm, EXCLUDED.sms_on_alarm),
  call_on_alarm = COALESCE(public.home_security_status.call_on_alarm, EXCLUDED.call_on_alarm);

-- 4. Enable Row-Level Security (RLS)
ALTER TABLE public.home_security_status ENABLE ROW LEVEL SECURITY;

-- 5. Grant table privileges to anon and authenticated roles
GRANT SELECT, UPDATE, INSERT ON public.home_security_status TO anon, authenticated;

-- 6. Read policy: Allow public read access to fleet security devices
DROP POLICY IF EXISTS security_select_policy ON public.home_security_status;
CREATE POLICY security_select_policy
  ON public.home_security_status
  FOR SELECT
  TO anon, authenticated
  USING (device_id = 'security_01');

-- 7. Update policy: Allow updating security state, arming modes, and GSM settings
DROP POLICY IF EXISTS security_update_policy ON public.home_security_status;
CREATE POLICY security_update_policy
  ON public.home_security_status
  FOR UPDATE
  TO anon, authenticated
  USING (device_id = 'security_01')
  WITH CHECK (device_id = 'security_01');

-- 8. Timestamp Auto-Update Trigger
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

-- 9. Enable Realtime Replication (Idempotent check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'home_security_status'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.home_security_status;
  END IF;
END;
$$;

-- 10. RPC: Set Armed Mode ('away', 'stay', 'disarmed')
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

-- 11. RPC: Clear Alarm / Silence Siren
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

-- 12. RPC: Panic Button / Manual Alarm Trigger
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

-- 13. RPC: Update Emergency Contacts & GSM Dispatch Rules
CREATE OR REPLACE FUNCTION public.update_security_gsm_settings(
  p_primary_phone TEXT,
  p_secondary_phone TEXT,
  p_sms_on_alarm BOOLEAN,
  p_call_on_alarm BOOLEAN,
  p_sms_on_arm_disarm BOOLEAN,
  p_gsm_enabled BOOLEAN DEFAULT true
)
RETURNS JSON AS $$
DECLARE
  v_updated RECORD;
BEGIN
  UPDATE public.home_security_status
  SET primary_phone = p_primary_phone,
      secondary_phone = p_secondary_phone,
      sms_on_alarm = p_sms_on_alarm,
      call_on_alarm = p_call_on_alarm,
      sms_on_arm_disarm = p_sms_on_arm_disarm,
      gsm_enabled = p_gsm_enabled,
      updated_at = timezone('utc'::text, now())
  WHERE device_id = 'security_01'
  RETURNING * INTO v_updated;

  RETURN row_to_json(v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.update_security_gsm_settings(TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO anon, authenticated;

-- 14. RPC: Request GSM Live Test (SMS or Call)
CREATE OR REPLACE FUNCTION public.trigger_security_gsm_test(p_test_type TEXT)
RETURNS JSON AS $$
DECLARE
  v_updated RECORD;
BEGIN
  IF p_test_type NOT IN ('TEST_SMS', 'TEST_CALL', 'NONE') THEN
    RAISE EXCEPTION 'Invalid test type: %. Must be TEST_SMS or TEST_CALL', p_test_type;
  END IF;

  UPDATE public.home_security_status
  SET gsm_test_requested = p_test_type,
      updated_at = timezone('utc'::text, now())
  WHERE device_id = 'security_01'
  RETURNING * INTO v_updated;

  RETURN row_to_json(v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.trigger_security_gsm_test(TEXT) TO anon, authenticated;

