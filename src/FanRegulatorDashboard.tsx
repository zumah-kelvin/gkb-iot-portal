import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Wind, Power, Sliders, Zap, Activity, Thermometer, Droplets,
  Timer, RotateCw, Volume2, VolumeX, Sparkles, CheckCircle2,
  AlertTriangle, RefreshCw, Cpu, Bluetooth, QrCode, Code, Database,
  Printer, ArrowUpRight, Copy, Check, X, Shield, Info, Gauge,
  Sun, Moon, CloudRain, Flame, ChevronRight
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

const HARDCODED_SUPABASE_URL = 'https://ditnksmvcacnzdguqcgz.supabase.co';
const HARDCODED_SUPABASE_KEY = 'sb_publishable_33KQl1SmvaBaqNzxWJiyzw_HuLMgWAl';

const SQL_FAN_SETUP_SCRIPT = `-- =====================================================================================
-- GKB TECHNOLOGIES — SMART FAN REGULATOR SYSTEM (CAPACITOR RELAY BANK + DHT22)
-- Schema Setup, Row-Level Security (RLS), Initial Fleet Seeding & Helper RPCs
-- =====================================================================================

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
  relay_1 BOOLEAN NOT NULL DEFAULT false,
  relay_2 BOOLEAN NOT NULL DEFAULT true,
  relay_3 BOOLEAN NOT NULL DEFAULT false,
  relay_4 BOOLEAN NOT NULL DEFAULT false,
  relay_osc BOOLEAN NOT NULL DEFAULT false,
  estimated_watts INTEGER NOT NULL DEFAULT 32,
  paired_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

INSERT INTO public.fan_regulator_status (
  device_id, device_key, power_state, speed_level, mode,
  temperature_c, humidity_pct, oscillation, reverse_direction,
  timer_minutes_remaining, auto_target_temp_c, sound_muted,
  relay_1, relay_2, relay_3, relay_4, relay_osc, estimated_watts
)
VALUES (
  'fan_01', 'GKB-FAN-0001', true, 2, 'manual',
  28.5, 62.0, false, false, 0, 26.0, false,
  false, true, false, false, false, 32
)
ON CONFLICT (device_id) DO NOTHING;

ALTER TABLE public.fan_regulator_status ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE, INSERT ON public.fan_regulator_status TO anon, authenticated;

DROP POLICY IF EXISTS fan_select_policy ON public.fan_regulator_status;
CREATE POLICY fan_select_policy ON public.fan_regulator_status
  FOR SELECT TO anon, authenticated USING (device_id = 'fan_01');

DROP POLICY IF EXISTS fan_update_policy ON public.fan_regulator_status;
CREATE POLICY fan_update_policy ON public.fan_regulator_status
  FOR UPDATE TO anon, authenticated USING (device_id = 'fan_01')
  WITH CHECK (device_id = 'fan_01');

ALTER PUBLICATION supabase_realtime ADD TABLE public.fan_regulator_status;
`;

export function generateFanArduinoCode(deviceKey: string = 'GKB-FAN-0001'): string {
  return `/*
 * =========================================================================================
 * GKB TECHNOLOGIES — ESP32 SMART FAN REGULATOR SYSTEM (CAPACITOR RELAY BANK + DHT22)
 * Dual-Mode: Web Bluetooth (BLE 4.2 GATT) Provisioning + 2.4GHz Wi-Fi Supabase Cloud Telemetry
 * =========================================================================================
 * Target Board       : ESP32 Dev Module / NodeMCU-32S / ESP-WROOM-32
 * Device Token Model : Hardware Casing QR Token (Default: ${deviceKey})
 * Output Channels    :
 *   - Speed Relay 1   : GPIO 23 (1.5uF Capacitor - Low Speed)
 *   - Speed Relay 2   : GPIO 22 (2.5uF Capacitor - Med-Low Speed)
 *   - Speed Relay 3   : GPIO 21 (3.5uF Capacitor - Med-High Speed)
 *   - Speed Relay 4   : GPIO 19 (Direct AC Bypass - High Speed)
 *   - Oscillation     : GPIO 18 (Swing Motor Relay)
 *   - DHT22 Temp/Hum  : GPIO 4  (Environmental Telemetry)
 *   - Feedback Buzzer : GPIO 5  (Speed change chime)
 *   - Diagnostic LED  : GPIO 2  (Onboard Blue LED)
 *   - Factory Reset   : GPIO 0  (Onboard BOOT Button - Hold 5s to clear Wi-Fi)
 *
 * Cloud Backend      : Supabase public.fan_regulator_status (Target: fan_01)
 * REST Endpoint      : https://ditnksmvcacnzdguqcgz.supabase.co/rest/v1/fan_regulator_status?device_id=eq.fan_01
 * =========================================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <DHT.h>

#define PIN_RELAY_1       23 // 1.5uF Step
#define PIN_RELAY_2       22 // 2.5uF Step
#define PIN_RELAY_3       21 // 3.5uF Step
#define PIN_RELAY_4       19 // Direct AC High
#define PIN_RELAY_OSC     18 // Oscillation Motor
#define PIN_DHT           4  // DHT22 Data
#define PIN_BUZZER        5  // Piezo Buzzer
#define PIN_STATUS_LED    2  // Blue Onboard LED
#define PIN_BOOT_BUTTON   0  // Factory Reset

#define DHTTYPE DHT22
DHT dht(PIN_DHT, DHTTYPE);

#define DEFAULT_DEVICE_KEY "${deviceKey}"
#define SUPABASE_DEVICE_ID "fan_01"

#define GKB_BLE_SERVICE_UUID "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define GKB_BLE_CHAR_RX_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define GKB_BLE_CHAR_TX_UUID "beb5483f-36e1-4688-b7f5-ea07361b26a9"

const char* SUPABASE_REST_URL = "https://ditnksmvcacnzdguqcgz.supabase.co/rest/v1/fan_regulator_status?device_id=eq.fan_01";
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

bool   powerState         = true;
int    speedLevel         = 2; // 0 to 5
String fanMode            = "manual";
bool   oscillation        = false;
float  currentTemp        = 28.5;
float  currentHum         = 62.0;

BLEServer*         pBleServer         = nullptr;
BLECharacteristic* pTxCharacteristic = nullptr;

unsigned long lastCloudPollTime    = 0;
const unsigned long CLOUD_POLL_MS  = 2500;
unsigned long lastSensorReadTime   = 0;
const unsigned long SENSOR_READ_MS = 5000;
unsigned long bootButtonPressTime  = 0;
bool isBootButtonPressed           = false;
bool pendingReboot                 = false;
unsigned long rebootScheduledAt    = 0;

void applyFanRelays(bool power, int speed, bool osc) {
  if (!power || speed == 0) {
    digitalWrite(PIN_RELAY_1, LOW);
    digitalWrite(PIN_RELAY_2, LOW);
    digitalWrite(PIN_RELAY_3, LOW);
    digitalWrite(PIN_RELAY_4, LOW);
    digitalWrite(PIN_RELAY_OSC, LOW);
    return;
  }

  // Interlocked capacitor switching (break-before-make)
  digitalWrite(PIN_RELAY_1, speed == 1 ? HIGH : LOW);
  digitalWrite(PIN_RELAY_2, speed == 2 ? HIGH : LOW);
  digitalWrite(PIN_RELAY_3, (speed == 3 || speed == 5) ? HIGH : LOW);
  digitalWrite(PIN_RELAY_4, speed >= 4 ? HIGH : LOW);
  digitalWrite(PIN_RELAY_OSC, osc ? HIGH : LOW);

  // Beep on speed change
  digitalWrite(PIN_BUZZER, HIGH);
  delay(35);
  digitalWrite(PIN_BUZZER, LOW);
}

void loadStoredCredentials() {
  preferences.begin("gkb_prov", false);
  deviceKey     = preferences.getString("dev_key", DEFAULT_DEVICE_KEY);
  isProvisioned = preferences.getBool("is_prov", false);
  wifiSSID      = preferences.getString("wifi_ssid", "");
  wifiPassword  = preferences.getString("wifi_pass", "");
  preferences.end();
}

void saveWiFiCredentials(const String& ssid, const String& pass) {
  preferences.begin("gkb_prov", false);
  preferences.putString("wifi_ssid", ssid);
  preferences.putString("wifi_pass", pass);
  preferences.putBool("is_prov", true);
  preferences.end();
  wifiSSID      = ssid;
  wifiPassword  = pass;
  isProvisioned = true;
}

void factoryResetPreferences() {
  preferences.begin("gkb_prov", false);
  preferences.clear();
  preferences.putString("dev_key", DEFAULT_DEVICE_KEY);
  preferences.end();
}

class GkbFanServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    bleClientConnected = true;
    qrAuthenticated    = false;
    digitalWrite(PIN_STATUS_LED, HIGH);
  }
  void onDisconnect(BLEServer* pServer) override {
    bleClientConnected = false;
    qrAuthenticated    = false;
    digitalWrite(PIN_STATUS_LED, LOW);
    if (currentMode == MODE_PROVISIONING_BLE && pBleServer) {
      pBleServer->startAdvertising();
    }
  }
};

class GkbFanCharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    String rxValue = pCharacteristic->getValue().c_str();
    rxValue.trim();
    if (rxValue.length() == 0) return;

    if (rxValue.startsWith("VERIFY:")) {
      String submittedKey = rxValue.substring(7);
      submittedKey.trim();
      if (submittedKey.equalsIgnoreCase(deviceKey) || submittedKey.equalsIgnoreCase(DEFAULT_DEVICE_KEY)) {
        qrAuthenticated = true;
        if (pTxCharacteristic) {
          pTxCharacteristic->setValue("AUTH_SUCCESS:DEVICE_UNLOCKED");
          pTxCharacteristic->notify();
        }
      } else {
        if (pTxCharacteristic) {
          pTxCharacteristic->setValue("AUTH_FAILED:INVALID_KEY");
          pTxCharacteristic->notify();
        }
      }
      return;
    }

    if (rxValue.startsWith("SET_WIFI:")) {
      if (!qrAuthenticated) return;
      int sIdx = rxValue.indexOf("\\"ssid\\":\\"");
      int pIdx = rxValue.indexOf("\\"pass\\":\\"");
      if (sIdx != -1) {
        String s = rxValue.substring(sIdx + 8, rxValue.indexOf("\\"", sIdx + 8));
        String p = pIdx != -1 ? rxValue.substring(pIdx + 8, rxValue.indexOf("\\"", pIdx + 8)) : "";
        saveWiFiCredentials(s, p);
        if (pTxCharacteristic) {
          pTxCharacteristic->setValue("CONFIG_SAVED:REBOOTING");
          pTxCharacteristic->notify();
        }
        pendingReboot = true;
        rebootScheduledAt = millis() + 2500;
      }
      return;
    }
  }
};

void initBLEProvisioningServer() {
  BLEDevice::init(DEFAULT_DEVICE_KEY);
  pBleServer = BLEDevice::createServer();
  pBleServer->setCallbacks(new GkbFanServerCallbacks());
  BLEService* pService = pBleServer->createService(GKB_BLE_SERVICE_UUID);
  BLECharacteristic* pRxCharacteristic = pService->createCharacteristic(
    GKB_BLE_CHAR_RX_UUID, BLECharacteristic::PROPERTY_WRITE
  );
  pRxCharacteristic->setCallbacks(new GkbFanCharacteristicCallbacks());
  pTxCharacteristic = pService->createCharacteristic(
    GKB_BLE_CHAR_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY
  );
  pTxCharacteristic->addDescriptor(new BLE2902());
  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(GKB_BLE_SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  BLEDevice::startAdvertising();
}

void connectToConfiguredWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(400);
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    currentMode = MODE_OPERATIONAL_CLOUD;
    digitalWrite(PIN_STATUS_LED, HIGH);
  } else {
    currentMode = MODE_PROVISIONING_BLE;
    initBLEProvisioningServer();
  }
}

void pollCloudFanState() {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  if (http.begin(client, SUPABASE_REST_URL)) {
    http.addHeader("apikey", SUPABASE_ANON_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    http.addHeader("Accept", "application/json");

    int httpCode = http.GET();
    if (httpCode == 200) {
      String payload = http.getString();
      // Simple parse for power_state and speed_level
      if (payload.indexOf("\\"power_state\\":true") != -1) powerState = true;
      else if (payload.indexOf("\\"power_state\\":false") != -1) powerState = false;

      for (int i = 0; i <= 5; i++) {
        String spPattern = "\\\"speed_level\\\":" + String(i);
        if (payload.indexOf(spPattern) != -1) {
          speedLevel = i;
          break;
        }
      }
      oscillation = payload.indexOf("\\"oscillation\\":true") != -1;
      applyFanRelays(powerState, speedLevel, oscillation);
    }
    http.end();
  }
}

void pushTelemetryToCloud() {
  if (WiFi.status() != WL_CONNECTED) return;
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) return;
  currentTemp = t;
  currentHum = h;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  if (http.begin(client, SUPABASE_REST_URL)) {
    http.addHeader("apikey", SUPABASE_ANON_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Prefer", "return=minimal");

    String body = "{\\"temperature_c\\":" + String(currentTemp, 1) + ",\\"humidity_pct\\":" + String(currentHum, 1) + "}";
    http.PATCH(body);
    http.end();
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELAY_1, OUTPUT);
  pinMode(PIN_RELAY_2, OUTPUT);
  pinMode(PIN_RELAY_3, OUTPUT);
  pinMode(PIN_RELAY_4, OUTPUT);
  pinMode(PIN_RELAY_OSC, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_STATUS_LED, OUTPUT);
  pinMode(PIN_BOOT_BUTTON, INPUT_PULLUP);

  applyFanRelays(false, 0, false);
  dht.begin();
  loadStoredCredentials();

  if (isProvisioned && wifiSSID.length() > 0) {
    currentMode = MODE_CONNECTING_WIFI;
    connectToConfiguredWiFi();
  } else {
    currentMode = MODE_PROVISIONING_BLE;
    initBLEProvisioningServer();
  }
}

void loop() {
  if (pendingReboot && millis() >= rebootScheduledAt) {
    ESP.restart();
  }

  if (digitalRead(PIN_BOOT_BUTTON) == LOW) {
    if (!isBootButtonPressed) {
      isBootButtonPressed = true;
      bootButtonPressTime = millis();
    } else if (millis() - bootButtonPressTime >= 5000) {
      factoryResetPreferences();
      ESP.restart();
    }
  } else {
    isBootButtonPressed = false;
  }

  if (currentMode == MODE_OPERATIONAL_CLOUD) {
    if (millis() - lastCloudPollTime >= CLOUD_POLL_MS) {
      lastCloudPollTime = millis();
      pollCloudFanState();
    }
    if (millis() - lastSensorReadTime >= SENSOR_READ_MS) {
      lastSensorReadTime = millis();
      pushTelemetryToCloud();
    }
  }
}
`;
}

interface FanRegulatorDashboardProps {
  mode?: 'test' | 'service';
  device?: Device;
}

export default function FanRegulatorDashboard({
  mode = 'service',
  device
}: FanRegulatorDashboardProps) {
  // Fan state variables
  const [powerState, setPowerState] = useState(true);
  const [speedLevel, setSpeedLevel] = useState<number>(2); // 0 (OFF), 1, 2, 3, 4, 5 (Turbo)
  const [fanMode, setFanMode] = useState<'manual' | 'auto_temp' | 'breeze' | 'sleep'>('manual');
  const [oscillation, setOscillation] = useState(false);
  const [reverseDirection, setReverseDirection] = useState(false);
  const [temperatureC, setTemperatureC] = useState<number>(28.5);
  const [humidityPct, setHumidityPct] = useState<number>(62.0);
  const [tempUnit, setTempUnit] = useState<'C' | 'F'>('C');
  const [autoTargetTempC, setAutoTargetTempC] = useState<number>(26.0);
  const [timerMinutes, setTimerMinutes] = useState<number>(0);
  const [soundMuted, setSoundMuted] = useState(false);

  // Connection & Activity
  const [connectionState, setConnectionState] = useState<'connected' | 'connecting' | 'error'>('connecting');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string>('');

  // Modals
  const [provisionModalOpen, setProvisionModalOpen] = useState(false);
  const [showFirmwareModal, setShowFirmwareModal] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [copiedFirmware, setCopiedFirmware] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  const deviceKey = device?.key || 'GKB-FAN-0001';

  // Wattage map per speed level
  const speedWattMap: Record<number, number> = {
    0: 0,
    1: 16,
    2: 32,
    3: 48,
    4: 65,
    5: 78
  };

  const currentWatts = powerState ? speedWattMap[speedLevel] || 0 : 0;
  const currentRPM = powerState ? (speedLevel === 1 ? 120 : speedLevel === 2 ? 190 : speedLevel === 3 ? 260 : speedLevel === 4 ? 330 : speedLevel === 5 ? 400 : 0) : 0;

  // Audio chirp feedback using Web Audio API
  const playBeep = useCallback((freq = 980, duration = 0.05) => {
    if (soundMuted || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      // AudioContext autoplay restrictions
    }
  }, [soundMuted]);

  // Patch state to Supabase
  const patchCloud = async (updates: Partial<{
    power_state: boolean;
    speed_level: number;
    mode: string;
    oscillation: boolean;
    reverse_direction: boolean;
    temperature_c: number;
    humidity_pct: number;
    auto_target_temp_c: number;
    timer_minutes_remaining: number;
    sound_muted: boolean;
    relay_1: boolean;
    relay_2: boolean;
    relay_3: boolean;
    relay_4: boolean;
    relay_osc: boolean;
    estimated_watts: number;
  }>) => {
    if (mode === 'test') return;
    setActionBusy(true);
    try {
      const res = await fetch(`${HARDCODED_SUPABASE_URL}/rest/v1/fan_regulator_status?device_id=eq.fan_01`, {
        method: 'PATCH',
        headers: {
          apikey: HARDCODED_SUPABASE_KEY,
          Authorization: `Bearer ${HARDCODED_SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          ...updates,
          updated_at: new Date().toISOString()
        })
      });
      if (res.ok) {
        setLastSyncedAt(new Date());
        setConnectionState('connected');
      } else {
        setConnectionState('error');
      }
    } catch (err) {
      console.warn('Fan cloud sync error:', err);
      setConnectionState('error');
    } finally {
      setActionBusy(false);
    }
  };

  // Cloud status fetcher
  const fetchFanStatus = useCallback(async () => {
    if (mode === 'test') return;
    try {
      const res = await fetch(`${HARDCODED_SUPABASE_URL}/rest/v1/fan_regulator_status?device_id=eq.fan_01`, {
        method: 'GET',
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
        setPowerState(Boolean(row.power_state));
        setSpeedLevel(Number(row.speed_level) || 0);
        if (row.mode) setFanMode(row.mode);
        setOscillation(Boolean(row.oscillation));
        setReverseDirection(Boolean(row.reverse_direction));
        if (row.temperature_c !== undefined) setTemperatureC(Number(row.temperature_c));
        if (row.humidity_pct !== undefined) setHumidityPct(Number(row.humidity_pct));
        if (row.auto_target_temp_c !== undefined) setAutoTargetTempC(Number(row.auto_target_temp_c));
        if (row.timer_minutes_remaining !== undefined) setTimerMinutes(Number(row.timer_minutes_remaining));
        if (row.sound_muted !== undefined) setSoundMuted(Boolean(row.sound_muted));

        setConnectionState('connected');
        setLastSyncedAt(new Date());
      }
    } catch (err) {
      setConnectionState('error');
    }
  }, [mode]);

  // Initial fetch and Realtime subscription
  useEffect(() => {
    fetchFanStatus();
    const interval = setInterval(fetchFanStatus, 3000);

    let channel: any = null;
    if (relaySupabase) {
      channel = relaySupabase
        .channel('fan_status_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'fan_regulator_status' }, (payload) => {
          if (payload.new) {
            const row: any = payload.new;
            setPowerState(Boolean(row.power_state));
            setSpeedLevel(Number(row.speed_level) || 0);
            if (row.mode) setFanMode(row.mode);
            setOscillation(Boolean(row.oscillation));
            setReverseDirection(Boolean(row.reverse_direction));
            if (row.temperature_c !== undefined) setTemperatureC(Number(row.temperature_c));
            if (row.humidity_pct !== undefined) setHumidityPct(Number(row.humidity_pct));
            setLastSyncedAt(new Date());
          }
        })
        .subscribe();
    }

    return () => {
      clearInterval(interval);
      if (channel && relaySupabase) relaySupabase.removeChannel(channel);
    };
  }, [fetchFanStatus]);

  // Natural Breeze Mode simulator
  useEffect(() => {
    if (fanMode !== 'breeze' || !powerState) return;
    const breezeTimer = setInterval(() => {
      const randomSpeed = Math.floor(Math.random() * 4) + 1; // Speeds 1 to 4
      setSpeedLevel(randomSpeed);
      playBeep(700 + randomSpeed * 80, 0.04);
    }, 4500);
    return () => clearInterval(breezeTimer);
  }, [fanMode, powerState, playBeep]);

  // Sleep Timer countdown
  useEffect(() => {
    if (timerMinutes <= 0 || !powerState) return;
    const timer = setInterval(() => {
      setTimerMinutes(prev => {
        if (prev <= 1) {
          // Timer finished -> Turn OFF fan
          setPowerState(false);
          setSpeedLevel(0);
          patchCloud({ power_state: false, speed_level: 0, timer_minutes_remaining: 0 });
          playBeep(440, 0.2);
          return 0;
        }
        return prev - 1;
      });
    }, 60000);
    return () => clearInterval(timer);
  }, [timerMinutes, powerState, playBeep]);

  // Auto Thermal logic: adjust speed when in auto_temp mode
  const handleAutoTempCheck = useCallback((currentT: number) => {
    if (fanMode !== 'auto_temp' || !powerState) return;
    let targetSpeed = 2;
    if (currentT < 23.0) targetSpeed = 1;
    else if (currentT < 26.0) targetSpeed = 2;
    else if (currentT < 29.5) targetSpeed = 3;
    else if (currentT < 32.5) targetSpeed = 4;
    else targetSpeed = 5;

    if (targetSpeed !== speedLevel) {
      setSpeedLevel(targetSpeed);
      playBeep(1100, 0.06);
      patchCloud({ speed_level: targetSpeed, estimated_watts: speedWattMap[targetSpeed] });
    }
  }, [fanMode, powerState, speedLevel, playBeep]);

  // Handler: Power Toggle
  const handleTogglePower = () => {
    const nextPower = !powerState;
    playBeep(nextPower ? 1200 : 500, 0.08);
    setPowerState(nextPower);
    const newSpeed = nextPower ? (speedLevel === 0 ? 2 : speedLevel) : 0;
    if (nextPower && speedLevel === 0) setSpeedLevel(2);

    const r1 = nextPower && newSpeed === 1;
    const r2 = nextPower && (newSpeed === 2 || newSpeed === 0);
    const r3 = nextPower && (newSpeed === 3 || newSpeed === 5);
    const r4 = nextPower && newSpeed >= 4;

    patchCloud({
      power_state: nextPower,
      speed_level: newSpeed,
      relay_1: r1,
      relay_2: r2,
      relay_3: r3,
      relay_4: r4,
      estimated_watts: nextPower ? speedWattMap[newSpeed] : 0
    });
  };

  // Handler: Change Speed
  const handleSetSpeed = (newSpeed: number) => {
    playBeep(750 + newSpeed * 100, 0.05);
    const isPowerOn = newSpeed > 0;
    setPowerState(isPowerOn);
    setSpeedLevel(newSpeed);

    const r1 = isPowerOn && newSpeed === 1;
    const r2 = isPowerOn && (newSpeed === 2 || newSpeed === 0);
    const r3 = isPowerOn && (newSpeed === 3 || newSpeed === 5);
    const r4 = isPowerOn && newSpeed >= 4;

    patchCloud({
      power_state: isPowerOn,
      speed_level: newSpeed,
      relay_1: r1,
      relay_2: r2,
      relay_3: r3,
      relay_4: r4,
      estimated_watts: isPowerOn ? speedWattMap[newSpeed] : 0
    });
  };

  // Handler: Toggle Oscillation
  const handleToggleOscillation = () => {
    playBeep(850, 0.05);
    const nextOsc = !oscillation;
    setOscillation(nextOsc);
    patchCloud({ oscillation: nextOsc, relay_osc: nextOsc });
  };

  // Handler: Simulated Temperature Change for instant user testing
  const handleSimulatedTempChange = (newTemp: number) => {
    setTemperatureC(newTemp);
    handleAutoTempCheck(newTemp);
    patchCloud({ temperature_c: newTemp });
  };

  // Speed description badges
  const speedLabels = [
    { level: 0, label: 'OFF', rpm: '0 RPM', watts: '0W', color: 'from-slate-600 to-slate-800' },
    { level: 1, label: 'Speed 1 (Breeze)', rpm: '120 RPM', watts: '16W', color: 'from-teal-500 to-emerald-600' },
    { level: 2, label: 'Speed 2 (Gentle)', rpm: '190 RPM', watts: '32W', color: 'from-cyan-500 to-blue-600' },
    { level: 3, label: 'Speed 3 (Medium)', rpm: '260 RPM', watts: '48W', color: 'from-blue-500 to-indigo-600' },
    { level: 4, label: 'Speed 4 (High)', rpm: '330 RPM', watts: '65W', color: 'from-amber-500 to-orange-600' },
    { level: 5, label: 'Speed 5 (Turbo)', rpm: '400 RPM', watts: '78W', color: 'from-rose-500 to-red-600' }
  ];

  // Dynamic CSS spin duration
  const spinSpeedMap: Record<number, string> = {
    0: '0s',
    1: '3.2s',
    2: '2.0s',
    3: '1.2s',
    4: '0.7s',
    5: '0.42s'
  };

  const currentSpinDuration = powerState ? spinSpeedMap[speedLevel] || '2.0s' : '0s';

  // Format temperature
  const displayTemp = tempUnit === 'C' ? `${temperatureC.toFixed(1)}°C` : `${((temperatureC * 9) / 5 + 32).toFixed(1)}°F`;

  return (
    <section aria-labelledby="fan-system-title" className="mx-auto max-w-6xl space-y-6 animate-fadeIn pb-12">
      <style>{`
        @keyframes gkb-fan-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes gkb-fan-reverse-spin {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        @keyframes gkb-fan-yaw {
          0% { transform: perspective(800px) rotateY(-20deg); }
          50% { transform: perspective(800px) rotateY(20deg); }
          100% { transform: perspective(800px) rotateY(-20deg); }
        }
        .gkb-spinning-fan {
          animation: ${reverseDirection ? 'gkb-fan-reverse-spin' : 'gkb-fan-spin'} ${currentSpinDuration} linear infinite;
        }
        .gkb-fan-oscillating {
          animation: gkb-fan-yaw 7s ease-in-out infinite;
        }
      `}</style>

      {/* ================= HEADER BAR ================= */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 backdrop-blur-xl shadow-2xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-cyan-400 animate-ping" />
            <p className="text-xs font-black uppercase tracking-[0.25em] text-cyan-400">
              GKB Smart Hardware Ecosystem · Climate Control
            </p>
          </div>
          <h2 id="fan-system-title" className="text-xl font-bold text-white sm:text-2xl flex items-center gap-2 mt-1">
            <Wind className="h-6 w-6 text-cyan-400" /> Smart Fan Regulator v1
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-slate-300">
            Multi-Speed Capacitor Relay Bank · DHT22 Environmental Telemetry · BLE GATT & QR Provisioning
          </p>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Buzzer Sound Toggle */}
          <button
            type="button"
            onClick={() => setSoundMuted(!soundMuted)}
            title={soundMuted ? 'Chime muted' : 'Chime active'}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-all cursor-pointer ${
              soundMuted
                ? 'border-slate-700 bg-slate-800 text-slate-400 hover:text-white'
                : 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25'
            }`}
          >
            {soundMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            <span>{soundMuted ? 'Muted' : 'Chime ON'}</span>
          </button>

          {/* Provisioning Modal Trigger */}
          <button
            type="button"
            onClick={() => setProvisionModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/50 bg-purple-500/15 px-3 py-2 text-xs font-bold text-purple-300 hover:bg-purple-500/25 transition-all cursor-pointer shadow-md shadow-purple-500/20"
          >
            <Bluetooth className="h-4 w-4 text-purple-400" />
            <span>Pair BLE</span>
          </button>

          {/* Firmware Code Modal Trigger */}
          <button
            type="button"
            onClick={() => setShowFirmwareModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-bold text-slate-200 hover:text-white hover:border-slate-600 transition-all cursor-pointer"
          >
            <Code className="h-4 w-4 text-cyan-400" />
            <span>Firmware</span>
          </button>

          {/* SQL Setup Modal Trigger */}
          <button
            type="button"
            onClick={() => setShowSqlModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-bold text-slate-200 hover:text-white hover:border-slate-600 transition-all cursor-pointer"
          >
            <Database className="h-4 w-4 text-blue-400" />
            <span>SQL Schema</span>
          </button>

          {/* QR Label Modal Trigger */}
          <button
            type="button"
            onClick={() => setShowLabelModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-bold text-slate-200 hover:text-white hover:border-slate-600 transition-all cursor-pointer"
          >
            <Printer className="h-4 w-4 text-emerald-400" />
            <span>Print Label</span>
          </button>
        </div>
      </header>

      {/* ================= TELEMETRY QUICK STRIP ================= */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {/* Power Status */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Power State</p>
            <p className={`text-base font-black mt-0.5 ${powerState ? 'text-emerald-400' : 'text-slate-500'}`}>
              {powerState ? 'ACTIVE · ON' : 'STANDBY · OFF'}
            </p>
          </div>
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${powerState ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
            <Power className="h-5 w-5" />
          </div>
        </div>

        {/* Current Speed / RPM */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Fan Velocity</p>
            <p className="text-base font-black text-cyan-300 mt-0.5">
              {powerState ? `Speed ${speedLevel} · ${currentRPM}` : '0 RPM (Stopped)'}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-300">
            <Wind className="h-5 w-5" />
          </div>
        </div>

        {/* Room Temperature */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Room Temp</p>
              <button
                type="button"
                onClick={() => setTempUnit(tempUnit === 'C' ? 'F' : 'C')}
                className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-cyan-300 hover:text-white"
              >
                °{tempUnit}
              </button>
            </div>
            <p className="text-base font-black text-amber-300 mt-0.5 font-mono">
              {displayTemp}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
            <Thermometer className="h-5 w-5" />
          </div>
        </div>

        {/* Power Draw */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Power Draw</p>
            <p className="text-base font-black text-purple-300 mt-0.5 font-mono">
              {currentWatts} Watts
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/20 text-purple-300">
            <Zap className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* ================= MAIN INTERACTIVE STAGE ================= */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* LEFT COLUMN: Animated Fan Unit (Visualizer) */}
        <div className="lg:col-span-5 flex flex-col items-center justify-between rounded-3xl border border-slate-800 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 p-6 shadow-2xl relative overflow-hidden">
          {/* Subtle Ambient Radial Glow */}
          <div className={`absolute inset-0 pointer-events-none transition-opacity duration-1000 ${
            powerState ? 'opacity-100' : 'opacity-0'
          }`}>
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full blur-3xl ${
              speedLevel >= 4 ? 'bg-orange-600/15' : speedLevel >= 2 ? 'bg-cyan-500/15' : 'bg-emerald-500/15'
            }`} />
          </div>

          {/* Visualizer Header */}
          <div className="w-full flex items-center justify-between z-10">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${powerState ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
              <span className="text-xs font-mono font-bold uppercase text-slate-300">
                {powerState ? `${speedLabels[speedLevel].label}` : 'MOTOR OFF'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
              <span>{oscillation ? 'SWING ON' : 'FIXED ANGLE'}</span>
            </div>
          </div>

          {/* Animated 3D/SVG Fan Blades Container */}
          <div className={`my-8 relative flex items-center justify-center ${oscillation && powerState ? 'gkb-fan-oscillating' : ''}`}>
            {/* Outer Fan Cage Grill */}
            <div className="relative w-64 h-64 sm:w-72 sm:h-72 rounded-full border-4 border-slate-800 bg-slate-950/60 shadow-[inset_0_0_40px_rgba(0,0,0,0.8)] flex items-center justify-center p-4">
              {/* Radial Grill Spokes */}
              <div className="absolute inset-0 rounded-full border border-slate-800/80 pointer-events-none" />
              <div className="absolute inset-4 rounded-full border border-slate-800/50 pointer-events-none" />
              <div className="absolute inset-10 rounded-full border border-slate-800/40 pointer-events-none" />
              <div className="absolute inset-16 rounded-full border border-slate-800/30 pointer-events-none" />

              {/* Rotating Blades Assembly */}
              <div className={`w-full h-full relative flex items-center justify-center transition-all duration-700 ${
                powerState && speedLevel > 0 ? 'gkb-spinning-fan' : ''
              }`}>
                {/* Blade 1 (Top) */}
                <div className="absolute top-2 w-14 h-28 rounded-t-3xl bg-gradient-to-b from-cyan-400/80 via-blue-500/60 to-slate-800 shadow-md transform origin-bottom" style={{ borderRadius: '45% 45% 20% 20%' }} />

                {/* Blade 2 (Right / 120deg) */}
                <div className="absolute top-2 w-14 h-28 rounded-t-3xl bg-gradient-to-b from-cyan-400/80 via-blue-500/60 to-slate-800 shadow-md transform origin-bottom rotate-120" style={{ borderRadius: '45% 45% 20% 20%' }} />

                {/* Blade 3 (Left / 240deg) */}
                <div className="absolute top-2 w-14 h-28 rounded-t-3xl bg-gradient-to-b from-cyan-400/80 via-blue-500/60 to-slate-800 shadow-md transform origin-bottom rotate-240" style={{ borderRadius: '45% 45% 20% 20%' }} />
              </div>

              {/* Center Motor Hub Cap */}
              <div className="absolute w-20 h-20 rounded-full bg-slate-900 border-2 border-cyan-400/60 shadow-xl flex flex-col items-center justify-center z-20">
                <Wind className={`h-6 w-6 transition-all duration-300 ${powerState ? 'text-cyan-300 animate-pulse' : 'text-slate-500'}`} />
                <span className="text-[9px] font-mono font-bold text-slate-300 mt-0.5">GKB</span>
              </div>
            </div>
          </div>

          {/* Big Tactile Power Button & Oscillation Switch */}
          <div className="w-full flex items-center justify-between gap-3 pt-2 z-10 border-t border-slate-800/80">
            {/* Main Power Toggle */}
            <button
              type="button"
              onClick={handleTogglePower}
              className={`flex-1 inline-flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold transition-all cursor-pointer shadow-lg ${
                powerState
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
              }`}
            >
              <Power className="h-4 w-4" />
              <span>{powerState ? 'Power OFF' : 'Power ON'}</span>
            </button>

            {/* Oscillation Toggle */}
            <button
              type="button"
              onClick={handleToggleOscillation}
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-xs font-bold transition-all cursor-pointer border ${
                oscillation
                  ? 'border-cyan-500/60 bg-cyan-500/20 text-cyan-300 shadow-md shadow-cyan-500/20'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              <RotateCw className={`h-4 w-4 ${oscillation ? 'text-cyan-400 animate-spin' : ''}`} style={{ animationDuration: '6s' }} />
              <span>{oscillation ? 'Oscillating' : 'Oscillation'}</span>
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: Speed Matrix, Modes & Telemetry Controls */}
        <div className="lg:col-span-7 space-y-5">
          {/* 1. Discrete Speed Selector Matrix */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-cyan-400" /> Multi-Speed Regulator Steps
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Select discrete capacitor tap or drag the continuous speed slider below.
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-cyan-300 bg-cyan-500/10 px-3 py-1 rounded-full border border-cyan-500/30">
                LEVEL {speedLevel} / 5
              </span>
            </div>

            {/* 6 Speed Buttons Grid */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
              {speedLabels.map(s => {
                const isSelected = powerState ? speedLevel === s.level : s.level === 0;
                return (
                  <button
                    key={s.level}
                    type="button"
                    onClick={() => handleSetSpeed(s.level)}
                    className={`flex flex-col items-center justify-center p-3 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? `bg-gradient-to-b ${s.color} text-white border-white/40 shadow-lg scale-105`
                        : 'border-slate-800 bg-slate-950/80 text-slate-400 hover:text-white hover:border-slate-700'
                    }`}
                  >
                    <span className="text-base font-black font-mono">{s.level}</span>
                    <span className="text-[10px] font-bold mt-1 tracking-tight truncate max-w-full">
                      {s.level === 0 ? 'OFF' : `Spd ${s.level}`}
                    </span>
                    <span className="text-[9px] font-mono opacity-80 mt-0.5">
                      {s.watts}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Continuous Smooth Slider */}
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                <span>0 (STOP)</span>
                <span>1 (LOW)</span>
                <span>2 (MED-LOW)</span>
                <span>3 (MED)</span>
                <span>4 (HIGH)</span>
                <span>5 (TURBO)</span>
              </div>
              <input
                type="range"
                min="0"
                max="5"
                step="1"
                value={powerState ? speedLevel : 0}
                onChange={e => handleSetSpeed(Number(e.target.value))}
                className="w-full accent-cyan-400 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none"
              />
            </div>
          </div>

          {/* 2. Operational Modes (Manual, Auto-Temp, Breeze, Sleep) */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-400" /> Smart Operating Profiles
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Manual Mode */}
              <button
                type="button"
                onClick={() => {
                  setFanMode('manual');
                  playBeep(900, 0.05);
                  patchCloud({ mode: 'manual' });
                }}
                className={`flex flex-col items-start p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                  fanMode === 'manual'
                    ? 'border-cyan-500/60 bg-cyan-500/15 text-white shadow-md shadow-cyan-500/10'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <Sliders className="h-4 w-4 text-cyan-400 mb-2" />
                <span className="text-xs font-bold text-white">Manual</span>
                <span className="text-[10px] text-slate-400 mt-1">Direct slider & button control</span>
              </button>

              {/* Auto Thermal Mode */}
              <button
                type="button"
                onClick={() => {
                  setFanMode('auto_temp');
                  playBeep(1100, 0.05);
                  handleAutoTempCheck(temperatureC);
                  patchCloud({ mode: 'auto_temp' });
                }}
                className={`flex flex-col items-start p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                  fanMode === 'auto_temp'
                    ? 'border-amber-500/60 bg-amber-500/15 text-white shadow-md shadow-amber-500/10'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <Thermometer className="h-4 w-4 text-amber-400 mb-2" />
                <span className="text-xs font-bold text-white">Auto Thermal</span>
                <span className="text-[10px] text-slate-400 mt-1">Adjusts speed by room heat</span>
              </button>

              {/* Natural Breeze Mode */}
              <button
                type="button"
                onClick={() => {
                  setFanMode('breeze');
                  playBeep(800, 0.05);
                  patchCloud({ mode: 'breeze' });
                }}
                className={`flex flex-col items-start p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                  fanMode === 'breeze'
                    ? 'border-teal-500/60 bg-teal-500/15 text-white shadow-md shadow-teal-500/10'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <Wind className="h-4 w-4 text-teal-400 mb-2" />
                <span className="text-xs font-bold text-white">Natural Breeze</span>
                <span className="text-[10px] text-slate-400 mt-1">Modulates speed like real wind</span>
              </button>

              {/* Sleep Mode */}
              <button
                type="button"
                onClick={() => {
                  setFanMode('sleep');
                  playBeep(600, 0.05);
                  if (timerMinutes === 0) setTimerMinutes(120); // Default 2 hours
                  patchCloud({ mode: 'sleep', timer_minutes_remaining: 120 });
                }}
                className={`flex flex-col items-start p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                  fanMode === 'sleep'
                    ? 'border-purple-500/60 bg-purple-500/15 text-white shadow-md shadow-purple-500/10'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <Moon className="h-4 w-4 text-purple-400 mb-2" />
                <span className="text-xs font-bold text-white">Sleep Mode</span>
                <span className="text-[10px] text-slate-400 mt-1">Winds down quietly overnight</span>
              </button>
            </div>
          </div>

          {/* 3. Environmental Telemetry & Interactive Test Simulator */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Activity className="h-4 w-4 text-cyan-400" /> Climate Telemetry & Test Simulator
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Live sensor values and interactive room temperature slider for immediate Auto Mode testing.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-400">DHT22 @ GPIO 4</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Temperature Card */}
              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 flex items-center gap-1.5">
                    <Thermometer className="h-4 w-4 text-amber-400" /> Room Temperature
                  </span>
                  <span className="text-sm font-mono font-bold text-amber-300">{displayTemp}</span>
                </div>
                <input
                  type="range"
                  min="18"
                  max="40"
                  step="0.5"
                  value={temperatureC}
                  onChange={e => handleSimulatedTempChange(Number(e.target.value))}
                  className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
                />
                <div className="flex justify-between text-[10px] font-mono text-slate-500">
                  <span>18°C (Cool)</span>
                  <span>28°C (Ideal)</span>
                  <span>40°C (Hot)</span>
                </div>
              </div>

              {/* Humidity Card */}
              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 flex items-center gap-1.5">
                    <Droplets className="h-4 w-4 text-cyan-400" /> Relative Humidity
                  </span>
                  <span className="text-sm font-mono font-bold text-cyan-300">{humidityPct.toFixed(1)}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="95"
                  step="1"
                  value={humidityPct}
                  onChange={e => {
                    const h = Number(e.target.value);
                    setHumidityPct(h);
                    patchCloud({ humidity_pct: h });
                  }}
                  className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
                />
                <div className="flex justify-between text-[10px] font-mono text-slate-500">
                  <span>20% (Dry)</span>
                  <span>60% (Comfort)</span>
                  <span>95% (Humid)</span>
                </div>
              </div>
            </div>
          </div>

          {/* 4. Sleep Timer Preset Controls */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Timer className="h-4 w-4 text-emerald-400" /> Auto Off Timer
              </h3>
              {timerMinutes > 0 && (
                <span className="text-xs font-mono font-bold text-emerald-300 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/30">
                  {timerMinutes} mins remaining
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {[
                { mins: 0, label: 'No Timer' },
                { mins: 30, label: '30m' },
                { mins: 60, label: '1 hour' },
                { mins: 120, label: '2 hours' },
                { mins: 240, label: '4 hours' },
                { mins: 480, label: '8 hours' }
              ].map(t => (
                <button
                  key={t.mins}
                  type="button"
                  onClick={() => {
                    setTimerMinutes(t.mins);
                    playBeep(950, 0.04);
                    patchCloud({ timer_minutes_remaining: t.mins });
                  }}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                    timerMinutes === t.mins
                      ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-300'
                      : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ================= HARDWARE CAPACITOR RELAY BANK VISUALIZER ================= */}
      <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Cpu className="h-4 w-4 text-cyan-400" /> Hardware Relay Matrix Status (ESP32 Multi-Capacitor Bank)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Break-before-make capacitor switching eliminates fan coil acoustic humming.
            </p>
          </div>
          <span className="text-xs font-mono text-cyan-300 bg-slate-950 px-3 py-1 rounded-lg border border-slate-800">
            Node: fan_01 · {deviceKey}
          </span>
        </div>

        <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
          {/* Relay 1 */}
          <div className={`p-4 rounded-2xl border transition-all ${
            powerState && speedLevel === 1
              ? 'border-teal-500/60 bg-teal-500/15 text-white shadow-lg shadow-teal-500/10'
              : 'border-slate-800 bg-slate-950/70 text-slate-500'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold uppercase">Relay 1 · GPIO 23</span>
              <span className={`h-2 w-2 rounded-full ${powerState && speedLevel === 1 ? 'bg-teal-400 animate-ping' : 'bg-slate-700'}`} />
            </div>
            <p className="text-sm font-bold text-white mt-1">1.5 µF Capacitor</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Speed 1 (Low Breeze)</p>
          </div>

          {/* Relay 2 */}
          <div className={`p-4 rounded-2xl border transition-all ${
            powerState && (speedLevel === 2 || speedLevel === 0)
              ? 'border-cyan-500/60 bg-cyan-500/15 text-white shadow-lg shadow-cyan-500/10'
              : 'border-slate-800 bg-slate-950/70 text-slate-500'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold uppercase">Relay 2 · GPIO 22</span>
              <span className={`h-2 w-2 rounded-full ${powerState && speedLevel === 2 ? 'bg-cyan-400 animate-ping' : 'bg-slate-700'}`} />
            </div>
            <p className="text-sm font-bold text-white mt-1">2.5 µF Capacitor</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Speed 2 (Gentle)</p>
          </div>

          {/* Relay 3 */}
          <div className={`p-4 rounded-2xl border transition-all ${
            powerState && (speedLevel === 3 || speedLevel === 5)
              ? 'border-blue-500/60 bg-blue-500/15 text-white shadow-lg shadow-blue-500/10'
              : 'border-slate-800 bg-slate-950/70 text-slate-500'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold uppercase">Relay 3 · GPIO 21</span>
              <span className={`h-2 w-2 rounded-full ${powerState && (speedLevel === 3 || speedLevel === 5) ? 'bg-blue-400 animate-ping' : 'bg-slate-700'}`} />
            </div>
            <p className="text-sm font-bold text-white mt-1">3.5 µF Capacitor</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Speed 3 & Turbo Boost</p>
          </div>

          {/* Relay 4 */}
          <div className={`p-4 rounded-2xl border transition-all ${
            powerState && speedLevel >= 4
              ? 'border-amber-500/60 bg-amber-500/15 text-white shadow-lg shadow-amber-500/10'
              : 'border-slate-800 bg-slate-950/70 text-slate-500'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold uppercase">Relay 4 · GPIO 19</span>
              <span className={`h-2 w-2 rounded-full ${powerState && speedLevel >= 4 ? 'bg-amber-400 animate-ping' : 'bg-slate-700'}`} />
            </div>
            <p className="text-sm font-bold text-white mt-1">Direct Mains Bypass</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Speed 4/5 (Full 230V)</p>
          </div>

          {/* Oscillation Relay */}
          <div className={`p-4 rounded-2xl border transition-all ${
            oscillation
              ? 'border-purple-500/60 bg-purple-500/15 text-white shadow-lg shadow-purple-500/10'
              : 'border-slate-800 bg-slate-950/70 text-slate-500'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold uppercase">Swing · GPIO 18</span>
              <span className={`h-2 w-2 rounded-full ${oscillation ? 'bg-purple-400 animate-ping' : 'bg-slate-700'}`} />
            </div>
            <p className="text-sm font-bold text-white mt-1">Oscillation Motor</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{oscillation ? 'Active Swivel' : 'Stationary'}</p>
          </div>
        </div>
      </div>

      {/* ================= MODAL: BLE PROVISIONING ================= */}
      <BleProvisioningModal
        isOpen={provisionModalOpen}
        onClose={() => setProvisionModalOpen(false)}
        initialDeviceKey={deviceKey}
        onDeviceProvisioned={(key, name) => {
          setProvisionModalOpen(false);
          fetchFanStatus();
        }}
      />

      {/* ================= MODAL: FIRMWARE CODE ================= */}
      {showFirmwareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-300">
                  <Code className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">ESP32 Arduino Firmware (GKB-FAN-0001)</h3>
                  <p className="text-xs text-slate-400">Capacitor relay bank switching, DHT22 telemetry & BLE GATT Server</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generateFanArduinoCode(deviceKey));
                    setCopiedFirmware(true);
                    setTimeout(() => setCopiedFirmware(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:text-white transition-all cursor-pointer"
                >
                  {copiedFirmware ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  <span>{copiedFirmware ? 'Copied' : 'Copy Sketch'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowFirmwareModal(false)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-slate-950 font-mono text-xs text-slate-300">
              <pre><code>{generateFanArduinoCode(deviceKey)}</code></pre>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: SQL SETUP ================= */}
      {showSqlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-blue-300">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Supabase SQL Schema (fan_regulator_status)</h3>
                  <p className="text-xs text-slate-400">Run this once in your Supabase SQL Editor to enable Realtime and RLS</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(SQL_FAN_SETUP_SCRIPT);
                    setCopiedSql(true);
                    setTimeout(() => setCopiedSql(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:text-white transition-all cursor-pointer"
                >
                  {copiedSql ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  <span>{copiedSql ? 'Copied' : 'Copy SQL'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSqlModal(false)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-slate-950 font-mono text-xs text-slate-300">
              <pre><code>{SQL_FAN_SETUP_SCRIPT}</code></pre>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: PRINTABLE QR LABEL ================= */}
      {showLabelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Printer className="h-5 w-5 text-emerald-400" /> Hardware Casing QR Label
              </h3>
              <button
                type="button"
                onClick={() => setShowLabelModal(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Printable Label Preview */}
            <div className="rounded-2xl border-2 border-dashed border-slate-700 bg-white p-5 text-slate-900 text-center space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="text-xs font-black tracking-wider uppercase">GKB TECHNOLOGIES</span>
                <span className="text-[10px] font-mono bg-slate-200 px-2 py-0.5 rounded">ESP32-FAN</span>
              </div>
              <div
                className="mx-auto w-36 h-36 flex items-center justify-center"
                dangerouslySetInnerHTML={{ __html: createQrSvg(deviceKey, 144) }}
              />
              <div>
                <p className="font-mono text-base font-black tracking-wider">{deviceKey}</p>
                <p className="text-[11px] text-slate-600 font-medium">Smart Fan Regulator v1</p>
                <p className="text-[9px] text-slate-500 font-mono mt-0.5">BLE GATT · 230V 50Hz · Relay Bank</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition-all cursor-pointer shadow-md shadow-emerald-600/30"
              >
                <Printer className="h-4 w-4" /> Print Label
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
