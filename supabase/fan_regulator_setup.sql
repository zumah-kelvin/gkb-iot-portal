-- =====================================================================================
-- GKB TECHNOLOGIES — SMART FAN REGULATOR SYSTEM (CAPACITOR RELAY BANK + DHT22)
-- Schema Setup, Row-Level Security (RLS), Initial Fleet Seeding & Helper RPCs
-- =====================================================================================

-- 1. Create the fan_regulator_status table
CREATE TABLE IF NOT EXISTS public.fan_regulator_status (
  device_id TEXT PRIMARY KEY DEFAULT 'fan_01',
  device_key TEXT NOT NULL DEFAULT 'GKB-FAN-0001',
  power_state BOOLEAN NOT NULL DEFAULT true,
  speed_level INTEGER NOT NULL DEFAULT 2 CHECK (speed_level >= 0 AND speed_level <= 5),
  mode TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'auto_temp', 'breeze', 'sleep')),
  temperature_c NUMERIC(4,1) NOT NULL DEFAULT 28.5,
  humidity_pct NUMERIC(4,1) NOT NULL DEFAULT 62.0,
  oscillation BOOLEAN NOT NULL DEFAULT false,
  reverse_direction BOOLEAN NOT NULL DEFAULT false,
  timer_minutes_remaining INTEGER NOT NULL DEFAULT 0,
  auto_target_temp_c NUMERIC(4,1) NOT NULL DEFAULT 26.0,
  sound_muted BOOLEAN NOT NULL DEFAULT false,
  relay_1 BOOLEAN NOT NULL DEFAULT false,  -- 1.5uF Capacitor Step (Speed 1)
  relay_2 BOOLEAN NOT NULL DEFAULT true,   -- 2.5uF Capacitor Step (Speed 2)
  relay_3 BOOLEAN NOT NULL DEFAULT false,  -- 3.5uF Capacitor Step (Speed 3)
  relay_4 BOOLEAN NOT NULL DEFAULT false,  -- Direct AC Mains (Speed 4/5)
  relay_osc BOOLEAN NOT NULL DEFAULT false,-- Oscillation motor relay
  estimated_watts INTEGER NOT NULL DEFAULT 32,
  paired_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Seed initial primary fleet record: fan_01
INSERT INTO public.fan_regulator_status (
  device_id,
  device_key,
  power_state,
  speed_level,
  mode,
  temperature_c,
  humidity_pct,
  oscillation,
  reverse_direction,
  timer_minutes_remaining,
  auto_target_temp_c,
  sound_muted,
  relay_1,
  relay_2,
  relay_3,
  relay_4,
  relay_osc,
  estimated_watts
)
VALUES (
  'fan_01',
  'GKB-FAN-0001',
  true,
  2,
  'manual',
  28.5,
  62.0,
  false,
  false,
  0,
  26.0,
  false,
  false,
  true,
  false,
  false,
  false,
  32
)
ON CONFLICT (device_id) DO NOTHING;

-- 3. Enable Row-Level Security (RLS)
ALTER TABLE public.fan_regulator_status ENABLE ROW LEVEL SECURITY;

-- 4. Grant table privileges to anon and authenticated roles
GRANT SELECT, UPDATE, INSERT ON public.fan_regulator_status TO anon, authenticated;

-- 5. Read policy: Allow public read access to fleet fan devices
DROP POLICY IF EXISTS fan_select_policy ON public.fan_regulator_status;
CREATE POLICY fan_select_policy
  ON public.fan_regulator_status
  FOR SELECT
  TO anon, authenticated
  USING (device_id = 'fan_01');

-- 6. Update policy: Allow updating fan states, speeds, and modes
DROP POLICY IF EXISTS fan_update_policy ON public.fan_regulator_status;
CREATE POLICY fan_update_policy
  ON public.fan_regulator_status
  FOR UPDATE
  TO anon, authenticated
  USING (device_id = 'fan_01')
  WITH CHECK (device_id = 'fan_01');

-- 7. Timestamp Auto-Update Trigger
CREATE OR REPLACE FUNCTION update_fan_status_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_fan_status_timestamp ON public.fan_regulator_status;
CREATE TRIGGER trg_update_fan_status_timestamp
  BEFORE UPDATE ON public.fan_regulator_status
  FOR EACH ROW
  EXECUTE FUNCTION update_fan_status_timestamp();

-- 8. Enable Realtime Replication (Idempotent check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'fan_regulator_status'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.fan_regulator_status;
  END IF;
END;
$$;

-- 9. RPC: Set Fan Speed (0 to 5)
CREATE OR REPLACE FUNCTION public.set_fan_speed(p_speed INTEGER)
RETURNS JSON AS $$
DECLARE
  v_updated RECORD;
  v_r1 BOOLEAN := false;
  v_r2 BOOLEAN := false;
  v_r3 BOOLEAN := false;
  v_r4 BOOLEAN := false;
  v_watts INTEGER := 0;
  v_power BOOLEAN := true;
BEGIN
  IF p_speed < 0 OR p_speed > 5 THEN
    RAISE EXCEPTION 'Invalid speed level: %. Must be between 0 and 5', p_speed;
  END IF;

  IF p_speed = 0 THEN
    v_power := false;
    v_watts := 0;
  ELSIF p_speed = 1 THEN
    v_r1 := true;
    v_watts := 16;
  ELSIF p_speed = 2 THEN
    v_r2 := true;
    v_watts := 32;
  ELSIF p_speed = 3 THEN
    v_r3 := true;
    v_watts := 48;
  ELSIF p_speed = 4 THEN
    v_r4 := true;
    v_watts := 65;
  ELSIF p_speed = 5 THEN
    v_r3 := true;
    v_r4 := true;
    v_watts := 78;
  END IF;

  UPDATE public.fan_regulator_status
  SET speed_level = p_speed,
      power_state = v_power,
      relay_1 = v_r1,
      relay_2 = v_r2,
      relay_3 = v_r3,
      relay_4 = v_r4,
      estimated_watts = v_watts,
      updated_at = timezone('utc'::text, now())
  WHERE device_id = 'fan_01'
  RETURNING * INTO v_updated;

  RETURN row_to_json(v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.set_fan_speed(INTEGER) TO anon, authenticated;

-- 10. RPC: Set Fan Power (Toggle ON/OFF)
CREATE OR REPLACE FUNCTION public.set_fan_power(p_power BOOLEAN)
RETURNS JSON AS $$
DECLARE
  v_updated RECORD;
BEGIN
  IF p_power = false THEN
    UPDATE public.fan_regulator_status
    SET power_state = false,
        relay_1 = false,
        relay_2 = false,
        relay_3 = false,
        relay_4 = false,
        relay_osc = false,
        estimated_watts = 0,
        updated_at = timezone('utc'::text, now())
    WHERE device_id = 'fan_01'
    RETURNING * INTO v_updated;
  ELSE
    UPDATE public.fan_regulator_status
    SET power_state = true,
        speed_level = CASE WHEN speed_level = 0 THEN 2 ELSE speed_level END,
        relay_1 = CASE WHEN speed_level = 1 THEN true ELSE false END,
        relay_2 = CASE WHEN speed_level = 2 OR speed_level = 0 THEN true ELSE false END,
        relay_3 = CASE WHEN speed_level = 3 OR speed_level = 5 THEN true ELSE false END,
        relay_4 = CASE WHEN speed_level >= 4 THEN true ELSE false END,
        estimated_watts = CASE
          WHEN speed_level = 1 THEN 16
          WHEN speed_level = 3 THEN 48
          WHEN speed_level = 4 THEN 65
          WHEN speed_level = 5 THEN 78
          ELSE 32
        END,
        updated_at = timezone('utc'::text, now())
    WHERE device_id = 'fan_01'
    RETURNING * INTO v_updated;
  END IF;

  RETURN row_to_json(v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.set_fan_power(BOOLEAN) TO anon, authenticated;

-- 11. RPC: Update Ambient Telemetry from ESP32 DHT22
CREATE OR REPLACE FUNCTION public.update_fan_telemetry(p_temp NUMERIC, p_humidity NUMERIC)
RETURNS JSON AS $$
DECLARE
  v_updated RECORD;
BEGIN
  UPDATE public.fan_regulator_status
  SET temperature_c = p_temp,
      humidity_pct = p_humidity,
      updated_at = timezone('utc'::text, now())
  WHERE device_id = 'fan_01'
  RETURNING * INTO v_updated;

  RETURN row_to_json(v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.update_fan_telemetry(NUMERIC, NUMERIC) TO anon, authenticated;
