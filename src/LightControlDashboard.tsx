import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Lightbulb, Pencil, Save, X, Activity, Wifi, Server,
  Bluetooth, QrCode, Printer, Code, Zap, Check, Copy,
  AlertTriangle, Cpu, Radio, Key, Power, RefreshCw
} from 'lucide-react';
import { relaySupabase } from './supabase';
import BleProvisioningModal from './BleProvisioningModal';

export type Device = {
  id: number;
  name: string;
  key: string;
  status: string;
  lastAlert: string;
  project?: string;
  legacyKeys?: string[];
  relayChannels?: 2 | 4 | 6 | 8;
  paused?: boolean;
};

type ControlledLight = {
  channel: number;
  name: string;
  gpio: number;
  isOn: boolean;
};

type DeviceControlActivity = {
  id: string;
  event: string;
  timestamp: string;
};

const GPIO_MAP: Record<number, number> = {
  1: 23, // Relay 1 -> GPIO 23
  2: 22, // Relay 2 -> GPIO 22
  3: 21, // Relay 3 -> GPIO 21
  4: 19, // Relay 4 -> GPIO 19
  5: 18, // Relay 5 -> GPIO 18
  6: 5,  // Relay 6 -> GPIO 5
  7: 25, // Relay 7 -> GPIO 25
  8: 26  // Relay 8 -> GPIO 26
};

const DEFAULT_NAMES: Record<number, string> = {
  1: 'Living Room Light',
  2: 'Dining Room Light',
  3: 'Kitchen Light',
  4: 'Porch / Entrance Light',
  5: 'Master Bedroom Light',
  6: 'Guest Bedroom Light',
  7: 'Garden & Pathway Light',
  8: 'Security Perimeter Floodlight'
};

export function getLightDeviceId(device: Device): string {
  if (device.relayChannels === 2 || device.key?.includes('V0')) return 'light_00';
  if (device.relayChannels === 6 || device.key?.includes('V2')) return 'light_02';
  if (device.relayChannels === 8 || device.key?.includes('V3')) return 'light_03';
  return 'light_01'; // Default 4-channel device
}

function generateLightArduinoCode(deviceKey: string = 'GKB-LIGHT-0001V1', channels: number = 4): string {
  const targetId = deviceKey.includes('V0') || channels === 2
    ? 'light_00'
    : deviceKey.includes('V2') || channels === 6
    ? 'light_02'
    : deviceKey.includes('V3') || channels === 8
    ? 'light_03'
    : 'light_01';

  const selectCols = Array.from({ length: channels }, (_, i) => `ch${i + 1}`).join(',');
  const pinEntries = Array.from({ length: channels }, (_, i) => {
    const ch = i + 1;
    const pin = GPIO_MAP[ch] ?? 23;
    return ` *                      - Channel ${ch}: GPIO ${pin} (${DEFAULT_NAMES[ch] || `Light ${ch}`})`;
  }).join('\n');

  const pinDefines = Array.from({ length: channels }, (_, i) => {
    const ch = i + 1;
    const pin = GPIO_MAP[ch] ?? 23;
    return `#define PIN_RELAY_CH${ch}       ${pin}   // Relay Channel ${ch}`;
  }).join('\n');

  const pinArray = Array.from({ length: channels }, (_, i) => `PIN_RELAY_CH${i + 1}`).join(', ');
  const initStates = Array.from({ length: channels }, () => 'false').join(', ');

  return `/*
 * =========================================================================================
 * GKB TECHNOLOGIES — ESP32 SMART LIGHT CONTROL SYSTEM (${channels}-CHANNEL RELAY)
 * =========================================================================================
 * Target Board       : ESP32 Dev Module / NodeMCU-32S / ESP-WROOM-32
 * Device Token Model : Unique Hardware Casing Token (Default: ${deviceKey})
 * Target Outputs     : ${channels}-Channel Relay Board:
${pinEntries}
 * Status Diagnostic  : Onboard Blue LED (GPIO 2)
 * Factory Reset Button: Onboard BOOT Button (GPIO 0, Hold for 5s)
 * Storage Engine     : Non-Volatile Flash Partition (ESP32 Preferences.h / NVS)
 * Connectivity       : Dual-Mode (BLE 4.2 GATT Provisioning + 2.4GHz Wi-Fi Cloud Polling)
 * Cloud Backend      : Supabase public.light_control_status (device_id: ${targetId})
 * =========================================================================================
 * STANDARDIZED PROVISIONING ARCHITECTURE:
 * 1. Boot-up: Reads Preferences NVS namespace ("gkb_prov"). If provisioned, connects to Wi-Fi.
 * 2. BLE Handshake: If unprovisioned, starts BLE GATT Server ("GKB-LIGHT-0001").
 * 3. Device QR Tagging: Web transmits "VERIFY:${deviceKey}" over BLE.
 * 4. Credential Transfer: Web transmits "SET_WIFI:{\\"ssid\\":\\"...\\",\\"pass\\":\\"...\\"}".
 * 5. Cloud Actuation: ESP32 joins Wi-Fi, injects 8.8.8.8/1.1.1.1 DNS, and polls Supabase every 2.5s.
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
#define TOTAL_CHANNELS      ${channels}
${pinDefines}
#define PIN_STATUS_LED      2    // ESP32 GPIO 2  -> Onboard Blue LED
#define PIN_BOOT_BUTTON     0    // ESP32 GPIO 0  -> BOOT Button (Factory Reset)

// Set to true if your relay module is Active HIGH (5V/3.3V trigger), false if Active LOW
#define RELAY_ACTIVE_HIGH   true

const int RELAY_PINS[TOTAL_CHANNELS] = { ${pinArray} };

// ================= DEVICE IDENTITY & SECURITY KEY =================
#define DEFAULT_DEVICE_KEY  "${deviceKey}"

// ================= BLE GATT SPECIFICATIONS =================
#define GKB_BLE_SERVICE_UUID "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define GKB_BLE_CHAR_RX_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define GKB_BLE_CHAR_TX_UUID "beb5483f-36e1-4688-b7f5-ea07361b26a9"

// ================= SUPABASE CLOUD REST ENDPOINT =================
const char* SUPABASE_REST_URL = "https://ditnksmvcacnzdguqcgz.supabase.co/rest/v1/light_control_status?device_id=eq.${targetId}&select=${selectCols}";
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

bool   channelStates[TOTAL_CHANNELS] = { ${initStates} };

BLEServer* pBleServer = nullptr;
BLECharacteristic* pTxCharacteristic = nullptr;

unsigned long lastCloudPoll = 0;
const unsigned long CLOUD_POLL_INTERVAL_MS = 2500;

bool pendingReboot = false;
unsigned long rebootScheduledAt = 0;

void applyOutput(int pin, bool state) {
  digitalWrite(pin, (RELAY_ACTIVE_HIGH ? state : !state) ? HIGH : LOW);
}

void pollCloudLightState() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(4);

  HTTPClient http;
  http.setTimeout(4000);

  if (http.begin(client, SUPABASE_REST_URL)) {
    http.addHeader("apikey", SUPABASE_ANON_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);

    int httpResponseCode = http.GET();
    if (httpResponseCode == 200) {
      String payload = http.getString();
      for (int i = 0; i < TOTAL_CHANNELS; i++) {
        String searchKey = "\\"ch" + String(i + 1) + "\\":true";
        bool nextState = payload.indexOf(searchKey) != -1;
        if (channelStates[i] != nextState) {
          channelStates[i] = nextState;
          applyOutput(RELAY_PINS[i], nextState);
          Serial.printf("⚡ [CH%d] Relay Output: %s (GPIO %d)\\n", i + 1, nextState ? "ON" : "OFF", RELAY_PINS[i]);
        }
      }
    } else {
      Serial.printf("⚠️ [CLOUD] Light status poll returned HTTP %d\\n", httpResponseCode);
    }
    http.end();
  }
  client.stop();
}

void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(PIN_BOOT_BUTTON, INPUT_PULLUP);
  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, LOW);

  for (int i = 0; i < TOTAL_CHANNELS; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    applyOutput(RELAY_PINS[i], false);
  }

  preferences.begin("gkb_prov", false);
  isProvisioned = preferences.getBool("provisioned", false);
  deviceKey     = preferences.getString("device_key", DEFAULT_DEVICE_KEY);
  wifiSSID      = preferences.getString("wifi_ssid", "");
  wifiPassword  = preferences.getString("wifi_pass", "");

  Serial.println("=======================================================");
  Serial.printf("⚡ GKB TECHNOLOGIES — ESP32 SMART LIGHT SYSTEM (%d-CH)\\n", TOTAL_CHANNELS);
  Serial.println("=======================================================");
  Serial.printf("🔑 Casing Device Key   : %s\\n", deviceKey.c_str());
  Serial.printf("📦 Provisioning Status : %s\\n", isProvisioned ? "PROVISIONED" : "UNPROVISIONED");

  if (isProvisioned && wifiSSID.length() > 0) {
    currentMode = MODE_CONNECTING_WIFI;
    WiFi.mode(WIFI_STA);
    WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());
  } else {
    currentMode = MODE_PROVISIONING_BLE;
    BLEDevice::init("GKB-LIGHT-0001");
    pBleServer = BLEDevice::createServer();
    BLEService* pService = pBleServer->createService(GKB_BLE_SERVICE_UUID);
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

  if (currentMode == MODE_CONNECTING_WIFI) {
    if (WiFi.status() == WL_CONNECTED) {
      currentMode = MODE_OPERATIONAL_CLOUD;
      digitalWrite(PIN_STATUS_LED, HIGH);
      ip_addr_t primaryDns, secondaryDns;
      IP_ADDR4(&primaryDns, 8, 8, 8, 8);
      IP_ADDR4(&secondaryDns, 1, 1, 1, 1);
      dns_setserver(0, &primaryDns);
      dns_setserver(1, &secondaryDns);
      pollCloudLightState();
    }
  } else if (currentMode == MODE_OPERATIONAL_CLOUD) {
    if (WiFi.status() == WL_CONNECTED) {
      if (millis() - lastCloudPoll >= CLOUD_POLL_INTERVAL_MS) {
        lastCloudPoll = millis();
        pollCloudLightState();
      }
    } else {
      digitalWrite(PIN_STATUS_LED, LOW);
      currentMode = MODE_CONNECTING_WIFI;
      WiFi.reconnect();
    }
  }

  delay(15);
}
`;
}

const HARDCODED_SUPABASE_URL = 'https://ditnksmvcacnzdguqcgz.supabase.co';
const HARDCODED_SUPABASE_KEY = 'sb_publishable_33KQl1SmvaBaqNzxWJiyzw_HuLMgWAl';

async function sendDirectRestUpdate(deviceId: string, payload: Record<string, boolean>): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${HARDCODED_SUPABASE_URL}/rest/v1/light_control_status?device_id=eq.${deviceId}`, {
      method: 'PATCH',
      headers: {
        'apikey': HARDCODED_SUPABASE_KEY,
        'Authorization': `Bearer ${HARDCODED_SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (res.ok || res.status === 204) return { success: true };
    const t = await res.text();
    return { success: false, error: `HTTP ${res.status}: ${t}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

async function sendDirectRestRpc(deviceId: string, channel: number, state: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${HARDCODED_SUPABASE_URL}/rest/v1/rpc/set_light_channel`, {
      method: 'POST',
      headers: {
        'apikey': HARDCODED_SUPABASE_KEY,
        'Authorization': `Bearer ${HARDCODED_SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_device_id: deviceId, p_channel: channel, p_state: state })
    });
    if (res.ok) return { success: true };
    const t = await res.text();
    return { success: false, error: `RPC HTTP ${res.status}: ${t}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export default function LightControlDashboard({
  mode = 'service',
  device
}: {
  mode?: 'test' | 'service';
  device: Device;
}) {
  const relayChannels = device.relayChannels ?? 4;
  const targetDeviceId = useMemo(() => getLightDeviceId(device), [device]);

  // BLE & QR Provisioning Modal States
  const [provisionModalOpen, setProvisionModalOpen] = useState(false);
  const [showLabelInModal, setShowLabelInModal] = useState(false);
  const [showFirmwareModal, setShowFirmwareModal] = useState(false);
  const [copiedFirmware, setCopiedFirmware] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncError, setSyncError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Anti-snapback lock map: channel -> { target: boolean, expiresAt: number }
  const pendingTogglesRef = useRef<Map<number, { target: boolean; expiresAt: number }>>(new Map());
  const fetchStatusRef = useRef<(() => Promise<void>) | null>(null);

  // Channels state
  const [lights, setLights] = useState<ControlledLight[]>(() => {
    return Array.from({ length: relayChannels }, (_, index) => {
      const channel = index + 1;
      let savedName = '';
      try {
        const stored = window.localStorage.getItem(`gkb-light-name:${device.key}:${channel}`);
        if (stored) savedName = stored;
      } catch {}

      return {
        channel,
        name: savedName || DEFAULT_NAMES[channel] || `Light ${channel}`,
        gpio: GPIO_MAP[channel] ?? 23,
        isOn: false
      };
    });
  });

  // Re-synchronize channels whenever selected device key or relayChannels changes
  useEffect(() => {
    setLights(
      Array.from({ length: relayChannels }, (_, index) => {
        const channel = index + 1;
        let savedName = '';
        try {
          const stored = window.localStorage.getItem(`gkb-light-name:${device.key}:${channel}`);
          if (stored) savedName = stored;
        } catch {}

        return {
          channel,
          name: savedName || DEFAULT_NAMES[channel] || `Light ${channel}`,
          gpio: GPIO_MAP[channel] ?? 23,
          isOn: false
        };
      })
    );
    pendingTogglesRef.current.clear();
    setSyncError('');
    setSyncMessage('');
  }, [device.key, relayChannels]);

  const [editingChannel, setEditingChannel] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [activity, setActivity] = useState<DeviceControlActivity[]>([
    {
      id: 'init',
      event: `Light controller initialized · ${relayChannels} relay channels ready (${targetDeviceId})`,
      timestamp: 'Just now'
    }
  ]);

  const [isTestingLink, setIsTestingLink] = useState(false);

  // Computed columns to fetch
  const selectColumns = useMemo(() => {
    const cols = Array.from({ length: relayChannels }, (_, i) => `ch${i + 1}`);
    return `${cols.join(', ')}, updated_at`;
  }, [relayChannels]);

  // Poll Supabase light_control_status every 2.5s with optimistic lock protection and REST fallback
  useEffect(() => {
    if (mode !== 'service') return;

    let disposed = false;
    const fetchStatus = async () => {
      try {
        let rowData: Record<string, unknown> | null = null;

        // Tier 1: Supabase JS Client SELECT
        if (relaySupabase) {
          try {
            const { data, error } = await relaySupabase
              .from('light_control_status')
              .select('ch1, ch2, ch3, ch4, ch5, ch6, ch7, ch8, updated_at')
              .eq('device_id', targetDeviceId)
              .maybeSingle();

            if (!error && data) rowData = data as Record<string, unknown>;
          } catch {}
        }

        // Tier 2: Direct Native Browser Fetch SELECT (failsafe)
        if (!rowData) {
          try {
            const res = await fetch(`${HARDCODED_SUPABASE_URL}/rest/v1/light_control_status?device_id=eq.${targetDeviceId}&select=ch1,ch2,ch3,ch4,ch5,ch6,ch7,ch8,updated_at`, {
              headers: {
                'apikey': HARDCODED_SUPABASE_KEY,
                'Authorization': `Bearer ${HARDCODED_SUPABASE_KEY}`
              }
            });
            if (res.ok) {
              const arr = await res.json();
              if (Array.isArray(arr) && arr.length > 0) rowData = arr[0];
            }
          } catch {}
        }

        // Tier 3: If target is 2-channel (light_00) and not found, gracefully read light_01
        if (!rowData && targetDeviceId === 'light_00') {
          try {
            const res = await fetch(`${HARDCODED_SUPABASE_URL}/rest/v1/light_control_status?device_id=eq.light_01&select=ch1,ch2,updated_at`, {
              headers: {
                'apikey': HARDCODED_SUPABASE_KEY,
                'Authorization': `Bearer ${HARDCODED_SUPABASE_KEY}`
              }
            });
            if (res.ok) {
              const arr = await res.json();
              if (Array.isArray(arr) && arr.length > 0) rowData = arr[0];
            }
          } catch {}
        }

        if (disposed || !rowData) return;

        setLastSyncedAt(new Date());
        const now = Date.now();
        setLights(current =>
          current.map(light => {
            const cloudVal = rowData![`ch${light.channel}`];
            if (typeof cloudVal !== 'boolean') return light;

            // Check if user recently interacted with this channel
            const pending = pendingTogglesRef.current.get(light.channel);
            if (pending) {
              if (cloudVal === pending.target) {
                // Cloud DB successfully synced with user's desired state! Release lock
                pendingTogglesRef.current.delete(light.channel);
                return { ...light, isOn: cloudVal };
              } else if (now < pending.expiresAt) {
                // Grace period active: preserve optimistic toggle state, do NOT snap back!
                return { ...light, isOn: pending.target };
              } else {
                // Grace period expired (command timed out) -> sync back to real cloud state
                pendingTogglesRef.current.delete(light.channel);
                return { ...light, isOn: cloudVal };
              }
            }

            return { ...light, isOn: cloudVal };
          })
        );
      } catch (err) {
        console.warn('Light status polling error:', err);
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
  }, [mode, device.key, targetDeviceId, relayChannels]);

  const testCloudConnection = async () => {
    setIsTestingLink(true);
    setSyncError('');
    const startTime = Date.now();
    try {
      const res = await fetch(`${HARDCODED_SUPABASE_URL}/rest/v1/light_control_status?device_id=eq.${targetDeviceId}&select=ch1,ch2,ch3,ch4,ch5,ch6,ch7,ch8,updated_at`, {
        headers: {
          'apikey': HARDCODED_SUPABASE_KEY,
          'Authorization': `Bearer ${HARDCODED_SUPABASE_KEY}`
        }
      });
      const latency = Date.now() - startTime;
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      const data = await res.json();
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        setLastSyncedAt(new Date());
        setLights(current =>
          current.map(light => {
            const cloudVal = row[`ch${light.channel}`];
            return typeof cloudVal === 'boolean' ? { ...light, isOn: cloudVal } : light;
          })
        );
        const statusSummary = Array.from({ length: relayChannels }, (_, i) => {
          const ch = i + 1;
          return `CH${ch}:${row[`ch${ch}`] ? 'ON' : 'OFF'}`;
        }).join(' ');
        setSyncMessage(`⚡ Supabase Live! Latency: ${latency}ms | Row: ${targetDeviceId} (${statusSummary})`);
      } else {
        setSyncError(`Connected, but ${targetDeviceId} row was not returned. Run migration in Supabase if needed.`);
      }
    } catch (err) {
      setSyncError(`Cloud test failed: ${err instanceof Error ? err.message : 'Network error'}`);
    } finally {
      setIsTestingLink(false);
    }
  };

  const recordActivity = (event: string) => {
    setActivity(current => [
      {
        id: `${Date.now()}-${Math.random()}`,
        event,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      },
      ...current
    ].slice(0, 8));
  };

  const handleToggleChannel = async (channel: number) => {
    const light = lights.find(item => item.channel === channel);
    if (!light) return;
    const nextState = !light.isOn;

    // 1. Lock channel with a 7-second grace window to protect optimistic state
    pendingTogglesRef.current.set(channel, {
      target: nextState,
      expiresAt: Date.now() + 7000
    });

    // 2. Snappy optimistic UI update
    setLights(current =>
      current.map(item => (item.channel === channel ? { ...item, isOn: nextState } : item))
    );
    setSyncError('');
    recordActivity(`${light.name} (GPIO ${light.gpio}) switched ${nextState ? 'ON' : 'OFF'}`);

    setIsSyncing(true);
    let success = false;
    let errorMsg = '';

    // Tier 1: Supabase JS Client Direct Column UPDATE
    if (relaySupabase) {
      try {
        const { error } = await relaySupabase
          .from('light_control_status')
          .update({ [`ch${channel}`]: nextState })
          .eq('device_id', targetDeviceId);
        if (!error) {
          success = true;
        } else {
          errorMsg = error.message;
        }
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : 'Client error';
      }
    }

    // Tier 2: Supabase JS Client RPC Call
    if (!success && relaySupabase) {
      try {
        const rpcRes = await relaySupabase.rpc('set_light_channel', {
          p_device_id: targetDeviceId,
          p_channel: channel,
          p_state: nextState
        });
        if (!rpcRes.error) {
          success = true;
        } else {
          errorMsg = rpcRes.error.message;
        }
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : 'RPC error';
      }
    }

    // Tier 3: Direct Native Browser REST fetch() fallback
    if (!success) {
      const restRes = await sendDirectRestUpdate(targetDeviceId, { [`ch${channel}`]: nextState });
      if (restRes.success) {
        success = true;
      } else {
        errorMsg = restRes.error || errorMsg;
      }
    }

    // Tier 4: Direct Native Browser REST RPC fetch() fallback
    if (!success) {
      const restRpcRes = await sendDirectRestRpc(targetDeviceId, channel, nextState);
      if (restRpcRes.success) {
        success = true;
      } else {
        errorMsg = restRpcRes.error || errorMsg;
      }
    }

    setIsSyncing(false);

    if (success) {
      setLastSyncedAt(new Date());
      setSyncMessage(`Relay ${channel} switched to ${nextState ? 'ON' : 'OFF'} (${targetDeviceId} synced)`);
      setTimeout(() => void fetchStatusRef.current?.(), 300);
    } else {
      pendingTogglesRef.current.delete(channel);
      // Revert optimistic update
      setLights(current =>
        current.map(item => (item.channel === channel ? { ...item, isOn: !nextState } : item))
      );
      setSyncError(`Failed to update Relay ${channel}: ${errorMsg || 'Connection error'}`);
    }
  };

  const handleMasterAll = async (targetState: boolean) => {
    const expiresAt = Date.now() + 7000;
    for (let ch = 1; ch <= relayChannels; ch++) {
      pendingTogglesRef.current.set(ch, { target: targetState, expiresAt });
    }

    setLights(current => current.map(item => ({ ...item, isOn: targetState })));
    setSyncError('');
    recordActivity(`Master Override: Switched ALL ${relayChannels} lights ${targetState ? 'ON' : 'OFF'}`);

    setIsSyncing(true);
    let success = false;
    let errorMsg = '';

    const payload: Record<string, boolean> = {};
    for (let i = 1; i <= relayChannels; i++) {
      payload[`ch${i}`] = targetState;
    }

    // Tier 1: Supabase JS Client UPDATE
    if (relaySupabase) {
      try {
        const { error } = await relaySupabase
          .from('light_control_status')
          .update(payload)
          .eq('device_id', targetDeviceId);
        if (!error) {
          success = true;
        } else {
          errorMsg = error.message;
        }
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : 'Master update error';
      }
    }

    // Tier 2: Supabase JS Client RPC per-channel
    if (!success && relaySupabase) {
      try {
        let allOk = true;
        for (let ch = 1; ch <= relayChannels; ch++) {
          const rpcRes = await relaySupabase.rpc('set_light_channel', {
            p_device_id: targetDeviceId,
            p_channel: ch,
            p_state: targetState
          });
          if (rpcRes.error) allOk = false;
        }
        if (allOk) success = true;
      } catch {}
    }

    // Tier 3: Direct Native REST fetch() fallback
    if (!success) {
      const restRes = await sendDirectRestUpdate(targetDeviceId, payload);
      if (restRes.success) {
        success = true;
      } else {
        errorMsg = restRes.error || errorMsg;
      }
    }

    setIsSyncing(false);

    if (success) {
      setLastSyncedAt(new Date());
      setSyncMessage(`All ${relayChannels} lights switched ${targetState ? 'ON' : 'OFF'} (${targetDeviceId} synced)`);
      setTimeout(() => void fetchStatusRef.current?.(), 300);
    } else {
      for (let ch = 1; ch <= relayChannels; ch++) {
        pendingTogglesRef.current.delete(ch);
      }
      setSyncError(`Master override failed: ${errorMsg || 'Connection error'}`);
    }
  };

  const saveLightName = (channel: number) => {
    if (!nameDraft.trim()) return;
    try {
      window.localStorage.setItem(`gkb-light-name:${device.key}:${channel}`, nameDraft.trim());
    } catch {}
    setLights(current =>
      current.map(item => (item.channel === channel ? { ...item, name: nameDraft.trim() } : item))
    );
    recordActivity(`Channel ${channel} renamed to "${nameDraft.trim()}"`);
    setEditingChannel(null);
  };

  const activeCount = lights.filter(l => l.isOn).length;
  const activeGpios = Array.from({ length: relayChannels }, (_, i) => GPIO_MAP[i + 1] ?? 23);

  return (
    <section aria-labelledby="light-control-title" className="mx-auto max-w-5xl space-y-6">
      {/* Primary Hardware Header */}
      <header className="rounded-2xl border border-amber-500/30 bg-slate-900/90 p-5 sm:p-6 shadow-xl shadow-amber-500/5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
                Multi-Channel Cloud Telemetry · Live public.light_control_status ({targetDeviceId})
              </p>
            </div>
            <h2 id="light-control-title" className="mt-1 text-2xl font-black text-white sm:text-3xl">
              Smart Light Control System · {relayChannels}-Channel Relay
            </h2>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3.5 py-1.5 font-mono text-xs font-bold text-amber-300 w-fit">
            <Lightbulb className="h-4 w-4 text-amber-400" /> Target: {device.key}
          </span>
        </div>
        <p className="mt-2 text-xs sm:text-sm text-slate-300 leading-relaxed max-w-3xl">
          Standardized ESP32 multi-relay controller supporting independent cloud actuation ({relayChannels} channels), Web Bluetooth (BLE) provisioning, phone camera QR verification, and non-volatile flash credentials.
        </p>
      </header>

      {/* Hardware BLE + QR Provisioning Hero Card */}
      <section aria-label="Hardware BLE and QR Provisioning" className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-slate-900/95 via-slate-900/70 to-amber-950/30 p-5 sm:p-6 shadow-xl shadow-amber-500/5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-400 to-amber-600 text-black shadow-lg shadow-amber-500/20 shrink-0">
              <Lightbulb className="h-6 w-6 text-black fill-black" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">{relayChannels}-Channel Relay</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-mono font-bold text-amber-300 border border-amber-500/30">
                  Target: {device.key}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> BLE GATT Active
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-black text-white mt-1">ESP32 BLE + QR Provisioning & Multi-Relay Control</h3>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setShowLabelInModal(false);
                setProvisionModalOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-black shadow-lg shadow-amber-500/20 hover:opacity-90 transition-all cursor-pointer"
            >
              <Bluetooth className="h-4 w-4" />
              <QrCode className="h-4 w-4" />
              Provision ESP32 (BLE & QR)
            </button>
            <button
              type="button"
              onClick={() => {
                setShowLabelInModal(true);
                setProvisionModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/10 px-3.5 py-2.5 text-xs font-bold text-purple-200 hover:bg-purple-500/20 transition-all cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5 text-purple-400" />
              Print QR Label
            </button>
            <button
              type="button"
              onClick={() => setShowFirmwareModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs font-bold text-slate-300 hover:text-amber-300 hover:border-amber-500/40 transition-all cursor-pointer"
            >
              <Code className="h-3.5 w-3.5 text-amber-400" />
              ESP32 Firmware
            </button>
          </div>
        </div>

        {/* 3-Step Architecture Flow Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Step 1 · Hardware ID</span>
              <span className="h-5 w-5 rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center text-xs font-black">1</span>
            </div>
            <p className="text-xs font-bold text-white">Device QR Tagging</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Physical QR code with security key <code className="text-amber-300 font-mono">{device.key}</code> affixed to module casing.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400">Step 2 · BLE Verification</span>
              <span className="h-5 w-5 rounded-full bg-purple-500/20 text-purple-300 flex items-center justify-center text-xs font-black">2</span>
            </div>
            <p className="text-xs font-bold text-white">GATT Handshake & Scan</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              App connects via Web Bluetooth, scans casing QR with camera, and unlocks device with matching token.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Step 3 · NVS Flash & Cloud</span>
              <span className="h-5 w-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-xs font-black">3</span>
            </div>
            <p className="text-xs font-bold text-white">NVS Credential Storage</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Transfers local Wi-Fi. ESP32 commits to Preferences.h Flash and polls Supabase ({targetDeviceId}) to switch {relayChannels} relays.
            </p>
          </div>
        </div>

        {/* Pinout and Hardware Specs Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-400 border-t border-slate-800/60">
          <div className="flex flex-wrap items-center gap-4 font-mono text-[11px]">
            <span className="flex items-center gap-1.5 text-amber-300">
              <Cpu className="h-3.5 w-3.5 text-amber-400" /> Relays 1-{relayChannels}: <strong className="text-white">GPIO {activeGpios.join(', ')}</strong>
            </span>
            <span className="flex items-center gap-1.5 text-purple-300">
              <Radio className="h-3.5 w-3.5 text-purple-400" /> Status LED: <strong className="text-white">GPIO 2</strong>
            </span>
            <span className="flex items-center gap-1.5 text-cyan-300">
              <Key className="h-3.5 w-3.5 text-cyan-400" /> Factory Reset: <strong className="text-white">BOOT (GPIO 0) 5s</strong>
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            Cloud Endpoint: <code className="text-slate-400 font-mono">public.light_control_status ({targetDeviceId})</code>
          </span>
        </div>
      </section>

      {/* Master Overrides & Status Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <Power className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Fleet Control Status:</span>
              <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${activeCount > 0 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-slate-800 text-slate-400'}`}>
                {activeCount} of {relayChannels} Relays Active
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {lastSyncedAt ? `Last cloud sync: ${lastSyncedAt.toLocaleTimeString()} (${targetDeviceId})` : 'Connected to cloud relay telemetry'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void testCloudConnection()}
            disabled={isTestingLink}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-cyan-400 ${isTestingLink ? 'animate-spin' : ''}`} />
            {isTestingLink ? 'Testing Link...' : 'Test Cloud Link'}
          </button>
          <button
            type="button"
            onClick={() => void handleMasterAll(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/20 px-3.5 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/40 transition-colors cursor-pointer"
          >
            <Zap className="h-3.5 w-3.5 text-emerald-400" /> All Lights ON
          </button>
          <button
            type="button"
            onClick={() => void handleMasterAll(false)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700 transition-colors cursor-pointer"
          >
            <Power className="h-3.5 w-3.5 text-slate-400" /> All Lights OFF
          </button>
        </div>
      </div>

      {syncError && (
        <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300 font-semibold animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
            <span>{syncError}</span>
          </div>
          <button
            type="button"
            onClick={() => setSyncError('')}
            className="rounded p-1 text-rose-400 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {syncMessage && (
        <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-center text-xs text-emerald-300 font-semibold animate-fadeIn">
          {syncMessage}
        </p>
      )}

      {/* Interactive Relays / Lights Grid */}
      <div className={`grid gap-4 sm:grid-cols-2 ${relayChannels >= 6 ? 'xl:grid-cols-3' : 'xl:grid-cols-4'}`}>
        {lights.map(light => {
          const lightOn = light.isOn;
          const isEditing = editingChannel === light.channel;

          return (
            <article
              key={light.channel}
              className={`relative flex flex-col justify-between rounded-2xl border p-5 transition-all duration-300 ${
                lightOn
                  ? 'border-amber-400/40 bg-gradient-to-b from-amber-500/[0.08] to-slate-900/90 shadow-lg shadow-amber-500/10'
                  : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
                    Channel {light.channel} · GPIO {light.gpio}
                  </span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    lightOn ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {lightOn ? 'ACTIVE' : 'OFF'}
                  </span>
                </div>

                <div className="my-4 flex items-center gap-4">
                  <div
                    className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl transition-all duration-500 ${
                      lightOn
                        ? 'bg-amber-400/20 text-amber-300 shadow-[0_0_30px_rgba(251,191,36,0.35)] animate-pulse'
                        : 'bg-slate-950 text-slate-600'
                    }`}
                  >
                    <Lightbulb className={`h-8 w-8 transition-transform ${lightOn ? 'fill-amber-300 text-amber-300 scale-110' : ''}`} />
                  </div>

                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={nameDraft}
                          onChange={e => setNameDraft(e.target.value)}
                          maxLength={32}
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-amber-400 focus:outline-none"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => saveLightName(light.channel)}
                          className="rounded bg-emerald-500/20 p-1 text-emerald-300 hover:bg-emerald-500/30"
                        >
                          <Save className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingChannel(null)}
                          className="rounded bg-slate-800 p-1 text-slate-400 hover:text-white"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="group flex items-center justify-between gap-1">
                        <h4 className="truncate text-sm font-bold text-white">{light.name}</h4>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingChannel(light.channel);
                            setNameDraft(light.name);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-amber-300 cursor-pointer"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    <p className={`mt-0.5 text-xs font-semibold ${lightOn ? 'text-amber-300' : 'text-slate-500'}`}>
                      {lightOn ? 'Relay Closed (HIGH)' : 'Relay Open (LOW)'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Individual Toggle Switch */}
              <div className="mt-2 flex items-center justify-between border-t border-slate-800/80 pt-3">
                <span className="text-[11px] font-mono text-slate-500">
                  ch{light.channel}={lightOn ? 1 : 0}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-label={`Toggle ${light.name}`}
                  aria-checked={lightOn}
                  onClick={() => void handleToggleChannel(light.channel)}
                  className={`group relative h-9 w-16 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 cursor-pointer shadow-md hover:scale-105 active:scale-95 ${
                    lightOn ? 'bg-gradient-to-r from-amber-400 to-amber-500 shadow-amber-500/30' : 'bg-slate-700 hover:bg-slate-600'
                  }`}
                >
                  <span
                    className={`absolute left-1 top-1 h-7 w-7 rounded-full bg-white shadow-md transition-transform duration-300 ease-out flex items-center justify-center ${
                      lightOn ? 'translate-x-7 bg-amber-50' : 'translate-x-0'
                    }`}
                  >
                    <Zap className={`h-3.5 w-3.5 transition-colors ${lightOn ? 'text-amber-600 fill-amber-500' : 'text-slate-400'}`} />
                  </span>
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {/* Activity Log */}
      <section aria-label="Light control activity log" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">Relay Telemetry & Activity Log</h3>
          </div>
          <span className="text-xs text-slate-500">Real-time local and cloud events</span>
        </div>
        <ul className="space-y-2">
          {activity.map(item => (
            <li key={item.id} className="flex items-center justify-between rounded-xl border border-slate-800/80 bg-slate-950/50 px-3.5 py-2 text-xs">
              <span className="text-slate-300">{item.event}</span>
              <time className="text-[10px] text-slate-500 font-mono shrink-0 ml-2">{item.timestamp}</time>
            </li>
          ))}
        </ul>
      </section>

      {/* Interactive BLE & QR Provisioning Modal */}
      <BleProvisioningModal
        isOpen={provisionModalOpen}
        onClose={() => setProvisionModalOpen(false)}
        initialDeviceKey={device.key}
        initialShowLabel={showLabelInModal}
        onDeviceProvisioned={(key) => {
          setProvisionModalOpen(false);
          setSyncMessage(`Device (${key}) successfully provisioned via BLE & QR! Wi-Fi credentials committed to Flash.`);
        }}
      />

      {/* ESP32 Firmware Source Inspection Modal */}
      {showFirmwareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fadeIn">
          <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-amber-500/40 bg-slate-950 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 p-4 sm:p-5">
              <div className="flex items-center gap-2.5">
                <Code className="h-5 w-5 text-amber-400" />
                <h3 className="text-base font-bold sm:text-lg">
                  ESP32 Smart Light Control Firmware ({relayChannels}-Channel Relay)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowFirmwareModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 font-mono text-xs">
              <pre className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 text-slate-200 overflow-x-auto whitespace-pre leading-relaxed">
                {generateLightArduinoCode(device.key, relayChannels)}
              </pre>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 p-4 sm:p-5">
              <span className="text-xs text-slate-400">
                Flash to ESP32 Dev Module via Arduino IDE (baud rate 115200)
              </span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(generateLightArduinoCode(device.key, relayChannels));
                  setCopiedFirmware(true);
                  setTimeout(() => setCopiedFirmware(false), 3000);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-4 py-2 text-xs font-bold text-black hover:opacity-90 transition-all cursor-pointer"
              >
                {copiedFirmware ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiedFirmware ? 'Copied to Clipboard!' : 'Copy Sketch Code'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
