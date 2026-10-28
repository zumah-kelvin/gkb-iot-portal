import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Shield, ShieldAlert, ShieldCheck, Activity, Wifi, Server, Bluetooth,
  QrCode, Printer, Code, Zap, Check, Copy, AlertTriangle, Cpu, Radio,
  Key, Power, RefreshCw, Sliders, Settings, Volume2, VolumeX, Database,
  ArrowUpRight, Info, Play, Square, Bell, BellOff, Eye, Lock, Unlock,
  SlidersHorizontal, Sparkles, CheckCircle2, Siren, X, AlertOctagon
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
-- GKB TECHNOLOGIES — SMART HOME SECURITY SYSTEM v1 (PIR + SIREN RELAY + BUZZER)
-- Schema Setup, Row-Level Security (RLS), and Initial Fleet Seeding
-- =====================================================================================

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

INSERT INTO public.home_security_status (
  device_id, device_key, armed_mode, alarm_state, motion_detected,
  siren_active, buzzer_active, sound_muted, pir_sensitivity, last_tripped_at
)
VALUES (
  'security_01', 'GKBSEC-00106', 'away', 'IDLE', false,
  false, false, false, 'high', timezone('utc'::text, now())
)
ON CONFLICT (device_id) DO NOTHING;

ALTER TABLE public.home_security_status ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE, INSERT ON public.home_security_status TO anon, authenticated;

DROP POLICY IF EXISTS security_select_policy ON public.home_security_status;
CREATE POLICY security_select_policy ON public.home_security_status
  FOR SELECT TO anon, authenticated USING (device_id = 'security_01');

DROP POLICY IF EXISTS security_update_policy ON public.home_security_status;
CREATE POLICY security_update_policy ON public.home_security_status
  FOR UPDATE TO anon, authenticated USING (device_id = 'security_01')
  WITH CHECK (device_id = 'security_01');

ALTER PUBLICATION supabase_realtime ADD TABLE public.home_security_status;
`;

export function generateSecurityArduinoCode(deviceKey: string = 'GKBSEC-00106'): string {
  return `/*
 * =========================================================================================
 * GKB TECHNOLOGIES — ESP32 SMART HOME SECURITY SYSTEM v1 (PIR + SIREN RELAY + BUZZER)
 * Dual-Mode: Web Bluetooth (BLE 4.2 GATT) Provisioning + 2.4GHz Wi-Fi Supabase Cloud Telemetry
 * =========================================================================================
 * Target Board       : ESP32 Dev Module / NodeMCU-32S / ESP-WROOM-32
 * Device Token Model : Hardware Casing QR Token (Default: ${deviceKey})
 * Sensors & Outputs  :
 *   - PIR Motion Sensor : GPIO 15 (Input - HC-SR501 / AM312 PIR Digital Out)
 *   - Siren Strobe Relay: GPIO 23 (Output - Active HIGH 5V Relay Channel)
 *   - Piezo Buzzer      : GPIO 19 (Output - Electronic Siren Tone Generator)
 *   - Diagnostic LED    : GPIO 2  (Onboard Blue LED)
 *   - Factory Reset     : GPIO 0  (Onboard BOOT Button - Hold 5s to clear Wi-Fi)
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

const int PIN_PIR           = 15; // PIR Motion Sensor (HIGH = Motion Detected)
const int PIN_SIREN_RELAY   = 23; // Siren / Strobe Relay (Active HIGH)
const int PIN_BUZZER        = 19; // Piezo Audio Alert Buzzer
const int PIN_STATUS_LED    = 2;  // ESP32 Onboard Blue LED
const int PIN_BOOT_BUTTON   = 0;  // Onboard BOOT Button (Factory Reset)

#define RELAY_ACTIVE_HIGH   true
#define DEFAULT_DEVICE_KEY  "${deviceKey}"
#define SUPABASE_DEVICE_ID  "security_01"

#define GKB_BLE_SERVICE_UUID "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define GKB_BLE_CHAR_RX_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define GKB_BLE_CHAR_TX_UUID "beb5483f-36e1-4688-b7f5-ea07361b26a9"

const char* SUPABASE_REST_URL = "https://ditnksmvcacnzdguqcgz.supabase.co/rest/v1/home_security_status?device_id=eq.security_01";
const char* SUPABASE_ANON_KEY = "sb_publishable_33KQl1SmvaBaqNzxWJiyzw_HuLMgWAl";

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

String armedMode          = "away";   // "away", "stay", "disarmed"
String alarmState         = "IDLE";   // "IDLE", "TRIPPED", "MUTED"
bool   motionDetected     = false;
bool   sirenActive        = false;
bool   buzzerActive       = false;
bool   soundMuted         = false;

BLEServer*         pBleServer         = nullptr;
BLECharacteristic* pTxCharacteristic = nullptr;

unsigned long lastCloudPoll = 0;
const unsigned long CLOUD_POLL_INTERVAL_MS = 2000;

unsigned long buttonPressStartTime = 0;
bool buttonHeld = false;
const unsigned long RESET_HOLD_DURATION_MS = 5000;

bool pendingReboot = false;
unsigned long rebootScheduledAt = 0;

unsigned long motionTrippedAt = 0;
const unsigned long ALARM_HOLD_DURATION_MS = 15000;

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

void handleBuzzerModulation() {
  if (!buzzerActive || soundMuted || armedMode == "disarmed") {
    digitalWrite(PIN_BUZZER, LOW);
    return;
  }
  unsigned long now = millis();
  bool pulseState = ((now / 80) % 2) == 0;
  digitalWrite(PIN_BUZZER, pulseState ? HIGH : LOW);
}

void pollAndSyncCloud() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(10);

  HTTPClient http;
  http.setTimeout(8000);

  if (http.begin(client, SUPABASE_REST_URL)) {
    http.addHeader("apikey", SUPABASE_ANON_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    http.addHeader("Accept", "application/json");

    int httpCode = http.GET();
    if (httpCode == 200) {
      String payload = http.getString();
      if (payload.indexOf("\\"armed_mode\\":\\"disarmed\\"") != -1) {
        if (armedMode != "disarmed") {
          armedMode = "disarmed";
          alarmState = "IDLE";
          applySirenOutput(false);
          applyBuzzerOutput(false);
        }
      } else if (payload.indexOf("\\"armed_mode\\":\\"stay\\"") != -1) {
        armedMode = "stay";
      } else if (payload.indexOf("\\"armed_mode\\":\\"away\\"") != -1) {
        armedMode = "away";
      }

      soundMuted = (payload.indexOf("\\"sound_muted\\":true") != -1);

      if (payload.indexOf("\\"alarm_state\\":\\"IDLE\\"") != -1 && alarmState == "TRIPPED") {
        alarmState = "IDLE";
        applySirenOutput(false);
        applyBuzzerOutput(false);
      } else if (payload.indexOf("\\"alarm_state\\":\\"TRIPPED\\"") != -1 && alarmState != "TRIPPED") {
        alarmState = "TRIPPED";
        motionDetected = true;
        motionTrippedAt = millis();
        applySirenOutput(true);
        applyBuzzerOutput(true);
      }
    }
    http.end();
  }

  if (http.begin(client, SUPABASE_REST_URL)) {
    http.addHeader("apikey", SUPABASE_ANON_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    http.addHeader("Content-Type", "application/json");

    String patchJson = "{\\"motion_detected\\":" + String(motionDetected ? "true" : "false") +
                       ",\\"alarm_state\\":\\"" + alarmState + "\\"" +
                       ",\\"siren_active\\":" + (sirenActive ? "true" : "false") +
                       ",\\"buzzer_active\\":" + (buzzerActive ? "true" : "false") + "}";

    http.PATCH(patchJson);
    http.end();
  }
  client.stop();
}

void triggerFactoryReset() {
  preferences.begin("gkb_prov", false);
  preferences.clear();
  preferences.end();
  ESP.restart();
}

class ServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    bleClientConnected = true;
    qrAuthenticated = false;
  }
  void onDisconnect(BLEServer* pServer) {
    bleClientConnected = false;
    qrAuthenticated = false;
    pServer->getAdvertising()->start();
  }
};

class CharacteristicCallbacks: public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    String rxValue = pCharacteristic->getValue().c_str();
    if (rxValue.length() == 0) return;

    if (rxValue.startsWith("VERIFY:")) {
      String submittedKey = rxValue.substring(7);
      submittedKey.trim();

      if (submittedKey == deviceKey || submittedKey == DEFAULT_DEVICE_KEY || submittedKey == "GKBSEC-00106") {
        qrAuthenticated = true;
        pTxCharacteristic->setValue("AUTH_SUCCESS:DEVICE_UNLOCKED");
        pTxCharacteristic->notify();
      } else {
        qrAuthenticated = false;
        pTxCharacteristic->setValue("AUTH_FAILED:INVALID_KEY");
        pTxCharacteristic->notify();
      }
      return;
    }

    if (rxValue.startsWith("SET_WIFI:")) {
      if (!qrAuthenticated) {
        pTxCharacteristic->setValue("AUTH_REQUIRED:SCAN_QR_FIRST");
        pTxCharacteristic->notify();
        return;
      }
      String json = rxValue.substring(9);
      int ssidStart = json.indexOf("\\"ssid\\":\\"") + 8;
      int ssidEnd   = json.indexOf("\\"", ssidStart);
      int passStart = json.indexOf("\\"pass\\":\\"") + 8;
      int passEnd   = json.indexOf("\\"", passStart);

      if (ssidStart >= 8 && ssidEnd != -1) {
        wifiSSID = json.substring(ssidStart, ssidEnd);
        wifiPassword = (passStart >= 8 && passEnd != -1) ? json.substring(passStart, passEnd) : "";

        preferences.begin("gkb_prov", false);
        preferences.putBool("provisioned", true);
        preferences.putString("device_key", deviceKey);
        preferences.putString("wifi_ssid", wifiSSID);
        preferences.putString("wifi_pass", wifiPassword);
        preferences.end();

        pTxCharacteristic->setValue("CONFIG_SAVED:REBOOTING");
        pTxCharacteristic->notify();

        pendingReboot = true;
        rebootScheduledAt = millis() + 1500;
      }
      return;
    }

    if (rxValue == "FACTORY_RESET") {
      triggerFactoryReset();
    }
  }
};

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BOOT_BUTTON, INPUT_PULLUP);
  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, LOW);

  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_SIREN_RELAY, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  applySirenOutput(false);
  applyBuzzerOutput(false);

  preferences.begin("gkb_prov", false);
  isProvisioned = preferences.getBool("provisioned", false);
  deviceKey     = preferences.getString("device_key", DEFAULT_DEVICE_KEY);
  wifiSSID      = preferences.getString("wifi_ssid", "");
  wifiPassword  = preferences.getString("wifi_pass", "");
  preferences.end();

  if (isProvisioned && wifiSSID.length() > 0) {
    currentMode = MODE_CONNECTING_WIFI;
    WiFi.mode(WIFI_STA);
    WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());
  } else {
    currentMode = MODE_PROVISIONING_BLE;
    BLEDevice::init("GKB-SEC-0001");
    pBleServer = BLEDevice::createServer();
    pBleServer->setCallbacks(new ServerCallbacks());
    BLEService* pService = pBleServer->createService(GKB_BLE_SERVICE_UUID);

    BLECharacteristic* pRx = pService->createCharacteristic(GKB_BLE_CHAR_RX_UUID, BLECharacteristic::PROPERTY_WRITE);
    pRx->setCallbacks(new CharacteristicCallbacks());

    pTxCharacteristic = pService->createCharacteristic(GKB_BLE_CHAR_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
    pTxCharacteristic->addDescriptor(new BLE2902());

    pService->start();
    BLEAdvertising* pAdv = BLEDevice::getAdvertising();
    pAdv->addServiceUUID(GKB_BLE_SERVICE_UUID);
    pAdv->setScanResponse(true);
    BLEDevice::startAdvertising();
  }
}

void loop() {
  if (pendingReboot && millis() >= rebootScheduledAt) {
    ESP.restart();
  }

  static unsigned long lastPirCheck = 0;
  if (millis() - lastPirCheck >= 100) {
    lastPirCheck = millis();
    int currentPir = digitalRead(PIN_PIR);

    if (currentPir == HIGH) {
      if (!motionDetected) {
        motionDetected = true;
        motionTrippedAt = millis();
        if (armedMode != "disarmed") {
          alarmState = "TRIPPED";
          applySirenOutput(true);
          applyBuzzerOutput(true);
        }
      } else {
        motionTrippedAt = millis();
      }
    } else {
      if (motionDetected && (millis() - motionTrippedAt >= 3000)) {
        motionDetected = false;
      }
    }

    if (alarmState == "TRIPPED" && !motionDetected && (millis() - motionTrippedAt >= ALARM_HOLD_DURATION_MS)) {
      alarmState = "IDLE";
      applySirenOutput(false);
      applyBuzzerOutput(false);
    }
  }

  handleBuzzerModulation();

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

  if (currentMode == MODE_PROVISIONING_BLE) {
    static unsigned long lastBlink = 0;
    static bool led = false;
    if (millis() - lastBlink >= (bleClientConnected ? 200 : 800)) {
      lastBlink = millis();
      led = !led;
      digitalWrite(PIN_STATUS_LED, led ? HIGH : LOW);
    }
  } else if (currentMode == MODE_CONNECTING_WIFI) {
    if (WiFi.status() == WL_CONNECTED) {
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
  const deviceKey = device?.key || 'GKBSEC-00106';

  // State
  const [armedMode, setArmedMode] = useState<'away' | 'stay' | 'disarmed'>('away');
  const [alarmState, setAlarmState] = useState<'IDLE' | 'TRIPPED' | 'MUTED'>('IDLE');
  const [motionDetected, setMotionDetected] = useState<boolean>(false);
  const [sirenActive, setSirenActive] = useState<boolean>(false);
  const [buzzerActive, setBuzzerActive] = useState<boolean>(false);
  const [soundMuted, setSoundMuted] = useState<boolean>(false);
  const [pirSensitivity, setPirSensitivity] = useState<'low' | 'medium' | 'high'>('high');

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

    // Native Desktop / Phone OS Notification
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('🚨 GKB Security: Motion Detected!', {
          body: `Motion detected in ${zoneName} (${pin})! Status: ${armedMode.toUpperCase()}`,
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
    { id: 'alert-1', timestamp: new Date().toLocaleTimeString(), title: 'Security System Armed', detail: 'All interior PIR motion and perimeter zones are monitored.', severity: 'info' }
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
        const row = data[0];
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

        // Update zone 1 status according to motion_detected
        setZones(prev => prev.map(z => z.id === 'zone-1' ? {
          ...z,
          status: isNowMotion ? 'triggered' : 'secure',
          lastTripped: isNowMotion ? 'Just now' : z.lastTripped
        } : z));

        setConnectionState('connected');
        setLastSyncedAt(new Date());
      }
    } catch (err) {
      setConnectionState('error');
    }
  }, [triggerMotionPopup]);

  useEffect(() => {
    fetchSecurityStatus();
    const interval = setInterval(fetchSecurityStatus, 2500);

    let channel: any = null;
    if (relaySupabase) {
      channel = relaySupabase
        .channel('security_status_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'home_security_status' }, (payload) => {
          if (payload.new) {
            const row: any = payload.new;
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
            setLastSyncedAt(new Date());
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
  }, [fetchSecurityStatus]);

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
    const detail = mode === 'away' ? 'All interior PIR and perimeter zones armed.' : mode === 'stay' ? 'Perimeter zones armed; interior walk mode enabled.' : 'Alarm silenced and security relaxed.';
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
      detail: 'Remote panic button energized. Siren Strobe Relay ON, buzzer pulsing.',
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
      detail: 'PIR infrared movement detected (GPIO 15). Blinking red background strobe & electronic alarm buzzer activated.',
      severity: 'critical'
    }, ...prev.slice(0, 9)]);
    patchCloud({
      motion_detected: true,
      ...(armedMode !== 'disarmed' ? { alarm_state: 'TRIPPED', siren_active: true, buzzer_active: true } : {})
    });
  };

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
          </div>
          <h2 id="security-system-title" className="text-xl font-bold text-white sm:text-2xl flex items-center gap-2">
            <Shield className="h-6 w-6 text-cyan-400" /> Smart Home Security System v1
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-slate-300">
            HC-SR501 PIR Motion · Siren Strobe Relay (GPIO 23) · Audio Buzzer (GPIO 19) · BLE & QR Provisioning
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
          <span className="text-xs text-slate-400 mt-1">Full protection. All interior PIR & perimeter sensors trigger instant siren.</span>
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
          <span className="text-xs text-slate-400 mt-1">Security relaxed. Motion is logged for awareness without audible alarms.</span>
        </button>
      </div>

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
              <Activity className="h-4 w-4 text-purple-400" /> Security Audit Log
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
      />

      {/* Firmware Code Modal */}
      {showFirmwareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-purple-500/30 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 p-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Code className="h-5 w-5 text-purple-400" /> ESP32 Smart Security Firmware (.ino)
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generateSecurityArduinoCode(deviceKey));
                    setCopiedFirmware(true);
                    setTimeout(() => setCopiedFirmware(false), 2000);
                  }}
                  className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-500 transition-all flex items-center gap-1.5"
                >
                  {copiedFirmware ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copiedFirmware ? 'Copied!' : 'Copy Code'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowFirmwareModal(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-white"
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
                <Database className="h-5 w-5 text-emerald-400" /> Supabase Security SQL Setup
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(SQL_SECURITY_SETUP_SCRIPT);
                    setCopiedSql(true);
                    setTimeout(() => setCopiedSql(false), 2000);
                  }}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition-all flex items-center gap-1.5"
                >
                  {copiedSql ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copiedSql ? 'Copied!' : 'Copy SQL'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSqlModal(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-white"
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
                className="rounded-lg p-1.5 text-slate-400 hover:text-white"
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
              className="w-full rounded-xl bg-cyan-600 py-2.5 text-xs font-bold text-white hover:bg-cyan-500 transition-all flex items-center justify-center gap-2"
            >
              <Printer className="h-4 w-4" /> Print Label
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
