import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Shield, ShieldAlert, ShieldCheck, Activity, Wifi, Server, Bluetooth,
  QrCode, Printer, Code, Zap, Check, Copy, AlertTriangle, Cpu, Radio,
  Key, Power, RefreshCw, Sliders, Settings, Volume2, VolumeX, Database,
  ArrowUpRight, Info, Play, Square, Bell, BellOff, Eye, Lock, Unlock,
  SlidersHorizontal, Sparkles, CheckCircle2, Siren, X, AlertOctagon,
  Phone, PhoneCall, PhoneForwarded, MessageSquare, Signal, Smartphone,
  Send, CheckCheck, UserPlus, Trash2, Plus, Star, RotateCcw
} from 'lucide-react';
import { relaySupabase } from './supabase';
import BleProvisioningModal from './BleProvisioningModal';
import { createQrSvg } from './qrCodeHelper';

export type EmergencyContact = {
  id: string;
  name: string;
  phone: string;
  isPrimary: boolean;
  enableCall: boolean;
  enableSms: boolean;
};

export type Device = {
  id: number;
  name: string;
  key: string;
  status: string;
  lastAlert: string;
  project?: string;
  legacyKeys?: string[];
};

type SecurityAlert = {
  id: string;
  timestamp: string;
  title: string;
  detail: string;
  severity: 'critical' | 'warning' | 'info';
};

const HARDCODED_SUPABASE_URL = 'https://ditnksmvcacnzdguqcgz.supabase.co';
const HARDCODED_SUPABASE_KEY = 'sb_publishable_33KQl1SmvaBaqNzxWJiyzw_HuLMgWAl';

const SQL_SECURITY_SETUP_SCRIPT = `-- =====================================================================================
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
  ADD COLUMN IF NOT EXISTS emergency_contacts JSONB DEFAULT '[{"id":"1","name":"Primary Security Line","phone":"+233256905290","isPrimary":true,"enableCall":true,"enableSms":false}]'::jsonb,
  ADD COLUMN IF NOT EXISTS sms_on_alarm BOOLEAN NOT NULL DEFAULT false,
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
  emergency_contacts,
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
  '[{"id":"1","name":"Primary Security Line","phone":"+233256905290","isPrimary":true,"enableCall":true,"enableSms":false}]'::jsonb,
  false,
  true,
  false
)
ON CONFLICT (device_id) DO UPDATE SET
  device_key = EXCLUDED.device_key,
  gsm_enabled = COALESCE(public.home_security_status.gsm_enabled, EXCLUDED.gsm_enabled),
  primary_phone = EXCLUDED.primary_phone,
  emergency_contacts = COALESCE(public.home_security_status.emergency_contacts, EXCLUDED.emergency_contacts),
  sms_on_alarm = false,
  call_on_alarm = true;

-- Ensure device security_01 operates in Call-Only mode
UPDATE public.home_security_status
SET sms_on_alarm = false,
    call_on_alarm = true
WHERE device_id = 'security_01';

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
DROP FUNCTION IF EXISTS public.update_security_gsm_settings(TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.update_security_gsm_settings(TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, JSONB);
CREATE OR REPLACE FUNCTION public.update_security_gsm_settings(
  p_primary_phone TEXT,
  p_secondary_phone TEXT,
  p_sms_on_alarm BOOLEAN,
  p_call_on_alarm BOOLEAN,
  p_sms_on_arm_disarm BOOLEAN,
  p_gsm_enabled BOOLEAN DEFAULT true,
  p_emergency_contacts JSONB DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_updated RECORD;
BEGIN
  UPDATE public.home_security_status
  SET primary_phone = p_primary_phone,
      secondary_phone = p_secondary_phone,
      emergency_contacts = COALESCE(p_emergency_contacts, emergency_contacts),
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

GRANT EXECUTE ON FUNCTION public.update_security_gsm_settings(TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, JSONB) TO anon, authenticated;

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

`;

export function generateSecurityArduinoCode(deviceKey: string = 'GKB-SEC-0001'): string {
  return `/*
 * =========================================================================================
 * GKB TECHNOLOGIES — ESP32 SMART HOME SECURITY SYSTEM v1 (PIR + SIREN + BUZZER + GSM SIM800L)
 * Dual-Mode: Web Bluetooth (BLE 4.2 GATT) Provisioning + 2.4GHz Wi-Fi + GSM Cellular Dispatch
 * =========================================================================================
 * Target Board       : ESP32 Dev Module / NodeMCU-32S / ESP-WROOM-32
 * Device Token Model : Hardware Casing QR Token (Default: GKB-SEC-0001)
 * Sensors & Outputs  :
 *   - PIR Motion Sensor : GPIO 15 (Input - HC-SR501 / AM312 PIR Digital Out)
 *   - Siren Strobe Relay: GPIO 23 (Output - Active HIGH 5V Relay Channel)
 *   - Piezo Buzzer      : GPIO 19 (Output - Electronic Siren Tone Generator)
 *   - Diagnostic LED    : GPIO 2  (Onboard Blue LED)
 *   - Factory Reset     : GPIO 0  (Onboard BOOT Button - Hold 5s to clear Wi-Fi)
 *   - GSM SIM800L UART2 : GPIO 16 (RX2 <- SIM800L TX), GPIO 17 (TX2 -> SIM800L RX)
 *
 * Cloud Backend      : Supabase public.home_security_status (Target: security_01)
 * REST Endpoint      : https://ditnksmvcacnzdguqcgz.supabase.co/rest/v1/home_security_status?device_id=eq.security_01
 * =========================================================================================
 */

#include <WiFi.h>
#include <lwip/dns.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ================= HARDWARE PINOUT ASSIGNMENTS =================
const int PIN_PIR           = 15; // PIR Motion Sensor (HIGH = Motion Detected)
const int PIN_SIREN_RELAY   = 23; // Siren / Strobe Relay (Active HIGH)
const int PIN_BUZZER        = 19; // Piezo Audio Alert Buzzer
const int PIN_STATUS_LED    = 2;  // ESP32 Onboard Blue LED
const int PIN_BOOT_BUTTON   = 0;  // Onboard BOOT Button (Factory Reset)

// ================= GSM SIM800L HARDWARE UART (UART2) =================
const int PIN_GSM_RX        = 16; // ESP32 GPIO 16 (RX2) -> SIM800L TXD
const int PIN_GSM_TX        = 17; // ESP32 GPIO 17 (TX2) -> SIM800L RXD
const unsigned long GSM_BAUD = 9600;
HardwareSerial gsmSerial(2);

#define RELAY_ACTIVE_HIGH   true

// ================= DEFAULT DEVICE IDENTITY =================
#define DEFAULT_DEVICE_KEY  "${deviceKey}"
#define SUPABASE_DEVICE_ID  "security_01"

// ================= BLE GATT SPECIFICATIONS =================
#define GKB_BLE_SERVICE_UUID "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define GKB_BLE_CHAR_RX_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8" // Web writes to ESP32
#define GKB_BLE_CHAR_TX_UUID "beb5483f-36e1-4688-b7f5-ea07361b26a9" // ESP32 notifies Web

// ================= SUPABASE CLOUD REST AUTH =================
const char* SUPABASE_REST_URL = "https://ditnksmvcacnzdguqcgz.supabase.co/rest/v1/home_security_status?device_id=eq.security_01";
const char* SUPABASE_ANON_KEY = "sb_publishable_33KQl1SmvaBaqNzxWJiyzw_HuLMgWAl";

// ================= SYSTEM STATE =================
Preferences preferences;

enum DeviceOperatingMode {
  MODE_PROVISIONING_BLE,
  MODE_CONNECTING_WIFI,
  MODE_OPERATIONAL_CLOUD
};

DeviceOperatingMode currentMode = MODE_PROVISIONING_BLE;

String deviceKey          = DEFAULT_DEVICE_KEY;
String wifiSSID           = "";
String wifiPassword       = "";
bool   isProvisioned      = false;
bool   bleClientConnected = false;
bool   qrAuthenticated    = false;

// Security Operating State
String armedMode          = "away";   // "away", "stay", "disarmed"
String alarmState         = "IDLE";   // "IDLE", "TRIPPED", "MUTED"
bool   motionDetected     = false;
bool   sirenActive        = false;
bool   buzzerActive       = false;
bool   soundMuted         = false;
String pirSensitivity     = "high";   // "low", "medium", "high"
bool   initialSyncLogged  = false;

// GSM Modem Subsystem State
bool   gsmEnabled         = true;
bool   gsmInitialized     = false;
int    gsmSignalCsq       = 24;       // 0 to 31 (24 ≈ -65dBm Excellent)
String gsmNetworkOperator = "MTN-GH";
String gsmSimStatus       = "READY";
String gsmCallState       = "IDLE";   // "IDLE", "DIALING", "RINGING", "COMPLETED", "FAILED"
String gsmLastSmsStatus   = "IDLE";   // "IDLE", "SENDING", "SENT_OK", "FAILED"
String primaryPhone       = "+233256905290";
String secondaryPhone     = "";
bool   smsOnAlarm         = false; // Default: CALL ONLY (SMS disabled)
bool   callOnAlarm        = true;  // Default: Voice Call auto-dial active
bool   smsOnArmDisarm     = false;
String gsmTestRequested   = "NONE";

unsigned long lastGsmPollTime     = 0;
const unsigned long GSM_POLL_INTERVAL_MS = 15000; // Query GSM signal & operator every 15s

bool isCallInProgress             = false;
unsigned long callStartedAt       = 0;
const unsigned long CALL_DURATION_MS = 25000; // Auto-hangup after 25s of ringing

BLEServer*         pBleServer         = nullptr;
BLECharacteristic* pTxCharacteristic = nullptr;

unsigned long lastCloudPoll = 0;
const unsigned long CLOUD_POLL_INTERVAL_MS = 2000; // Poll & report every 2.0s

unsigned long buttonPressStartTime = 0;
bool buttonHeld = false;
const unsigned long RESET_HOLD_DURATION_MS = 5000;

bool pendingReboot = false;
unsigned long rebootScheduledAt = 0;

// PIR Debounce & Motion Tracking
int lastPirReading = LOW;
unsigned long motionTrippedAt = 0;
const unsigned long ALARM_HOLD_DURATION_MS = 15000; // Alarm sounds for 15s upon trip unless cleared

// ================= FUNCTION PROTOTYPES =================
void applySirenOutput(bool state);
void applyBuzzerOutput(bool state);
void pollAndSyncCloud();
void triggerFactoryReset();
void handleBuzzerModulation();

// GSM Prototypes
void initGsmModule();
String sendAtCommand(const String& cmd, unsigned long timeoutMs = 2000);
void updateGsmSignal();
void updateGsmOperator();
bool sendGsmSms(const String& recipient, const String& message);
void makeEmergencyCall(const String& recipient);
void checkCallStatus();
void triggerIntruderGsmAlerts(const String& zoneName);
void processIncomingGsmData();

// ================= HARDWARE CONTROL FUNCTIONS =================
void applySirenOutput(bool state) {
  sirenActive = state;
  digitalWrite(PIN_SIREN_RELAY, (RELAY_ACTIVE_HIGH ? state : !state) ? HIGH : LOW);
}

void applyBuzzerOutput(bool state) {
  buzzerActive = state;
  if (!state || soundMuted) {
    digitalWrite(PIN_BUZZER, LOW);
  }
}

// Generates an urgent dual-tone security alarm pattern on GPIO 19
void handleBuzzerModulation() {
  if (!buzzerActive || soundMuted || armedMode == "disarmed") {
    digitalWrite(PIN_BUZZER, LOW);
    return;
  }

  // 10Hz pulsing siren sound
  unsigned long now = millis();
  bool pulseState = ((now / 80) % 2) == 0;
  digitalWrite(PIN_BUZZER, pulseState ? HIGH : LOW);
}

// ================= GSM SIM800L CELLULAR ENGINE =================
String sendAtCommand(const String& cmd, unsigned long timeoutMs) {
  while (gsmSerial.available()) gsmSerial.read(); // Clear input buffer
  gsmSerial.println(cmd);

  String response = "";
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    while (gsmSerial.available()) {
      char c = gsmSerial.read();
      response += c;
    }
    if (response.indexOf("OK") != -1 || response.indexOf("ERROR") != -1) {
      break;
    }
    delay(10);
  }
  return response;
}

void initGsmModule() {
  Serial.println("📱 [GSM] Initializing SIM800L Cellular Modem on UART2 (RX:16, TX:17, 9600 baud)...");
  gsmSerial.begin(GSM_BAUD, SERIAL_8N1, PIN_GSM_RX, PIN_GSM_TX);
  delay(1200);

  // Auto-baud sync
  for (int i = 0; i < 3; i++) {
    gsmSerial.println("AT");
    delay(200);
  }

  String testResp = sendAtCommand("AT", 1500);
  if (testResp.indexOf("OK") != -1) {
    gsmInitialized = true;
    Serial.println("✅ [GSM] SIM800L Responded: OK (Modem Active)");
  } else {
    Serial.println("⚠️ [GSM] SIM800L did not respond! Check UART wiring and 4.0V/2A power supply.");
    gsmSimStatus = "NO_RESPONSE";
  }

  sendAtCommand("ATE0", 800); // Echo off

  // SIM Presence & Pin Status Auto-Detection
  checkGsmSimStatus(false);

  // Text Mode for SMS
  sendAtCommand("AT+CMGF=1", 1000);

  // Configure Direct SMS Notification (+CMT forwarding)
  sendAtCommand("AT+CNMI=1,2,0,0,0", 1000);

  // Initial Telemetry Query
  updateGsmSignal();
  if (gsmSimStatus == "READY") {
    updateGsmOperator();
  }
}

bool checkGsmSimStatus(bool silent) {
  String pinResp = sendAtCommand("AT+CPIN?", 1500);
  String oldStatus = gsmSimStatus;
  if (pinResp.indexOf("READY") != -1) {
    gsmSimStatus = "READY";
    if (oldStatus != "READY" || !silent) {
      Serial.println("✅ [GSM] SIM Card Detected: READY (Cellular network registration active)");
      sendAtCommand("AT+CMGF=1", 1000);
      sendAtCommand("AT+CNMI=1,2,0,0,0", 1000);
      updateGsmOperator();
    }
    return true;
  } else if (pinResp.indexOf("SIM PIN") != -1) {
    gsmSimStatus = "PIN_REQUIRED";
    if (oldStatus != "PIN_REQUIRED" || !silent) {
      Serial.println("⚠️ [GSM] SIM Card requires PIN unlock. Please disable SIM PIN using a phone.");
    }
    return false;
  } else {
    gsmSimStatus = "NO_SIM";
    if (!silent) {
      Serial.println("❌ [GSM] No SIM Card detected or inserted (+CPIN: NOT INSERTED)!");
      Serial.println("💡 [GSM TIP] Verify Micro-SIM orientation (gold contacts facing PCB, notch aligned) and press/slide metal tray firmly to 'LOCK'.");
    }
    return false;
  }
}

void updateGsmSignal() {
  String resp = sendAtCommand("AT+CSQ", 1500);
  int csqIdx = resp.indexOf("+CSQ: ");
  if (csqIdx != -1) {
    int commaIdx = resp.indexOf(",", csqIdx);
    if (commaIdx != -1) {
      String csqStr = resp.substring(csqIdx + 6, commaIdx);
      int val = csqStr.toInt();
      if (val >= 0 && val <= 31) {
        gsmSignalCsq = val;
        Serial.printf("📶 [GSM] Signal Quality: %d/31\\n", gsmSignalCsq);
      }
    }
  }
}

void updateGsmOperator() {
  String resp = sendAtCommand("AT+COPS?", 2000);
  int quote1 = resp.indexOf("\\"");
  if (quote1 != -1) {
    int quote2 = resp.indexOf("\\"", quote1 + 1);
    if (quote2 != -1) {
      gsmNetworkOperator = resp.substring(quote1 + 1, quote2);
      Serial.printf("🌐 [GSM] Cellular Carrier: %s\\n", gsmNetworkOperator.c_str());
    }
  }
}

String sanitizePhoneNumber(const String& phone) {
  String clean = "";
  for (unsigned int i = 0; i < phone.length(); i++) {
    char c = phone.charAt(i);
    if (c == '+' || (c >= '0' && c <= '9')) {
      clean += c;
    }
  }
  return clean;
}

bool sendGsmSms(const String& recipient, const String& message) {
  String targetNum = sanitizePhoneNumber(recipient);
  if (targetNum.length() < 9) {
    Serial.printf("⚠️ [GSM SMS] Aborted. Recipient number too short: '%s'\\n", targetNum.c_str());
    return false;
  }

  // Auto-probe SIM card if not currently flagged ready
  if (gsmSimStatus != "READY") {
    checkGsmSimStatus(true);
  }

  if (gsmSimStatus != "READY") {
    Serial.printf("❌ [GSM SMS] Cannot send SMS: SIM card not ready (Status: %s). Check SIM tray lock & orientation.\\n", gsmSimStatus.c_str());
    gsmLastSmsStatus = "NO_SIM";
    return false;
  }

  Serial.printf("📤 [GSM SMS] Sending to [%s]:\\n   \\"%s\\"\\n", targetNum.c_str(), message.c_str());
  gsmLastSmsStatus = "SENDING";

  while (gsmSerial.available()) gsmSerial.read();

  gsmSerial.print("AT+CMGS=\\"");
  gsmSerial.print(targetNum);
  gsmSerial.println("\\"");

  // Wait for '>' prompt
  unsigned long start = millis();
  bool promptReceived = false;
  while (millis() - start < 5000) {
    if (gsmSerial.available()) {
      char c = gsmSerial.read();
      if (c == '>') {
        promptReceived = true;
        break;
      }
    }
    delay(10);
  }

  if (!promptReceived) {
    Serial.println("❌ [GSM SMS] Error: Prompt '>' not received from SIM800L.");
    gsmLastSmsStatus = "FAILED";
    return false;
  }

  // Send message text + ASCII 26 (Ctrl+Z)
  gsmSerial.print(message);
  gsmSerial.write(26);

  // Wait for +CMGS: or OK response
  start = millis();
  String reply = "";
  while (millis() - start < 15000) {
    while (gsmSerial.available()) {
      reply += (char)gsmSerial.read();
    }
    if (reply.indexOf("OK") != -1 || reply.indexOf("+CMGS:") != -1) {
      Serial.println("🎉 [GSM SMS] SMS Delivered to Cellular Tower Successfully!");
      gsmLastSmsStatus = "SENT_OK";
      return true;
    }
    if (reply.indexOf("ERROR") != -1) {
      break;
    }
    delay(40);
  }

  Serial.printf("❌ [GSM SMS] Send failed. Response: %s\\n", reply.c_str());
  gsmLastSmsStatus = "FAILED";
  return false;
}

void makeEmergencyCall(const String& recipient) {
  String targetNum = sanitizePhoneNumber(recipient);
  if (targetNum.length() < 9) return;

  if (gsmSimStatus != "READY") {
    checkGsmSimStatus(true);
  }

  if (gsmSimStatus != "READY") {
    Serial.printf("❌ [GSM CALL] Cannot place call: SIM card not ready (Status: %s). Check SIM tray lock & orientation.\\n", gsmSimStatus.c_str());
    gsmCallState = "NO_SIM";
    return;
  }

  Serial.printf("📞 [GSM CALL] Placing emergency voice call to [%s]...\\n", targetNum.c_str());
  gsmCallState = "DIALING";

  sendAtCommand("ATH", 400); // Hang up any existing line
  delay(150);

  // Notice the semicolon at the end indicates voice dial
  String dialCmd = "ATD" + targetNum + ";";
  gsmSerial.println(dialCmd);

  isCallInProgress = true;
  callStartedAt = millis();
}

void checkCallStatus() {
  if (isCallInProgress && (millis() - callStartedAt >= CALL_DURATION_MS)) {
    Serial.println("📴 [GSM CALL] Auto-ending 25s emergency alert call (ATH).");
    sendAtCommand("ATH", 1000);
    isCallInProgress = false;
    gsmCallState = "COMPLETED";
  }
}

void triggerIntruderGsmAlerts(const String& zoneName) {
  if (!gsmEnabled) return;

  Serial.printf("🚨 [INTRUDER PROTOCOL] Triggering GSM alerts for zone '%s'!\\n", zoneName.c_str());

  // 1. Place Instant Emergency Phone Call to Primary Contact (CALL-FIRST PRIORITY)
  if (callOnAlarm && primaryPhone.length() >= 9) {
    Serial.printf("📞 [INTRUDER PROTOCOL] Placing instant emergency voice call to %s...\\n", primaryPhone.c_str());
    makeEmergencyCall(primaryPhone);
  }

  // 2. Dispatch SMS ONLY if smsOnAlarm is enabled (Call-Only mode skips this entirely)
  if (smsOnAlarm) {
    String alertMsg = "🚨 GKB SECURITY ALERT!\\n"
                      "Motion detected in " + zoneName + "!\\n"
                      "Status: ARMED (" + armedMode + ")\\n"
                      "Siren: ACTIVE\\n"
                      "Device: " + deviceKey + "\\n"
                      "Direct emergency dispatch from GKB IoT Hardware.";

    if (primaryPhone.length() >= 9) {
      delay(600);
      sendGsmSms(primaryPhone, alertMsg);
    }

    if (secondaryPhone.length() >= 9) {
      delay(600);
      sendGsmSms(secondaryPhone, alertMsg);
    }
  } else {
    Serial.println("ℹ️ [INTRUDER PROTOCOL] SMS on alarm is DISABLED (Call-Only Mode). No SMS sent.");
  }
}

// Handles incoming SMS commands from homeowner phone
void processIncomingGsmData() {
  while (gsmSerial.available()) {
    String line = gsmSerial.readStringUntil('\\n');
    line.trim();
    if (line.length() == 0) continue;

    Serial.printf("📩 [GSM INCOMING] %s\\n", line.c_str());

    String upper = line;
    upper.toUpperCase();

    if (upper.indexOf("DISARM") != -1) {
      Serial.println("🛡️ [SMS CMD] 'DISARM' command received via SMS!");
      armedMode = "disarmed";
      alarmState = "IDLE";
      applySirenOutput(false);
      applyBuzzerOutput(false);
      if (primaryPhone.length() >= 9) {
        sendGsmSms(primaryPhone, "✅ GKB Security: System DISARMED via SMS. Sirens silenced.");
      }
    } else if (upper.indexOf("ARM AWAY") != -1 || upper == "ARM") {
      Serial.println("🛡️ [SMS CMD] 'ARM AWAY' command received via SMS!");
      armedMode = "away";
      if (primaryPhone.length() >= 9) {
        sendGsmSms(primaryPhone, "🛡️ GKB Security: System Armed in AWAY mode. PIR & perimeter active.");
      }
    } else if (upper.indexOf("ARM STAY") != -1) {
      Serial.println("🛡️ [SMS CMD] 'ARM STAY' command received via SMS!");
      armedMode = "stay";
      if (primaryPhone.length() >= 9) {
        sendGsmSms(primaryPhone, "🛡️ GKB Security: System Armed in STAY mode. Perimeter active.");
      }
    } else if (upper.indexOf("PANIC") != -1 || upper.indexOf("SIREN ON") != -1) {
      Serial.println("🚨 [SMS CMD] 'PANIC' command received via SMS!");
      alarmState = "TRIPPED";
      motionDetected = true;
      applySirenOutput(true);
      applyBuzzerOutput(true);
      if (primaryPhone.length() >= 9) {
        sendGsmSms(primaryPhone, "🚨 GKB Security: Emergency PANIC activated! Siren energized.");
      }
    } else if (upper.indexOf("SILENCE") != -1 || upper.indexOf("SIREN OFF") != -1) {
      Serial.println("🔇 [SMS CMD] 'SILENCE' command received via SMS!");
      alarmState = "IDLE";
      applySirenOutput(false);
      applyBuzzerOutput(false);
      if (primaryPhone.length() >= 9) {
        sendGsmSms(primaryPhone, "🔇 GKB Security: Siren silenced.");
      }
    } else if (upper.indexOf("STATUS") != -1) {
      String statusReply = "GKB SECURITY STATUS:\\n"
                           "Mode: " + armedMode + "\\n"
                           "Alarm: " + alarmState + "\\n"
                           "Motion: " + String(motionDetected ? "YES" : "NO") + "\\n"
                           "Siren: " + String(sirenActive ? "ON" : "OFF") + "\\n"
                           "GSM CSQ: " + String(gsmSignalCsq) + "/31 (" + gsmNetworkOperator + ")\\n"
                           "Wi-Fi: " + String(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
      if (primaryPhone.length() >= 9) {
        sendGsmSms(primaryPhone, statusReply);
      }
    }
  }
}

// ================= SUPABASE CLOUD TELEMETRY & CONTROL =================
void pollAndSyncCloud() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(10);

  HTTPClient http;
  http.setTimeout(8000);

  // Step 1: GET current armed mode, sound mute, GSM configs, and alarm commands from Supabase
  if (http.begin(client, SUPABASE_REST_URL)) {
    http.addHeader("apikey", SUPABASE_ANON_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    http.addHeader("Accept", "application/json");

    int httpCode = http.GET();
    if (httpCode == 200) {
      String payload = http.getString();
      if (!initialSyncLogged) {
        initialSyncLogged = true;
        Serial.println("🌐 [CLOUD] Successfully linked to Supabase (public.home_security_status / security_01)!");
        Serial.printf("📡 [INITIAL STATE] Payload: %s\\n", payload.c_str());
      }

      // 1. Parse armed_mode: "away" | "stay" | "disarmed"
      if (payload.indexOf("\\"armed_mode\\":\\"disarmed\\"") != -1) {
        if (armedMode != "disarmed") {
          armedMode = "disarmed";
          alarmState = "IDLE";
          applySirenOutput(false);
          applyBuzzerOutput(false);
          Serial.println("🛡️ [SECURITY] System DISARMED via Cloud. Siren & Buzzer silenced.");
          if (smsOnArmDisarm && primaryPhone.length() >= 9) {
            sendGsmSms(primaryPhone, "ℹ️ GKB Security: System DISARMED via Web Dashboard.");
          }
        }
      } else if (payload.indexOf("\\"armed_mode\\":\\"stay\\"") != -1) {
        if (armedMode != "stay") {
          armedMode = "stay";
          Serial.println("🛡️ [SECURITY] System Armed in STAY mode (Perimeter active).");
          if (smsOnArmDisarm && primaryPhone.length() >= 9) {
            sendGsmSms(primaryPhone, "🛡️ GKB Security: System Armed in STAY mode.");
          }
        }
      } else if (payload.indexOf("\\"armed_mode\\":\\"away\\"") != -1) {
        if (armedMode != "away") {
          armedMode = "away";
          Serial.println("🛡️ [SECURITY] System Armed in AWAY mode (Full PIR intrusion active).");
          if (smsOnArmDisarm && primaryPhone.length() >= 9) {
            sendGsmSms(primaryPhone, "🛡️ GKB Security: System Armed in AWAY mode.");
          }
        }
      }

      // 2. Parse sound_muted
      if (payload.indexOf("\\"sound_muted\\":true") != -1) {
        soundMuted = true;
      } else if (payload.indexOf("\\"sound_muted\\":false") != -1) {
        soundMuted = false;
      }

      // 3. Parse alarm_state override ("IDLE" -> manual reset / clear alarm)
      if (payload.indexOf("\\"alarm_state\\":\\"IDLE\\"") != -1 && alarmState == "TRIPPED") {
        alarmState = "IDLE";
        applySirenOutput(false);
        applyBuzzerOutput(false);
        Serial.println("✅ [SECURITY] Alarm manually CLEARED from Web Portal.");
      } else if (payload.indexOf("\\"alarm_state\\":\\"TRIPPED\\"") != -1 && alarmState != "TRIPPED") {
        // Web Panic Button
        alarmState = "TRIPPED";
        motionDetected = true;
        motionTrippedAt = millis();
        applySirenOutput(true);
        applyBuzzerOutput(true);
        Serial.println("🚨 [PANIC] Alarm TRIPPED via Remote Web Panic Button!");
        triggerIntruderGsmAlerts("Web Remote Panic Button");
      }

      // 4. Parse Emergency Contact Phone Numbers
      int pIdx = payload.indexOf("\\"primary_phone\\":\\"");
      if (pIdx != -1) {
        int pEnd = payload.indexOf("\\"", pIdx + 17);
        if (pEnd != -1) {
          String fetchedPhone = payload.substring(pIdx + 17, pEnd);
          if (fetchedPhone.length() >= 3 && fetchedPhone != primaryPhone) {
            primaryPhone = fetchedPhone;
            Serial.printf("📱 [GSM CONFIG] Primary Emergency Phone updated: %s\\n", primaryPhone.c_str());
          }
        }
      }

      int sIdx = payload.indexOf("\\"secondary_phone\\":\\"");
      if (sIdx != -1) {
        int sEnd = payload.indexOf("\\"", sIdx + 19);
        if (sEnd != -1) {
          secondaryPhone = payload.substring(sIdx + 19, sEnd);
        }
      }

      // 5. Parse GSM Toggles
      if (payload.indexOf("\\"sms_on_alarm\\":true") != -1) smsOnAlarm = true;
      else if (payload.indexOf("\\"sms_on_alarm\\":false") != -1) smsOnAlarm = false;

      if (payload.indexOf("\\"call_on_alarm\\":true") != -1) callOnAlarm = true;
      else if (payload.indexOf("\\"call_on_alarm\\":false") != -1) callOnAlarm = false;

      if (payload.indexOf("\\"sms_on_arm_disarm\\":true") != -1) smsOnArmDisarm = true;
      else if (payload.indexOf("\\"sms_on_arm_disarm\\":false") != -1) smsOnArmDisarm = false;

      // 6. Handle Live GSM Test Trigger from Web Portal
      if (payload.indexOf("\\"gsm_test_requested\\":\\"TEST_SMS\\"") != -1) {
        Serial.println("🧪 [GSM TEST] Live SMS Test requested from Web Portal!");
        sendGsmSms(primaryPhone, "🧪 GKB Security: This is a verified test SMS from your ESP32 + SIM800L cellular module.");
      } else if (payload.indexOf("\\"gsm_test_requested\\":\\"TEST_CALL\\"") != -1) {
        Serial.println("🧪 [GSM TEST] Live Alert Call Test requested from Web Portal!");
        makeEmergencyCall(primaryPhone);
      }
    } else {
      Serial.printf("⚠️ [CLOUD] GET security_status HTTP %d\\n", httpCode);
    }
    http.end();
  }

  // Step 2: PATCH live telemetry (motion, alarm, siren, buzzer, gsm stats) back to Supabase
  if (http.begin(client, SUPABASE_REST_URL)) {
    http.addHeader("apikey", SUPABASE_ANON_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    http.addHeader("Content-Type", "application/json");

    String patchJson = "{\\"motion_detected\\":" + String(motionDetected ? "true" : "false") +
                       ",\\"alarm_state\\":\\"" + alarmState + "\\"" +
                       ",\\"siren_active\\":" + (sirenActive ? "true" : "false") +
                       ",\\"buzzer_active\\":" + (buzzerActive ? "true" : "false") +
                       ",\\"gsm_enabled\\":" + (gsmEnabled ? "true" : "false") +
                       ",\\"gsm_signal_csq\\":" + String(gsmSignalCsq) +
                       ",\\"gsm_network_operator\\":\\"" + gsmNetworkOperator + "\\"" +
                       ",\\"gsm_sim_status\\":\\"" + gsmSimStatus + "\\"" +
                       ",\\"gsm_call_state\\":\\"" + gsmCallState + "\\"" +
                       ",\\"gsm_last_sms_status\\":\\"" + gsmLastSmsStatus + "\\"" +
                       ",\\"gsm_test_requested\\":\\"NONE\\"}";

    int patchCode = http.PATCH(patchJson);
    if (patchCode == 200 || patchCode == 204) {
      // Telemetry sent
    } else {
      Serial.printf("⚠️ [CLOUD] PATCH telemetry returned HTTP %d\\n", patchCode);
    }
    http.end();
  }

  client.stop();
}

void triggerFactoryReset() {
  Serial.println("\\n⚠️ [FACTORY RESET] Clearing non-volatile flash credentials...");
  preferences.begin("gkb_prov", false);
  preferences.clear();
  preferences.end();

  for (int i = 0; i < 10; i++) {
    digitalWrite(PIN_STATUS_LED, HIGH);
    delay(75);
    digitalWrite(PIN_STATUS_LED, LOW);
    delay(75);
  }

  Serial.println("🔄 [REBOOT] Hardware returning to unprovisioned state. Rebooting...");
  ESP.restart();
}

// ================= BLE GATT CALLBACKS =================
class ServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    bleClientConnected = true;
    qrAuthenticated    = false;
    Serial.println("📱 [BLE] Web Client Connected! Awaiting QR verification...");
  }
  void onDisconnect(BLEServer* pServer) {
    bleClientConnected = false;
    qrAuthenticated    = false;
    Serial.println("📱 [BLE] Client disconnected. Resuming advertising...");
    pServer->getAdvertising()->start();
  }
};

class CharacteristicCallbacks: public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    String rxValue = pCharacteristic->getValue().c_str();
    if (rxValue.length() == 0) return;

    Serial.printf("📩 [BLE RX] Raw: %s\\n", rxValue.c_str());

    // 1. QR Verification Handshake: "VERIFY:<DEVICE_KEY>"
    if (rxValue.startsWith("VERIFY:")) {
      String submittedKey = rxValue.substring(7);
      submittedKey.trim();

      if (submittedKey == deviceKey || submittedKey == DEFAULT_DEVICE_KEY) {
        qrAuthenticated = true;
        Serial.printf("✅ [BLE AUTH] Hardware QR match confirmed (%s). Device unlocked.\\n", submittedKey.c_str());
        pTxCharacteristic->setValue("AUTH_SUCCESS:DEVICE_UNLOCKED");
        pTxCharacteristic->notify();
      } else {
        qrAuthenticated = false;
        Serial.printf("❌ [BLE AUTH] QR token mismatch! Submitted: %s\\n", submittedKey.c_str());
        pTxCharacteristic->setValue("AUTH_FAILED:INVALID_KEY");
        pTxCharacteristic->notify();
      }
      return;
    }

    // 2. Wi-Fi Credential Transfer: "SET_WIFI:{"ssid":"...","pass":"..."}"
    if (rxValue.startsWith("SET_WIFI:")) {
      if (!qrAuthenticated) {
        Serial.println("❌ [SECURITY] Rejected Wi-Fi config without QR authentication!");
        pTxCharacteristic->setValue("AUTH_REQUIRED:SCAN_QR_FIRST");
        pTxCharacteristic->notify();
        return;
      }

      String json = rxValue.substring(9);
      int ssidStart = json.indexOf("\\"ssid\\":\\"") + 8;
      int ssidEnd   = json.indexOf("\\"", ssidStart);
      int passStart = json.indexOf("\\"pass\\":\\"") + 8;
      int passEnd   = json.indexOf("\\"", passStart);
      int phoneStart = json.indexOf("\\"phone\\":\\"") + 9;
      int phoneEnd   = json.indexOf("\\"", phoneStart);

      if (ssidStart >= 8 && ssidEnd != -1) {
        wifiSSID = json.substring(ssidStart, ssidEnd);
        wifiPassword = (passStart >= 8 && passEnd != -1) ? json.substring(passStart, passEnd) : "";

        if (phoneStart >= 9 && phoneEnd != -1) {
          String parsedPhone = json.substring(phoneStart, phoneEnd);
          parsedPhone = sanitizePhoneNumber(parsedPhone);
          if (parsedPhone.length() >= 9) {
            primaryPhone = parsedPhone;
            Serial.printf("📱 [BLE CONFIG] Emergency Alert Phone received: %s\\n", primaryPhone.c_str());
          }
        }

        Serial.printf("💾 [FLASH] Saving Config: SSID='%s', Phone='%s'\\n", wifiSSID.c_str(), primaryPhone.c_str());
        preferences.begin("gkb_prov", false);
        preferences.putBool("provisioned", true);
        preferences.putString("device_key", deviceKey);
        preferences.putString("wifi_ssid", wifiSSID);
        preferences.putString("wifi_pass", wifiPassword);
        preferences.putString("primary_phone", primaryPhone);
        preferences.end();

        pTxCharacteristic->setValue("CONFIG_SAVED:REBOOTING");
        pTxCharacteristic->notify();

        pendingReboot = true;
        rebootScheduledAt = millis() + 1500;
      }
      return;
    }

    if (rxValue == "FACTORY_RESET") {
      pTxCharacteristic->setValue("RESET_CONFIRMED:REBOOTING");
      pTxCharacteristic->notify();
      triggerFactoryReset();
    }
  }
};

// ================= ARDUINO SETUP =================
void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(PIN_BOOT_BUTTON, INPUT_PULLUP);
  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, LOW);

  // PIR Motion Sensor & Outputs (GPIO 15, GPIO 23, GPIO 19)
  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_SIREN_RELAY, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  applySirenOutput(false);
  applyBuzzerOutput(false);

  // Initialize GSM SIM800L Module on UART2
  initGsmModule();

  preferences.begin("gkb_prov", false);
  isProvisioned = preferences.getBool("provisioned", false);
  deviceKey     = preferences.getString("device_key", DEFAULT_DEVICE_KEY);
  wifiSSID      = preferences.getString("wifi_ssid", "");
  wifiPassword  = preferences.getString("wifi_pass", "");
  primaryPhone  = preferences.getString("primary_phone", primaryPhone);
  preferences.end();

  Serial.println("=======================================================");
  Serial.println("⚡ GKB TECHNOLOGIES — SMART HOME SECURITY SYSTEM v1");
  Serial.println("   PIR Motion Sensor · Siren Strobe Relay · Piezo Buzzer");
  Serial.println("   GSM SIM800L Cellular Modem · SMS Alerts & Voice Calling");
  Serial.println("   BLE & QR Provisioning · Supabase Cloud Telemetry");
  Serial.println("=======================================================");
  Serial.printf("🔑 Casing Device Key   : %s\\n", deviceKey.c_str());
  Serial.printf("📡 Supabase Device ID  : %s\\n", SUPABASE_DEVICE_ID);
  Serial.printf("📦 Provisioning Status : %s\\n", isProvisioned ? "PROVISIONED" : "UNPROVISIONED");
  Serial.printf("📱 Emergency Alert Num : %s\\n", primaryPhone.c_str());
  Serial.println("📌 Pin Allocation:");
  Serial.printf("   - PIR Motion Sensor : GPIO %d (Input)\\n", PIN_PIR);
  Serial.printf("   - Siren Strobe Relay: GPIO %d (Output)\\n", PIN_SIREN_RELAY);
  Serial.printf("   - Alert Buzzer      : GPIO %d (Output)\\n", PIN_BUZZER);
  Serial.printf("   - GSM SIM800L RX2   : GPIO %d\\n", PIN_GSM_RX);
  Serial.printf("   - GSM SIM800L TX2   : GPIO %d\\n", PIN_GSM_TX);
  Serial.printf("   - Diagnostic LED    : GPIO %d\\n", PIN_STATUS_LED);
  Serial.printf("   - BOOT Reset Button : GPIO %d\\n", PIN_BOOT_BUTTON);
  Serial.println("=======================================================");

  if (isProvisioned && wifiSSID.length() > 0) {
    Serial.printf("📶 Saved Network SSID  : %s\\n", wifiSSID.c_str());
    Serial.println("⚡ Provisioned credentials located. Connecting to Wi-Fi...");
    currentMode = MODE_CONNECTING_WIFI;
    WiFi.mode(WIFI_STA);
    WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());
  } else {
    Serial.println("🚀 Entering BLE Provisioning Mode (Waiting for web app)...");
    currentMode = MODE_PROVISIONING_BLE;

    BLEDevice::init("GKB-SEC-0001");
    pBleServer = BLEDevice::createServer();
    pBleServer->setCallbacks(new ServerCallbacks());

    BLEService* pService = pBleServer->createService(GKB_BLE_SERVICE_UUID);

    BLECharacteristic* pRxCharacteristic = pService->createCharacteristic(
      GKB_BLE_CHAR_RX_UUID,
      BLECharacteristic::PROPERTY_WRITE
    );
    pRxCharacteristic->setCallbacks(new CharacteristicCallbacks());

    pTxCharacteristic = pService->createCharacteristic(
      GKB_BLE_CHAR_TX_UUID,
      BLECharacteristic::PROPERTY_NOTIFY
    );
    pTxCharacteristic->addDescriptor(new BLE2902());

    pService->start();

    BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(GKB_BLE_SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);
    pAdvertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();

    Serial.println("✅ [BLE GATT] Advertising as 'GKB-SEC-0001'. Ready for pairing.");
  }
}

// ================= ARDUINO MAIN LOOP =================
void loop() {
  if (pendingReboot && millis() >= rebootScheduledAt) {
    Serial.println("🔄 Rebooting now into operational mode...");
    ESP.restart();
  }

  // Monitor auto-hangup for emergency alert calls
  checkCallStatus();

  // Listen for incoming SMS commands from homeowner phone
  processIncomingGsmData();

  // Periodic GSM signal & dynamic SIM presence refresh
  if (millis() - lastGsmPollTime >= GSM_POLL_INTERVAL_MS) {
    lastGsmPollTime = millis();
    updateGsmSignal();
    if (gsmSimStatus != "READY") {
      checkGsmSimStatus(true); // Auto-detect SIM insertion without reboot
    } else if (gsmNetworkOperator == "SEARCHING" || gsmNetworkOperator.length() == 0) {
      updateGsmOperator();
    }
  }

  // ================= 100MS PIR SENSOR SAMPLING & TRIP LOGIC =================
  static unsigned long lastPirCheck = 0;
  if (millis() - lastPirCheck >= 100) {
    lastPirCheck = millis();
    int currentPir = digitalRead(PIN_PIR);

    if (currentPir == HIGH) {
      if (!motionDetected) {
        motionDetected = true;
        motionTrippedAt = millis();
        Serial.println("🚨 [MOTION DETECTED] PIR Sensor Tripped on GPIO 15!");

        // If system is armed (away or stay), trip the alarm & trigger GSM dispatch!
        if (armedMode != "disarmed") {
          alarmState = "TRIPPED";
          applySirenOutput(true);
          applyBuzzerOutput(true);
          Serial.println("⚡ [ALARM ACTIVE] Intrusion Protocol Activated! Siren ON, Buzzer Pulsing.");

          // Dispatch cellular phone calls and SMS alerts
          triggerIntruderGsmAlerts("Living Room PIR (GPIO 15)");
        } else {
          Serial.println("ℹ️ [DISARMED] Motion detected but system is Disarmed. Siren silenced.");
        }
      } else {
        // Keep refreshing alarm timer while continuous motion persists
        motionTrippedAt = millis();
      }
    } else {
      if (motionDetected) {
        // If motion stopped, clear motion flag after brief settling delay
        if (millis() - motionTrippedAt >= 3000) {
          motionDetected = false;
          Serial.println("🍃 [MOTION CLEARED] PIR Sensor Nominal.");
        }
      }
    }

    // Auto-timeout alarm after hold duration if motion has subsided
    if (alarmState == "TRIPPED" && !motionDetected && (millis() - motionTrippedAt >= ALARM_HOLD_DURATION_MS)) {
      alarmState = "IDLE";
      applySirenOutput(false);
      applyBuzzerOutput(false);
      Serial.println("⏱️ [ALARM TIMEOUT] Siren released after 15s quiet duration.");
    }
  }

  // Handle acoustic / pulsed buzzer modulation
  handleBuzzerModulation();

  // Factory Reset Hold Check (BOOT button held for 5 seconds)
  if (digitalRead(PIN_BOOT_BUTTON) == LOW) {
    if (!buttonHeld) {
      buttonHeld = true;
      buttonPressStartTime = millis();
    } else if (millis() - buttonPressStartTime >= RESET_HOLD_DURATION_MS) {
      triggerFactoryReset();
    }
  } else {
    buttonHeld = false;
  }

  // State Machine
  if (currentMode == MODE_PROVISIONING_BLE) {
    static unsigned long lastBlink = 0;
    static bool ledState = false;
    if (millis() - lastBlink >= (bleClientConnected ? 200 : 800)) {
      lastBlink = millis();
      ledState = !ledState;
      digitalWrite(PIN_STATUS_LED, ledState ? HIGH : LOW);
    }
  } else if (currentMode == MODE_CONNECTING_WIFI) {
    static unsigned long lastAttemptDot = 0;
    if (millis() - lastAttemptDot >= 500) {
      lastAttemptDot = millis();
      Serial.print(".");
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println();
      Serial.printf("🎉 Wi-Fi Connected! IP Address: %s\\n", WiFi.localIP().toString().c_str());

      // Direct lwIP DNS injection
      ip_addr_t primaryDns, secondaryDns;
      IP_ADDR4(&primaryDns, 8, 8, 8, 8);
      IP_ADDR4(&secondaryDns, 1, 1, 1, 1);
      dns_setserver(0, &primaryDns);
      dns_setserver(1, &secondaryDns);
      Serial.println("🌐 [DNS] Set Primary DNS: 8.8.8.8, Secondary DNS: 1.1.1.1");

      digitalWrite(PIN_STATUS_LED, HIGH);
      currentMode = MODE_OPERATIONAL_CLOUD;
      pollAndSyncCloud();
    }
  } else if (currentMode == MODE_OPERATIONAL_CLOUD) {
    if (WiFi.status() == WL_CONNECTED) {
      if (millis() - lastCloudPoll >= CLOUD_POLL_INTERVAL_MS) {
        lastCloudPoll = millis();
        pollAndSyncCloud();
      }
    } else {
      digitalWrite(PIN_STATUS_LED, LOW);
      Serial.println("⚠️ [WIFI] Connection lost! Reconnecting...");
      currentMode = MODE_CONNECTING_WIFI;
      WiFi.reconnect();
    }
  }

  delay(20);
}
`;
}

export default function SmartSecurityDashboard({
  mode = 'service',
  device,
  isAdmin = false
}: {
  mode?: 'test' | 'service';
  device?: Device;
  isAdmin?: boolean;
}) {
  const deviceKey = device?.key || 'GKB-SEC-0001';

  // Security Operating State
  const [armedMode, setArmedMode] = useState<'away' | 'stay' | 'disarmed'>('away');
  const [alarmState, setAlarmState] = useState<'IDLE' | 'TRIPPED' | 'MUTED'>('IDLE');
  const [motionDetected, setMotionDetected] = useState<boolean>(false);
  const [sirenActive, setSirenActive] = useState<boolean>(false);
  const [buzzerActive, setBuzzerActive] = useState<boolean>(false);
  const [soundMuted, setSoundMuted] = useState<boolean>(false);
  const [pirSensitivity, setPirSensitivity] = useState<'low' | 'medium' | 'high'>('high');

  // GSM Cellular Modem Subsystem State
  const [gsmEnabled, setGsmEnabled] = useState<boolean>(true);
  const [gsmSignalCsq, setGsmSignalCsq] = useState<number>(24);
  const [gsmNetworkOperator, setGsmNetworkOperator] = useState<string>('MTN-GH');
  const [gsmSimStatus, setGsmSimStatus] = useState<string>('READY');
  const [gsmCallState, setGsmCallState] = useState<string>('IDLE');
  const [gsmLastSmsStatus, setGsmLastSmsStatus] = useState<string>('IDLE');
  const [primaryPhone, setPrimaryPhone] = useState<string>('+233256905290');
  const [secondaryPhone, setSecondaryPhone] = useState<string>('');
  const [smsOnAlarm, setSmsOnAlarm] = useState<boolean>(false);
  const [callOnAlarm, setCallOnAlarm] = useState<boolean>(true);
  const [smsOnArmDisarm, setSmsOnArmDisarm] = useState<boolean>(false);

  // Dynamic Emergency Contacts Directory State & Dirty-Editing Guard
  const [contacts, setContacts] = useState<EmergencyContact[]>([
    {
      id: 'contact-1',
      name: 'Primary Security Contact',
      phone: '+233256905290',
      isPrimary: true,
      enableCall: true,
      enableSms: false
    }
  ]);
  const [contactsDirty, setContactsDirty] = useState<boolean>(false);
  const contactsDirtyRef = useRef<boolean>(false);

  const markContactsDirty = (dirty: boolean) => {
    contactsDirtyRef.current = dirty;
    setContactsDirty(dirty);
  };

  // GSM Interaction State
  const [savingContacts, setSavingContacts] = useState(false);
  const [contactsNotice, setContactsNotice] = useState('');
  const [testSmsBusy, setTestSmsBusy] = useState(false);
  const [testCallBusy, setTestCallBusy] = useState(false);
  const [showSmsCheatSheet, setShowSmsCheatSheet] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showEngineeringModal, setShowEngineeringModal] = useState(false);

  const [connectionState, setConnectionState] = useState<'connected' | 'connecting' | 'error'>('connecting');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [audioNeedsInteraction, setAudioNeedsInteraction] = useState(false);

  // Motion Notification Popup & Browser Notification State
  const [motionPopup, setMotionPopup] = useState<{
    visible: boolean;
    timestamp: string;
    zone: string;
    pin: string;
    secondsAgo: number;
  } | null>(null);

  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  });

  const prevMotionRef = useRef<boolean>(false);

  // Request browser desktop / phone notification permission
  const requestNotificationPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const perm = await Notification.requestPermission();
        setNotificationPermission(perm);
        if (perm === 'granted') {
          new Notification('🛡️ GKB Security Notifications Enabled', {
            body: 'You will receive immediate popups when motion is detected!',
            icon: '/favicon.ico'
          });
        }
      } catch (err) {
        console.warn('Notification permission error:', err);
      }
    }
  };

  // Trigger popup notification modal & desktop notification
  const triggerMotionPopup = useCallback((zoneName: string = 'Living Room PIR #01', pin: string = 'GPIO 15') => {
    const timeStr = new Date().toLocaleTimeString();
    setMotionPopup({
      visible: true,
      timestamp: timeStr,
      zone: zoneName,
      pin: pin,
      secondsAgo: 0
    });

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('🚨 GKB Security: Motion Detected!', {
          body: `Motion detected in ${zoneName} (${pin})! Status: ${armedMode.toUpperCase()} · GSM Alerts Dispatched`,
          icon: '/favicon.ico',
          tag: 'gkb-security-motion-' + Date.now(),
          requireInteraction: true
        });
      } catch (e) {
        console.warn('Desktop notification error:', e);
      }
    }
  }, [armedMode]);

  // Elapsed seconds timer on active popup
  useEffect(() => {
    if (!motionPopup?.visible) return;
    const timer = setInterval(() => {
      setMotionPopup(prev => prev ? { ...prev, secondsAgo: prev.secondsAgo + 1 } : null);
    }, 1000);
    return () => clearInterval(timer);
  }, [motionPopup?.visible]);

  // Modals
  const [provisionModalOpen, setProvisionModalOpen] = useState(false);
  const [showFirmwareModal, setShowFirmwareModal] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [copiedFirmware, setCopiedFirmware] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Security Zones
  const [zones, setZones] = useState<Array<{
    id: string;
    name: string;
    location: string;
    type: 'pir' | 'magnetic' | 'vibration' | 'infrared';
    status: 'triggered' | 'secure';
    lastTripped: string;
    pin: string;
  }>>([
    { id: 'zone-1', name: 'Living Room PIR #01', location: 'Living Room (Front Window)', type: 'pir', status: 'secure', lastTripped: 'Never', pin: 'GPIO 15' },
    { id: 'zone-2', name: 'Front Entrance Contact', location: 'Main Front Door', type: 'magnetic', status: 'secure', lastTripped: '12 mins ago', pin: 'GPIO 4' },
    { id: 'zone-3', name: 'Kitchen Window Glass', location: 'Rear Kitchen Window', type: 'vibration', status: 'secure', lastTripped: '1 hour ago', pin: 'GPIO 14' },
    { id: 'zone-4', name: 'Patio Infrared Barrier', location: 'Backyard Perimeter', type: 'infrared', status: 'secure', lastTripped: 'Yesterday', pin: 'GPIO 13' }
  ]);

  const [alerts, setAlerts] = useState<SecurityAlert[]>([
    { id: 'alert-1', timestamp: new Date().toLocaleTimeString(), title: 'Security System Armed', detail: 'All interior PIR motion and perimeter zones are monitored with GSM SIM800L auto-dispatch ready.', severity: 'info' }
  ]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const buzzerCleanupRef = useRef<(() => void) | null>(null);

  const isAlarmActive = (alarmState === 'TRIPPED' || (motionDetected && armedMode !== 'disarmed'));

  // Web Audio Context setup
  const ensureAudioContext = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().then(() => setAudioNeedsInteraction(false)).catch(() => setAudioNeedsInteraction(true));
      } else {
        setAudioNeedsInteraction(false);
      }
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  const stopBuzzer = useCallback(() => {
    if (buzzerCleanupRef.current) {
      try {
        buzzerCleanupRef.current();
      } catch {
        // ignore
      }
      buzzerCleanupRef.current = null;
    }
  }, []);

  // Web Audio electronic siren synthesizer
  const startBuzzer = useCallback(() => {
    stopBuzzer();
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      setAudioNeedsInteraction(true);
      return;
    }

    try {
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(165, now);

      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      osc2.frequency.setValueAtTime(330, now);

      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.setValueAtTime(10, now);

      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(0.75, now);

      const pulseGain = ctx.createGain();
      pulseGain.gain.setValueAtTime(0.25, now);

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.0001, now);
      masterGain.gain.linearRampToValueAtTime(0.2, now + 0.05);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, now);

      lfo.connect(lfoGain);
      lfoGain.connect(pulseGain.gain);

      osc1.connect(filter);
      const osc2Gain = ctx.createGain();
      osc2Gain.gain.setValueAtTime(0.35, now);
      osc2.connect(osc2Gain);
      osc2Gain.connect(filter);

      filter.connect(pulseGain);
      pulseGain.connect(masterGain);
      masterGain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      lfo.start(now);

      let stopped = false;
      buzzerCleanupRef.current = () => {
        if (stopped) return;
        stopped = true;
        try {
          const stopTime = ctx.currentTime;
          masterGain.gain.cancelScheduledValues(stopTime);
          masterGain.gain.linearRampToValueAtTime(0.0001, stopTime + 0.04);
          setTimeout(() => {
            try {
              osc1.stop();
              osc2.stop();
              lfo.stop();
              osc1.disconnect();
              osc2.disconnect();
              lfo.disconnect();
              filter.disconnect();
              masterGain.disconnect();
            } catch {
              // ignore
            }
          }, 50);
        } catch {
          // ignore
        }
      };
    } catch (e) {
      console.warn('Audio buzzer startup failed:', e);
    }
  }, [ensureAudioContext, stopBuzzer]);

  useEffect(() => {
    if (isAlarmActive && !soundMuted) {
      startBuzzer();
    } else {
      stopBuzzer();
    }
    return () => stopBuzzer();
  }, [isAlarmActive, soundMuted, startBuzzer, stopBuzzer]);

  useEffect(() => {
    return () => {
      stopBuzzer();
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [stopBuzzer]);

  // Apply row data from Supabase
  const applyRowData = useCallback((row: any) => {
    setArmedMode(row.armed_mode || 'away');
    setAlarmState(row.alarm_state || 'IDLE');
    const isNowMotion = Boolean(row.motion_detected);
    if (isNowMotion && !prevMotionRef.current) {
      triggerMotionPopup('Living Room PIR #01', 'GPIO 15');
    }
    prevMotionRef.current = isNowMotion;
    setMotionDetected(isNowMotion);
    setSirenActive(Boolean(row.siren_active));
    setBuzzerActive(Boolean(row.buzzer_active));
    setSoundMuted(Boolean(row.sound_muted));
    if (row.pir_sensitivity) setPirSensitivity(row.pir_sensitivity);

    // GSM Subsystem Fields
    if (row.gsm_enabled !== undefined) setGsmEnabled(Boolean(row.gsm_enabled));
    if (row.gsm_signal_csq !== undefined && row.gsm_signal_csq !== null) setGsmSignalCsq(Number(row.gsm_signal_csq));
    if (row.gsm_network_operator) setGsmNetworkOperator(row.gsm_network_operator);
    if (row.gsm_sim_status) setGsmSimStatus(row.gsm_sim_status);
    if (row.gsm_call_state) setGsmCallState(row.gsm_call_state);
    if (row.gsm_last_sms_status) setGsmLastSmsStatus(row.gsm_last_sms_status);
    if (row.sms_on_alarm !== undefined) setSmsOnAlarm(Boolean(row.sms_on_alarm));
    if (row.call_on_alarm !== undefined) setCallOnAlarm(Boolean(row.call_on_alarm));
    if (row.sms_on_arm_disarm !== undefined) setSmsOnArmDisarm(Boolean(row.sms_on_arm_disarm));

    // CRITICAL: Synchronize Emergency Contacts ONLY if user is not actively editing
    if (!contactsDirtyRef.current) {
      if (Array.isArray(row.emergency_contacts) && row.emergency_contacts.length > 0) {
        setContacts(row.emergency_contacts);
        const prim = row.emergency_contacts.find((c: any) => c.isPrimary) || row.emergency_contacts[0];
        if (prim?.phone) setPrimaryPhone(prim.phone);
        const sec = row.emergency_contacts.find((c: any) => !c.isPrimary && c.phone);
        setSecondaryPhone(sec ? sec.phone : '');
      } else {
        const pPhone = row.primary_phone || '+233256905290';
        const sPhone = row.secondary_phone || '';
        setPrimaryPhone(pPhone);
        setSecondaryPhone(sPhone);
        const initialList: EmergencyContact[] = [
          {
            id: 'contact-1',
            name: 'Primary Security Contact',
            phone: pPhone,
            isPrimary: true,
            enableCall: true,
            enableSms: false
          }
        ];
        if (sPhone && sPhone.trim().length > 0) {
          initialList.push({
            id: 'contact-2',
            name: 'Secondary Backup Line',
            phone: sPhone,
            isPrimary: false,
            enableCall: true,
            enableSms: false
          });
        }
        setContacts(initialList);
      }
    }

    // Update zone 1 status according to motion_detected
    setZones(prev => prev.map(z => z.id === 'zone-1' ? {
      ...z,
      status: isNowMotion ? 'triggered' : 'secure',
      lastTripped: isNowMotion ? 'Just now' : z.lastTripped
    } : z));

    setConnectionState('connected');
    setLastSyncedAt(new Date());
  }, [triggerMotionPopup]);

  // Supabase Fetch & Sync
  const fetchSecurityStatus = useCallback(async () => {
    try {
      const res = await fetch(`${HARDCODED_SUPABASE_URL}/rest/v1/home_security_status?device_id=eq.security_01`, {
        headers: {
          apikey: HARDCODED_SUPABASE_KEY,
          Authorization: `Bearer ${HARDCODED_SUPABASE_KEY}`,
          Accept: 'application/json'
        }
      });
      if (!res.ok) {
        setConnectionState('error');
        return;
      }
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        applyRowData(data[0]);
      }
    } catch (err) {
      setConnectionState('error');
    }
  }, [applyRowData]);

  useEffect(() => {
    fetchSecurityStatus();
    const interval = setInterval(fetchSecurityStatus, 2500);

    let channel: any = null;
    if (relaySupabase) {
      channel = relaySupabase
        .channel('security_status_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'home_security_status' }, (payload) => {
          if (payload.new) {
            applyRowData(payload.new);
          }
        })
        .subscribe();
    }

    return () => {
      clearInterval(interval);
      if (channel && relaySupabase) {
        relaySupabase.removeChannel(channel);
      }
    };
  }, [fetchSecurityStatus, applyRowData]);

  // Patch Cloud State
  const patchCloud = async (fields: Record<string, any>) => {
    setActionBusy(true);
    setStatusMessage('');
    try {
      const res = await fetch(`${HARDCODED_SUPABASE_URL}/rest/v1/home_security_status?device_id=eq.security_01`, {
        method: 'PATCH',
        headers: {
          apikey: HARDCODED_SUPABASE_KEY,
          Authorization: `Bearer ${HARDCODED_SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(fields)
      });
      if (res.ok) {
        setLastSyncedAt(new Date());
      }
    } catch {
      // optimistic state retained
    } finally {
      setActionBusy(false);
    }
  };

  const handleSetArmedMode = (mode: 'away' | 'stay' | 'disarmed') => {
    ensureAudioContext();
    setArmedMode(mode);
    if (mode === 'disarmed') {
      setAlarmState('IDLE');
      setSirenActive(false);
      setBuzzerActive(false);
      setMotionDetected(false);
      setZones(prev => prev.map(z => ({ ...z, status: 'secure' })));
    }
    const title = mode === 'away' ? 'System Armed (Away)' : mode === 'stay' ? 'System Armed (Stay)' : 'System Disarmed';
    const detail = mode === 'away' ? 'All interior PIR and perimeter zones armed with active GSM emergency calling.' : mode === 'stay' ? 'Perimeter zones armed; interior walk mode enabled.' : 'Alarm silenced and security relaxed.';
    setAlerts(prev => [{ id: `${Date.now()}`, timestamp: new Date().toLocaleTimeString(), title, detail, severity: mode === 'disarmed' ? 'info' : 'warning' }, ...prev.slice(0, 9)]);
    patchCloud({
      armed_mode: mode,
      ...(mode === 'disarmed' ? { alarm_state: 'IDLE', siren_active: false, buzzer_active: false, motion_detected: false } : {})
    });
  };

  const handleClearAlarm = () => {
    ensureAudioContext();
    setAlarmState('IDLE');
    setSirenActive(false);
    setBuzzerActive(false);
    setMotionDetected(false);
    setZones(prev => prev.map(z => ({ ...z, status: 'secure' })));
    setAlerts(prev => [{
      id: `${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      title: 'Alarm Cleared & Silenced',
      detail: 'Manual reset from web dashboard. Siren relay (GPIO 23) released.',
      severity: 'info'
    }, ...prev.slice(0, 9)]);
    patchCloud({ alarm_state: 'IDLE', siren_active: false, buzzer_active: false, motion_detected: false });
  };

  const handlePanicButton = () => {
    ensureAudioContext();
    setAlarmState('TRIPPED');
    setSirenActive(true);
    setBuzzerActive(true);
    setMotionDetected(true);
    triggerMotionPopup('Remote Panic Button', 'Manual Override');
    setZones(prev => prev.map(z => z.id === 'zone-1' ? { ...z, status: 'triggered', lastTripped: 'Just now' } : z));
    setAlerts(prev => [{
      id: `${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      title: '🚨 EMERGENCY PANIC TRIGGERED',
      detail: `Remote panic button energized. Siren Strobe Relay ON, buzzer pulsing, and GSM auto-call dialing ${primaryPhone}.`,
      severity: 'critical'
    }, ...prev.slice(0, 9)]);
    patchCloud({ alarm_state: 'TRIPPED', siren_active: true, buzzer_active: true, motion_detected: true });
  };

  const toggleSoundMute = () => {
    ensureAudioContext();
    const nextMuted = !soundMuted;
    setSoundMuted(nextMuted);
    patchCloud({ sound_muted: nextMuted });
  };

  // Simulate or Test Motion on Zone 1
  const handleTestMotionTrip = () => {
    ensureAudioContext();
    setMotionDetected(true);
    triggerMotionPopup('Living Room PIR #01', 'GPIO 15');
    if (armedMode !== 'disarmed') {
      setAlarmState('TRIPPED');
      setSirenActive(true);
      setBuzzerActive(true);
    }
    setZones(prev => prev.map(z => z.id === 'zone-1' ? { ...z, status: 'triggered', lastTripped: 'Just now' } : z));
    setAlerts(prev => [{
      id: `${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      title: 'Motion Tripped · Living Room PIR #01',
      detail: `PIR infrared movement detected (GPIO 15). Blinking red strobe, buzzer & GSM dispatch triggered to ${primaryPhone}.`,
      severity: 'critical'
    }, ...prev.slice(0, 9)]);
    patchCloud({
      motion_detected: true,
      ...(armedMode !== 'disarmed' ? { alarm_state: 'TRIPPED', siren_active: true, buzzer_active: true } : {})
    });
  };

  // Emergency Contact Directory Handlers
  const handleAddContact = () => {
    markContactsDirty(true);
    const newId = 'contact-' + Date.now();
    const newIndex = contacts.length + 1;
    const isFirst = contacts.length === 0;
    const newContact: EmergencyContact = {
      id: newId,
      name: `Emergency Contact #${newIndex}`,
      phone: '',
      isPrimary: isFirst,
      enableCall: true,
      enableSms: false
    };
    setContacts(prev => [...prev, newContact]);
    if (isFirst) {
      setPrimaryPhone('');
    }
  };

  const handleRemoveContact = (id: string) => {
    if (contacts.length <= 1) {
      alert('You must have at least one emergency contact configured for GSM security dispatch.');
      return;
    }
    markContactsDirty(true);
    setContacts(prev => {
      const target = prev.find(c => c.id === id);
      const remaining = prev.filter(c => c.id !== id);
      let updated = remaining;
      if (target?.isPrimary && remaining.length > 0) {
        updated = remaining.map((c, idx) => idx === 0 ? { ...c, isPrimary: true, enableCall: true } : c);
      }
      const prim = updated.find(c => c.isPrimary) || updated[0];
      if (prim) setPrimaryPhone(prim.phone);
      const sec = updated.find(c => !c.isPrimary && c.phone);
      setSecondaryPhone(sec ? sec.phone : '');
      return updated;
    });
  };

  const handleSetPrimary = (id: string) => {
    markContactsDirty(true);
    setContacts(prev => {
      const updated = prev.map(c => ({
        ...c,
        isPrimary: c.id === id,
        enableCall: c.id === id ? true : c.enableCall
      }));
      const prim = updated.find(c => c.id === id);
      if (prim) setPrimaryPhone(prim.phone);
      const sec = updated.find(c => c.id !== id && c.phone);
      setSecondaryPhone(sec ? sec.phone : '');
      return updated;
    });
  };

  const handleUpdateContact = (id: string, updates: Partial<EmergencyContact>) => {
    markContactsDirty(true);
    setContacts(prev => {
      const updated = prev.map(c => c.id === id ? { ...c, ...updates } : c);
      const prim = updated.find(c => c.isPrimary);
      if (prim && updates.phone !== undefined) {
        setPrimaryPhone(prim.phone);
      }
      return updated;
    });
  };

  const handleDiscardContacts = () => {
    markContactsDirty(false);
    fetchSecurityStatus();
  };

  // Save GSM Emergency Contacts & Settings
  const handleSaveContacts = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (contacts.length === 0) {
      setContactsNotice('⚠️ Please add at least one emergency contact.');
      return;
    }

    const primary = contacts.find(c => c.isPrimary) || contacts[0];
    if (!primary.phone || primary.phone.trim().length < 5) {
      setContactsNotice('⚠️ Primary Emergency Contact must have a valid phone number (at least 5 digits).');
      return;
    }

    const secondary = contacts.find(c => !c.isPrimary && c.phone && c.phone.trim().length >= 5);
    const pPhone = primary.phone.trim();
    const sPhone = secondary ? secondary.phone.trim() : '';

    setSavingContacts(true);
    setContactsNotice('');
    try {
      await patchCloud({
        primary_phone: pPhone,
        secondary_phone: sPhone,
        emergency_contacts: contacts,
        sms_on_alarm: smsOnAlarm,
        call_on_alarm: callOnAlarm,
        sms_on_arm_disarm: smsOnArmDisarm,
        gsm_enabled: gsmEnabled
      });
      setPrimaryPhone(pPhone);
      setSecondaryPhone(sPhone);
      markContactsDirty(false);
      setContactsNotice(`✅ Saved ${contacts.length} emergency contacts! Primary contact (${pPhone}) synced to ESP32 SIM800L.`);
      setTimeout(() => setContactsNotice(''), 6000);
    } catch {
      setContactsNotice('❌ Failed to save contacts to Supabase. Check connection.');
    } finally {
      setSavingContacts(false);
    }
  };

  // Trigger Live Test SMS
  const handleTestSms = async () => {
    const targetPhone = primaryPhone || contacts.find(c => c.isPrimary)?.phone || '';
    if (!targetPhone) {
      setContactsNotice('⚠️ No primary phone number available to test.');
      return;
    }
    setTestSmsBusy(true);
    setAlerts(prev => [{
      id: `${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      title: '🧪 Cellular Test SMS Requested',
      detail: `Dispatching test SMS to primary contact (${targetPhone}) via ESP32 SIM800L.`,
      severity: 'info'
    }, ...prev.slice(0, 9)]);

    await patchCloud({ gsm_test_requested: 'TEST_SMS' });
    setTimeout(() => {
      setTestSmsBusy(false);
    }, 2500);
  };

  // Trigger Live Test Call
  const handleTestCall = async () => {
    const targetPhone = primaryPhone || contacts.find(c => c.isPrimary)?.phone || '';
    if (!targetPhone) {
      setContactsNotice('⚠️ No primary phone number available to test.');
      return;
    }
    setTestCallBusy(true);
    setAlerts(prev => [{
      id: `${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      title: '📞 Emergency Auto-Dial Call Test',
      detail: `ESP32 placing 25-second test ring to ${targetPhone} via SIM800L UART.`,
      severity: 'info'
    }, ...prev.slice(0, 9)]);

    await patchCloud({ gsm_test_requested: 'TEST_CALL' });
    setTimeout(() => {
      setTestCallBusy(false);
    }, 2500);
  };

  // RSSI dBm calculation from CSQ (0 to 31)
  const rssiDbm = gsmSignalCsq === 99 || gsmSignalCsq === 0 ? -113 : -113 + (gsmSignalCsq * 2);
  const signalQualityLabel =
    gsmSignalCsq >= 20 ? 'Excellent' :
    gsmSignalCsq >= 15 ? 'Good' :
    gsmSignalCsq >= 10 ? 'Fair' : 'Marginal';

  return (
    <section
      aria-labelledby="security-system-title"
      onClick={ensureAudioContext}
      className={`space-y-3 rounded-2xl border p-3 sm:p-4 transition-all duration-300 relative overflow-hidden ${
        isAlarmActive
          ? 'gkb-security-red-blink text-white'
          : 'border-cyan-500/30 bg-slate-900/90 text-slate-100 shadow-xl shadow-cyan-950/40 backdrop-blur-md'
      }`}
    >
      <style>{`
        @keyframes gkb-security-red-blink {
          0%, 100% {
            background-color: rgba(127, 29, 29, 0.45);
            border-color: rgba(239, 68, 68, 0.7);
            box-shadow: 0 0 45px rgba(239, 68, 68, 0.5), inset 0 0 70px rgba(185, 28, 28, 0.4);
          }
          50% {
            background-color: rgba(220, 38, 38, 0.88);
            border-color: rgba(254, 202, 202, 1);
            box-shadow: 0 0 95px rgba(239, 68, 68, 0.95), inset 0 0 120px rgba(239, 68, 68, 0.8);
          }
        }
        .gkb-security-red-blink {
          animation: gkb-security-red-blink 0.85s infinite ease-in-out;
        }
        @keyframes gkb-siren-strobe {
          0%, 100% { transform: scale(1) rotate(-8deg); }
          50% { transform: scale(1.18) rotate(8deg); }
        }
        .gkb-siren-strobe {
          animation: gkb-siren-strobe 0.55s infinite ease-in-out;
        }
        @keyframes gkb-radar-ring {
          0% { transform: scale(0.3); opacity: 1; }
          100% { transform: scale(2.6); opacity: 0; }
        }
        .gkb-radar-ring {
          animation: gkb-radar-ring 1.4s infinite ease-out;
        }
      `}</style>

      {/* ================= FLOATING INTRUSION NOTIFICATION POPUP ================= */}
      {motionPopup?.visible && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed top-5 right-4 sm:right-6 z-[100] max-w-md w-full animate-fadeIn"
        >
          <div className="relative overflow-hidden rounded-2xl border-2 border-red-500 bg-slate-950/95 p-4 sm:p-5 shadow-[0_0_55px_rgba(239,68,68,0.7)] backdrop-blur-xl">
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-600 via-amber-400 to-red-600 animate-pulse" />

            <div className="flex items-start gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white shadow-lg shadow-red-600/70 gkb-siren-strobe">
                <Siren className="h-6 w-6" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-red-500/50 bg-red-500/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-red-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-ping" />
                    Intrusion Alert
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {motionPopup.timestamp}
                  </span>
                </div>

                <h4 className="mt-1 text-sm font-black text-white uppercase tracking-wide truncate">
                  Motion Detected: {motionPopup.zone}
                </h4>

                <p className="mt-0.5 text-xs text-slate-300 leading-relaxed">
                  Infrared motion sensed on <strong className="text-red-400">{motionPopup.pin}</strong>. System status: <strong className="text-white">{armedMode.toUpperCase()}</strong>.
                </p>

                {gsmEnabled && primaryPhone && (
                  <p className="mt-1 text-[11px] text-amber-300 font-mono flex items-center gap-1">
                    <PhoneForwarded className="h-3 w-3 text-amber-400" />
                    GSM Auto-Dialing: <span className="underline">{primaryPhone}</span>
                  </p>
                )}

                {motionPopup.secondsAgo > 0 && (
                  <p className="text-[10px] text-amber-400 mt-1 flex items-center gap-1 font-mono">
                    <Activity className="h-3 w-3" /> Active alert · Tripped {motionPopup.secondsAgo}s ago
                  </p>
                )}

                <div className="mt-3.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClearAlarm}
                    className="inline-flex items-center gap-1 rounded-xl bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-red-500 transition-all cursor-pointer shadow-md shadow-red-600/30"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Clear Alarm
                  </button>

                  <button
                    type="button"
                    onClick={toggleSoundMute}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white transition-all cursor-pointer"
                  >
                    {soundMuted ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                    {soundMuted ? 'Unmute' : 'Silence'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setMotionPopup(prev => prev ? { ...prev, visible: false } : null)}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-xs text-slate-400 hover:text-white transition-all cursor-pointer ml-auto"
                  >
                    <X className="h-3.5 w-3.5" /> Dismiss
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setMotionPopup(prev => prev ? { ...prev, visible: false } : null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
                aria-label="Close notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= 1. CLIENT-FIRST SLEEK HEADER ================= */}
      <header className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/80 p-3 sm:p-4 sm:flex-row sm:items-center sm:justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl shrink-0 transition-all ${
            isAlarmActive
              ? 'bg-red-600 text-white shadow-lg shadow-red-600/50 gkb-siren-strobe'
              : 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 shadow-md shadow-cyan-500/10'
          }`}>
            <Shield className="h-5 w-5" />
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="security-system-title" className="text-base sm:text-lg font-black text-white">
                Smart Home Security
              </h2>
              <span className="font-mono text-[10px] text-cyan-300 bg-slate-900 px-2 py-0.5 rounded-md border border-cyan-500/30 font-bold">
                {deviceKey}
              </span>
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                isAlarmActive ? 'bg-red-500/25 text-red-200 border border-red-500/50 animate-pulse' :
                armedMode === 'away' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' :
                armedMode === 'stay' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' :
                'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${
                  isAlarmActive ? 'bg-red-400 animate-ping' :
                  armedMode === 'disarmed' ? 'bg-emerald-400' : 'bg-amber-400'
                }`} />
                {isAlarmActive ? 'ALARM TRIPPED' : armedMode === 'away' ? 'ARMED (AWAY)' : armedMode === 'stay' ? 'ARMED (STAY)' : 'DISARMED'}
              </span>
              {gsmSimStatus === 'READY' && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  <Signal className="h-3 w-3" /> GSM Online
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              {isAlarmActive
                ? '⚠️ Emergency intrusion alarm active! Siren sounding and emergency contacts dispatched.'
                : 'Real-time motion sensing, 4-zone perimeter monitoring, and emergency phone dispatch.'}
            </p>
          </div>
        </div>

        {/* Action Controls for Client */}
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
          <button
            type="button"
            onClick={() => setProvisionModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-md shadow-cyan-500/20 hover:brightness-110 transition-all cursor-pointer"
          >
            <Bluetooth className="h-3.5 w-3.5" />
            <span>Pair Device</span>
          </button>

          {/* Sound / Buzzer Mute Toggle */}
          <button
            type="button"
            onClick={toggleSoundMute}
            title={soundMuted ? 'Buzzer muted - click to enable audio alerts' : 'Buzzer active - click to mute'}
            className={`p-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
              soundMuted
                ? 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
                : isAlarmActive
                  ? 'border-amber-400 bg-amber-500/30 text-amber-200 animate-pulse'
                  : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20'
            }`}
          >
            {soundMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          {/* Notification Permission Toggle */}
          <button
            type="button"
            onClick={requestNotificationPermission}
            title={notificationPermission === 'granted' ? 'Desktop popups active' : 'Click to enable desktop popups'}
            className={`p-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
              notificationPermission === 'granted'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            {notificationPermission === 'granted' ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </button>

          {/* Admin / Engineering Tools Toggle */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowEngineeringModal(true)}
              title="Engineering Tools (Firmware, SQL, QR sticker)"
              className="inline-flex items-center gap-1 rounded-xl border border-purple-500/40 bg-purple-500/15 px-2.5 py-2 text-xs font-bold text-purple-200 hover:bg-purple-500/25 transition-all cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5 text-purple-300" />
              <span className="hidden md:inline">Dev Tools</span>
            </button>
          )}
        </div>
      </header>

      {/* Browser Autoplay interaction warning */}
      {isAlarmActive && !soundMuted && audioNeedsInteraction && (
        <button
          type="button"
          onClick={() => {
            ensureAudioContext();
            if (audioCtxRef.current?.state === 'suspended') {
              audioCtxRef.current.resume().then(() => setAudioNeedsInteraction(false));
            }
          }}
          className="w-full rounded-xl border border-amber-500 bg-amber-500/20 p-2.5 text-xs font-bold text-amber-200 text-center animate-bounce cursor-pointer"
        >
          🔊 Click anywhere to enable browser audio alarm sound
        </button>
      )}

      {/* CRITICAL INTRUSION BANNER (Shown when alarm is TRIPPED) */}
      {isAlarmActive && (
        <div className="rounded-2xl border-2 border-red-500 bg-red-950/80 p-3.5 sm:p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xl shadow-red-900/60 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-600 text-white shadow-xl shadow-red-600/70 gkb-siren-strobe">
              <Siren className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-white uppercase tracking-wider">
                🚨 Intrusion Alert! Alarm Tripped!
              </h3>
              <p className="text-xs text-red-200 mt-0.5">
                Motion detected while system armed in <strong>{armedMode.toUpperCase()}</strong> mode. Physical siren strobe active.
              </p>
              {gsmEnabled && primaryPhone && (
                <p className="text-xs text-amber-300 font-mono mt-1 flex items-center gap-1.5">
                  <PhoneCall className="h-3.5 w-3.5 text-amber-400 animate-bounce" />
                  GSM Auto-Dispatch: Calling <strong className="text-white">{primaryPhone}</strong> and sending alert SMS.
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
            <button
              type="button"
              onClick={handleClearAlarm}
              className="flex-1 sm:flex-initial rounded-xl bg-white px-4 py-2 text-xs font-black text-red-700 hover:bg-slate-100 transition-all cursor-pointer shadow-lg"
            >
              Clear Alarm
            </button>
            <button
              type="button"
              onClick={() => handleSetArmedMode('disarmed')}
              className="flex-1 sm:flex-initial rounded-xl border border-red-400 bg-red-900/70 px-4 py-2 text-xs font-bold text-white hover:bg-red-800 transition-all cursor-pointer"
            >
              Disarm All
            </button>
          </div>
        </div>
      )}

      {/* ================= 2. COMPACT 3-MODE ARMING SELECTOR ================= */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => handleSetArmedMode('away')}
          className={`flex items-center justify-center gap-2 rounded-2xl border py-2.5 sm:py-3 px-3 transition-all cursor-pointer ${
            armedMode === 'away'
              ? 'border-red-500 bg-red-500/20 text-white shadow-lg shadow-red-500/20 ring-1 ring-red-400'
              : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900/60'
          }`}
        >
          <ShieldAlert className={`h-4 w-4 sm:h-5 sm:w-5 shrink-0 ${armedMode === 'away' ? 'text-red-400' : 'text-slate-400'}`} />
          <div className="text-left">
            <span className="block text-xs sm:text-sm font-black uppercase tracking-wider">Armed Away</span>
            <span className="text-[10px] text-slate-400 hidden sm:block">Full Protection</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => handleSetArmedMode('stay')}
          className={`flex items-center justify-center gap-2 rounded-2xl border py-2.5 sm:py-3 px-3 transition-all cursor-pointer ${
            armedMode === 'stay'
              ? 'border-amber-500 bg-amber-500/20 text-white shadow-lg shadow-amber-500/20 ring-1 ring-amber-400'
              : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900/60'
          }`}
        >
          <ShieldCheck className={`h-4 w-4 sm:h-5 sm:w-5 shrink-0 ${armedMode === 'stay' ? 'text-amber-400' : 'text-slate-400'}`} />
          <div className="text-left">
            <span className="block text-xs sm:text-sm font-black uppercase tracking-wider">Armed Stay</span>
            <span className="text-[10px] text-slate-400 hidden sm:block">Perimeter Only</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => handleSetArmedMode('disarmed')}
          className={`flex items-center justify-center gap-2 rounded-2xl border py-2.5 sm:py-3 px-3 transition-all cursor-pointer ${
            armedMode === 'disarmed'
              ? 'border-emerald-500 bg-emerald-500/20 text-white shadow-lg shadow-emerald-500/20 ring-1 ring-emerald-400'
              : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900/60'
          }`}
        >
          <Unlock className={`h-4 w-4 sm:h-5 sm:w-5 shrink-0 ${armedMode === 'disarmed' ? 'text-emerald-400' : 'text-slate-400'}`} />
          <div className="text-left">
            <span className="block text-xs sm:text-sm font-black uppercase tracking-wider">Disarmed</span>
            <span className="text-[10px] text-slate-400 hidden sm:block">System Standby</span>
          </div>
        </button>
      </div>

      {/* ================= 3. CLIENT-FIRST EMERGENCY DISPATCH LINE ================= */}
      <section className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-slate-950 via-slate-900/80 to-slate-950 p-3 sm:p-3.5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0">
              <Phone className="h-4 w-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                  Emergency Contact:
                </span>
                <span className="font-bold text-white text-xs">
                  {contacts[0]?.name || 'Primary Security Line'}
                </span>
                <span className="font-mono text-xs font-bold text-cyan-300 bg-slate-900 px-2 py-0.5 rounded border border-cyan-500/30">
                  {primaryPhone || 'No Phone Set'}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/30">
                  <PhoneCall className="h-2.5 w-2.5" /> Auto-Dial
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/30">
                  <MessageSquare className="h-2.5 w-2.5" /> SMS Alert
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Auto-dialed on alarm. Cellular signal: <strong className="text-slate-300 font-mono">{gsmNetworkOperator} ({signalQualityLabel})</strong>.
              </p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowContactModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-cyan-400 hover:text-cyan-300 transition-all cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5 text-cyan-400" />
              <span>Edit Contact</span>
            </button>

            <button
              type="button"
              onClick={handleTestCall}
              disabled={testCallBusy || !primaryPhone}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition-all cursor-pointer disabled:opacity-50"
            >
              <PhoneCall className="h-3.5 w-3.5" />
              <span>{testCallBusy ? 'Calling...' : 'Test Call'}</span>
            </button>

            <button
              type="button"
              onClick={handleTestSms}
              disabled={testSmsBusy || !primaryPhone}
              className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 transition-all cursor-pointer disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{testSmsBusy ? 'Sending...' : 'Test SMS'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSmsCheatSheet(!showSmsCheatSheet)}
              className="inline-flex items-center gap-1 rounded-xl border border-purple-500/40 bg-purple-500/10 px-2.5 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-500/20 transition-all cursor-pointer"
              title="View two-way remote SMS commands"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">SMS Commands</span>
            </button>
          </div>
        </div>

        {contactsNotice && (
          <p className="mt-2 text-xs p-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 animate-fadeIn">
            {contactsNotice}
          </p>
        )}
      </section>

      {/* Two-Way Remote SMS Control Cheat-Sheet */}
      {showSmsCheatSheet && (
        <div className="rounded-2xl border border-purple-500/30 bg-purple-950/20 p-3.5 space-y-2.5 animate-fadeIn">
          <div className="flex items-center justify-between border-b border-purple-500/20 pb-2">
            <h4 className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-purple-400" />
              Two-Way Remote SMS Commands (Direct Phone-to-Device Control)
            </h4>
            <button
              type="button"
              onClick={() => setShowSmsCheatSheet(false)}
              className="text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 text-xs font-mono">
            <div className="p-2 rounded-xl border border-slate-800 bg-slate-950/90">
              <span className="text-cyan-400 font-bold">ARM AWAY</span>
              <p className="text-[11px] text-slate-400 font-sans mt-0.5">Arms PIR & perimeter zones with instant sirens</p>
            </div>
            <div className="p-2 rounded-xl border border-slate-800 bg-slate-950/90">
              <span className="text-amber-400 font-bold">ARM STAY</span>
              <p className="text-[11px] text-slate-400 font-sans mt-0.5">Arms perimeter doors while permitting interior walking</p>
            </div>
            <div className="p-2 rounded-xl border border-slate-800 bg-slate-950/90">
              <span className="text-emerald-400 font-bold">DISARM</span>
              <p className="text-[11px] text-slate-400 font-sans mt-0.5">Disarms system and silences sounding sirens</p>
            </div>
          </div>
        </div>
      )}

      {/* ================= 4. MAIN STATUS & ZONES GRID ================= */}
      <div className="grid gap-3 lg:grid-cols-3 items-start">
        {/* Radar & Motion Visualizer (Left 1 col) */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5 flex flex-col items-center justify-center text-center relative overflow-hidden">
          <div className="relative flex h-36 w-36 items-center justify-center">
            <span className="pointer-events-none absolute h-32 w-32 rounded-full border border-cyan-500/30 gkb-radar-ring" />
            <span className="pointer-events-none absolute h-20 w-20 rounded-full border border-cyan-500/40" />
            <span className="pointer-events-none absolute h-12 w-12 rounded-full border border-cyan-500/50" />

            <div className={`flex h-16 w-16 items-center justify-center rounded-full transition-all ${
              motionDetected
                ? 'bg-red-600 text-white shadow-xl shadow-red-600/70 scale-110'
                : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
            }`}>
              <Eye className={`h-8 w-8 ${motionDetected ? 'animate-bounce' : ''}`} />
            </div>
          </div>

          <p className="text-xs sm:text-sm font-bold text-white mt-1">
            {motionDetected ? '🚨 Motion Sensed in Home' : '🍃 All Areas Quiet'}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            PIR Infrared Motion Surveillance Active
          </p>

          <div className="mt-3.5 flex gap-2 w-full">
            <button
              type="button"
              onClick={handlePanicButton}
              className="flex-1 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:brightness-110 transition-all cursor-pointer shadow-md shadow-red-600/30 flex items-center justify-center gap-1.5"
            >
              <AlertOctagon className="h-4 w-4" /> Panic Alarm
            </button>
            <button
              type="button"
              onClick={handleTestMotionTrip}
              className="rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2.5 text-xs font-semibold text-slate-300 hover:text-cyan-300 hover:border-cyan-500/40 transition-all cursor-pointer"
              title="Simulate a motion trigger"
            >
              Test Sensor
            </button>
          </div>
        </div>

        {/* Multi-Zone Security Layout (Right 2 cols) */}
        <div className="lg:col-span-2 space-y-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3.5 sm:p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Radio className="h-3.5 w-3.5 text-cyan-400" /> Monitored Security Zones
              </h3>
              <span className="text-[10px] text-slate-400 font-mono">4 Zones Online</span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {zones.map(z => (
                <div
                  key={z.id}
                  className={`rounded-xl border p-2.5 sm:p-3 transition-all ${
                    z.status === 'triggered'
                      ? 'border-red-500/60 bg-red-950/40 shadow-md shadow-red-900/30'
                      : 'border-slate-800/80 bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${z.status === 'triggered' ? 'bg-red-500 animate-ping' : 'bg-emerald-400'}`} />
                      {z.name}
                    </span>
                    <span className={z.status === 'triggered' ? 'text-red-300 text-[10px] font-bold' : 'text-emerald-400 text-[10px] font-semibold'}>
                      {z.status === 'triggered' ? '🔴 Tripped' : '🟢 Secure'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">{z.location}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Real-time Intrusion Logs */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3.5 sm:p-4 space-y-2">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-purple-400" /> Recent Security Activity
            </h3>
            <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
              {alerts.slice(0, 5).map(a => (
                <div
                  key={a.id}
                  className={`rounded-lg border p-2 text-xs flex items-start justify-between gap-3 ${
                    a.severity === 'critical' ? 'border-red-500/40 bg-red-950/30 text-red-200' :
                    a.severity === 'warning' ? 'border-amber-500/30 bg-amber-950/20 text-amber-200' :
                    'border-slate-800 bg-slate-900/50 text-slate-300'
                  }`}
                >
                  <div>
                    <span className="font-bold text-[11px]">{a.title}</span>
                    <p className="text-[10px] text-slate-400 mt-0.5">{a.detail}</p>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono shrink-0">{a.timestamp}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ================= 5. CLIENT EMERGENCY CONTACT EDITOR MODAL ================= */}
      {showContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="relative w-full max-w-lg rounded-2xl border border-amber-500/30 bg-slate-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Phone className="h-5 w-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Edit Emergency Contact</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={async (e) => {
              await handleSaveContacts(e);
              setShowContactModal(false);
            }} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Contact Name / Relationship
                </label>
                <input
                  type="text"
                  value={contacts[0]?.name || ''}
                  onChange={e => handleUpdateContact(contacts[0]?.id || 'contact-1', { name: e.target.value })}
                  placeholder="e.g. Home Owner, Spouse, Guard"
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Emergency Phone Number *
                </label>
                <input
                  type="tel"
                  required
                  value={contacts[0]?.phone || ''}
                  onChange={e => handleUpdateContact(contacts[0]?.id || 'contact-1', { phone: e.target.value })}
                  placeholder="e.g. +233 55 211 7787"
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white focus:border-amber-400 focus:outline-none"
                />
                <p className="text-[10px] text-slate-400 mt-1">This number is auto-dialed via GSM cellular on intrusion.</p>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-800 text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={callOnAlarm}
                    onChange={e => setCallOnAlarm(e.target.checked)}
                    className="rounded border-slate-700 text-amber-500 focus:ring-0"
                  />
                  <span className="text-slate-300">Auto-Dial Phone Call on Intrusion</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={smsOnAlarm}
                    onChange={e => setSmsOnAlarm(e.target.checked)}
                    className="rounded border-slate-700 text-amber-500 focus:ring-0"
                  />
                  <span className="text-slate-300">Send Instant SMS Alert on Intrusion</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowContactModal(false)}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingContacts}
                  className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-2 text-xs font-bold text-black hover:opacity-90 cursor-pointer"
                >
                  {savingContacts ? 'Saving...' : 'Save Contact'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= 6. ADMIN / ENGINEERING TOOLS MODAL ================= */}
      {showEngineeringModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fadeIn">
          <div className="relative w-full max-w-2xl rounded-3xl border border-purple-500/40 bg-slate-950 p-6 text-white shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-purple-400" />
                <h3 className="text-base font-bold text-white">Engineering & Diagnostics Center</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowEngineeringModal(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setShowEngineeringModal(false);
                  setShowFirmwareModal(true);
                }}
                className="p-3 rounded-xl border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 text-left transition-all cursor-pointer"
              >
                <Code className="h-4 w-4 text-purple-400 mb-1" />
                <span className="block text-xs font-bold text-white">ESP32 Firmware</span>
                <span className="block text-[10px] text-slate-400">Download .ino Arduino code</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowEngineeringModal(false);
                  setShowSqlModal(true);
                }}
                className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-left transition-all cursor-pointer"
              >
                <Database className="h-4 w-4 text-emerald-400 mb-1" />
                <span className="block text-xs font-bold text-white">SQL Schema</span>
                <span className="block text-[10px] text-slate-400">Supabase setup script</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowEngineeringModal(false);
                  setShowLabelModal(true);
                }}
                className="p-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-left transition-all cursor-pointer"
              >
                <Printer className="h-4 w-4 text-cyan-400 mb-1" />
                <span className="block text-xs font-bold text-white">Casing QR Sticker</span>
                <span className="block text-[10px] text-slate-400">Print module QR code</span>
              </button>
            </div>

            {/* Hardware Pinout Specs */}
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2 text-xs font-mono text-slate-300">
              <span className="block font-bold text-cyan-300 text-[11px]">Hardware Pin Allocation:</span>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <span>PIR Sensor: <strong className="text-white">GPIO 15</strong></span>
                <span>Siren Relay: <strong className="text-white">GPIO 23</strong></span>
                <span>Buzzer: <strong className="text-white">GPIO 19</strong></span>
                <span>GSM SIM800L RX: <strong className="text-amber-400">GPIO 16</strong></span>
                <span>GSM SIM800L TX: <strong className="text-amber-400">GPIO 17</strong></span>
                <span>Status LED: <strong className="text-white">GPIO 2</strong></span>
              </div>
              <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-800 font-sans">
                Power requirement: 3.7V - 4.2V (2A peak capability) with 1000uF low-ESR capacitor across VCC/GND.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* BLE Provisioning Modal */}
      <BleProvisioningModal
        isOpen={provisionModalOpen}
        onClose={() => setProvisionModalOpen(false)}
        deviceKey={deviceKey}
        deviceName={device?.name || 'Smart Home Security System v1'}
        initialPhone={primaryPhone}
      />

      {/* Firmware Code Modal */}
      {showFirmwareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-purple-500/30 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 p-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Code className="h-5 w-5 text-purple-400" /> ESP32 Smart Security Firmware (.ino) · GSM SIM800L Enabled
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generateSecurityArduinoCode(deviceKey));
                    setCopiedFirmware(true);
                    setTimeout(() => setCopiedFirmware(false), 2000);
                  }}
                  className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-500 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedFirmware ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copiedFirmware ? 'Copied!' : 'Copy Code'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowFirmwareModal(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs font-mono text-purple-200 bg-slate-900/60 leading-relaxed">
              {generateSecurityArduinoCode(deviceKey)}
            </pre>
          </div>
        </div>
      )}

      {/* SQL Setup Modal */}
      {showSqlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-emerald-500/30 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 p-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Database className="h-5 w-5 text-emerald-400" /> Supabase Security SQL Setup (with GSM Subsystem)
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(SQL_SECURITY_SETUP_SCRIPT);
                    setCopiedSql(true);
                    setTimeout(() => setCopiedSql(false), 2000);
                  }}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedSql ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copiedSql ? 'Copied!' : 'Copy SQL'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSqlModal(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs font-mono text-emerald-200 bg-slate-900/60 leading-relaxed">
              {SQL_SECURITY_SETUP_SCRIPT}
            </pre>
          </div>
        </div>
      )}

      {/* QR Label Modal */}
      {showLabelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md rounded-2xl border border-cyan-500/30 bg-slate-950 p-6 space-y-4 text-center">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Hardware Casing QR Label</h3>
              <button
                type="button"
                onClick={() => setShowLabelModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-col items-center justify-center p-4 bg-white rounded-xl shadow-lg">
              <div dangerouslySetInnerHTML={{ __html: createQrSvg(deviceKey, 200) }} />
              <p className="text-xs font-mono font-bold text-slate-900 mt-2">{deviceKey}</p>
              <p className="text-[10px] text-slate-500">GKB Technologies · Smart Security v1</p>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="w-full rounded-xl bg-cyan-600 py-2.5 text-xs font-bold text-white hover:bg-cyan-500 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Printer className="h-4 w-4" /> Print Label
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
