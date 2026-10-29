-- =====================================================================================
-- GKB TECHNOLOGIES — SMART WATER TANK MONITOR SYSTEM (JSN-SR04T ULTRASONIC + PUMP)
-- Schema Setup, Row-Level Security (RLS), and Seeding Script
-- =====================================================================================

-- 1. Create the water_tank_status table
CREATE TABLE IF NOT EXISTS public.water_tank_status (
  device_id TEXT PRIMARY KEY,
  device_key TEXT NOT NULL DEFAULT 'GKB-SWP-0001',
  water_level INTEGER NOT NULL DEFAULT 68,
  distance_cm NUMERIC(6,2) NOT NULL DEFAULT 32.00,
  tank_height_cm NUMERIC(6,2) NOT NULL DEFAULT 100.00,
  tank_circumference_cm NUMERIC(6,2) NOT NULL DEFAULT 314.16,
  min_distance_cm NUMERIC(6,2) NOT NULL DEFAULT 20.00,
  pump_state TEXT NOT NULL DEFAULT 'OFF' CHECK (pump_state IN ('ON', 'OFF')),
  pump_mode TEXT NOT NULL DEFAULT 'AUTO' CHECK (pump_mode IN ('AUTO', 'MANUAL')),
  low_threshold INTEGER NOT NULL DEFAULT 30,
  full_threshold INTEGER NOT NULL DEFAULT 90,
  buzzer_active BOOLEAN NOT NULL DEFAULT false,
  tank_capacity_liters INTEGER NOT NULL DEFAULT 5000,
  paired_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Backward compatibility: add tank_circumference_cm if table already exists
ALTER TABLE public.water_tank_status 
  ADD COLUMN IF NOT EXISTS tank_circumference_cm NUMERIC(6,2) DEFAULT 314.16;

-- 2. Seed initial primary fleet record: water_01
INSERT INTO public.water_tank_status (
  device_id,
  device_key,
  water_level,
  distance_cm,
  tank_height_cm,
  tank_circumference_cm,
  min_distance_cm,
  pump_state,
  pump_mode,
  low_threshold,
  full_threshold,
  buzzer_active,
  tank_capacity_liters
)
VALUES (
  'water_01',
  'GKB-SWP-0001',
  68,
  32.00,
  100.00,
  314.16,
  20.00,
  'OFF',
  'AUTO',
  30,
  90,
  false,
  5000
)
ON CONFLICT (device_id) DO NOTHING;

-- 3. Enable Row-Level Security (RLS)
ALTER TABLE public.water_tank_status ENABLE ROW LEVEL SECURITY;

-- 4. Grant table privileges to anon and authenticated roles
GRANT SELECT, UPDATE, INSERT ON public.water_tank_status TO anon, authenticated;

-- 5. Read policy: Allow public read access to fleet water tanks
DROP POLICY IF EXISTS water_tank_select_policy ON public.water_tank_status;
CREATE POLICY water_tank_select_policy
  ON public.water_tank_status
  FOR SELECT
  TO anon, authenticated
  USING (device_id = 'water_01');

-- 6. Update policy: Allow updating telemetry, pump controls, and thresholds
DROP POLICY IF EXISTS water_tank_update_policy ON public.water_tank_status;
CREATE POLICY water_tank_update_policy
  ON public.water_tank_status
  FOR UPDATE
  TO anon, authenticated
  USING (device_id = 'water_01')
  WITH CHECK (device_id = 'water_01');

-- 7. Timestamp Auto-Update Trigger
CREATE OR REPLACE FUNCTION update_water_tank_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  
  -- Boundary safety enforcement
  IF NEW.water_level < 0 THEN NEW.water_level = 0; END IF;
  IF NEW.water_level > 100 THEN NEW.water_level = 100; END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_water_tank_timestamp ON public.water_tank_status;
CREATE TRIGGER trg_update_water_tank_timestamp
  BEFORE UPDATE ON public.water_tank_status
  FOR EACH ROW
  EXECUTE FUNCTION update_water_tank_timestamp();

-- 8. RPC: Safe remote pump state switch
CREATE OR REPLACE FUNCTION public.set_water_pump_state(p_state TEXT, p_mode TEXT DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  v_updated RECORD;
BEGIN
  IF p_state NOT IN ('ON', 'OFF') THEN
    RAISE EXCEPTION 'Invalid pump state: %. Must be ON or OFF', p_state;
  END IF;

  IF p_mode IS NOT NULL AND p_mode NOT IN ('AUTO', 'MANUAL') THEN
    RAISE EXCEPTION 'Invalid pump mode: %. Must be AUTO or MANUAL', p_mode;
  END IF;

  IF p_mode IS NOT NULL THEN
    UPDATE public.water_tank_status
    SET pump_state = p_state,
        pump_mode = p_mode,
        updated_at = timezone('utc'::text, now())
    WHERE device_id = 'water_01'
    RETURNING * INTO v_updated;
  ELSE
    UPDATE public.water_tank_status
    SET pump_state = p_state,
        updated_at = timezone('utc'::text, now())
    WHERE device_id = 'water_01'
    RETURNING * INTO v_updated;
  END IF;

  RETURN row_to_json(v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.set_water_pump_state(TEXT, TEXT) TO anon, authenticated;
