import React, { useState, useEffect, useRef } from 'react';
import {
  Droplets, Activity, Wifi, Server, Bluetooth, QrCode, Printer,
  Code, Zap, Check, Copy, AlertTriangle, Cpu, Radio, Key, Power,
  RefreshCw, Sliders, Settings, Volume2, VolumeX, Database,
  Waves, ArrowUpRight, Info, Play, Square, Gauge, ShieldAlert,
  ChevronDown, ChevronUp
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

type TelemetryActivity = {
  id: string;
  event: string;
  timestamp: string;
  type?: 'info' | 'pump' | 'alert' | 'sync';
};

const HARDCODED_SUPABASE_URL = 'https://ditnksmvcacnzdguqcgz.supabase.co';
const HARDCODED_SUPABASE_KEY = 'sb_publishable_33KQl1SmvaBaqNzxWJiyzw_HuLMgWAl';

const SQL_SETUP_SCRIPT = `-- =====================================================================================
-- GKB TECHNOLOGIES — SMART WATER TANK MONITOR SYSTEM (JSN-SR04T ULTRASONIC + PUMP)
-- Schema Setup, Row-Level Security (RLS), and Seeding Script
-- =====================================================================================

CREATE TABLE IF NOT EXISTS public.water_tank_status (
  device_id TEXT PRIMARY KEY,
  device_key TEXT NOT NULL DEFAULT 'GKB-SWP-0001',
  water_level INTEGER NOT NULL DEFAULT 68,
  distance_cm NUMERIC(6,2) NOT NULL DEFAULT 32.00,
  tank_height_cm NUMERIC(6,2) NOT NULL DEFAULT 100.00,
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

INSERT INTO public.water_tank_status (
  device_id, device_key, water_level, distance_cm, tank_height_cm,
  min_distance_cm, pump_state, pump_mode, low_threshold, full_threshold,
  buzzer_active, tank_capacity_liters
)
VALUES (
  'water_01', 'GKB-SWP-0001', 68, 32.00, 100.00,
  20.00, 'OFF', 'AUTO', 30, 90, false, 5000
)
ON CONFLICT (device_id) DO NOTHING;

ALTER TABLE public.water_tank_status ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE, INSERT ON public.water_tank_status TO anon, authenticated;

DROP POLICY IF EXISTS water_tank_select_policy ON public.water_tank_status;
CREATE POLICY water_tank_select_policy
  ON public.water_tank_status FOR SELECT TO anon, authenticated
  USING (device_id = 'water_01');

DROP POLICY IF EXISTS water_tank_update_policy ON public.water_tank_status;
CREATE POLICY water_tank_update_policy
  ON public.water_tank_status FOR UPDATE TO anon, authenticated
  USING (device_id = 'water_01')
  WITH CHECK (device_id = 'water_01');
`;

function generateWaterTankArduinoCode(deviceKey: string = 'GKB-SWP-0001'): string {
  return `/*
 * =========================================================================================
 * GKB TECHNOLOGIES — ESP32 SMART WATER TANK MONITOR SYSTEM (JSN-SR04T + SUBMERSIBLE PUMP)
 * Dual-Mode: Web Bluetooth (BLE 4.2 GATT) Provisioning + 2.4GHz Wi-Fi Supabase Cloud Telemetry
 * =========================================================================================
 * Target Board       : ESP32 Dev Module / NodeMCU-32S / ESP-WROOM-32
 * Device Token Model : Hardware Casing QR Token (Default: ${deviceKey})
 * Ultrasonic Sensor  : JSN-SR04T Waterproof Ultrasonic Transducer Module (Trig / Echo)
 * Pin Assignments    :
 *   - JSN-SR04T Trigger : GPIO 5  (Output pulse)
 *   - JSN-SR04T Echo    : GPIO 18 (Input pulse)
 *   - Water Pump Relay  : GPIO 23 (Output - Active HIGH relay trigger)
 *   - Alert Buzzer      : GPIO 19 (Output - Audio warning on low/full thresholds)
 *   - Diagnostic LED    : GPIO 2  (Onboard Blue LED)
 *   - Factory Reset     : GPIO 0  (Onboard BOOT Button - Hold 5s to clear Wi-Fi)
 *
 * Cloud Backend      : Supabase public.water_tank_status (Target: water_01)
 * REST Endpoint      : https://ditnksmvcacnzdguqcgz.supabase.co/rest/v1/water_tank_status?device_id=eq.water_01
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

#define PIN_TRIG            5    // JSN-SR04T Trigger Pin
#define PIN_ECHO            18   // JSN-SR04T Echo Pin
#define PIN_PUMP_RELAY      23   // Submersible Water Pump Relay (Active HIGH)
#define PIN_BUZZER          19   // Piezo Buzzer Alert Pin
#define PIN_STATUS_LED      2    // ESP32 Onboard Blue LED
#define PIN_BOOT_BUTTON     0    // Onboard BOOT Button (Factory Reset)

#define RELAY_ACTIVE_HIGH   true
#define DEFAULT_DEVICE_KEY  "${deviceKey}"
#define SUPABASE_DEVICE_ID  "water_01"

float tankHeightCm          = 100.0;
float minDistanceCm         = 20.0;  // JSN-SR04T blind zone limit
int   lowThresholdPct       = 30;
int   fullThresholdPct      = 90;

#define GKB_BLE_SERVICE_UUID "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define GKB_BLE_CHAR_RX_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define GKB_BLE_CHAR_TX_UUID "beb5483f-36e1-4688-b7f5-ea07361b26a9"

const char* SUPABASE_REST_URL = "https://ditnksmvcacnzdguqcgz.supabase.co/rest/v1/water_tank_status?device_id=eq.water_01";
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

int    currentWaterLevel  = 68;
float  currentDistanceCm  = 32.0;
bool   currentPumpState   = false;
String currentPumpMode    = "AUTO";
bool   buzzerActive       = false;
bool   initialSyncLogged  = false;

BLEServer*         pBleServer         = nullptr;
BLECharacteristic* pTxCharacteristic = nullptr;

unsigned long lastCloudPoll = 0;
const unsigned long CLOUD_POLL_INTERVAL_MS = 2500;

unsigned long buttonPressStartTime = 0;
bool buttonHeld = false;
const unsigned long RESET_HOLD_DURATION_MS = 5000;

bool pendingReboot = false;
unsigned long rebootScheduledAt = 0;

float measureRawDistanceCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(4);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  unsigned long duration = pulseIn(PIN_ECHO, HIGH, 30000);
  if (duration == 0) return -1.0;
  return (duration * 0.0343) / 2.0;
}

float getFilteredDistanceCm() {
  float samples[5];
  int validCount = 0;

  for (int i = 0; i < 5; i++) {
    float d = measureRawDistanceCm();
    if (d >= 15.0 && d <= 600.0) {
      samples[validCount++] = d;
    }
    delay(10);
  }

  if (validCount == 0) return currentDistanceCm;

  for (int i = 0; i < validCount - 1; i++) {
    for (int j = i + 1; j < validCount; j++) {
      if (samples[i] > samples[j]) {
        float temp = samples[i];
        samples[i] = samples[j];
        samples[j] = temp;
      }
    }
  }

  return samples[validCount / 2];
}

int calculateWaterLevelPct(float distance) {
  if (distance <= 0) return currentWaterLevel;
  if (distance <= minDistanceCm) return 100;
  if (distance >= tankHeightCm) return 0;

  float effectiveSpan = tankHeightCm - minDistanceCm;
  if (effectiveSpan <= 0) effectiveSpan = 80.0;

  float pct = ((tankHeightCm - distance) / effectiveSpan) * 100.0;
  int level = (int)round(pct);
  if (level > 100) level = 100;
  if (level < 0) level = 0;
  return level;
}

void applyPumpOutput(bool state) {
  currentPumpState = state;
  digitalWrite(PIN_PUMP_RELAY, (RELAY_ACTIVE_HIGH ? state : !state) ? HIGH : LOW);
}

void applyBuzzerOutput(bool state) {
  buzzerActive = state;
  digitalWrite(PIN_BUZZER, state ? HIGH : LOW);
}

void pollAndSyncCloud() {
  if (WiFi.status() != WL_CONNECTED) return;

  float dist = getFilteredDistanceCm();
  int level = calculateWaterLevelPct(dist);
  currentDistanceCm = dist;
  currentWaterLevel = level;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(10);

  HTTPClient http;
  http.setTimeout(10000);

  if (http.begin(client, SUPABASE_REST_URL)) {
    http.addHeader("apikey", SUPABASE_ANON_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    http.addHeader("Accept", "application/json");

    int httpCode = http.GET();
    if (httpCode == 200) {
      String payload = http.getString();
      if (!initialSyncLogged) {
        initialSyncLogged = true;
        Serial.println("🌐 [CLOUD] Successfully linked to Supabase (water_tank_status / water_01)!");
      }

      if (payload.indexOf("\\"pump_mode\\":\\"MANUAL\\"") != -1) {
        currentPumpMode = "MANUAL";
        bool targetPumpOn = (payload.indexOf("\\"pump_state\\":\\"ON\\"") != -1);
        if (targetPumpOn != currentPumpState) {
          applyPumpOutput(targetPumpOn);
          Serial.printf("⚡ [MANUAL PUMP] Remote Switch: %s\\n", targetPumpOn ? "ON" : "OFF");
        }
      } else {
        currentPumpMode = "AUTO";
        if (currentWaterLevel <= lowThresholdPct && !currentPumpState) {
          applyPumpOutput(true);
          applyBuzzerOutput(true);
          Serial.printf("⚡ [AUTO PUMP] Low Water Level (%d%%) -> Pump Engaged (ON)\\n", currentWaterLevel);
        } else if (currentWaterLevel >= fullThresholdPct && currentPumpState) {
          applyPumpOutput(false);
          applyBuzzerOutput(false);
          Serial.printf("⚡ [AUTO PUMP] Tank Full (%d%%) -> Pump Released (OFF)\\n", currentWaterLevel);
        } else if (currentWaterLevel > lowThresholdPct && currentWaterLevel < fullThresholdPct) {
          applyBuzzerOutput(false);
        }
      }
    }
    http.end();
  }

  if (http.begin(client, SUPABASE_REST_URL)) {
    http.addHeader("apikey", SUPABASE_ANON_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    http.addHeader("Content-Type", "application/json");

    String patchJson = "{\\"water_level\\":" + String(currentWaterLevel) +
                       ",\\"distance_cm\\":" + String(currentDistanceCm, 1) +
                       ",\\"pump_state\\":\\"" + (currentPumpState ? "ON" : "OFF") + "\\"" +
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
    qrAuthenticated    = false;
  }
  void onDisconnect(BLEServer* pServer) {
    bleClientConnected = false;
    qrAuthenticated    = false;
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

      if (submittedKey == deviceKey || submittedKey == DEFAULT_DEVICE_KEY || submittedKey == "GKB-SWP-0001") {
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
        pTxCharacteristic->setValue("ERROR:NOT_AUTHENTICATED");
        pTxCharacteristic->notify();
        return;
      }

      String jsonPayload = rxValue.substring(9);
      int ssidIndex = jsonPayload.indexOf("\\"ssid\\":\\"");
      int passIndex = jsonPayload.indexOf("\\"pass\\":\\"");

      if (ssidIndex != -1 && passIndex != -1) {
        int ssidStart = ssidIndex + 8;
        int ssidEnd   = jsonPayload.indexOf("\\"", ssidStart);
        int passStart = passIndex + 8;
        int passEnd   = jsonPayload.indexOf("\\"", passStart);

        if (ssidEnd != -1 && passEnd != -1) {
          wifiSSID     = jsonPayload.substring(ssidStart, ssidEnd);
          wifiPassword = jsonPayload.substring(passStart, passEnd);

          preferences.begin("gkb_prov", false);
          preferences.putString("wifi_ssid", wifiSSID);
          preferences.putString("wifi_pass", wifiPassword);
          preferences.putBool("provisioned", true);
          preferences.putString("device_key", deviceKey);
          preferences.end();

          pTxCharacteristic->setValue("CONFIG_SAVED:REBOOTING");
          pTxCharacteristic->notify();

          pendingReboot = true;
          rebootScheduledAt = millis() + 1500;
        }
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

void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(PIN_BOOT_BUTTON, INPUT_PULLUP);
  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, LOW);

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  digitalWrite(PIN_TRIG, LOW);

  pinMode(PIN_PUMP_RELAY, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  applyPumpOutput(false);
  applyBuzzerOutput(false);

  preferences.begin("gkb_prov", false);
  isProvisioned = preferences.getBool("provisioned", false);
  deviceKey     = preferences.getString("device_key", DEFAULT_DEVICE_KEY);
  wifiSSID      = preferences.getString("wifi_ssid", "");
  wifiPassword  = preferences.getString("wifi_pass", "");
  preferences.end();

  Serial.println("=======================================================");
  Serial.println("⚡ GKB TECHNOLOGIES — SMART WATER TANK MONITOR SYSTEM");
  Serial.println("   JSN-SR04T Ultrasonic Sensor · Submersible Pump Relay");
  Serial.println("=======================================================");

  if (isProvisioned && wifiSSID.length() > 0) {
    currentMode = MODE_CONNECTING_WIFI;
    WiFi.mode(WIFI_STA);
    WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());
  } else {
    currentMode = MODE_PROVISIONING_BLE;

    BLEDevice::init("GKB-SWP-0001");
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
    BLEDevice::startAdvertising();
  }
}

void loop() {
  if (pendingReboot && millis() >= rebootScheduledAt) {
    ESP.restart();
  }

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
    static bool ledState = false;
    if (millis() - lastBlink >= (bleClientConnected ? 200 : 800)) {
      lastBlink = millis();
      ledState = !ledState;
      digitalWrite(PIN_STATUS_LED, ledState ? HIGH : LOW);
    }
  } else if (currentMode == MODE_CONNECTING_WIFI) {
    if (WiFi.status() == WL_CONNECTED) {
      ip_addr_t primaryDns, secondaryDns;
      IP_ADDR4(&primaryDns, 8, 8, 8, 8);
      IP_ADDR4(&secondaryDns, 1, 1, 1, 1);
      dns_setserver(0, &primaryDns);
      dns_setserver(1, &secondaryDns);

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

export default function WaterTankDashboard({
  mode = 'service',
  device
}: {
  mode?: 'test' | 'service';
  device: Device;
}) {
  const [waterLevel, setWaterLevel] = useState<number>(68);
  const [distanceCm, setDistanceCm] = useState<number>(32.0);
  const [tankHeightCm, setTankHeightCm] = useState<number>(100.0);
  const [minDistanceCm, setMinDistanceCm] = useState<number>(20.0);
  const [tankCapacityLiters, setTankCapacityLiters] = useState<number>(5000);
  const [pumpState, setPumpState] = useState<'ON' | 'OFF'>('OFF');
  const [pumpMode, setPumpMode] = useState<'AUTO' | 'MANUAL'>('AUTO');
  const [lowThreshold, setLowThreshold] = useState<number>(30);
  const [fullThreshold, setFullThreshold] = useState<number>(90);
  const [buzzerActive, setBuzzerActive] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Status & Lock States
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [dbMissingTable, setDbMissingTable] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string>('');
  const [activities, setActivities] = useState<TelemetryActivity[]>([]);

  // Modals
  const [provisionModalOpen, setProvisionModalOpen] = useState<boolean>(false);
  const [casingModalOpen, setCasingModalOpen] = useState<boolean>(false);
  const [firmwareModalOpen, setFirmwareModalOpen] = useState<boolean>(false);
  const [sqlModalOpen, setSqlModalOpen] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  // Copy Feedback
  const [copiedFirmware, setCopiedFirmware] = useState<boolean>(false);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);

  const fetchStatusRef = useRef<(() => Promise<void>) | null>(null);
  const targetDeviceId = 'water_01';
  const targetDeviceKey = device.key || 'GKB-SWP-0001';

  const recordActivity = (event: string, type: TelemetryActivity['type'] = 'info') => {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setActivities(prev => [{ id: Math.random().toString(36).substring(2, 9), event, timestamp: timeStr, type }, ...prev.slice(0, 7)]);
  };

  // Poll Supabase water_tank_status every 2.5s
  useEffect(() => {
    if (mode !== 'service') return;

    let disposed = false;
    const fetchStatus = async () => {
      try {
        let rowData: Record<string, unknown> | null = null;

        // Tier 1: Supabase client
        if (relaySupabase) {
          try {
            const { data, error } = await relaySupabase
              .from('water_tank_status')
              .select('*')
              .eq('device_id', targetDeviceId)
              .maybeSingle();

            if (error) {
              if (error.code === 'PGRST205' || error.message?.includes('not find the table')) {
                setDbMissingTable(true);
              }
            } else if (data) {
              rowData = data as Record<string, unknown>;
              setDbMissingTable(false);
            }
          } catch (err: unknown) {
            const msg = String(err);
            if (msg.includes('PGRST205') || msg.includes('water_tank_status')) {
              setDbMissingTable(true);
            }
          }
        }

        // Tier 2: Direct REST fetch fallback
        if (!rowData && !dbMissingTable) {
          try {
            const res = await fetch(`${HARDCODED_SUPABASE_URL}/rest/v1/water_tank_status?device_id=eq.${targetDeviceId}&select=*`, {
              headers: {
                'apikey': HARDCODED_SUPABASE_KEY,
                'Authorization': `Bearer ${HARDCODED_SUPABASE_KEY}`
              }
            });

            if (res.status === 404) {
              setDbMissingTable(true);
            } else if (res.ok) {
              const arr = await res.json();
              if (Array.isArray(arr) && arr.length > 0) {
                rowData = arr[0];
                setDbMissingTable(false);
              }
            }
          } catch {}
        }

        if (disposed || !rowData) return;

        setLastSyncedAt(new Date());

        if (typeof rowData.water_level === 'number') setWaterLevel(rowData.water_level);
        if (typeof rowData.distance_cm === 'number') setDistanceCm(rowData.distance_cm);
        if (typeof rowData.tank_height_cm === 'number') setTankHeightCm(rowData.tank_height_cm);
        if (typeof rowData.min_distance_cm === 'number') setMinDistanceCm(rowData.min_distance_cm);
        if (typeof rowData.tank_capacity_liters === 'number') setTankCapacityLiters(rowData.tank_capacity_liters);
        if (rowData.pump_state === 'ON' || rowData.pump_state === 'OFF') setPumpState(rowData.pump_state);
        if (rowData.pump_mode === 'AUTO' || rowData.pump_mode === 'MANUAL') setPumpMode(rowData.pump_mode);
        if (typeof rowData.low_threshold === 'number') setLowThreshold(rowData.low_threshold);
        if (typeof rowData.full_threshold === 'number') setFullThreshold(rowData.full_threshold);
        if (typeof rowData.buzzer_active === 'boolean') setBuzzerActive(rowData.buzzer_active);
      } catch (err) {
        console.warn('Water tank status polling error:', err);
      }
    };

    fetchStatusRef.current = fetchStatus;
    void fetchStatus();
    const intervalId = window.setInterval(() => void fetchStatus(), 2500);

    return () => {
      disposed = true;
      fetchStatusRef.current = null;
      window.clearInterval(intervalId);
    };
  }, [mode, dbMissingTable]);

  // Handle Manual Remote Pump Toggle
  const handleTogglePump = async () => {
    const nextState = pumpState === 'ON' ? 'OFF' : 'ON';
    setPumpState(nextState); // Optimistic UI update
    setIsUpdating(true);
    setSyncMessage(`📡 Transmitting ${nextState} command to Submersible Pump (GPIO 23)...`);
    recordActivity(`Pump switched ${nextState} (Manual Override)`, 'pump');

    try {
      if (!dbMissingTable) {
        await fetch(`${HARDCODED_SUPABASE_URL}/rest/v1/water_tank_status?device_id=eq.${targetDeviceId}`, {
          method: 'PATCH',
          headers: {
            'apikey': HARDCODED_SUPABASE_KEY,
            'Authorization': `Bearer ${HARDCODED_SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ pump_state: nextState, pump_mode: 'MANUAL' })
        });
        setPumpMode('MANUAL');
      }
      setSyncMessage(`✅ Submersible pump set to ${nextState} via cloud`);
    } catch {
      setSyncMessage(`⚠️ Offline test: Pump updated locally to ${nextState}`);
    } finally {
      setIsUpdating(false);
      setTimeout(() => setSyncMessage(''), 3000);
    }
  };

  // Handle Mode Switch (AUTO <-> MANUAL)
  const handleToggleMode = async () => {
    const nextMode = pumpMode === 'AUTO' ? 'MANUAL' : 'AUTO';
    setPumpMode(nextMode);
    setIsUpdating(true);
    setSyncMessage(`🔄 System Mode switched to ${nextMode}`);
    recordActivity(`Operating Mode switched to ${nextMode}`, 'info');

    try {
      if (!dbMissingTable) {
        await fetch(`${HARDCODED_SUPABASE_URL}/rest/v1/water_tank_status?device_id=eq.${targetDeviceId}`, {
          method: 'PATCH',
          headers: {
            'apikey': HARDCODED_SUPABASE_KEY,
            'Authorization': `Bearer ${HARDCODED_SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ pump_mode: nextMode })
        });
      }
    } catch {
      // Local fallback
    } finally {
      setIsUpdating(false);
      setTimeout(() => setSyncMessage(''), 2500);
    }
  };

  // Handle Thresholds & Geometry Save
  const handleSaveSettings = async () => {
    setIsUpdating(true);
    setSyncMessage('💾 Transmitting calibration parameters to ESP32...');
    recordActivity(`Updated calibration: Low ${lowThreshold}%, Full ${fullThreshold}%, Height ${tankHeightCm}cm`, 'info');

    try {
      if (!dbMissingTable) {
        await fetch(`${HARDCODED_SUPABASE_URL}/rest/v1/water_tank_status?device_id=eq.${targetDeviceId}`, {
          method: 'PATCH',
          headers: {
            'apikey': HARDCODED_SUPABASE_KEY,
            'Authorization': `Bearer ${HARDCODED_SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            low_threshold: lowThreshold,
            full_threshold: fullThreshold,
            tank_height_cm: tankHeightCm,
            min_distance_cm: minDistanceCm,
            tank_capacity_liters: tankCapacityLiters
          })
        });
      }
      setSyncMessage('✅ Tank calibration saved to cloud');
      setSettingsOpen(false);
    } catch {
      setSyncMessage('⚠️ Calibration saved locally');
    } finally {
      setIsUpdating(false);
      setTimeout(() => setSyncMessage(''), 3000);
    }
  };

  // Simulated slider changes for testing
  const handleSimulatedLevelChange = (newLevel: number) => {
    setWaterLevel(newLevel);
    const effectiveSpan = tankHeightCm - minDistanceCm;
    const computedDist = tankHeightCm - (newLevel / 100.0) * effectiveSpan;
    setDistanceCm(Number(computedDist.toFixed(1)));

    if (pumpMode === 'AUTO') {
      if (newLevel <= lowThreshold && pumpState === 'OFF') {
        setPumpState('ON');
        setBuzzerActive(true);
        recordActivity(`[AUTO LOGIC] Level ${newLevel}% <= ${lowThreshold}% -> Pump triggered ON`, 'pump');
      } else if (newLevel >= fullThreshold && pumpState === 'ON') {
        setPumpState('OFF');
        setBuzzerActive(false);
        recordActivity(`[AUTO LOGIC] Level ${newLevel}% >= ${fullThreshold}% -> Pump cut off (OFF)`, 'pump');
      } else if (newLevel > lowThreshold && newLevel < fullThreshold) {
        setBuzzerActive(false);
      }
    }
  };

  // Computed values
  const currentVolumeLiters = Math.round((waterLevel / 100) * tankCapacityLiters);
  const waterDepthCm = Math.max(0, tankHeightCm - distanceCm);

  // Dynamic tank status badge
  const getStatusBadge = () => {
    if (waterLevel <= lowThreshold) {
      return {
        label: 'CRITICAL LOW',
        color: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
        waveColor: 'from-rose-500/80 to-amber-600/90',
        glow: 'shadow-[0_0_25px_rgba(244,63,94,0.35)]'
      };
    }
    if (waterLevel >= fullThreshold) {
      return {
        label: 'MAX CAPACITY',
        color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
        waveColor: 'from-emerald-500/80 to-cyan-600/90',
        glow: 'shadow-[0_0_25px_rgba(16,185,129,0.35)]'
      };
    }
    if (pumpState === 'ON') {
      return {
        label: 'AUTO REFILLING',
        color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
        waveColor: 'from-cyan-500/80 to-blue-600/90',
        glow: 'shadow-[0_0_25px_rgba(6,182,212,0.35)]'
      };
    }
    return {
      label: 'NORMAL LEVEL',
      color: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
      waveColor: 'from-cyan-500/70 to-blue-600/80',
      glow: 'shadow-[0_0_20px_rgba(59,130,246,0.25)]'
    };
  };

  const statusBadge = getStatusBadge();

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* ================= MISSING TABLE HELPER BANNER ================= */}
      {dbMissingTable && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 backdrop-blur-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 shrink-0">
                <Database className="h-5 w-5 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-amber-200 flex items-center gap-2">
                  Supabase Table <span className="font-mono text-cyan-300">public.water_tank_status</span> Not Detected
                </h4>
                <p className="text-xs text-amber-300/80 leading-relaxed max-w-2xl">
                  Run the 1-minute database setup script in your Supabase SQL Editor to enable real-time telemetry syncing with your ESP32.
                  In the meantime, the dashboard is running in simulated telemetry mode!
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSqlModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 transition-all shadow-lg shadow-amber-500/20 cursor-pointer shrink-0"
            >
              <Code className="h-4 w-4" />
              View & Copy SQL Script
            </button>
          </div>
        </div>
      )}

      {/* ================= HEADER CONTROL BAR ================= */}
      <div className="rounded-3xl border border-cyan-500/20 bg-slate-900/80 p-6 backdrop-blur-xl shadow-2xl relative overflow-hidden">
        <div className="absolute -right-24 -top-24 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -left-24 -bottom-24 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
                <Droplets className="h-3.5 w-3.5" /> JSN-SR04T Waterproof Ultrasonic Sensor
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/10 border border-blue-500/30 text-blue-300 font-mono">
                GPIO 23 Pump Relay
              </span>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${statusBadge.color}`}>
                <Activity className="h-3.5 w-3.5 animate-pulse" /> {statusBadge.label}
              </span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-3">
              Smart Water Tank Monitor
              <span className="text-xs font-mono font-normal text-slate-400 px-2.5 py-0.5 rounded-md bg-slate-800 border border-slate-700">
                {targetDeviceKey}
              </span>
            </h2>
            <p className="text-xs text-slate-300 max-w-xl">
              Acoustic depth telemetry via high-frequency pulse timing (GPIO 5/18), automatic relay pump actuation, and BLE provisioning.
            </p>
          </div>

          {/* Quick Action Badges */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setProvisionModalOpen(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-cyan-600/20 border border-cyan-500/40 text-cyan-200 text-xs font-bold hover:bg-cyan-600/30 transition-all cursor-pointer shadow-sm"
            >
              <Bluetooth className="h-4 w-4 text-cyan-400 animate-pulse" />
              BLE QR Provisioning
            </button>

            <button
              type="button"
              onClick={() => setCasingModalOpen(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-200 text-xs font-semibold hover:border-cyan-400/50 hover:text-cyan-300 transition-all cursor-pointer"
            >
              <QrCode className="h-4 w-4 text-slate-400" />
              Casing Label
            </button>

            <button
              type="button"
              onClick={() => setFirmwareModalOpen(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-200 text-xs font-semibold hover:border-cyan-400/50 hover:text-cyan-300 transition-all cursor-pointer"
            >
              <Code className="h-4 w-4 text-slate-400" />
              ESP32 Sketch
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(!settingsOpen)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                settingsOpen
                  ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                  : 'bg-slate-800/80 border-slate-700 text-slate-200 hover:border-slate-600'
              }`}
            >
              <Sliders className="h-4 w-4" />
              Calibration
              {settingsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Sync message toast */}
        {syncMessage && (
          <div className="mt-4 p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-200 text-xs font-mono animate-fadeIn flex items-center gap-2">
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-cyan-400 shrink-0" />
            <span>{syncMessage}</span>
          </div>
        )}
      </div>

      {/* ================= CALIBRATION DRAWER ================= */}
      {settingsOpen && (
        <div className="rounded-3xl border border-cyan-500/30 bg-slate-900/90 p-6 backdrop-blur-xl animate-fadeIn space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sliders className="h-4 w-4 text-cyan-400" /> Tank Geometry & Threshold Calibration
              </h3>
              <p className="text-xs text-slate-400">
                Tune the acoustic dead-zone and auto-fill refill parameters stored in cloud NVS.
              </p>
            </div>
            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={isUpdating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold text-xs hover:from-cyan-400 hover:to-blue-500 transition-all cursor-pointer shadow-lg shadow-cyan-500/20"
            >
              <Save className="h-4 w-4" />
              Save Parameters
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Low Threshold */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Auto-Fill Cut-in (Low)</span>
                <span className="font-mono font-bold text-rose-400">{lowThreshold}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="50"
                value={lowThreshold}
                onChange={e => setLowThreshold(Number(e.target.value))}
                className="w-full accent-rose-500 cursor-pointer"
              />
              <p className="text-[10px] text-slate-500">Pump starts automatically when level drops below this.</p>
            </div>

            {/* Full Threshold */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Auto-Cutoff (Full)</span>
                <span className="font-mono font-bold text-emerald-400">{fullThreshold}%</span>
              </div>
              <input
                type="range"
                min="60"
                max="98"
                value={fullThreshold}
                onChange={e => setFullThreshold(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <p className="text-[10px] text-slate-500">Pump cuts off when level reaches this capacity.</p>
            </div>

            {/* Total Tank Height */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Total Tank Height</span>
                <span className="font-mono font-bold text-cyan-400">{tankHeightCm} cm</span>
              </div>
              <input
                type="range"
                min="40"
                max="300"
                step="5"
                value={tankHeightCm}
                onChange={e => setTankHeightCm(Number(e.target.value))}
                className="w-full accent-cyan-500 cursor-pointer"
              />
              <p className="text-[10px] text-slate-500">Sensor face distance to tank bottom floor.</p>
            </div>

            {/* Tank Capacity */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Storage Capacity</span>
                <span className="font-mono font-bold text-blue-400">{tankCapacityLiters.toLocaleString()} L</span>
              </div>
              <input
                type="range"
                min="500"
                max="25000"
                step="500"
                value={tankCapacityLiters}
                onChange={e => setTankCapacityLiters(Number(e.target.value))}
                className="w-full accent-blue-500 cursor-pointer"
              />
              <p className="text-[10px] text-slate-500">Total volume at 100% capacity in Liters.</p>
            </div>
          </div>
        </div>
      )}

      {/* ================= MAIN TELEMETRY & TANK VISUALIZER GRID ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* LEFT COLUMN: ANIMATED CYLINDRICAL WATER TANK (5 COLS) */}
        <div className="lg:col-span-5 rounded-3xl border border-cyan-500/20 bg-slate-900/90 p-6 flex flex-col justify-between backdrop-blur-xl relative overflow-hidden shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-2">
              <Waves className="h-4 w-4 text-cyan-400" /> Real-time Acoustic Waveform
            </span>
            <span className="text-[11px] font-mono text-cyan-400/80 bg-slate-950 px-2 py-0.5 rounded border border-cyan-500/20">
              JSN-SR04T Beam
            </span>
          </div>

          {/* CYLINDRICAL TANK CONTAINER */}
          <div className="relative mx-auto my-2 w-full max-w-[280px] h-[360px] flex items-center justify-center">
            {/* Sensor Housing at the top */}
            <div className="absolute top-0 z-30 flex flex-col items-center">
              <div className="w-16 h-5 rounded-t-lg bg-gradient-to-b from-slate-700 to-slate-800 border-t border-x border-cyan-400/50 shadow-md flex items-center justify-center">
                <span className="text-[8px] font-mono text-cyan-300 font-bold">JSN-SR04T</span>
              </div>
              <div className="w-10 h-3 bg-cyan-500/30 rounded-b-md border-b border-cyan-400 flex items-center justify-center">
                <div className="w-2 h-1 rounded-full bg-cyan-400 animate-ping" />
              </div>
              {/* Ultrasonic Sonic Pulse Wave Visual */}
              <div className="w-0.5 h-10 bg-gradient-to-b from-cyan-400/80 to-transparent border-dashed animate-pulse mt-0.5" />
            </div>

            {/* Outer Glass Cylinder */}
            <div className="relative w-full h-[310px] mt-6 rounded-[2.5rem] border-2 border-cyan-500/40 bg-slate-950/70 overflow-hidden shadow-[inset_0_0_30px_rgba(6,182,212,0.15)] flex flex-col justify-end">
              {/* Glass Reflection Highlight */}
              <div className="absolute left-4 top-3 bottom-3 w-3 bg-gradient-to-r from-white/15 to-transparent rounded-full z-20 pointer-events-none" />
              <div className="absolute right-4 top-3 bottom-3 w-1.5 bg-gradient-to-l from-white/10 to-transparent rounded-full z-20 pointer-events-none" />

              {/* Tick Marks on Right Edge */}
              <div className="absolute right-3 inset-y-8 flex flex-col justify-between text-[9px] font-mono text-slate-500 z-20 pointer-events-none select-none">
                <span className="text-emerald-400 font-bold">100% —</span>
                <span>75% —</span>
                <span className="text-cyan-400 font-bold">50% —</span>
                <span className="text-rose-400 font-bold">25% —</span>
                <span>0% —</span>
              </div>

              {/* WATER FLUID LEVEL CONTAINER */}
              <div
                className="w-full transition-all duration-1000 ease-out relative overflow-hidden"
                style={{ height: `${Math.min(100, Math.max(4, waterLevel))}%` }}
              >
                {/* Wavy Surface Layer (SVG) */}
                <div className="absolute top-0 left-0 right-0 h-6 -translate-y-3 z-10">
                  <svg
                    viewBox="0 0 500 150"
                    preserveAspectRatio="none"
                    className="w-full h-full fill-cyan-400/90 animate-pulse"
                  >
                    <path d="M0.00,49.98 C150.00,150.00 349.20,-50.00 500.00,49.98 L500.00,150.00 L0.00,150.00 Z" />
                  </svg>
                </div>

                {/* Main Water Body Gradient */}
                <div
                  className={`w-full h-full bg-gradient-to-t ${statusBadge.waveColor} opacity-90 transition-all duration-1000 flex flex-col justify-between p-4`}
                >
                  {/* Floating Bubble particles */}
                  {pumpState === 'ON' && (
                    <div className="absolute inset-0 pointer-events-none overflow-hidden">
                      <div className="absolute bottom-2 left-1/4 w-2 h-2 rounded-full bg-white/40 animate-bounce" style={{ animationDuration: '1.2s' }} />
                      <div className="absolute bottom-4 left-1/2 w-3 h-3 rounded-full bg-white/30 animate-bounce" style={{ animationDuration: '1.8s' }} />
                      <div className="absolute bottom-1 left-2/3 w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce" style={{ animationDuration: '0.9s' }} />
                    </div>
                  )}

                  {/* Water surface label */}
                  <div className="text-center pt-2 z-10">
                    <span className="text-2xl font-black text-white drop-shadow-md font-mono">
                      {waterLevel}%
                    </span>
                  </div>

                  {/* Submersible Pump Base Indicator */}
                  <div className="flex items-center justify-between text-[10px] text-white/80 font-mono z-10 border-t border-white/20 pt-1.5">
                    <span>DEPTH: {waterDepthCm.toFixed(1)}cm</span>
                    <span className="flex items-center gap-1">
                      <Power className={`h-3 w-3 ${pumpState === 'ON' ? 'text-emerald-300 animate-spin' : 'text-slate-300'}`} />
                      {pumpState}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Submersible Pump Impeller Icon at Bottom */}
            <div className="absolute -bottom-2 z-30 flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950 border border-slate-700 shadow-xl">
              <Zap className={`h-3.5 w-3.5 ${pumpState === 'ON' ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
              <span className="text-[10px] font-mono text-slate-300 font-bold">
                SUBMERSIBLE PUMP · {pumpState === 'ON' ? 'ENGAGED' : 'STANDBY'}
              </span>
            </div>
          </div>

          {/* Quick Simulation Slider (Hands-on Testing) */}
          <div className="mt-4 pt-3 border-t border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 flex items-center gap-1">
                <Gauge className="h-3 w-3 text-cyan-400" /> Interactive Test Slider:
              </span>
              <span className="font-mono text-cyan-300 font-bold">{waterLevel}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={waterLevel}
              onChange={e => handleSimulatedLevelChange(Number(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer"
            />
          </div>
        </div>

        {/* RIGHT COLUMN: METRIC TILES & CONTROLS (7 COLS) */}
        <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
          {/* 4 PRIMARY METRIC TILES */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            {/* 1. Water Level */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Droplets className="h-3.5 w-3.5 text-cyan-400" /> Level
              </span>
              <div className="text-2xl font-black text-white font-mono">{waterLevel}%</div>
              <div className="text-[10px] text-cyan-400 font-medium">
                {waterLevel >= fullThreshold ? 'Full Cutoff' : waterLevel <= lowThreshold ? 'Refill Needed' : 'Nominal'}
              </div>
            </div>

            {/* 2. Liquid Volume */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5 text-blue-400" /> Volume
              </span>
              <div className="text-2xl font-black text-white font-mono">
                {currentVolumeLiters.toLocaleString()}
                <span className="text-xs font-normal text-slate-400 ml-1">L</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">of {tankCapacityLiters.toLocaleString()} L</div>
            </div>

            {/* 3. Ultrasonic Distance */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Radio className="h-3.5 w-3.5 text-purple-400" /> Acoustic Echo
              </span>
              <div className="text-2xl font-black text-white font-mono">
                {distanceCm.toFixed(1)}
                <span className="text-xs font-normal text-slate-400 ml-1">cm</span>
              </div>
              <div className="text-[10px] text-slate-400">Surface gap</div>
            </div>

            {/* 4. Usable Water Depth */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Gauge className="h-3.5 w-3.5 text-emerald-400" /> Water Depth
              </span>
              <div className="text-2xl font-black text-white font-mono">
                {waterDepthCm.toFixed(1)}
                <span className="text-xs font-normal text-slate-400 ml-1">cm</span>
              </div>
              <div className="text-[10px] text-slate-400">Total {tankHeightCm} cm</div>
            </div>
          </div>

          {/* DUAL PUMP ACTUATOR & MODE CONTROL CARD */}
          <div className="rounded-3xl border border-cyan-500/30 bg-slate-900/90 p-6 backdrop-blur-xl space-y-5 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <Power className="h-5 w-5 text-cyan-400" /> Submersible Pump Control Engine
                </h3>
                <p className="text-xs text-slate-400">
                  Trigger 5V/12V pump relay via ESP32 GPIO 23 with automated low-level refill safety.
                </p>
              </div>

              {/* Mode Toggle Pill */}
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800 shrink-0">
                <button
                  type="button"
                  onClick={() => pumpMode !== 'AUTO' && handleToggleMode()}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    pumpMode === 'AUTO'
                      ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  AUTOMATIC
                </button>
                <button
                  type="button"
                  onClick={() => pumpMode !== 'MANUAL' && handleToggleMode()}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    pumpMode === 'MANUAL'
                      ? 'bg-purple-500 text-white shadow-md shadow-purple-500/20'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  MANUAL OVERRIDE
                </button>
              </div>
            </div>

            {/* Large Pump State Switcher */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 rounded-2xl bg-slate-950/70 border border-slate-800/80">
              <div className="space-y-1 text-center sm:text-left">
                <div className="text-sm font-bold text-slate-200 flex items-center justify-center sm:justify-start gap-2">
                  <span>Submersible Relay Status:</span>
                  <span
                    className={`font-mono px-2.5 py-0.5 rounded-md text-xs font-bold ${
                      pumpState === 'ON'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {pumpState === 'ON' ? 'PUMP RUNNING (ON)' : 'PUMP STOPPED (OFF)'}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Pin: <span className="font-mono text-cyan-300">GPIO 23</span> · Mode:{' '}
                  <span className="font-mono text-purple-300 font-bold">{pumpMode}</span>
                  {pumpMode === 'AUTO' && (
                    <span className="text-slate-500 ml-1">
                      (Refill &lt;= {lowThreshold}%, Cutoff &gt;= {fullThreshold}%)
                    </span>
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={handleTogglePump}
                disabled={isUpdating}
                className={`w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-2xl font-black text-sm tracking-wide transition-all shadow-xl cursor-pointer ${
                  pumpState === 'ON'
                    ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-rose-500/20 active:scale-95'
                    : 'bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-emerald-500/20 active:scale-95'
                }`}
              >
                <Power className="h-5 w-5" />
                {pumpState === 'ON' ? 'STOP PUMP NOW' : 'START WATER PUMP'}
              </button>
            </div>

            {/* Diagnostic Alert Ribbon */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/50 border border-slate-800">
                <Volume2 className={`h-4 w-4 ${buzzerActive ? 'text-rose-400 animate-ping' : 'text-slate-500'}`} />
                <div>
                  <div className="font-bold text-slate-300">Piezo Audio Buzzer</div>
                  <div className="text-[10px] text-slate-500">
                    GPIO 19 · {buzzerActive ? 'AUDIO WARNING SOUNDING' : 'Silent Normal'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/50 border border-slate-800">
                <Server className="h-4 w-4 text-cyan-400" />
                <div>
                  <div className="font-bold text-slate-300">Cloud REST Link</div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    {lastSyncedAt ? `Synced ${lastSyncedAt.toLocaleTimeString()}` : 'Awaiting heartbeat'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* TELEMETRY ACTIVITY AUDIT LOG */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-2">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-cyan-400" /> Recent Tank Telemetry Events
            </span>
            <div className="space-y-1 text-[11px] font-mono">
              {activities.length === 0 ? (
                <div className="text-slate-500 py-1">Telemetry stream online. Monitoring ultrasonic waves...</div>
              ) : (
                activities.map(act => (
                  <div key={act.id} className="flex items-center justify-between text-slate-400 py-0.5 border-b border-slate-800/40">
                    <span className="text-slate-300">{act.event}</span>
                    <span className="text-slate-500 text-[10px]">{act.timestamp}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ================= MODAL: BLE & QR PROVISIONING ================= */}
      <BleProvisioningModal
        isOpen={provisionModalOpen}
        onClose={() => setProvisionModalOpen(false)}
        targetDeviceKey={targetDeviceKey}
        targetDeviceId={targetDeviceId}
        onProvisionSuccess={async (savedKey) => {
          setProvisionModalOpen(false);
          setSyncMessage(`🎉 GKB Water Tank Monitor (${savedKey}) provisioned successfully!`);
          recordActivity(`Device provisioned via Web Bluetooth: ${savedKey}`, 'info');
        }}
      />

      {/* ================= MODAL: CASING QR STICKER GENERATOR ================= */}
      {casingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-md rounded-3xl border border-cyan-500/30 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <QrCode className="h-5 w-5 text-cyan-400" /> Casing QR Code Sticker
              </h3>
              <button
                type="button"
                onClick={() => setCasingModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 rounded-2xl bg-white flex flex-col items-center justify-center space-y-3 shadow-inner">
              <div
                dangerouslySetInnerHTML={{ __html: createQrSvg(targetDeviceKey, 200) }}
                className="w-48 h-48"
              />
              <div className="text-center">
                <div className="text-base font-black text-slate-950 tracking-wider font-mono">
                  {targetDeviceKey}
                </div>
                <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">
                  GKB Smart Water Tank Monitor
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(targetDeviceKey);
                  setCopiedKey(true);
                  setTimeout(() => setCopiedKey(false), 2000);
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-xs font-bold text-slate-200 hover:border-cyan-400"
              >
                {copiedKey ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                {copiedKey ? 'Copied' : 'Copy Key'}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-cyan-500 text-xs font-bold text-slate-950 hover:bg-cyan-400"
              >
                <Printer className="h-4 w-4" />
                Print Sticker
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: ESP32 ARDUINO FIRMWARE INSPECTION ================= */}
      {firmwareModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-4xl max-h-[85vh] rounded-3xl border border-cyan-500/30 bg-slate-900 p-6 shadow-2xl flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Code className="h-5 w-5 text-cyan-400" /> ESP32 Water Tank Monitor Firmware
                </h3>
                <p className="text-xs text-slate-400">
                  Target: <span className="font-mono text-cyan-300">smart_water_monitor.ino</span> (OneDrive & ESP32 Dev Board)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFirmwareModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
              <div className="font-bold text-slate-300">Hardware Pinout Reference:</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-400 font-mono text-[11px]">
                <div>• Trig: <span className="text-cyan-300">GPIO 5</span></div>
                <div>• Echo: <span className="text-cyan-300">GPIO 18</span></div>
                <div>• Pump Relay: <span className="text-cyan-300">GPIO 23</span></div>
                <div>• Buzzer: <span className="text-cyan-300">GPIO 19</span></div>
              </div>
            </div>

            <div className="flex-1 overflow-auto rounded-2xl bg-slate-950 p-4 border border-slate-800 font-mono text-xs text-cyan-200/90 leading-relaxed">
              <pre className="whitespace-pre-wrap">{generateWaterTankArduinoCode(targetDeviceKey)}</pre>
            </div>

            <div className="flex justify-between items-center pt-2">
              <span className="text-xs text-slate-400 font-mono">
                Saved in: OneDrive\GKB TECHNOLOGIES\projects\smart_water_monitor
              </span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(generateWaterTankArduinoCode(targetDeviceKey));
                  setCopiedFirmware(true);
                  setTimeout(() => setCopiedFirmware(false), 2000);
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-500 text-slate-950 font-bold text-xs hover:bg-cyan-400 transition-all cursor-pointer shadow-lg shadow-cyan-500/20"
              >
                {copiedFirmware ? <Check className="h-4 w-4 text-slate-950" /> : <Copy className="h-4 w-4" />}
                {copiedFirmware ? 'Copied to Clipboard!' : 'Copy Arduino Sketch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: SUPABASE SQL SETUP ================= */}
      {sqlModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-3xl max-h-[85vh] rounded-3xl border border-amber-500/30 bg-slate-900 p-6 shadow-2xl flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Database className="h-5 w-5 text-amber-400" /> Supabase SQL Setup Script
                </h3>
                <p className="text-xs text-slate-400">
                  Run this in your Supabase SQL Editor to create <span className="font-mono text-cyan-300">public.water_tank_status</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSqlModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto rounded-2xl bg-slate-950 p-4 border border-slate-800 font-mono text-xs text-amber-200/90 leading-relaxed">
              <pre className="whitespace-pre-wrap">{SQL_SETUP_SCRIPT}</pre>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(SQL_SETUP_SCRIPT);
                  setCopiedSql(true);
                  setTimeout(() => setCopiedSql(false), 2000);
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition-all cursor-pointer shadow-lg shadow-amber-500/20"
              >
                {copiedSql ? <Check className="h-4 w-4 text-slate-950" /> : <Copy className="h-4 w-4" />}
                {copiedSql ? 'Copied SQL Script!' : 'Copy SQL to Clipboard'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
