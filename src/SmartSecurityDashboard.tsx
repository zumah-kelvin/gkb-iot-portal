import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Shield, ShieldAlert, ShieldCheck, Activity, Wifi, Server, Bluetooth,
  QrCode, Printer, Code, Zap, Check, Copy, AlertTriangle, Cpu, Radio,
  Key, Power, RefreshCw, Sliders, Settings, Volume2, VolumeX, Database,
  ArrowUpRight, Info, Play, Square, Bell, BellOff, Eye, Lock, Unlock,
  SlidersHorizontal, Sparkles, CheckCircle2, Siren, X, AlertOctagon,
  Phone, PhoneCall, PhoneForwarded, MessageSquare, Signal, Smartphone,
  Send, CheckCheck
} from 'lucide-react';
import { relaySupabase } from './supabase';
import BleProvisioningModal from './BleProvisioningModal';
import { createQrSvg } from './qrCodeHelper';

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
bool   smsOnAlarm         = true;
bool   callOnAlarm        = true;
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

  String alertMsg = "🚨 GKB SECURITY ALERT!\\n"
                    "Motion detected in " + zoneName + "!\\n"
                    "Status: ARMED (" + armedMode + ")\\n"
                    "Siren: ACTIVE\\n"
                    "Device: " + deviceKey + "\\n"
                    "Direct emergency dispatch from GKB IoT Hardware.";

  // 1. Dispatch SMS to Primary Contact
  if (smsOnAlarm && primaryPhone.length() >= 9) {
    sendGsmSms(primaryPhone, alertMsg);
  }

  // 2. Dispatch SMS to Secondary Contact (if provided)
  if (smsOnAlarm && secondaryPhone.length() >= 9) {
    delay(600);
    sendGsmSms(secondaryPhone, alertMsg);
  }

  // 3. Place Instant Emergency Phone Call to Primary Contact
  if (callOnAlarm && primaryPhone.length() >= 9) {
    delay(800);
    makeEmergencyCall(primaryPhone);
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
  device
}: {
  mode?: 'test' | 'service';
  device?: Device;
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
  const [smsOnAlarm, setSmsOnAlarm] = useState<boolean>(true);
  const [callOnAlarm, setCallOnAlarm] = useState<boolean>(true);
  const [smsOnArmDisarm, setSmsOnArmDisarm] = useState<boolean>(false);

  // GSM Interaction State
  const [savingContacts, setSavingContacts] = useState(false);
  const [contactsNotice, setContactsNotice] = useState('');
  const [testSmsBusy, setTestSmsBusy] = useState(false);
  const [testCallBusy, setTestCallBusy] = useState(false);
  const [showSmsCheatSheet, setShowSmsCheatSheet] = useState(false);

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
    if (row.primary_phone) setPrimaryPhone(row.primary_phone);
    if (row.secondary_phone !== undefined && row.secondary_phone !== null) setSecondaryPhone(row.secondary_phone);
    if (row.sms_on_alarm !== undefined) setSmsOnAlarm(Boolean(row.sms_on_alarm));
    if (row.call_on_alarm !== undefined) setCallOnAlarm(Boolean(row.call_on_alarm));
    if (row.sms_on_arm_disarm !== undefined) setSmsOnArmDisarm(Boolean(row.sms_on_arm_disarm));

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

  // Save GSM Emergency Contacts & Settings
  const handleSaveContacts = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSavingContacts(true);
    setContactsNotice('');
    try {
      await patchCloud({
        primary_phone: primaryPhone.trim(),
        secondary_phone: secondaryPhone.trim(),
        sms_on_alarm: smsOnAlarm,
        call_on_alarm: callOnAlarm,
        sms_on_arm_disarm: smsOnArmDisarm,
        gsm_enabled: gsmEnabled
      });
      setContactsNotice('✅ Emergency contacts and GSM dispatch rules updated successfully.');
      setTimeout(() => setContactsNotice(''), 4000);
    } catch {
      setContactsNotice('❌ Failed to save contacts. Check connection.');
    } finally {
      setSavingContacts(false);
    }
  };

  // Trigger Live Test SMS
  const handleTestSms = async () => {
    if (!primaryPhone) return;
    setTestSmsBusy(true);
    setAlerts(prev => [{
      id: `${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      title: '🧪 Cellular Test SMS Requested',
      detail: `Dispatching test SMS to primary contact (${primaryPhone}) via ESP32 SIM800L.`,
      severity: 'info'
    }, ...prev.slice(0, 9)]);

    await patchCloud({ gsm_test_requested: 'TEST_SMS' });
    setTimeout(() => {
      setTestSmsBusy(false);
    }, 2500);
  };

  // Trigger Live Test Call
  const handleTestCall = async () => {
    if (!primaryPhone) return;
    setTestCallBusy(true);
    setAlerts(prev => [{
      id: `${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      title: '📞 Emergency Auto-Dial Call Test',
      detail: `ESP32 placing 25-second test ring to ${primaryPhone} via SIM800L UART.`,
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
      className={`space-y-6 rounded-3xl border p-4 sm:p-6 transition-all duration-300 relative overflow-hidden ${
        isAlarmActive
          ? 'gkb-security-red-blink text-white'
          : 'border-cyan-500/30 bg-slate-900/90 text-slate-100 shadow-2xl shadow-cyan-950/40 backdrop-blur-md'
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
            {/* Pulsing indicator bar */}
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

                {/* Popup Action Buttons */}
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

      {/* Top Header Badge & Navigation */}
      <header className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-slate-950/70 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 shadow-inner">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-400/40 bg-cyan-400/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">
              {mode === 'test' ? 'Hardware test preview' : 'Fleet target'}
            </span>
            <span className="rounded-full border border-purple-400/40 bg-purple-400/15 px-3 py-1 text-[10px] font-bold font-mono uppercase tracking-[0.14em] text-purple-300">
              Key: {deviceKey}
            </span>
            <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${
              armedMode === 'away' ? 'border-red-500/50 bg-red-500/25 text-red-200' :
              armedMode === 'stay' ? 'border-amber-500/50 bg-amber-500/25 text-amber-200' :
              'border-slate-600 bg-slate-800 text-slate-400'
            }`}>
              Armed: {armedMode.toUpperCase()}
            </span>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
              <Signal className="h-3 w-3" />
              GSM: {gsmSimStatus === 'READY' ? `${gsmNetworkOperator} (${gsmSignalCsq}/31)` : gsmSimStatus}
            </span>
          </div>
          <h2 id="security-system-title" className="text-xl font-bold text-white sm:text-2xl flex items-center gap-2">
            <Shield className="h-6 w-6 text-cyan-400" /> Smart Home Security System v1
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-slate-300">
            HC-SR501 PIR Motion · Siren Strobe (GPIO 23) · Buzzer (GPIO 19) · GSM SIM800L (UART2: GPIO 16/17)
          </p>
        </div>

        {/* Quick Actions & Indicators */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Desktop Push / Popup Notifications Toggle */}
          <button
            type="button"
            onClick={requestNotificationPermission}
            title={notificationPermission === 'granted' ? 'Desktop alerts active' : 'Click to enable desktop popups'}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-all cursor-pointer ${
              notificationPermission === 'granted'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 animate-pulse'
            }`}
          >
            {notificationPermission === 'granted' ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            <span>{notificationPermission === 'granted' ? 'Popups Enabled' : 'Enable Popups'}</span>
          </button>

          <button
            type="button"
            onClick={toggleSoundMute}
            className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition-all cursor-pointer ${
              soundMuted
                ? 'border-slate-700 bg-slate-800 text-slate-400 hover:text-white'
                : isAlarmActive
                  ? 'border-amber-400 bg-amber-500/30 text-amber-200 shadow-[0_0_15px_rgba(251,191,36,0.5)] animate-pulse'
                  : 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25'
            }`}
          >
            {soundMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4 text-cyan-300" />}
            <span>Buzzer: {soundMuted ? 'Muted' : isAlarmActive ? 'Buzzing' : 'Ready'}</span>
          </button>

          <button
            type="button"
            onClick={() => setProvisionModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 transition-all cursor-pointer shadow-sm"
          >
            <Bluetooth className="h-4 w-4" /> Pair BLE & QR
          </button>

          <button
            type="button"
            onClick={() => setShowFirmwareModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/10 px-3.5 py-2 text-xs font-bold text-purple-300 hover:bg-purple-500/20 transition-all cursor-pointer shadow-sm"
          >
            <Code className="h-4 w-4" /> View Firmware (.ino)
          </button>

          <button
            type="button"
            onClick={() => setShowSqlModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition-all cursor-pointer shadow-sm"
          >
            <Database className="h-4 w-4" /> SQL Setup
          </button>

          <button
            type="button"
            onClick={() => setShowLabelModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-300 hover:text-white transition-all cursor-pointer"
          >
            <Printer className="h-4 w-4" /> Print QR Label
          </button>
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
          className="w-full rounded-xl border border-amber-500 bg-amber-500/20 p-3 text-xs font-bold text-amber-200 text-center animate-bounce cursor-pointer"
        >
          🔊 Click anywhere to enable browser audio alarm sound
        </button>
      )}

      {/* CRITICAL INTRUSION BANNER (Shown when alarm is TRIPPED) */}
      {isAlarmActive && (
        <div className="rounded-2xl border-2 border-red-500 bg-red-950/80 p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-2xl shadow-red-900/60 animate-pulse">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-red-600 text-white shadow-xl shadow-red-600/70 gkb-siren-strobe">
              <Siren className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-lg font-black text-white uppercase tracking-wider">
                🚨 Intrusion Alert! Alarm Tripped!
              </h3>
              <p className="text-xs text-red-200">
                PIR Motion Sensor (GPIO 15) triggered while system armed in <strong>{armedMode.toUpperCase()}</strong> mode. Siren Relay (GPIO 23) active.
              </p>
              {gsmEnabled && primaryPhone && (
                <p className="text-xs text-amber-300 font-mono mt-1 flex items-center gap-1.5">
                  <PhoneCall className="h-3.5 w-3.5 text-amber-400 animate-bounce" />
                  GSM Cellular Dispatch: Calling <strong className="text-white">{primaryPhone}</strong> and sending breach SMS!
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleClearAlarm}
              className="flex-1 sm:flex-initial rounded-xl border border-white bg-white px-5 py-2.5 text-xs font-bold text-red-700 hover:bg-slate-100 transition-all cursor-pointer shadow-lg"
            >
              Clear Alarm
            </button>
            <button
              type="button"
              onClick={() => handleSetArmedMode('disarmed')}
              className="flex-1 sm:flex-initial rounded-xl border border-red-400 bg-red-900/60 px-5 py-2.5 text-xs font-bold text-white hover:bg-red-800 transition-all cursor-pointer"
            >
              Disarm All
            </button>
          </div>
        </div>
      )}

      {/* Arming Mode Control Switcher */}
      <div className="grid gap-4 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => handleSetArmedMode('away')}
          className={`flex flex-col items-start rounded-2xl border p-5 text-left transition-all cursor-pointer ${
            armedMode === 'away'
              ? 'border-red-500 bg-red-500/20 shadow-lg shadow-red-500/20'
              : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between w-full">
            <ShieldAlert className={`h-6 w-6 ${armedMode === 'away' ? 'text-red-400' : 'text-slate-400'}`} />
            {armedMode === 'away' && <span className="h-2.5 w-2.5 rounded-full bg-red-400 animate-ping" />}
          </div>
          <span className="text-base font-bold text-white mt-3">ARMED AWAY</span>
          <span className="text-xs text-slate-400 mt-1">Full protection. All interior PIR & perimeter sensors trigger instant siren & GSM phone call.</span>
        </button>

        <button
          type="button"
          onClick={() => handleSetArmedMode('stay')}
          className={`flex flex-col items-start rounded-2xl border p-5 text-left transition-all cursor-pointer ${
            armedMode === 'stay'
              ? 'border-amber-500 bg-amber-500/20 shadow-lg shadow-amber-500/20'
              : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between w-full">
            <ShieldCheck className={`h-6 w-6 ${armedMode === 'stay' ? 'text-amber-400' : 'text-slate-400'}`} />
            {armedMode === 'stay' && <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-ping" />}
          </div>
          <span className="text-base font-bold text-white mt-3">ARMED STAY</span>
          <span className="text-xs text-slate-400 mt-1">Perimeter doors & windows armed. Interior motion permits normal walking.</span>
        </button>

        <button
          type="button"
          onClick={() => handleSetArmedMode('disarmed')}
          className={`flex flex-col items-start rounded-2xl border p-5 text-left transition-all cursor-pointer ${
            armedMode === 'disarmed'
              ? 'border-emerald-500 bg-emerald-500/20 shadow-lg shadow-emerald-500/20'
              : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between w-full">
            <Unlock className={`h-6 w-6 ${armedMode === 'disarmed' ? 'text-emerald-400' : 'text-slate-400'}`} />
            {armedMode === 'disarmed' && <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />}
          </div>
          <span className="text-base font-bold text-white mt-3">DISARMED</span>
          <span className="text-xs text-slate-400 mt-1">Security relaxed. Motion is logged for awareness without audible alarms or auto-dialing.</span>
        </button>
      </div>

      {/* ================= GSM CELLULAR SUB-SYSTEM & EMERGENCY DISPATCH ================= */}
      <section className="rounded-3xl border border-amber-500/30 bg-gradient-to-r from-slate-950 via-slate-900/90 to-slate-950 p-5 sm:p-6 shadow-[0_0_35px_rgba(245,158,11,0.08)] space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
              <Signal className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-white uppercase tracking-wider">
                  GSM Cellular Subsystem (SIM800L)
                </h3>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  gsmSimStatus === 'READY'
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                    : 'bg-red-500/10 text-red-300 border border-red-500/30'
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${gsmSimStatus === 'READY' ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                  {gsmSimStatus === 'READY' ? 'SIM Ready' : gsmSimStatus}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Hardware UART2 (GPIO 16 RX / GPIO 17 TX) · Direct SMS Dispatch & Emergency Voice Auto-Dialing
              </p>
            </div>
          </div>

          {/* Real-time Cellular Signal Quality Meter */}
          <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-2 self-start sm:self-auto">
            <div className="text-right">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Cellular Signal
              </span>
              <span className="text-xs font-mono font-bold text-amber-300">
                {gsmNetworkOperator} · {gsmSignalCsq}/31 ({signalQualityLabel})
              </span>
              <span className="block text-[10px] text-slate-500 font-mono">
                {rssiDbm} dBm
              </span>
            </div>

            {/* 5-bar vertical signal meter */}
            <div className="flex items-end gap-1 h-7 px-1">
              {[1, 2, 3, 4, 5].map((bar) => {
                const active = gsmSignalCsq >= (bar === 1 ? 4 : bar === 2 ? 10 : bar === 3 ? 16 : bar === 4 ? 22 : 27);
                const barColor =
                  gsmSignalCsq < 10 ? 'bg-red-500' :
                  gsmSignalCsq < 16 ? 'bg-amber-400' :
                  gsmSignalCsq < 22 ? 'bg-cyan-400' : 'bg-emerald-400';
                return (
                  <div
                    key={bar}
                    style={{ height: `${bar * 20}%` }}
                    className={`w-1.5 rounded-sm transition-all ${
                      active ? `${barColor} shadow-[0_0_6px_rgba(245,158,11,0.6)]` : 'bg-slate-800'
                    }`}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Emergency Contacts & Automated Dispatch Rules */}
        <form onSubmit={handleSaveContacts} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Primary Emergency Contact Number (Auto-Dial + SMS) *
              </label>
              <div className="relative">
                <Phone className="absolute left-3.5 top-3 h-4 w-4 text-cyan-400" />
                <input
                  type="tel"
                  value={primaryPhone}
                  onChange={e => setPrimaryPhone(e.target.value)}
                  required
                  placeholder="e.g. 0552117787 or +233552117787"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-10 pr-3.5 py-2.5 text-xs text-white font-mono focus:border-cyan-400 focus:outline-none"
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                ESP32 places an instant emergency voice call so your phone rings loudly, and sends an SMS alert with zone & time.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Secondary Alert Number (Backup SMS)
              </label>
              <div className="relative">
                <Smartphone className="absolute left-3.5 top-3 h-4 w-4 text-purple-400" />
                <input
                  type="tel"
                  value={secondaryPhone}
                  onChange={e => setSecondaryPhone(e.target.value)}
                  placeholder="Optional backup line, spouse, or neighbor"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-10 pr-3.5 py-2.5 text-xs text-white font-mono focus:border-purple-400 focus:outline-none"
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Receives a duplicate SMS alert upon intrusion detection.
              </p>
            </div>
          </div>

          {/* Dispatch Automation Toggles */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Cellular Dispatch Automations
            </span>

            <div className="grid gap-3 sm:grid-cols-3 text-xs">
              <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-800 bg-slate-900/60 cursor-pointer hover:border-slate-700">
                <input
                  type="checkbox"
                  checked={smsOnAlarm}
                  onChange={e => setSmsOnAlarm(e.target.checked)}
                  className="rounded border-slate-700 text-amber-500 focus:ring-0"
                />
                <div>
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5 text-amber-400" /> SMS on Intrusion
                  </span>
                  <p className="text-[10px] text-slate-400 mt-0.5">Sends zone name and alert text</p>
                </div>
              </label>

              <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-800 bg-slate-900/60 cursor-pointer hover:border-slate-700">
                <input
                  type="checkbox"
                  checked={callOnAlarm}
                  onChange={e => setCallOnAlarm(e.target.checked)}
                  className="rounded border-slate-700 text-amber-500 focus:ring-0"
                />
                <div>
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <PhoneCall className="h-3.5 w-3.5 text-emerald-400" /> Auto-Dial Phone Call
                  </span>
                  <p className="text-[10px] text-slate-400 mt-0.5">Rings phone for 25s via ATD</p>
                </div>
              </label>

              <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-800 bg-slate-900/60 cursor-pointer hover:border-slate-700">
                <input
                  type="checkbox"
                  checked={smsOnArmDisarm}
                  onChange={e => setSmsOnArmDisarm(e.target.checked)}
                  className="rounded border-slate-700 text-amber-500 focus:ring-0"
                />
                <div>
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-cyan-400" /> SMS on Arm / Disarm
                  </span>
                  <p className="text-[10px] text-slate-400 mt-0.5">Notifies when status changes</p>
                </div>
              </label>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={savingContacts}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-black shadow-lg shadow-amber-500/20 hover:opacity-90 transition-all cursor-pointer disabled:opacity-50"
              >
                {savingContacts ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                {savingContacts ? 'Saving Contacts...' : 'Save Emergency Contacts'}
              </button>

              <button
                type="button"
                onClick={handleTestSms}
                disabled={testSmsBusy || !primaryPhone}
                className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-2.5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 transition-all cursor-pointer disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {testSmsBusy ? 'Sending Test SMS...' : 'Send Test SMS'}
              </button>

              <button
                type="button"
                onClick={handleTestCall}
                disabled={testCallBusy || !primaryPhone}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition-all cursor-pointer disabled:opacity-50"
              >
                <PhoneCall className="h-3.5 w-3.5" />
                {testCallBusy ? 'Dialing Alert Ring...' : 'Place Test Alert Call'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowSmsCheatSheet(!showSmsCheatSheet)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/10 px-3.5 py-2 text-xs font-bold text-purple-300 hover:bg-purple-500/20 transition-all cursor-pointer"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {showSmsCheatSheet ? 'Hide SMS Remote Commands' : 'Two-Way SMS Remote Commands'}
            </button>
          </div>

          {contactsNotice && (
            <p className="text-xs p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 animate-fadeIn">
              {contactsNotice}
            </p>
          )}
        </form>

        {/* Two-Way Remote SMS Control Cheat-Sheet */}
        {showSmsCheatSheet && (
          <div className="rounded-2xl border border-purple-500/30 bg-purple-950/20 p-5 space-y-3 animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-purple-500/20 pb-3">
              <div>
                <h4 className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-purple-400" />
                  Two-Way Remote SMS Commands (Direct Microcontroller Control)
                </h4>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  When you are away without internet or when local Wi-Fi goes down, send these SMS commands directly to the SIM card in your hardware:
                </p>
              </div>
              <span className="text-[10px] font-mono text-purple-300 bg-purple-500/10 px-2.5 py-1 rounded border border-purple-500/30 self-start sm:self-auto">
                AT+CNMI Auto-Execution Active
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 text-xs font-mono">
              <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/90">
                <div className="flex items-center justify-between">
                  <span className="text-cyan-400 font-bold">ARM AWAY</span>
                  <span className="text-[10px] text-slate-500">or ARM</span>
                </div>
                <p className="text-[11px] text-slate-400 font-sans mt-1">Arms PIR & perimeter zones with instant sirens</p>
              </div>

              <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/90">
                <div className="flex items-center justify-between">
                  <span className="text-amber-400 font-bold">ARM STAY</span>
                  <span className="text-[10px] text-slate-500">Perimeter</span>
                </div>
                <p className="text-[11px] text-slate-400 font-sans mt-1">Arms exterior doors while permitting interior walking</p>
              </div>

              <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/90">
                <div className="flex items-center justify-between">
                  <span className="text-emerald-400 font-bold">DISARM</span>
                  <span className="text-[10px] text-slate-500">Safety</span>
                </div>
                <p className="text-[11px] text-slate-400 font-sans mt-1">Disarms system and silences sounding sirens</p>
              </div>

              <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/90">
                <div className="flex items-center justify-between">
                  <span className="text-purple-400 font-bold">STATUS</span>
                  <span className="text-[10px] text-slate-500">Diagnostics</span>
                </div>
                <p className="text-[11px] text-slate-400 font-sans mt-1">Returns armed status, motion state & cellular CSQ via SMS</p>
              </div>

              <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/90">
                <div className="flex items-center justify-between">
                  <span className="text-red-400 font-bold">PANIC</span>
                  <span className="text-[10px] text-slate-500">or SIREN ON</span>
                </div>
                <p className="text-[11px] text-slate-400 font-sans mt-1">Manually triggers physical 5V siren relay & buzzer</p>
              </div>

              <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/90">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 font-bold">SILENCE</span>
                  <span className="text-[10px] text-slate-500">or SIREN OFF</span>
                </div>
                <p className="text-[11px] text-slate-400 font-sans mt-1">Immediately cuts off siren relay without full disarm</p>
              </div>
            </div>
          </div>
        )}

        {/* GSM Hardware Connection & Power Diagram */}
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-4 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <span>GSM Module: <strong className="text-white">SIM800L / SIM900</strong></span>
            <span>ESP32 RX2: <strong className="text-amber-400">GPIO 16</strong> (&larr; SIM800L TXD)</span>
            <span>ESP32 TX2: <strong className="text-amber-400">GPIO 17</strong> (&rarr; SIM800L RXD)</span>
            <span>Power: <strong className="text-white">3.7V–4.2V (2A Peak)</strong> + 1000&mu;F Low-ESR Cap</span>
          </div>
          <div className="flex items-center gap-2 text-slate-500 font-mono text-[10px]">
            <span>Call Status: <strong className="text-cyan-400">{gsmCallState}</strong></span>
            <span>·</span>
            <span>SMS Status: <strong className="text-emerald-400">{gsmLastSmsStatus}</strong></span>
          </div>
        </div>
      </section>

      {/* Main Status & Zones Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Radar & Motion Visualizer (Left 1 col) */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 flex flex-col items-center justify-center text-center relative overflow-hidden">
          <div className="relative flex h-48 w-48 items-center justify-center">
            {/* Animated Radar Rings */}
            <span className="pointer-events-none absolute h-40 w-40 rounded-full border border-cyan-500/30 gkb-radar-ring" />
            <span className="pointer-events-none absolute h-28 w-28 rounded-full border border-cyan-500/40" />
            <span className="pointer-events-none absolute h-16 w-16 rounded-full border border-cyan-500/50" />

            <div className={`flex h-24 w-24 items-center justify-center rounded-full transition-all ${
              motionDetected
                ? 'bg-red-600 text-white shadow-xl shadow-red-600/70 scale-110'
                : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
            }`}>
              <Eye className={`h-12 w-12 ${motionDetected ? 'animate-bounce' : ''}`} />
            </div>
          </div>

          <p className="text-sm font-bold text-white mt-2">
            {motionDetected ? '🚨 Motion Detected (GPIO 15)' : '🍃 No Motion Detected'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            HC-SR501 Infrared Sensor active · Sensitivity: {pirSensitivity.toUpperCase()}
          </p>

          <div className="mt-5 flex gap-2 w-full">
            <button
              type="button"
              onClick={handleTestMotionTrip}
              className="flex-1 rounded-xl border border-cyan-500/40 bg-cyan-500/10 py-2.5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 transition-all cursor-pointer"
            >
              Test Motion Pulse
            </button>
            <button
              type="button"
              onClick={handlePanicButton}
              className="flex-1 rounded-xl border border-red-500/50 bg-red-600/20 py-2.5 text-xs font-bold text-red-300 hover:bg-red-600/40 transition-all cursor-pointer flex items-center justify-center gap-1.5"
            >
              <AlertOctagon className="h-4 w-4" /> Panic Button
            </button>
          </div>
        </div>

        {/* Multi-Zone Security Layout (Right 2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Radio className="h-4 w-4 text-cyan-400" /> Monitored Security Zones
              </h3>
              <span className="text-xs text-slate-400">4 Monitored Channels</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {zones.map(z => (
                <div
                  key={z.id}
                  className={`rounded-xl border p-4 transition-all ${
                    z.status === 'triggered'
                      ? 'border-red-500/60 bg-red-950/40 shadow-md shadow-red-900/30'
                      : 'border-slate-800/80 bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${z.status === 'triggered' ? 'bg-red-500 animate-ping' : 'bg-emerald-400'}`} />
                      {z.name}
                    </span>
                    <span className="text-[10px] font-mono text-cyan-300 bg-slate-950 px-2 py-0.5 rounded border border-cyan-500/20">
                      {z.pin}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">{z.location}</p>
                  <div className="mt-3 flex items-center justify-between text-[11px]">
                    <span className={z.status === 'triggered' ? 'text-red-300 font-bold' : 'text-emerald-400'}>
                      {z.status === 'triggered' ? '🔴 Tripped' : '🟢 Secure'}
                    </span>
                    <span className="text-slate-500 text-[10px]">Last: {z.lastTripped}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Real-time Intrusion Logs */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5 space-y-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Activity className="h-4 w-4 text-purple-400" /> Security Audit Log & Cellular Dispatch
            </h3>
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {alerts.map(a => (
                <div
                  key={a.id}
                  className={`rounded-xl border p-2.5 text-xs flex items-start justify-between gap-3 ${
                    a.severity === 'critical' ? 'border-red-500/40 bg-red-950/30 text-red-200' :
                    a.severity === 'warning' ? 'border-amber-500/30 bg-amber-950/20 text-amber-200' :
                    'border-slate-800 bg-slate-900/50 text-slate-300'
                  }`}
                >
                  <div>
                    <span className="font-bold">{a.title}</span>
                    <p className="text-[11px] text-slate-400 mt-0.5">{a.detail}</p>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono shrink-0">{a.timestamp}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Hardware Pin Allocation Summary */}
      <footer className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <span>PIR Sensor: <strong className="text-white">GPIO 15</strong></span>
          <span>Siren Relay: <strong className="text-white">GPIO 23</strong> (Active HIGH)</span>
          <span>Buzzer: <strong className="text-white">GPIO 19</strong></span>
          <span>GSM RX2: <strong className="text-amber-400">GPIO 16</strong></span>
          <span>GSM TX2: <strong className="text-amber-400">GPIO 17</strong></span>
          <span>Status LED: <strong className="text-white">GPIO 2</strong></span>
        </div>
        <div className="flex items-center gap-2 text-slate-500 font-mono text-[11px]">
          <span>Supabase Table: <strong className="text-cyan-400">home_security_status</strong></span>
          <span>·</span>
          <span>Target: <strong className="text-cyan-400">security_01</strong></span>
        </div>
      </footer>

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
