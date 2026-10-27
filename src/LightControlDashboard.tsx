import React, { useState, useEffect, useRef } from 'react';
import {
  Lightbulb, Pencil, Save, X, Activity, Wifi, Server,
  Bluetooth, QrCode, Printer, Code, Zap, Check, Copy,
  AlertTriangle, Cpu, Radio, Key, Power, RefreshCw, Layers
} from 'lucide-react';
import { relaySupabase } from './supabase';
import BleProvisioningModal from './BleProvisioningModal';

export type ChannelOption = 2 | 4 | 6 | 8;

export type Device = {
  id: number;
  name: string;
  key: string;
  status: string;
  lastAlert: string;
  project?: string;
  legacyKeys?: string[];
  relayChannels?: ChannelOption;
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
  5: 18, // Relay 5 -> GPIO 18 (for 6/8 ch)
  6: 5,  // Relay 6 -> GPIO 5
  7: 4,  // Relay 7 -> GPIO 4
  8: 15  // Relay 8 -> GPIO 15
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

function generateLightArduinoCode(deviceKey: string = 'GKB-LIGHT-0001V1', channels: number = 4): string {
  const targetId = channels <= 4 ? 'light_01' : (channels === 6 ? 'light_02' : 'light_03');
  return `/*
 * =========================================================================================
 * GKB TECHNOLOGIES — ESP32 UNIVERSAL SMART LIGHT CONTROL SYSTEM (2 / 4 / 6 / 8 CHANNELS)
 * Single Shared Firmware for Multi-Channel Relay Hardware Boards
 * =========================================================================================
 * Target Board       : ESP32 Dev Module / NodeMCU-32S / ESP-WROOM-32
 * Device Token Model : Hardware Casing Token (Default: ${deviceKey})
 * Active Variant     : ${channels}-Channel Relay Board (Active: Relays 1 to ${channels})
 * Standard Pin Map   :
 *   - Channel 1 : GPIO 23 (Relay 1 - Living Room / Zone 1)
 *   - Channel 2 : GPIO 22 (Relay 2 - Dining Room / Zone 2)
 *   - Channel 3 : GPIO 21 (Relay 3 - Kitchen / Zone 3)       [4, 6, 8-Ch]
 *   - Channel 4 : GPIO 19 (Relay 4 - Porch / Zone 4)         [4, 6, 8-Ch]
 *   - Channel 5 : GPIO 18 (Relay 5 - Master Bed / Zone 5)    [6, 8-Ch]
 *   - Channel 6 : GPIO 5  (Relay 6 - Guest Bed / Zone 6)     [6, 8-Ch]
 *   - Channel 7 : GPIO 4  (Relay 7 - Garden / Zone 7)        [8-Ch]
 *   - Channel 8 : GPIO 15 (Relay 8 - Security Flood / Zone 8)[8-Ch]
 * Diagnostic LED     : Onboard Blue LED (GPIO 2)
 * Factory Reset      : Onboard BOOT Button (GPIO 0, Hold for 5s)
 * Storage Engine     : Non-Volatile Flash Partition (ESP32 Preferences.h / NVS)
 * Connectivity       : Dual-Mode (BLE 4.2 GATT Provisioning + 2.4GHz Wi-Fi Cloud Polling)
 * Cloud Backend      : Supabase public.light_control_status (Target: ${targetId})
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

// ================= HARDWARE PINOUT ASSIGNMENTS (ALL 8 CHANNELS) =================
const int RELAY_PINS[8] = { 23, 22, 21, 19, 18, 5, 4, 15 };
const char* CHANNEL_KEYS[8] = { "ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "ch7", "ch8" };

#define PIN_STATUS_LED        2    // ESP32 GPIO 2  -> Onboard Blue LED
#define PIN_BOOT_BUTTON       0    // ESP32 GPIO 0  -> BOOT Button (Factory Reset)
#define RELAY_ACTIVE_HIGH     true

// ================= DEVICE IDENTITY & DEFAULT CHANNEL COUNT =================
#define DEFAULT_DEVICE_KEY    "${deviceKey}"
#define DEFAULT_CHANNEL_COUNT ${channels} // 2, 4, 6, or 8 (Configurable over BLE / NVS)

// ================= BLE GATT SPECIFICATIONS =================
#define GKB_BLE_SERVICE_UUID  "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define GKB_BLE_CHAR_RX_UUID  "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define GKB_BLE_CHAR_TX_UUID  "beb5483f-36e1-4688-b7f5-ea07361b26a9"

// ================= SUPABASE CLOUD REST SPECIFICATIONS =================
const char* SUPABASE_BASE_URL = "https://ditnksmvcacnzdguqcgz.supabase.co/rest/v1/light_control_status";
const char* SUPABASE_ANON_KEY = "sb_publishable_33KQl1SmvaBaqNzxWJiyzw_HuLMgWAl";

Preferences preferences;

enum DeviceOperatingMode {
  MODE_PROVISIONING_BLE,
  MODE_CONNECTING_WIFI,
  MODE_OPERATIONAL_CLOUD
};

DeviceOperatingMode currentMode = MODE_PROVISIONING_BLE;

String  deviceKey          = DEFAULT_DEVICE_KEY;
String  wifiSSID           = "";
String  wifiPassword       = "";
bool    isProvisioned      = false;
bool    bleClientConnected = false;
bool    qrAuthenticated    = false;
uint8_t activeChannels     = DEFAULT_CHANNEL_COUNT;
bool    ch_states[8]       = { false, false, false, false, false, false, false, false };

BLEServer*         pBleServer         = nullptr;
BLECharacteristic* pTxCharacteristic = nullptr;

unsigned long lastCloudPollTime    = 0;
const unsigned long CLOUD_POLL_MS  = 2500;
unsigned long bootButtonPressTime  = 0;
bool isBootButtonPressed           = false;
bool pendingReboot                 = false;
unsigned long rebootScheduledAt    = 0;

void loadStoredCredentials();
void saveWiFiCredentials(const String& ssid, const String& pass);
void factoryResetPreferences();
void initBLEProvisioningServer();
void sendBLEResponse(const String& message);
void connectToConfiguredWiFi();
void pollCloudLightState();
void applyRelayOutput(int pin, bool state);
void reconfigureRelayPins();
String getCloudRestUrl();
String extractJsonField(const String& json, const String& key);

class GkbLightServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    bleClientConnected = true;
    qrAuthenticated    = false;
    Serial.println("📱 [BLE] Client Connected!");
    digitalWrite(PIN_STATUS_LED, HIGH);
  }

  void onDisconnect(BLEServer* pServer) override {
    bleClientConnected = false;
    qrAuthenticated    = false;
    Serial.println("📱 [BLE] Client Disconnected. Re-advertising...");
    digitalWrite(PIN_STATUS_LED, LOW);
    if (currentMode == MODE_PROVISIONING_BLE && pBleServer) {
      pBleServer->startAdvertising();
    }
  }
};

class GkbLightCharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    String rxValue = pCharacteristic->getValue().c_str();
    rxValue.trim();
    if (rxValue.length() == 0) return;

    if (rxValue.startsWith("VERIFY:")) {
      String submittedKey = rxValue.substring(7);
      submittedKey.trim();
      bool isMatch = submittedKey.equalsIgnoreCase(deviceKey) ||
                     submittedKey.equalsIgnoreCase(DEFAULT_DEVICE_KEY) ||
                     submittedKey.equalsIgnoreCase("GKB-LIGHT-0001") ||
                     submittedKey.equalsIgnoreCase("GKB-RELAY-0001");
      if (isMatch) {
        qrAuthenticated = true;
        sendBLEResponse("AUTH_SUCCESS:DEVICE_UNLOCKED");
      } else {
        qrAuthenticated = false;
        sendBLEResponse("AUTH_FAILED:INVALID_KEY");
      }
      return;
    }

    if (rxValue.startsWith("SET_CHANNELS:")) {
      if (!qrAuthenticated) {
        sendBLEResponse("AUTH_REQUIRED:SCAN_QR_FIRST");
        return;
      }
      int count = rxValue.substring(13).toInt();
      if (count == 2 || count == 4 || count == 6 || count == 8) {
        activeChannels = (uint8_t)count;
        preferences.begin("gkb_prov", false);
        preferences.putUChar("ch_count", activeChannels);
        preferences.end();
        reconfigureRelayPins();
        sendBLEResponse("CHANNELS_SAVED:" + String(activeChannels));
      } else {
        sendBLEResponse("CONFIG_ERROR:INVALID_CHANNELS");
      }
      return;
    }

    if (rxValue.startsWith("SET_WIFI:")) {
      if (!qrAuthenticated) {
        sendBLEResponse("AUTH_REQUIRED:SCAN_QR_FIRST");
        return;
      }
      String jsonPayload = rxValue.substring(9);
      String incomingSSID = extractJsonField(jsonPayload, "ssid");
      String incomingPass = extractJsonField(jsonPayload, "pass");
      if (incomingSSID.length() == 0) {
        sendBLEResponse("CONFIG_ERROR:EMPTY_SSID");
        return;
      }
      saveWiFiCredentials(incomingSSID, incomingPass);
      sendBLEResponse("CONFIG_SAVED:REBOOTING");
      pendingReboot = true;
      rebootScheduledAt = millis() + 2500;
      return;
    }

    if (rxValue == "GET_STATUS") {
      String statusMsg = "STATUS:KEY=" + deviceKey + ";CHANNELS=" + String(activeChannels);
      sendBLEResponse(statusMsg);
      return;
    }

    if (rxValue == "FACTORY_RESET") {
      sendBLEResponse("RESET_CONFIRMED:REBOOTING");
      factoryResetPreferences();
      pendingReboot = true;
      rebootScheduledAt = millis() + 1500;
      return;
    }
  }
};

void reconfigureRelayPins() {
  for (int i = 0; i < 8; i++) {
    if (i < activeChannels) {
      pinMode(RELAY_PINS[i], OUTPUT);
      applyRelayOutput(RELAY_PINS[i], ch_states[i]);
    } else {
      pinMode(RELAY_PINS[i], INPUT);
    }
  }
}

String getCloudRestUrl() {
  String devId = (activeChannels <= 4) ? "light_01" : ((activeChannels == 6) ? "light_02" : "light_03");
  return String(SUPABASE_BASE_URL) + "?device_id=eq." + devId + "&select=ch1,ch2,ch3,ch4,ch5,ch6,ch7,ch8";
}

void setup() {
  Serial.begin(115200);
  delay(1200);
  pinMode(PIN_BOOT_BUTTON, INPUT_PULLUP);
  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, LOW);

  loadStoredCredentials();
  reconfigureRelayPins();

  if (isProvisioned && wifiSSID.length() > 0) {
    currentMode = MODE_CONNECTING_WIFI;
    connectToConfiguredWiFi();
  } else {
    currentMode = MODE_PROVISIONING_BLE;
    initBLEProvisioningServer();
  }
}

void loop() {
  if (pendingReboot && millis() >= rebootScheduledAt) ESP.restart();

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

  if (currentMode == MODE_PROVISIONING_BLE) {
    static unsigned long lastBlink = 0;
    if (!bleClientConnected && millis() - lastBlink > 700) {
      lastBlink = millis();
      digitalWrite(PIN_STATUS_LED, !digitalRead(PIN_STATUS_LED));
    }
  } else if (currentMode == MODE_OPERATIONAL_CLOUD) {
    digitalWrite(PIN_STATUS_LED, HIGH);
    if (WiFi.status() != WL_CONNECTED) {
      WiFi.reconnect();
      delay(1000);
      return;
    }
    if (millis() - lastCloudPollTime >= CLOUD_POLL_MS) {
      lastCloudPollTime = millis();
      pollCloudLightState();
    }
    delay(15);
  }
}

void initBLEProvisioningServer() {
  BLEDevice::init("GKB-LIGHT-0001");
  pBleServer = BLEDevice::createServer();
  pBleServer->setCallbacks(new GkbLightServerCallbacks());
  BLEService* pService = pBleServer->createService(GKB_BLE_SERVICE_UUID);

  BLECharacteristic* pRxCharacteristic = pService->createCharacteristic(
    GKB_BLE_CHAR_RX_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  pRxCharacteristic->setCallbacks(new GkbLightCharacteristicCallbacks());

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

void sendBLEResponse(const String& message) {
  if (pTxCharacteristic && bleClientConnected) {
    pTxCharacteristic->setValue(message.c_str());
    pTxCharacteristic->notify();
  }
}

void loadStoredCredentials() {
  preferences.begin("gkb_prov", false);
  deviceKey = preferences.getString("dev_key", DEFAULT_DEVICE_KEY);
  isProvisioned = preferences.getBool("is_prov", false);
  wifiSSID = preferences.getString("wifi_ssid", "");
  wifiPassword = preferences.getString("wifi_pass", "");
  activeChannels = preferences.getUChar("ch_count", DEFAULT_CHANNEL_COUNT);
  if (activeChannels != 2 && activeChannels != 4 && activeChannels != 6 && activeChannels != 8) {
    activeChannels = DEFAULT_CHANNEL_COUNT;
  }
  preferences.end();
}

void saveWiFiCredentials(const String& ssid, const String& pass) {
  preferences.begin("gkb_prov", false);
  preferences.putString("wifi_ssid", ssid);
  preferences.putString("wifi_pass", pass);
  preferences.putBool("is_prov", true);
  preferences.end();
  wifiSSID = ssid;
  wifiPassword = pass;
  isProvisioned = true;
}

void factoryResetPreferences() {
  preferences.begin("gkb_prov", false);
  preferences.clear();
  preferences.putString("dev_key", DEFAULT_DEVICE_KEY);
  preferences.putUChar("ch_count", DEFAULT_CHANNEL_COUNT);
  preferences.end();
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

    // Reliable Google and Cloudflare DNS
    ip_addr_t d1, d2;
    IPAddress dns1(8, 8, 8, 8);
    IPAddress dns2(1, 1, 1, 1);
    d1.type = IPADDR_TYPE_V4;
    d1.u_addr.ip4.addr = static_cast<uint32_t>(dns1);
    d2.type = IPADDR_TYPE_V4;
    d2.u_addr.ip4.addr = static_cast<uint32_t>(dns2);
    dns_setserver(0, &d1);
    dns_setserver(1, &d2);

    lastCloudPollTime = millis();
    delay(300);
    pollCloudLightState();
  } else {
    currentMode = MODE_PROVISIONING_BLE;
    initBLEProvisioningServer();
  }
}

void pollCloudLightState() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(4);
  HTTPClient http;
  http.setTimeout(4000);

  String restUrl = getCloudRestUrl();
  if (http.begin(client, restUrl.c_str())) {
    http.addHeader("apikey", SUPABASE_ANON_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    http.addHeader("Accept", "application/json");

    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK || httpCode == 200) {
      String payload = http.getString();
      for (int i = 0; i < activeChannels; i++) {
        String searchStr = String("\\"") + CHANNEL_KEYS[i] + "\\":true";
        bool next_state = payload.indexOf(searchStr) != -1;
        if (next_state != ch_states[i]) {
          ch_states[i] = next_state;
          applyRelayOutput(RELAY_PINS[i], ch_states[i]);
          Serial.print("⚡ [CH"); Serial.print(i + 1); Serial.print("] Relay Output: ");
          Serial.println(ch_states[i] ? "ON" : "OFF");
        }
      }
    }
    http.end();
  }
  client.stop();
  lastCloudPollTime = millis();
}

void applyRelayOutput(int pin, bool state) {
  if (RELAY_ACTIVE_HIGH) {
    digitalWrite(pin, state ? HIGH : LOW);
  } else {
    digitalWrite(pin, state ? LOW : HIGH);
  }
}

String extractJsonField(const String& json, const String& key) {
  String searchKey = "\\"" + key + "\\":\\"";
  int startIdx = json.indexOf(searchKey);
  if (startIdx == -1) {
    searchKey = "\\"" + key + "\\":";
    startIdx = json.indexOf(searchKey);
    if (startIdx == -1) return "";
    startIdx += searchKey.length();
    int endIdx = json.indexOf(",", startIdx);
    if (endIdx == -1) endIdx = json.indexOf("}", startIdx);
    if (endIdx == -1) return "";
    String result = json.substring(startIdx, endIdx);
    result.trim();
    result.replace("\\"", "");
    return result;
  }
  startIdx += searchKey.length();
  int endIdx = json.indexOf("\\"", startIdx);
  if (endIdx == -1) return "";
  return json.substring(startIdx, endIdx);
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
  // Hardware relay channel configuration (2, 4, 6, 8)
  const [selectedChannels, setSelectedChannels] = useState<ChannelOption>(() => {
    try {
      const stored = window.localStorage.getItem('gkb-light-selected-channels');
      if (stored === '2' || stored === '4' || stored === '6' || stored === '8') {
        return Number(stored) as ChannelOption;
      }
    } catch {}
    return (device.relayChannels as ChannelOption) || 4;
  });

  // Target Supabase cloud row based on active channels:
  // - 2 & 4 channels: light_01
  // - 6 channels: light_02
  // - 8 channels: light_03
  const targetDeviceId = selectedChannels <= 4 ? 'light_01' : (selectedChannels === 6 ? 'light_02' : 'light_03');

  // BLE & QR Provisioning Modal States
  const [provisionModalOpen, setProvisionModalOpen] = useState(false);
  const [showLabelInModal, setShowLabelInModal] = useState(false);
  const [showFirmwareModal, setShowFirmwareModal] = useState(false);
  const [firmwarePreviewChannels, setFirmwarePreviewChannels] = useState<ChannelOption>(selectedChannels);
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
    const count = (() => {
      try {
        const stored = window.localStorage.getItem('gkb-light-selected-channels');
        if (stored === '2' || stored === '4' || stored === '6' || stored === '8') {
          return Number(stored) as ChannelOption;
        }
      } catch {}
      return (device.relayChannels as ChannelOption) || 4;
    })();

    return Array.from({ length: count }, (_, index) => {
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

  const [editingChannel, setEditingChannel] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [activity, setActivity] = useState<DeviceControlActivity[]>([
    {
      id: 'init',
      event: `Light controller initialized · ${selectedChannels} relay channels configured (Unified Firmware)`,
      timestamp: 'Just now'
    }
  ]);

  const [isTestingLink, setIsTestingLink] = useState(false);

  // Switch channel configuration dynamically from dropdown
  const handleChannelChange = (newChannels: ChannelOption) => {
    setSelectedChannels(newChannels);
    setFirmwarePreviewChannels(newChannels);
    try {
      window.localStorage.setItem('gkb-light-selected-channels', String(newChannels));
    } catch {}

    setLights(Array.from({ length: newChannels }, (_, index) => {
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
    }));

    pendingTogglesRef.current.clear();
    setSyncMessage(`⚡ Switched to ${newChannels}-Channel Relay Board · Active: Relays 1 to ${newChannels}`);
    recordActivity(`Hardware variant switched: ${newChannels}-Channel Relay Board configured`);
    setTimeout(() => void fetchStatusRef.current?.(), 100);
  };

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
  }, [mode, device.key, selectedChannels, targetDeviceId]);

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
        const statusSummary = Array.from({ length: selectedChannels }, (_, i) => `CH${i + 1}:${row[`ch${i + 1}`] ? 'ON' : 'OFF'}`).join(' ');
        setSyncMessage(`⚡ Supabase Live! Latency: ${latency}ms | Target: ${targetDeviceId} (${selectedChannels} Channels: ${statusSummary})`);
      } else {
        setSyncError(`Connected, but ${targetDeviceId} row was not returned.`);
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
    for (let ch = 1; ch <= selectedChannels; ch++) {
      pendingTogglesRef.current.set(ch, { target: targetState, expiresAt });
    }

    setLights(current => current.map(item => ({ ...item, isOn: targetState })));
    setSyncError('');
    recordActivity(`Master Override: Switched ALL ${selectedChannels} lights ${targetState ? 'ON' : 'OFF'}`);

    setIsSyncing(true);
    let success = false;
    let errorMsg = '';

    const payload: Record<string, boolean> = {};
    for (let i = 1; i <= selectedChannels; i++) {
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
        for (let ch = 1; ch <= selectedChannels; ch++) {
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
      setSyncMessage(`Master command applied: All ${selectedChannels} channels ${targetState ? 'ON' : 'OFF'} on ${targetDeviceId}`);
      setTimeout(() => void fetchStatusRef.current?.(), 300);
    } else {
      for (let ch = 1; ch <= selectedChannels; ch++) {
        pendingTogglesRef.current.delete(ch);
      }
      setSyncError(`Master sync error: ${errorMsg || 'Connection error'}`);
    }
  };

  const saveLightName = (channel: number) => {
    const nextName = nameDraft.trim() || `Light ${channel}`;
    setLights(current =>
      current.map(item => (item.channel === channel ? { ...item, name: nextName } : item))
    );
    try {
      window.localStorage.setItem(`gkb-light-name:${device.key}:${channel}`, nextName);
    } catch {}
    setEditingChannel(null);
    recordActivity(`Renamed Relay ${channel} to "${nextName}"`);
  };

  const activeCount = lights.filter(l => l.isOn).length;

  return (
    <section aria-labelledby="light-control-title" className="mx-auto max-w-5xl space-y-6">
      {/* Primary Hardware Header */}
      <header className="rounded-2xl border border-amber-500/30 bg-slate-900/90 p-5 sm:p-6 shadow-xl shadow-amber-500/5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
                Multi-Channel Cloud Telemetry · Live public.light_control_status
              </p>
            </div>
            <h2 id="light-control-title" className="mt-1 text-2xl font-black text-white sm:text-3xl">
              Smart Light Control System · {selectedChannels}-Channel Relay
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3.5 py-1.5 font-mono text-xs font-bold text-amber-300 w-fit">
              <Lightbulb className="h-4 w-4 text-amber-400" /> Target: {device.key}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-xs font-bold text-cyan-300 w-fit">
              <Layers className="h-3.5 w-3.5 text-cyan-400" /> {selectedChannels} Relays
            </span>
          </div>
        </div>
        <p className="mt-2 text-xs sm:text-sm text-slate-300 leading-relaxed max-w-3xl">
          Standardized ESP32 multi-relay controller supporting independent cloud actuation, Web Bluetooth (BLE) provisioning, phone camera QR verification, and non-volatile flash credentials.
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
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Multi-Channel Relay</span>
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

        {/* Relay Hardware Option Dropdown Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-slate-950/80 p-3.5 shadow-inner">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-amber-300">
                  Relay Hardware Option (Unified Firmware)
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  1 Firmware · 4 Variants
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Select the relay channel board wired to your ESP32 controller:
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="channel-option-dropdown" className="sr-only">Select Relay Hardware Variant</label>
            <select
              id="channel-option-dropdown"
              value={selectedChannels}
              onChange={(e) => handleChannelChange(Number(e.target.value) as ChannelOption)}
              className="w-full sm:w-auto rounded-xl border-2 border-amber-500/60 bg-slate-900 px-3.5 py-2 text-xs font-bold text-amber-200 shadow-md focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 focus:outline-none cursor-pointer"
            >
              <option value={2}>⚡ 2-Channel Relay Board (Relays 1-2 · GPIO 23, 22)</option>
              <option value={4}>⚡ 4-Channel Relay Board (Relays 1-4 · GPIO 23, 22, 21, 19)</option>
              <option value={6}>⚡ 6-Channel Relay Board (Relays 1-6 · GPIO 23, 22, 21, 19, 18, 5)</option>
              <option value={8}>⚡ 8-Channel Relay Board (Relays 1-8 · GPIO 23, 22, 21, 19, 18, 5, 4, 15)</option>
            </select>
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
              Transfers local Wi-Fi. ESP32 commits to Preferences.h Flash and polls Supabase to switch {selectedChannels} relays.
            </p>
          </div>
        </div>

        {/* Pinout and Hardware Specs Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-400 border-t border-slate-800/60">
          <div className="flex flex-wrap items-center gap-4 font-mono text-[11px]">
            <span className="flex items-center gap-1.5 text-amber-300">
              <Cpu className="h-3.5 w-3.5 text-amber-400" /> Relays 1-{selectedChannels}: <strong className="text-white">
                {Array.from({ length: selectedChannels }, (_, i) => `GPIO ${GPIO_MAP[i + 1]}`).join(', ')}
              </strong>
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
                {activeCount} of {selectedChannels} Relays Active
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {lastSyncedAt ? `Last cloud sync: ${lastSyncedAt.toLocaleTimeString()}` : 'Connected to cloud relay telemetry'}
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
        channelVariant={selectedChannels}
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
                <div>
                  <h3 className="text-base font-bold sm:text-lg text-white">
                    ESP32 Universal Multi-Channel Relay Firmware
                  </h3>
                  <p className="text-xs text-slate-400">
                    One single shared firmware codebase for 2, 4, 6, and 8-channel relay boards
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowFirmwareModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Quick Hardware Variant Tabs */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 sm:px-5 py-2.5 bg-slate-900/50">
              <span className="text-xs font-bold text-slate-400 mr-1 flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-amber-400" /> Hardware Preset:
              </span>
              {([2, 4, 6, 8] as ChannelOption[]).map(cnt => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => setFirmwarePreviewChannels(cnt)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    firmwarePreviewChannels === cnt
                      ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-black shadow-md shadow-amber-500/20'
                      : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
                  }`}
                >
                  {cnt}-Channel Board
                </button>
              ))}
              <span className="ml-auto text-[11px] text-amber-300/80 font-mono hidden md:inline">
                Target: {firmwarePreviewChannels <= 4 ? 'light_01' : (firmwarePreviewChannels === 6 ? 'light_02' : 'light_03')}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 font-mono text-xs">
              <pre className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 text-slate-200 overflow-x-auto whitespace-pre leading-relaxed">
                {generateLightArduinoCode(device.key, firmwarePreviewChannels)}
              </pre>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 p-4 sm:p-5">
              <span className="text-xs text-slate-400">
                Flash via Arduino IDE to ESP32 Dev Module (Upload speed 115200) · 1 Sketch Runs All Variants
              </span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(generateLightArduinoCode(device.key, firmwarePreviewChannels));
                  setCopiedFirmware(true);
                  setTimeout(() => setCopiedFirmware(false), 3000);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-4 py-2 text-xs font-bold text-black hover:opacity-90 transition-all cursor-pointer shadow-lg shadow-amber-500/20"
              >
                {copiedFirmware ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiedFirmware ? 'Copied to Clipboard!' : `Copy ${firmwarePreviewChannels}-Channel Sketch Code`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
