import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { relayControlEnabled, relaySupabase, relaySupabaseConfigError } from './supabase';
import BleProvisioningModal from './BleProvisioningModal';
import LightControlDashboard from './LightControlDashboard';
import {
  Cpu, Shield, Wrench, Phone, Mail, Globe,
  User, Lock, LogOut, CheckCircle, AlertTriangle,
  ArrowRight, Sun, Moon, Zap, Wifi, Radio, Key,
  Copy, Download, Code, Check, Printer, Bluetooth, QrCode, X, RefreshCw,
  Layers, Lightbulb, Power, Droplets, Fuel, Gauge, Wind, FlaskConical
} from 'lucide-react';

type UserType = {
  id: string;
  role: 'admin' | 'client';
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  location: string;
};

export type StudentProject =
  | 'relay-test'
  | 'light-control'
  | 'water-tank-monitor'
  | 'fuel-tank-monitor'
  | 'prepaid-energy-meter'
  | 'fan-regulator'
  | 'alcohol-breathalyzer';

export type Device = {
  id: number;
  name: string;
  key: string;
  status: string;
  lastAlert: string;
  project?: StudentProject;
  legacyKeys?: string[];
  relayChannels?: 4 | 6 | 8;
  paused?: boolean;
};

// ================= GKB HARDWARE FLEET =================
const defaultDevices: Device[] = [
  {
    id: 1,
    name: 'ESP32 Smart Relay Pilot (Single Relay)',
    key: 'GKB-SEC-0001',
    legacyKeys: ['GKB-RELAY-0001', 'GKBSEC-00106', 'GKB-SEC-9988'],
    status: 'Verified',
    lastAlert: 'Single Relay Active · BLE & QR Verified · GPIO 23 Cloud Switched',
    project: 'relay-test'
  },
  {
    id: 2,
    name: 'Smart Light Control System v1 · 4-Channel Relay',
    key: 'GKB-LIGHT-0001V1',
    legacyKeys: ['GKB-LIGHTV1-0001', 'GKB-LIGHT-0001'],
    status: 'Active Target',
    lastAlert: '4-Relay Channel Board · BLE & QR Ready · GPIO 23, 22, 21, 19',
    project: 'light-control',
    relayChannels: 4
  },
  {
    id: 3,
    name: 'Smart Light Control System v2 · 6-Channel Relay',
    key: 'GKB-LIGHT-0001V2',
    legacyKeys: ['GKB-LIGHTV2-0001'],
    status: 'Fleet',
    lastAlert: '6-Relay Channel Board · Multi-Zone Lighting',
    project: 'light-control',
    relayChannels: 6
  },
  {
    id: 4,
    name: 'Smart Light Control System v3 · 8-Channel Relay',
    key: 'GKB-LIGHT-0001V3',
    legacyKeys: ['GKB-LIGHTV3-0001'],
    status: 'Fleet',
    lastAlert: '8-Relay Channel Board · Industrial Lighting Array',
    project: 'light-control',
    relayChannels: 8
  },
  {
    id: 5,
    name: 'Smart Water Tank Monitor',
    key: 'GKB-SWP-0001',
    legacyKeys: ['GKB-WTR-4412'],
    status: 'Fleet',
    lastAlert: 'Water level stable at 68% · Ultrasonic Telemetry',
    project: 'water-tank-monitor'
  },
  {
    id: 6,
    name: 'Industrial Fuel Tank Monitor',
    key: 'GKB-IUFT-0001',
    status: 'Fleet',
    lastAlert: 'Fuel level stable at 72% · Pressure Sensor',
    project: 'fuel-tank-monitor'
  },
  {
    id: 7,
    name: 'GKB Smart Prepaid Energy Meter',
    key: 'GKB-SPEM-0001',
    status: 'Fleet',
    lastAlert: 'Meter secure · Balance GHS 24.50 · 230V 50Hz',
    project: 'prepaid-energy-meter'
  },
  {
    id: 8,
    name: 'Smart Fan Regulator',
    key: 'GKB-FAN-0001',
    legacyKeys: ['GKB-SFLC-0001'],
    status: 'Fleet',
    lastAlert: 'Multi-speed capacitor relay bank',
    project: 'fan-regulator'
  },
  {
    id: 9,
    name: 'Smart Alcohol Breathalyzer System',
    key: 'GKB-SAB-0001',
    status: 'Fleet',
    lastAlert: 'MQ-3 Gas Sensor · Vehicle Ignition Lockout',
    project: 'alcohol-breathalyzer'
  }
];


function formatSupabaseError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    const details = 'details' in error && typeof error.details === 'string' ? error.details : '';
    const hint = 'hint' in error && typeof error.hint === 'string' ? error.hint : '';
    const code = 'code' in error && typeof error.code === 'string' ? ` (${error.code})` : '';
    return [error.message + code, details, hint].filter(Boolean).join(' ');
  }
  return 'Unknown Supabase error. Check the browser console and Supabase logs.';
}

function generateRelayArduinoCode(deviceKey: string = 'GKB-SEC-0001'): string {
  const baseCode = "/*\n * =========================================================================================\n * GKB TECHNOLOGIES — ESP32 RELAY PILOT: BLE + QR CODE PROVISIONING & CLOUD CONTROL\n * =========================================================================================\n * Target Board       : ESP32 Dev Module / NodeMCU-32S / ESP-WROOM-32\n * Device Token Model : Unique Hardware Casing Token (Default: GKB-SEC-0001)\n * Target Output      : 5V/3.3V Smart Relay Channel (GPIO 23)\n * Status Diagnostic  : Onboard Blue LED (GPIO 2)\n * Factory Reset Button: Onboard BOOT Button (GPIO 0, Hold for 5s)\n * Storage Engine     : Non-Volatile Flash Partition (ESP32 Preferences.h / NVS)\n * Connectivity       : Dual-Mode (BLE 4.2 GATT Provisioning + 2.4GHz Wi-Fi Cloud Polling)\n * Cloud Backend      : Supabase public.relay_status (device_id: relay_01)\n * =========================================================================================\n * WORKFLOW SPECIFICATION:\n * 1. Boot-up:\n *    - Reads Preferences NVS namespace (\"gkb_prov\").\n *    - If provisioned: Connects directly to saved Wi-Fi and begins operational cloud relay control.\n *    - If unprovisioned: Starts BLE GATT Server with advertising name \"GKB-RELAY-0001\".\n *\n * 2. Web App & BLE Handshake:\n *    - User opens the relay test portal at https://gkb-devices.netlify.app/\n *    - Web Bluetooth scans and connects to BLE Service: 4fafc201-1fb5-459e-8fcc-c5c9c331914b\n *\n * 3. Device QR Tagging & Verification:\n *    - User scans the physical QR code sticker on the ESP32 module casing (e.g. GKB-SEC-0001).\n *    - App transmits \"VERIFY:GKB-SEC-0001\" over RX characteristic.\n *    - ESP32 compares against internal deviceKey.\n *    - If match -> Returns \"AUTH_SUCCESS:DEVICE_UNLOCKED\".\n *\n * 4. Credential Transfer & Flash Storage:\n *    - App sends \"SET_WIFI:{\\\"ssid\\\":\\\"...\\\",\\\"pass\\\":\\\"...\\\"}\" over BLE.\n *    - ESP32 writes SSID & Password to Preferences.h NVS.\n *    - ESP32 transmits \"CONFIG_SAVED:REBOOTING\" and restarts.\n *\n * 5. Operational Relay Operation:\n *    - ESP32 joins local Wi-Fi and polls Supabase relay_status table for relay_01.\n *    - Updates GPIO 23 (HIGH = ON, LOW = OFF) with real-time web portal sync.\n * =========================================================================================\n */\n\n#include <WiFi.h>\n#include <WiFiClientSecure.h>\n#include <HTTPClient.h>\n#include <Preferences.h>\n#include <BLEDevice.h>\n#include <BLEServer.h>\n#include <BLEUtils.h>\n#include <BLE2902.h>\n\n// ================= HARDWARE PINOUT ASSIGNMENTS =================\n#define PIN_RELAY_OUTPUT    23   // ESP32 GPIO 23 -> Relay Signal IN (IN1)\n#define PIN_STATUS_LED      2    // ESP32 GPIO 2  -> Onboard Blue LED\n#define PIN_BOOT_BUTTON     0    // ESP32 GPIO 0  -> BOOT Button (Factory Reset)\n\n// Default Relay Logic (Set to true if your relay module is Active HIGH, false if Active LOW)\n#define RELAY_ACTIVE_HIGH   true\n\n// ================= DEVICE IDENTITY & SECURITY KEY =================\n// Physical QR code label token on device casing:\n#define DEFAULT_DEVICE_KEY  \"GKB-SEC-0001\"\n\n// ================= BLE GATT SPECIFICATIONS =================\n#define GKB_BLE_SERVICE_UUID        \"4fafc201-1fb5-459e-8fcc-c5c9c331914b\"\n#define GKB_BLE_CHAR_RX_UUID        \"beb5483e-36e1-4688-b7f5-ea07361b26a8\" // Phone writes to ESP32\n#define GKB_BLE_CHAR_TX_UUID        \"beb5483f-36e1-4688-b7f5-ea07361b26a9\" // ESP32 notifies Phone\n\n// ================= SUPABASE CLOUD REST ENDPOINT =================\n// Supabase REST endpoint for relay_01:\nconst char* SUPABASE_REST_URL = \"https://ditnksmvcacnzdguqcgz.supabase.co/rest/v1/relay_status?device_id=eq.relay_01&select=state\";\n// Valid Supabase publishable key for public.relay_status:\nconst char* SUPABASE_ANON_KEY = \"sb_publishable_33KQl1SmvaBaqNzxWJiyzw_HuLMgWAl\";\n\n// ================= SYSTEM STATE =================\nPreferences preferences;\n\nenum DeviceOperatingMode {\n  MODE_PROVISIONING_BLE,\n  MODE_CONNECTING_WIFI,\n  MODE_OPERATIONAL_CLOUD,\n  MODE_STANDALONE_FAILSAFE\n};\n\nDeviceOperatingMode currentMode = MODE_PROVISIONING_BLE;\n\nString deviceKey          = DEFAULT_DEVICE_KEY;\nString wifiSSID           = \"\";\nString wifiPassword       = \"\";\nbool   isProvisioned      = false;\nbool   bleClientConnected = false;\nbool   qrAuthenticated    = false;\nbool   currentRelayState  = false;\n\nBLEServer*         pBleServer         = nullptr;\nBLECharacteristic* pTxCharacteristic = nullptr;\n\nunsigned long lastCloudPollTime    = 0;\nconst unsigned long CLOUD_POLL_MS  = 2500; // Poll cloud relay state every 2.5s\nunsigned long bootButtonPressTime  = 0;\nbool isBootButtonPressed           = false;\nbool pendingReboot                 = false;\nunsigned long rebootScheduledAt    = 0;\n\n// ================= FUNCTION PROTOTYPES =================\nvoid loadStoredCredentials();\nvoid saveWiFiCredentials(const String& ssid, const String& pass);\nvoid factoryResetPreferences();\nvoid initBLEProvisioningServer();\nvoid sendBLEResponse(const String& message);\nvoid connectToConfiguredWiFi();\nvoid pollCloudRelayState();\nvoid applyRelayOutput(bool state);\nString extractJsonField(const String& json, const String& key);\n\n// ================= BLE SERVER CALLBACKS =================\nclass GkbRelayServerCallbacks : public BLEServerCallbacks {\n  void onConnect(BLEServer* pServer) override {\n    bleClientConnected = true;\n    qrAuthenticated    = false; // Every new connection requires fresh QR verification\n    Serial.println(\"📱 [BLE] Mobile / Web Client Connected!\");\n    digitalWrite(PIN_STATUS_LED, HIGH);\n  }\n\n  void onDisconnect(BLEServer* pServer) override {\n    bleClientConnected = false;\n    qrAuthenticated    = false;\n    Serial.println(\"📱 [BLE] Client Disconnected. Re-advertising...\");\n    digitalWrite(PIN_STATUS_LED, LOW);\n    if (currentMode == MODE_PROVISIONING_BLE && pBleServer) {\n      pBleServer->startAdvertising();\n    }\n  }\n};\n\nclass GkbRelayCharacteristicCallbacks : public BLECharacteristicCallbacks {\n  void onWrite(BLECharacteristic* pCharacteristic) override {\n    String rxValue = pCharacteristic->getValue().c_str();\n    rxValue.trim();\n    if (rxValue.length() == 0) return;\n\n    Serial.print(\"📩 [BLE-RX] Received: \");\n    Serial.println(rxValue);\n\n    // 1. QR Code Security Key Verification (Phase 2 Step 2)\n    if (rxValue.startsWith(\"VERIFY:\")) {\n      String submittedKey = rxValue.substring(7);\n      submittedKey.trim();\n\n      Serial.print(\"🔍 Verifying QR Key: [\");\n      Serial.print(submittedKey);\n      Serial.print(\"] vs Stored Key: [\");\n      Serial.print(deviceKey);\n      Serial.println(\"]\");\n\n      if (submittedKey.equalsIgnoreCase(deviceKey)) {\n        qrAuthenticated = true;\n        Serial.println(\"✅ [AUTH] QR Security Key Verified! Access Granted.\");\n        sendBLEResponse(\"AUTH_SUCCESS:DEVICE_UNLOCKED\");\n      } else {\n        qrAuthenticated = false;\n        Serial.println(\"❌ [AUTH] Security Key Mismatch! Rejected.\");\n        sendBLEResponse(\"AUTH_FAILED:INVALID_KEY\");\n      }\n      return;\n    }\n\n    // 2. Wi-Fi Credential Transfer & Storage (Phase 2 Step 3)\n    if (rxValue.startsWith(\"SET_WIFI:\")) {\n      if (!qrAuthenticated) {\n        Serial.println(\"⚠️ [SECURITY] Rejected Wi-Fi configuration without QR verification!\");\n        sendBLEResponse(\"AUTH_REQUIRED:SCAN_QR_FIRST\");\n        return;\n      }\n\n      String jsonPayload = rxValue.substring(9);\n      String incomingSSID = extractJsonField(jsonPayload, \"ssid\");\n      String incomingPass = extractJsonField(jsonPayload, \"pass\");\n\n      if (incomingSSID.length() == 0) {\n        sendBLEResponse(\"CONFIG_ERROR:EMPTY_SSID\");\n        return;\n      }\n\n      Serial.println(\"💾 [NVS] Saving Wi-Fi Credentials via Preferences.h...\");\n      Serial.print(\"   SSID: \"); Serial.println(incomingSSID);\n\n      saveWiFiCredentials(incomingSSID, incomingPass);\n      sendBLEResponse(\"CONFIG_SAVED:REBOOTING\");\n\n      // Non-blocking scheduled restart: Allows BLE GATT Write Acknowledgment to flush cleanly to Chrome\n      pendingReboot = true;\n      rebootScheduledAt = millis() + 2500;\n      Serial.println(\"🔄 Wi-Fi saved! Scheduled restart into Cloud Relay Mode in 2.5s (flushing BLE buffers)...\"\n      );\n      return;\n    }\n\n    // 3. Status Query\n    if (rxValue == \"GET_STATUS\") {\n      String statusMsg = \"STATUS:\";\n      statusMsg += \"KEY=\" + deviceKey + \";\";\n      statusMsg += \"AUTH=\" + String(qrAuthenticated ? \"YES\" : \"NO\") + \";\";\n      statusMsg += \"PROV=\" + String(isProvisioned ? \"YES\" : \"NO\") + \";\";\n      statusMsg += \"RELAY=\" + String(currentRelayState ? \"ON\" : \"OFF\");\n      sendBLEResponse(statusMsg);\n      return;\n    }\n\n    // 4. Factory Reset Command\n    if (rxValue == \"FACTORY_RESET\") {\n      sendBLEResponse(\"RESET_CONFIRMED:REBOOTING\");\n      factoryResetPreferences();\n      pendingReboot = true;\n      rebootScheduledAt = millis() + 1500;\n      return;\n    }\n\n    sendBLEResponse(\"UNKNOWN_COMMAND\");\n  }\n};\n\n// ================= ARDUINO SETUP =================\nvoid setup() {\n  Serial.begin(115200);\n  delay(1200);\n\n  Serial.println(\"\\n=======================================================\");\n  Serial.println(\"⚡ GKB TECHNOLOGIES — ESP32 SMART RELAY PILOT\");\n  Serial.println(\"   BLE & QR Provisioning · Supabase Cloud Telemetry\");\n  Serial.println(\"=======================================================\");\n\n  pinMode(PIN_BOOT_BUTTON, INPUT_PULLUP);\n  pinMode(PIN_STATUS_LED, OUTPUT);\n  pinMode(PIN_RELAY_OUTPUT, OUTPUT);\n\n  // Default initial state: Relay OFF, LED OFF\n  applyRelayOutput(false);\n  digitalWrite(PIN_STATUS_LED, LOW);\n\n  // Load persistent credentials from Flash memory\n  loadStoredCredentials();\n\n  // Route based on provisioning state\n  if (isProvisioned && wifiSSID.length() > 0) {\n    Serial.println(\"⚡ Provisioned credentials located. Connecting to Wi-Fi...\");\n    currentMode = MODE_CONNECTING_WIFI;\n    connectToConfiguredWiFi();\n  } else {\n    Serial.println(\"🚀 Unprovisioned module. Launching BLE Provisioning Server...\");\n    currentMode = MODE_PROVISIONING_BLE;\n    initBLEProvisioningServer();\n  }\n}\n\n// ================= ARDUINO MAIN LOOP =================\nvoid loop() {\n  // 0. Non-blocking Scheduled Reboot Handler (allows clean BLE GATT ACK transmission before restart)\n  if (pendingReboot && millis() >= rebootScheduledAt) {\n    Serial.println(\"🔄 Rebooting ESP32 into Cloud Relay Mode...\");\n    ESP.restart();\n  }\n\n  // 1. Factory Reset Check (Hold BOOT button for 5 seconds)\n  if (digitalRead(PIN_BOOT_BUTTON) == LOW) {\n    if (!isBootButtonPressed) {\n      isBootButtonPressed = true;\n      bootButtonPressTime = millis();\n    } else {\n      if (millis() - bootButtonPressTime >= 5000) {\n        Serial.println(\"\\n⚠️ [RESET] BOOT Button held for 5s. Clearing NVS & Factory Resetting...\");\n        for (int i = 0; i < 5; i++) {\n          digitalWrite(PIN_STATUS_LED, HIGH);\n          delay(100);\n          digitalWrite(PIN_STATUS_LED, LOW);\n          delay(100);\n        }\n        factoryResetPreferences();\n        ESP.restart();\n      }\n    }\n  } else {\n    isBootButtonPressed = false;\n  }\n\n  // 2. State-Specific Operational Logic\n  if (currentMode == MODE_PROVISIONING_BLE) {\n    // Pulse Status LED to visually indicate BLE Advertising / Pairing Mode\n    static unsigned long lastBlink = 0;\n    if (!bleClientConnected && millis() - lastBlink > 700) {\n      lastBlink = millis();\n      digitalWrite(PIN_STATUS_LED, !digitalRead(PIN_STATUS_LED));\n    }\n  } else if (currentMode == MODE_OPERATIONAL_CLOUD) {\n    // Keep Status LED solid ON when connected and operational\n    digitalWrite(PIN_STATUS_LED, HIGH);\n\n    // Check Wi-Fi Connection Health\n    if (WiFi.status() != WL_CONNECTED) {\n      Serial.println(\"⚠️ [WI-FI] Connection dropped. Re-establishing link...\");\n      WiFi.reconnect();\n      delay(1000);\n      return;\n    }\n\n    // Periodically poll Supabase relay state\n    if (millis() - lastCloudPollTime >= CLOUD_POLL_MS) {\n      lastCloudPollTime = millis();\n      pollCloudRelayState();\n    }\n  }\n}\n\n// ================= BLE PROVISIONING ENGINE =================\nvoid initBLEProvisioningServer() {\n  // Advertise as GKB-RELAY-0001 (or GKB-PROV-0001)\n  String bleAdvertisedName = \"GKB-RELAY-0001\";\n  Serial.print(\"📶 [BLE] Initializing GATT Server: \");\n  Serial.println(bleAdvertisedName);\n\n  BLEDevice::init(bleAdvertisedName.c_str());\n  pBleServer = BLEDevice::createServer();\n  pBleServer->setCallbacks(new GkbRelayServerCallbacks());\n\n  BLEService* pService = pBleServer->createService(GKB_BLE_SERVICE_UUID);\n\n  // RX Characteristic (Web Bluetooth writes commands to ESP32)\n  BLECharacteristic* pRxCharacteristic = pService->createCharacteristic(\n    GKB_BLE_CHAR_RX_UUID,\n    BLECharacteristic::PROPERTY_WRITE\n  );\n  pRxCharacteristic->setCallbacks(new GkbRelayCharacteristicCallbacks());\n\n  // TX Characteristic (ESP32 sends real-time notifications to Web App)\n  pTxCharacteristic = pService->createCharacteristic(\n    GKB_BLE_CHAR_TX_UUID,\n    BLECharacteristic::PROPERTY_NOTIFY\n  );\n  pTxCharacteristic->addDescriptor(new BLE2902());\n\n  pService->start();\n\n  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();\n  pAdvertising->addServiceUUID(GKB_BLE_SERVICE_UUID);\n  pAdvertising->setScanResponse(true);\n  pAdvertising->setMinPreferred(0x06);\n  pAdvertising->setMinPreferred(0x12);\n  BLEDevice::startAdvertising();\n\n  Serial.println(\"📡 [BLE] Provisioning Server Active. Ready for Web Bluetooth & QR scan.\");\n}\n\nvoid sendBLEResponse(const String& message) {\n  if (pTxCharacteristic && bleClientConnected) {\n    pTxCharacteristic->setValue(message.c_str());\n    pTxCharacteristic->notify();\n    Serial.print(\"📤 [BLE-TX] Sent: \");\n    Serial.println(message);\n  }\n}\n\n// ================= NON-VOLATILE STORAGE (PREFERENCES.H) =================\nvoid loadStoredCredentials() {\n  preferences.begin(\"gkb_prov\", false);\n\n  if (!preferences.isKey(\"dev_key\")) {\n    preferences.putString(\"dev_key\", DEFAULT_DEVICE_KEY);\n    deviceKey = DEFAULT_DEVICE_KEY;\n  } else {\n    deviceKey = preferences.getString(\"dev_key\", DEFAULT_DEVICE_KEY);\n  }\n\n  isProvisioned = preferences.getBool(\"is_prov\", false);\n  wifiSSID      = preferences.getString(\"wifi_ssid\", \"\");\n  wifiPassword  = preferences.getString(\"wifi_pass\", \"\");\n\n  preferences.end();\n\n  Serial.print(\"🔑 Casing Device Key   : \"); Serial.println(deviceKey);\n  Serial.print(\"📦 Provisioning Status : \"); Serial.println(isProvisioned ? \"PROVISIONED\" : \"UNPROVISIONED\");\n  if (isProvisioned) {\n    Serial.print(\"📶 Saved Network SSID  : \"); Serial.println(wifiSSID);\n  }\n}\n\nvoid saveWiFiCredentials(const String& ssid, const String& pass) {\n  preferences.begin(\"gkb_prov\", false);\n  preferences.putString(\"wifi_ssid\", ssid);\n  preferences.putString(\"wifi_pass\", pass);\n  preferences.putBool(\"is_prov\", true);\n  preferences.end();\n\n  wifiSSID      = ssid;\n  wifiPassword  = pass;\n  isProvisioned = true;\n  Serial.println(\"✅ [NVS] Wi-Fi network saved to Flash memory partition.\");\n}\n\nvoid factoryResetPreferences() {\n  preferences.begin(\"gkb_prov\", false);\n  preferences.clear();\n  preferences.putString(\"dev_key\", DEFAULT_DEVICE_KEY);\n  preferences.end();\n  Serial.println(\"🧹 [NVS] Preferences cleared. Ready for fresh factory provisioning.\");\n}\n\n// ================= WI-FI & SUPABASE CLOUD RELAY =================\nvoid connectToConfiguredWiFi() {\n  Serial.print(\"🌐 Connecting to Wi-Fi SSID: [\");\n  Serial.print(wifiSSID);\n  Serial.print(\"] \");\n\n  WiFi.mode(WIFI_STA);\n  WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());\n\n  int attempts = 0;\n  while (WiFi.status() != WL_CONNECTED && attempts < 30) {\n    delay(400);\n    Serial.print(\".\");\n    attempts++;\n  }\n\n  if (WiFi.status() == WL_CONNECTED) {\n    currentMode = MODE_OPERATIONAL_CLOUD;\n    Serial.println(\"\\n🎉 Wi-Fi Connected! IP Address: \" + WiFi.localIP().toString());\n    digitalWrite(PIN_STATUS_LED, HIGH);\n    // Immediately fetch initial relay state\n    pollCloudRelayState();\n  } else {\n    currentMode = MODE_PROVISIONING_BLE;\n    Serial.println(\"\\n⚠️ Failed to join Wi-Fi. Returning to BLE Provisioning Server...\");\n    initBLEProvisioningServer();\n  }\n}\n\nvoid pollCloudRelayState() {\n  if (WiFi.status() != WL_CONNECTED) return;\n\n  WiFiClientSecure client;\n  // Use setInsecure to allow reliable HTTPS REST polling without requiring local NTP clock sync on the ESP32\n  client.setInsecure();\n\n  HTTPClient http;\n  if (http.begin(client, SUPABASE_REST_URL)) {\n    http.addHeader(\"apikey\", SUPABASE_ANON_KEY);\n    http.addHeader(\"Authorization\", String(\"Bearer \") + SUPABASE_ANON_KEY);\n    http.addHeader(\"Accept\", \"application/json\");\n\n    int httpCode = http.GET();\n    if (httpCode == HTTP_CODE_OK || httpCode == 200) {\n      String payload = http.getString();\n      // Payload format: [{\"state\":\"ON\"}] or [{\"state\":\"OFF\"}]\n      if (payload.indexOf(\"\\\"state\\\":\\\"ON\\\"\") != -1) {\n        if (!currentRelayState) {\n          Serial.println(\"⚡ [CLOUD RELAY] Switch Command: ON -> Engaging GPIO 23\");\n          applyRelayOutput(true);\n        }\n      } else if (payload.indexOf(\"\\\"state\\\":\\\"OFF\\\"\") != -1) {\n        if (currentRelayState) {\n          Serial.println(\"⚡ [CLOUD RELAY] Switch Command: OFF -> Releasing GPIO 23\");\n          applyRelayOutput(false);\n        }\n      }\n    } else {\n      Serial.print(\"⚠️ [CLOUD] Relay status poll returned HTTP \");\n      Serial.println(httpCode);\n    }\n    http.end();\n  }\n}\n\nvoid applyRelayOutput(bool state) {\n  currentRelayState = state;\n  if (RELAY_ACTIVE_HIGH) {\n    digitalWrite(PIN_RELAY_OUTPUT, state ? HIGH : LOW);\n  } else {\n    digitalWrite(PIN_RELAY_OUTPUT, state ? LOW : HIGH);\n  }\n}\n\n// Simple JSON extraction helper without requiring ArduinoJson library\nString extractJsonField(const String& json, const String& key) {\n  String searchKey = \"\\\"\" + key + \"\\\":\\\"\";\n  int startIdx = json.indexOf(searchKey);\n  if (startIdx == -1) {\n    searchKey = \"\\\"\" + key + \"\\\":\";\n    startIdx = json.indexOf(searchKey);\n    if (startIdx == -1) return \"\";\n    startIdx += searchKey.length();\n    int endIdx = json.indexOf(\",\", startIdx);\n    if (endIdx == -1) endIdx = json.indexOf(\"}\", startIdx);\n    if (endIdx == -1) return \"\";\n    String result = json.substring(startIdx, endIdx);\n    result.trim();\n    result.replace(\"\\\"\", \"\");\n    return result;\n  }\n  startIdx += searchKey.length();\n  int endIdx = json.indexOf(\"\\\"\", startIdx);\n  if (endIdx == -1) return \"\";\n  return json.substring(startIdx, endIdx);\n}\n";
  return baseCode.replace(/#define DEFAULT_DEVICE_KEY\s+"[^"]+"/, '#define DEFAULT_DEVICE_KEY  "' + deviceKey + '"');
}

// ================= PRIMARY TESTING GROUND: RELAY TEST DASHBOARD =================
function RelayTestDashboard({ mode = 'service' }: { mode?: 'test' | 'service' }) {
  const [relayOn, setRelayOn] = useState(false);
  const [relaySession, setRelaySession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(mode === 'service');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [authMessageIsError, setAuthMessageIsError] = useState(false);
  const [relayBusy, setRelayBusy] = useState(false);
  const [relayError, setRelayError] = useState('');
  const [relayMessage, setRelayMessage] = useState('');
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [relayPaired, setRelayPaired] = useState(false);

  // BLE & QR Provisioning Pilot States
  const [provisionModalOpen, setProvisionModalOpen] = useState(false);
  const [showLabelInModal, setShowLabelInModal] = useState(false);
  const [showFirmwareModal, setShowFirmwareModal] = useState(false);
  const [copiedFirmware, setCopiedFirmware] = useState(false);

  useEffect(() => {
    if (mode !== 'service') return;
    if (!relaySupabase) {
      setConnectionState('error');
      setRelayError(relaySupabaseConfigError);
      setSessionLoading(false);
      return;
    }

    let disposed = false;
    const { data: { subscription } } = relaySupabase.auth.onAuthStateChange((_event, session) => {
      if (!disposed) {
        setRelaySession(session);
        setSessionLoading(false);
        setAuthMessage('');
      }
    });

    void relaySupabase.auth.getSession().then(({ data, error }) => {
      if (disposed) return;
      if (error) {
        setAuthMessage(error.message);
        setAuthMessageIsError(true);
      }
      setRelaySession(data.session);
      setSessionLoading(false);
    });

    const readRelayState = async () => {
      try {
        const { data, error } = await relaySupabase
          .from('relay_status')
          .select('state, updated_at, paired_at')
          .eq('device_id', 'relay_01')
          .maybeSingle();
        if (disposed) return;
        if (error) {
          setConnectionState('error');
          setRelayError(`Could not read relay_01 from Supabase: ${error.message}`);
          return;
        }
        if (!data) {
          setConnectionState('error');
          setRelayError('No relay_01 row was returned. Check the database row and its read policy.');
          return;
        }
        if (data.state !== 'ON' && data.state !== 'OFF') {
          setConnectionState('error');
          setRelayError(`Unexpected relay state returned by Supabase: ${String(data.state)}.`);
          return;
        }
        setRelayOn(data.state === 'ON');
        setRelayPaired(Boolean(data.paired_at));
        setLastSyncedAt(new Date());
        setConnectionState('connected');
        setRelayError('');
      } catch (error) {
        if (!disposed) {
          setConnectionState('error');
          setRelayError(error instanceof Error ? error.message : 'Unexpected error while reading relay state.');
        }
      }
    };

    void readRelayState();
    const pollId = window.setInterval(() => void readRelayState(), 2500);
    return () => {
      disposed = true;
      subscription.unsubscribe();
      window.clearInterval(pollId);
    };
  }, [mode]);

  const handleSupabaseAuth = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthMessage('');
    setAuthMessageIsError(false);
    if (!relaySupabase) {
      setAuthMessage(relaySupabaseConfigError);
      setAuthMessageIsError(true);
      setAuthBusy(false);
      return;
    }
    try {
      if (creatingAccount) {
        const { data, error } = await relaySupabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword
        });
        if (error) throw error;
        setAuthMessage(data.session
          ? 'Supabase account created and signed in.'
          : 'Account created. Confirm your email if requested, then sign in.');
        setAuthPassword('');
      } else {
        const { error } = await relaySupabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword
        });
        if (error) throw error;
        setAuthMessage('Signed in to Supabase. Relay control is available only if this account owns relay_01.');
        setAuthPassword('');
      }
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Supabase authentication failed.');
      setAuthMessageIsError(true);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSupabaseSignOut = async () => {
    if (!relaySupabase) return;
    setAuthBusy(true);
    setAuthMessage('');
    try {
      const { error } = await relaySupabase.auth.signOut();
      if (error) throw error;
      setAuthMessage('Signed out of Supabase.');
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Could not sign out of Supabase.');
      setAuthMessageIsError(true);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleRelayToggle = async () => {
    if (mode === 'test') {
      setRelayOn(current => !current);
      return;
    }
    if (!relaySupabase || relayBusy) return;

    const previousState = relayOn;
    const nextState = relayOn ? 'OFF' : 'ON';

    // Snappy optimistic UI update
    setRelayOn(!previousState);
    setRelayBusy(true);
    setRelayError('');
    setRelayMessage('');

    try {
      const { error } = await relaySupabase
        .from('relay_status')
        .update({ state: nextState, updated_at: new Date().toISOString() })
        .eq('device_id', 'relay_01');
      if (error) throw error;

      setRelayOn(nextState === 'ON');
      setLastSyncedAt(new Date());
      setRelayMessage(`Relay switched to ${nextState}. ESP32 polling will actuate GPIO 23 within 2.5s.`);
    } catch (error) {
      setRelayOn(previousState);
      setRelayError(`Could not send relay command: ${formatSupabaseError(error)}`);
    } finally {
      setRelayBusy(false);
    }
  };

  return (
    <section aria-labelledby="relay-test-title" className="mx-auto max-w-5xl space-y-6">
      <style>{`
        @keyframes gkb-relay-wheel-spin {
          to { transform: rotate(360deg); }
        }
        .relay-car-wheel {
          transform-box: fill-box;
          transform-origin: center;
        }
        .relay-car-wheel.is-running {
          animation: gkb-relay-wheel-spin 0.45s linear infinite;
        }
      `}</style>

      {/* Primary Hardware Test Ground Header */}
      <header className="rounded-2xl border border-cyan-500/30 bg-slate-900/90 p-5 sm:p-6 shadow-xl shadow-cyan-500/5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">
                Primary Hardware Testing Ground · Live Supabase relay_01
              </p>
            </div>
            <h2 id="relay-test-title" className="mt-1 text-2xl font-black text-white sm:text-3xl">
              ESP32 Relay Test & Provisioning Center
            </h2>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-1.5 font-mono text-xs font-bold text-cyan-300 w-fit">
            <Cpu className="h-4 w-4 text-cyan-400" /> Active Hardware: GKB-SEC-0001
          </span>
        </div>
        <p className="mt-2 text-xs sm:text-sm text-slate-300 leading-relaxed max-w-3xl">
          Designated primary testing ground for GKB hardware communication, Web Bluetooth (BLE) handshake, phone camera QR verification, NVS flash credentials storage, and cloud relay actuation.
        </p>
      </header>

      {/* Hardware BLE + QR Provisioning Pilot Hero Card */}
      <section aria-label="Hardware BLE and QR Provisioning" className="rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-slate-900/95 via-slate-900/70 to-purple-950/40 p-5 sm:p-6 shadow-xl shadow-cyan-500/5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 to-purple-600 text-black shadow-lg shadow-cyan-500/20 shrink-0">
              <Bluetooth className="h-6 w-6 text-black" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">Hardware Pilot</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-mono font-bold text-cyan-300 border border-cyan-500/30">
                  Target: GKB-SEC-0001
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> BLE GATT Active
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-black text-white mt-1">ESP32 BLE + QR Provisioning & Cloud Relay Control</h3>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setShowLabelInModal(false);
                setProvisionModalOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-black shadow-lg shadow-cyan-500/20 hover:opacity-90 transition-all cursor-pointer"
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
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs font-bold text-slate-300 hover:text-cyan-300 hover:border-cyan-500/40 transition-all cursor-pointer"
            >
              <Code className="h-3.5 w-3.5 text-cyan-400" />
              ESP32 Firmware
            </button>
          </div>
        </div>

        {/* 3-Step Architecture Flow Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-cyan-500/20 bg-slate-950/60 p-4 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-cyan-500/20 text-[10px] font-bold text-cyan-300">1</span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">BLE Local Handshake</span>
            </div>
            <p className="text-xs font-bold text-white">Web Bluetooth GATT Server</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Discovers ESP32 beacon and establishes encrypted local GATT channel without cloud dependencies.
            </p>
          </div>

          <div className="rounded-xl border border-purple-500/20 bg-slate-950/60 p-4 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-purple-500/20 text-[10px] font-bold text-purple-300">2</span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-purple-300">QR Tag Verification</span>
            </div>
            <p className="text-xs font-bold text-white">Zero-Trust Casing Key</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Scans physical QR sticker with phone camera. Transmits VERIFY:GKB-SEC-0001 over BLE for hardware authentication.
            </p>
          </div>

          <div className="rounded-xl border border-emerald-500/20 bg-slate-950/60 p-4 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500/20 text-[10px] font-bold text-emerald-300">3</span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">Preferences.h Storage</span>
            </div>
            <p className="text-xs font-bold text-white">NVS Flash Commit</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Transfers local Wi-Fi SSID and password. ESP32 commits credentials to Flash and reboots into operational Cloud Relay mode.
            </p>
          </div>
        </div>

        {/* Pinout and Hardware Specs Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-400 border-t border-slate-800/60">
          <div className="flex flex-wrap items-center gap-4 font-mono text-[11px]">
            <span className="flex items-center gap-1.5 text-cyan-300">
              <Cpu className="h-3.5 w-3.5 text-cyan-400" /> Relay Output: <strong className="text-white">GPIO 23</strong>
            </span>
            <span className="flex items-center gap-1.5 text-purple-300">
              <Radio className="h-3.5 w-3.5 text-purple-400" /> Status LED: <strong className="text-white">GPIO 2</strong>
            </span>
            <span className="flex items-center gap-1.5 text-amber-300">
              <Key className="h-3.5 w-3.5 text-amber-400" /> Factory Reset: <strong className="text-white">BOOT (GPIO 0) 5s</strong>
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            Cloud Endpoint: <code className="text-slate-400 font-mono">public.relay_status (relay_01)</code>
          </span>
        </div>
      </section>

      {/* Relay Hardware Output & Animated Visualizer */}
      <div className="grid gap-5 md:grid-cols-[1fr_auto]">
        <section aria-label="Animated car relay output" className={`flex min-h-64 flex-col items-center justify-center rounded-2xl border p-6 transition-colors ${relayOn ? 'border-emerald-400/30 bg-emerald-400/[0.04]' : 'border-slate-800 bg-slate-900/70'}`}>
          <svg role="img" aria-label={relayOn ? 'Car with spinning tires' : 'Stationary car with stopped tires'} viewBox="0 0 440 220" className="w-full max-w-lg">
            <line x1="35" y1="183" x2="405" y2="183" stroke="#475569" strokeWidth="5" strokeLinecap="round" />
            <path d="M96 145 L123 102 Q133 86 157 83 L259 83 Q279 85 295 105 L328 123 L356 132 Q369 138 371 153 L371 169 L83 169 L83 154 Q84 147 96 145Z" fill={relayOn ? '#0891b2' : '#475569'} stroke={relayOn ? '#67e8f9' : '#94a3b8'} strokeWidth="5" strokeLinejoin="round" />
            <path d="M143 101 Q150 93 163 93 L201 93 L201 121 L128 121Z" fill="#bae6fd" opacity="0.9" />
            <path d="M213 93 L255 93 Q267 95 277 108 L286 121 L213 121Z" fill="#bae6fd" opacity="0.9" />
            <rect x="91" y="145" width="20" height="10" rx="5" fill="#fde68a" />
            <rect x="342" y="145" width="17" height="10" rx="5" fill="#fca5a5" />
            {[145, 315].map(x => (
              <g key={x} transform={`translate(${x} 166)`}>
                <g className={`relay-car-wheel${relayOn ? ' is-running' : ''}`}>
                  <circle r="28" fill="#0f172a" stroke="#cbd5e1" strokeWidth="5" />
                  <circle r="9" fill="#94a3b8" />
                  <path d="M0 -19 L0 -10 M19 0 L10 0 M0 19 L0 10 M-19 0 L-10 0" stroke="#e2e8f0" strokeWidth="4" strokeLinecap="round" />
                </g>
              </g>
            ))}
          </svg>
          <p className={`mt-2 text-sm font-semibold ${relayOn ? 'text-emerald-300' : 'text-slate-400'}`}>
            {relayOn ? 'Relay ON · GPIO 23 Output HIGH · Wheels Spinning' : 'Relay OFF · GPIO 23 Output LOW · Stationary'}
          </p>
        </section>

        <section aria-label="Relay switch control" className="flex min-w-56 flex-col items-center justify-center gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${mode === 'test' ? 'bg-slate-500' : connectionState === 'connected' ? 'bg-emerald-400' : connectionState === 'error' ? 'bg-red-400' : 'bg-amber-400'}`} />
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {mode === 'test' ? 'Simulated relay' : connectionState === 'connected' ? 'Supabase connected' : connectionState === 'error' ? 'Supabase error' : 'Connecting to Supabase'}
            </p>
          </div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Relay output · relay_01</p>
          <button
            type="button"
            role="switch"
            aria-label="Relay switch"
            aria-checked={relayOn}
            onClick={() => void handleRelayToggle()}
            disabled={relayBusy || (mode === 'service' && !relaySupabase)}
            className={`group relative h-12 w-24 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-lg hover:scale-105 active:scale-95 ${relayOn ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-emerald-500/30' : 'bg-slate-700 hover:bg-slate-600 shadow-slate-900/50'}`}
          >
            <span className={`absolute left-1.5 top-1.5 h-9 w-9 rounded-full bg-white shadow-md transition-transform duration-300 ease-out flex items-center justify-center ${relayOn ? 'translate-x-12 bg-emerald-50' : 'translate-x-0'}`}>
              <Zap className={`h-4 w-4 transition-colors ${relayOn ? 'text-emerald-600 fill-emerald-500' : 'text-slate-400'}`} />
            </span>
          </button>
          <p className={`text-xl font-black tracking-wider ${relayOn ? 'text-emerald-300' : 'text-slate-300'}`}>{relayOn ? 'ON' : 'OFF'}</p>
          {mode === 'test' ? (
            <p className="text-center text-xs leading-relaxed text-slate-500">Demo toggle mode · test the output visualizer.</p>
          ) : (
            <>
              {lastSyncedAt && <p className="text-center text-xs text-slate-400">Last cloud sync: {lastSyncedAt.toLocaleTimeString()}</p>}
              {relayError && (
                <div role="alert" className="w-full max-w-xs rounded-xl border border-red-500/40 bg-red-950/60 p-3 text-left">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-red-200">
                      <p className="font-semibold text-red-100">{relayError}</p>
                      {(relayError.includes('42501') || relayError.includes('permission denied')) && (
                        <div className="mt-2 text-[11px] text-amber-200 bg-amber-950/60 border border-amber-500/40 rounded-lg p-2.5 space-y-1.5">
                          <p className="font-bold text-amber-300">Supabase SQL Grant Required</p>
                          <p className="text-slate-300">Run this in your Supabase SQL Editor to allow public switch control:</p>
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(
                                "GRANT SELECT, UPDATE (state, updated_at) ON public.relay_status TO anon, authenticated;\n" +
                                "DROP POLICY IF EXISTS relay_01_anon_update ON public.relay_status;\n" +
                                "CREATE POLICY relay_01_anon_update ON public.relay_status FOR UPDATE TO anon, authenticated USING (device_id = 'relay_01') WITH CHECK (device_id = 'relay_01');"
                              );
                              setRelayMessage('SQL copied! Paste and Run in Supabase SQL Editor.');
                            }}
                            className="inline-flex items-center gap-1.5 rounded bg-amber-500/20 px-2.5 py-1 text-[11px] font-bold text-amber-300 hover:bg-amber-500/30 border border-amber-500/50 cursor-pointer"
                          >
                            <Copy className="h-3.5 w-3.5" /> Copy SQL Grant
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {relayMessage && <p role="status" className="max-w-64 text-center text-xs leading-relaxed text-emerald-300 font-semibold">{relayMessage}</p>}
              <p className="max-w-64 text-center text-xs leading-relaxed text-slate-400">
                ESP32 polls <code className="text-cyan-300 font-mono">public.relay_status</code> every 2.5s and switches GPIO 23.
              </p>
            </>
          )}
        </section>
      </div>

      {mode === 'service' && (
        <section aria-label="Supabase relay account" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          {relaySession ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Supabase signed in</p>
                <p className="mt-1 text-xs text-slate-400">
                  {relaySession.user.email?.toLowerCase() === 'zumkel023@gmail.com' ? (
                    <span className="text-amber-300 font-mono font-bold flex items-center gap-1"><Shield className="w-3 h-3 text-amber-400" /> Admin</span>
                  ) : relaySession.user.email}
                </p>
                {authMessage && <p role={authMessageIsError ? 'alert' : 'status'} className={`mt-2 text-xs ${authMessageIsError ? 'text-red-300' : 'text-emerald-200'}`}>{authMessage}</p>}
              </div>
              <button type="button" onClick={() => void handleSupabaseSignOut()} disabled={authBusy} className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-cyan-400 disabled:opacity-50 cursor-pointer">
                {authBusy ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          ) : (
            <>
              <h3 className="text-sm font-semibold text-white">{creatingAccount ? 'Create a Supabase account' : 'Supabase Account (Optional — Admin / Ownership)'}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Direct cloud relay toggle is active above for the hardware pilot. Signing in binds administrative ownership of relay_01 to your email.
              </p>
              {authMessage && <p role={authMessageIsError ? 'alert' : 'status'} className={`mt-3 rounded-lg px-3 py-2 text-xs ${authMessageIsError ? 'bg-red-500/10 text-red-300' : 'bg-emerald-500/10 text-emerald-200'}`}>{authMessage}</p>}
              <form onSubmit={handleSupabaseAuth} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <label className="sr-only" htmlFor="relay-auth-email">Supabase email</label>
                <input
                  id="relay-auth-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={authEmail}
                  onChange={event => setAuthEmail(event.target.value)}
                  placeholder="Supabase account email"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                />
                <label className="sr-only" htmlFor="relay-auth-password">Supabase password</label>
                <input
                  id="relay-auth-password"
                  type="password"
                  autoComplete={creatingAccount ? 'new-password' : 'current-password'}
                  minLength={6}
                  required
                  value={authPassword}
                  onChange={event => setAuthPassword(event.target.value)}
                  placeholder="Password"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                />
                <button type="submit" disabled={authBusy || sessionLoading || !relaySupabase} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 cursor-pointer">
                  {authBusy ? 'Working…' : creatingAccount ? 'Create account' : sessionLoading ? 'Loading…' : 'Sign in'}
                </button>
              </form>
              <button type="button" onClick={() => { setCreatingAccount(current => !current); setAuthMessage(''); setAuthMessageIsError(false); }} className="mt-3 text-xs text-cyan-300 hover:text-cyan-200 cursor-pointer">
                {creatingAccount ? 'Already registered? Sign in' : 'Need a Supabase account? Create one'}
              </button>
            </>
          )}
        </section>
      )}

      {/* Interactive BLE & QR Provisioning Modal */}
      <BleProvisioningModal
        isOpen={provisionModalOpen}
        onClose={() => setProvisionModalOpen(false)}
        initialDeviceKey="GKB-SEC-0001"
        initialShowLabel={showLabelInModal}
        onDeviceProvisioned={(key) => {
          setProvisionModalOpen(false);
          setRelayMessage(`Device (${key}) successfully provisioned via BLE & QR! Wi-Fi credentials committed to Flash.`);
        }}
      />

      {/* ESP32 Firmware Source Inspection Modal */}
      {showFirmwareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fadeIn">
          <div className="relative w-full max-w-4xl rounded-3xl border border-cyan-500/40 bg-slate-950 p-6 sm:p-8 text-white shadow-[0_0_50px_rgba(6,182,212,0.25)] space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">ESP32 Firmware Source</span>
                <h3 className="text-xl font-black text-white">GKB ESP32 Relay BLE + QR Provisioning (.ino)</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Upload directly via Arduino IDE to any ESP32 Dev Board (ESP-WROOM-32 / NodeMCU-32S).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFirmwareModal(false)}
                className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-xs font-mono">
              <span className="text-cyan-300">File: GKB_ESP32_BLE_QR_Provisioning.ino</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generateRelayArduinoCode('GKB-SEC-0001'));
                    setCopiedFirmware(true);
                    setTimeout(() => setCopiedFirmware(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-cyan-400 cursor-pointer"
                >
                  {copiedFirmware ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedFirmware ? 'Copied Code!' : 'Copy Code'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([generateRelayArduinoCode('GKB-SEC-0001')], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'GKB_ESP32_BLE_QR_Provisioning.ino';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:text-cyan-300 cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" /> Download .ino
                </button>
              </div>
            </div>

            <pre className="p-4 rounded-2xl bg-black border border-slate-800 text-xs font-mono text-cyan-200 overflow-x-auto max-h-96 leading-relaxed">
              <code>{generateRelayArduinoCode('GKB-SEC-0001')}</code>
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}

// ================= GENERIC FLEET PREVIEW DASHBOARD =================
function GenericFleetPreviewDashboard({
  device,
  onSwitchToLightControl,
  onSwitchToRelayPilot
}: {
  device: Device;
  onSwitchToLightControl: () => void;
  onSwitchToRelayPilot: () => void;
}) {
  return (
    <section aria-labelledby="fleet-device-title" className="mx-auto max-w-5xl space-y-6 animate-fadeIn">
      <header className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-cyan-400" />
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">
                GKB Hardware Fleet Member · Microcontroller Telemetry
              </p>
            </div>
            <h2 id="fleet-device-title" className="mt-1 text-2xl font-black text-white sm:text-3xl">
              {device.name}
            </h2>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-1.5 font-mono text-xs font-bold text-cyan-300 w-fit">
            <Cpu className="h-4 w-4 text-cyan-400" /> Key: {device.key}
          </span>
        </div>
        <p className="mt-2 text-xs sm:text-sm text-slate-300 leading-relaxed max-w-3xl">
          {device.lastAlert}. Node status: {device.status}. Ready for standardized Web Bluetooth (BLE) GATT provisioning and telemetry pipeline.
        </p>
      </header>

      {/* Target Notice & Quick Action Banner */}
      <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-slate-900 to-slate-900 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300 shrink-0">
            <Lightbulb className="h-6 w-6" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">Active Hardware Target: Smart Light Control</h4>
            <p className="text-xs text-slate-400">
              Standardized BLE + QR provisioning and 4-channel cloud relay telemetry is currently active on the Smart Light Control System.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSwitchToLightControl}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-4 py-2 text-xs font-bold text-black hover:opacity-90 transition-all cursor-pointer"
          >
            <Lightbulb className="h-4 w-4" /> Open Light Control
          </button>
          <button
            type="button"
            onClick={onSwitchToRelayPilot}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 hover:text-white transition-all cursor-pointer"
          >
            <Cpu className="h-4 w-4" /> Verified Relay Pilot
          </button>
        </div>
      </div>

      {/* Telemetry Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Hardware Gateway</p>
          <p className="text-xl font-bold text-white mt-2">ESP32 Dev Module</p>
          <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> 2.4GHz Wi-Fi + BLE 4.2
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Provisioning Standard</p>
          <p className="text-xl font-bold text-white mt-2">BLE + QR Token</p>
          <p className="text-xs text-cyan-400 mt-2 font-mono">{device.key}</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Device Telemetry</p>
          <p className="text-xl font-bold text-white mt-2">{device.status}</p>
          <p className="text-xs text-slate-400 mt-2 truncate">{device.lastAlert}</p>
        </div>
      </div>
    </section>
  );
}

// ================= MAIN IOT DEVICE PORTAL =================
export default function IoTDevicePortal() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'support' | 'contact'>('dashboard');
  const [isLightMode, setIsLightMode] = useState(
    () => window.localStorage.getItem('gkb-theme') === 'light'
  );
  const [user, setUser] = useState<UserType | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [signupFirstName, setSignupFirstName] = useState('');
  const [signupLastName, setSignupLastName] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupLocation, setSignupLocation] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginMessage, setLoginMessage] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);

  // Selected device from fleet (defaults to active target: Smart Light Control System v1)
  const [selectedDevice, setSelectedDevice] = useState<Device>(defaultDevices[1]);
  const [inputKey, setInputKey] = useState('');
  const [linkMessage, setLinkMessage] = useState('');
  const [linkMessageIsError, setLinkMessageIsError] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);

  const isAdmin = Boolean(user && (user.role === 'admin' || user.email?.toLowerCase() === 'zumkel023@gmail.com'));

  useEffect(() => {
    window.localStorage.setItem('gkb-devices', JSON.stringify(defaultDevices));
  }, []);

  useEffect(() => {
    window.localStorage.setItem('gkb-theme', isLightMode ? 'light' : 'dark');
  }, [isLightMode]);


  // Auth session
  const applyPortalSession = useCallback(async (session: Session | null) => {
    if (!session?.user.email && !session?.user.phone) {
      setUser(null);
      return;
    }
    const metadata = session.user.user_metadata;
    const account: UserType = {
      id: session.user.id,
      role: (metadata?.role === 'admin' || session.user.email?.toLowerCase() === 'zumkel023@gmail.com') ? 'admin' : 'client',
      email: session.user.email || '',
      firstName: metadata?.first_name || '',
      lastName: metadata?.last_name || '',
      phone: session.user.phone || metadata?.phone || '',
      location: metadata?.location || ''
    };
    setUser(account);
  }, []);

  useEffect(() => {
    if (!relaySupabase) return;
    const { data: { subscription } } = relaySupabase.auth.onAuthStateChange((_event, session) => {
      void applyPortalSession(session);
    });
    void relaySupabase.auth.getSession().then(({ data }) => {
      void applyPortalSession(data.session);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [applyPortalSession]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relaySupabase) return;
    setLoginBusy(true);
    setLoginError('');
    setLoginMessage('');

    try {
      if (creatingAccount) {
        const { data, error } = await relaySupabase.auth.signUp({
          email: loginEmail.trim(),
          password: loginPassword,
          options: {
            data: {
              first_name: signupFirstName.trim(),
              last_name: signupLastName.trim(),
              phone: signupPhone.trim(),
              location: signupLocation.trim()
            }
          }
        });
        if (error) throw error;
        setLoginMessage(data.session ? 'Account created and signed in!' : 'Account registered! Please sign in.');
        if (data.session) setLoginModalOpen(false);
      } else {
        const { error } = await relaySupabase.auth.signInWithPassword({
          email: loginEmail.trim(),
          password: loginPassword
        });
        if (error) throw error;
        setLoginModalOpen(false);
      }
    } catch (err) {
      setLoginError(formatSupabaseError(err));
    } finally {
      setLoginBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (!relaySupabase) return;
    await relaySupabase.auth.signOut();
    setUser(null);
  };

  const handleKeySearch = (e: React.FormEvent) => {
    e.preventDefault();
    setLinkBusy(true);
    setLinkMessage('');
    setLinkMessageIsError(false);

    const clean = inputKey.trim().toUpperCase();
    if (!clean) {
      setLinkMessageIsError(true);
      setLinkMessage('Please enter a hardware device key.');
      setLinkBusy(false);
      return;
    }

    const matched = defaultDevices.find(d =>
      d.key.toUpperCase() === clean ||
      d.legacyKeys?.some(k => k.toUpperCase() === clean) ||
      d.name.toUpperCase().includes(clean)
    );

    if (matched) {
      setSelectedDevice(matched);
      setLinkMessage(`Device matched: ${matched.name} (${matched.key})! Launching dashboard...`);
      setActiveTab('dashboard');
    } else {
      setLinkMessageIsError(true);
      setLinkMessage(`No hardware device registered with key "${clean}". Select from fleet below.`);
    }
    setLinkBusy(false);
  };

  return (
    <div className={`min-h-screen ${isLightMode ? 'bg-slate-100 text-slate-900' : 'bg-slate-950 text-slate-100'} font-sans relative overflow-x-hidden`}>
      {/* Background Glow */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Top Header */}
      <header className="relative z-50 border-b border-cyan-500/30 bg-slate-950/80 backdrop-blur-md sticky top-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-2">
          {/* Brand */}
          <div className="flex min-w-0 items-center space-x-2 sm:space-x-3 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
            <img
              src="/gkb-company-logo.png"
              alt="GKB Technologies logo"
              className="h-12 w-12 shrink-0 rounded-lg object-cover shadow-[0_0_15px_rgba(6,182,212,0.2)]"
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm sm:text-lg font-black tracking-wider bg-gradient-to-r from-cyan-400 via-purple-300 to-purple-500 bg-clip-text text-transparent">
                  GKB IOT DEVICE CLOUD
                </h1>
                <span className="hidden md:inline-flex items-center rounded-full bg-cyan-500/20 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300 border border-cyan-500/40">
                  ESP32 Relay Pilot
                </span>
              </div>
              <p className="hidden sm:block text-[10px] text-cyan-400/70 tracking-widest uppercase">
                Hardware BLE & QR Provisioning · Relay Control Center
              </p>
            </div>
          </div>

          {/* Navigation Bar */}
          <nav aria-label="Main navigation" className="hidden md:flex items-center space-x-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer ${activeTab === 'dashboard' ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/60 shadow-[0_0_15px_rgba(6,182,212,0.25)]' : 'text-slate-400 hover:text-cyan-300'}`}
            >
              <span className="flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                Relay Test & Provisioning
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('support')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer ${activeTab === 'support' ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/60 shadow-[0_0_15px_rgba(6,182,212,0.25)]' : 'text-slate-400 hover:text-cyan-300'}`}
            >
              Support & Docs
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('contact')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer ${activeTab === 'contact' ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/60 shadow-[0_0_15px_rgba(6,182,212,0.25)]' : 'text-slate-400 hover:text-cyan-300'}`}
            >
              Contact
            </button>
          </nav>

          {/* Right Actions */}
          <div className="flex shrink-0 items-center space-x-2 sm:space-x-3">
            <button
              type="button"
              onClick={() => setIsLightMode(!isLightMode)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-slate-900 px-2.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-cyan-400 hover:text-cyan-300 sm:px-3 cursor-pointer"
            >
              {isLightMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              <span className="hidden sm:inline">{isLightMode ? 'Dark' : 'Light'}</span>
            </button>

            {user ? (
              <div className="flex items-center space-x-2 bg-slate-900 px-3 py-1.5 rounded-lg border border-purple-500/30">
                <span className="text-xs font-bold text-slate-200">{user.firstName || user.email}</span>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="text-slate-400 hover:text-red-400 text-xs cursor-pointer ml-1"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLoginModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-purple-600 px-3 py-1.5 text-xs font-bold text-black shadow-md hover:opacity-90 cursor-pointer"
              >
                <User className="h-3.5 w-3.5" /> Sign In
              </button>
            )}
          </div>
        </div>

        {/* Mobile Navigation */}
        <nav className="flex md:hidden gap-1 overflow-x-auto border-t border-slate-800/70 px-3 py-2">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${activeTab === 'dashboard' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}
          >
            Relay Test & Provisioning
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('support')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${activeTab === 'support' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}
          >
            Support & Docs
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('contact')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${activeTab === 'contact' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}
          >
            Contact
          </button>
        </nav>
      </header>

      {/* Main Body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hardware Fleet Navigation Bar */}
        <div className="mb-6 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 to-purple-600 text-black shrink-0 shadow-md shadow-cyan-500/20">
                <Layers className="h-5 w-5 text-black" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Active Hardware:</span>
                  <span className={`font-mono text-xs font-bold px-2.5 py-0.5 rounded-lg border ${
                    selectedDevice.project === 'light-control'
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                      : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                  }`}>
                    {selectedDevice.key}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{selectedDevice.name}</p>
              </div>
            </div>

            <form onSubmit={handleKeySearch} className="flex items-center gap-2">
              <input
                type="text"
                value={inputKey}
                onChange={e => setInputKey(e.target.value)}
                placeholder="Search key (e.g. GKB-LIGHT-0001V1)..."
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none font-mono"
              />
              <button
                type="submit"
                disabled={linkBusy}
                className="rounded-xl bg-cyan-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-cyan-400 transition-colors cursor-pointer"
              >
                Open
              </button>
            </form>
          </div>

          {/* Quick Fleet Pills Switcher */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {defaultDevices.map(d => {
              const isSelected = selectedDevice.key === d.key;
              const isLight = d.project === 'light-control';
              const isRelayPilot = d.project === 'relay-test';

              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => {
                    setSelectedDevice(d);
                    setActiveTab('dashboard');
                    setLinkMessage('');
                  }}
                  className={`flex flex-col justify-between p-3 rounded-xl border text-left transition-all duration-200 cursor-pointer ${
                    isSelected
                      ? isLight
                        ? 'border-amber-400/80 bg-amber-500/20 shadow-md shadow-amber-500/20 ring-1 ring-amber-400'
                        : 'border-cyan-400/80 bg-cyan-500/20 shadow-md shadow-cyan-500/20 ring-1 ring-cyan-400'
                      : 'border-slate-800/80 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/90'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span className="font-mono text-[10px] text-slate-400 truncate">{d.key}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                      isLight
                        ? 'bg-amber-400/20 text-amber-300'
                        : isRelayPilot
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-slate-800 text-slate-400'
                    }`}>
                      {isLight ? 'Target' : isRelayPilot ? 'Verified' : 'Fleet'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isLight ? (
                      <Lightbulb className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-amber-300 fill-amber-300' : 'text-amber-400'}`} />
                    ) : isRelayPilot ? (
                      <Cpu className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-cyan-300' : 'text-cyan-400'}`} />
                    ) : d.project === 'water-tank-monitor' ? (
                      <Droplets className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                    ) : d.project === 'fuel-tank-monitor' ? (
                      <Fuel className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    ) : d.project === 'prepaid-energy-meter' ? (
                      <Zap className="h-3.5 w-3.5 shrink-0 text-yellow-400" />
                    ) : d.project === 'fan-regulator' ? (
                      <Wind className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                    ) : (
                      <FlaskConical className="h-3.5 w-3.5 shrink-0 text-purple-400" />
                    )}
                    <p className={`text-xs font-bold truncate ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                      {d.name.split('·')[0].replace('ESP32 ', '').replace('GKB ', '')}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {linkMessage && (
          <div className={`mb-6 p-3 rounded-xl text-xs border ${linkMessageIsError ? 'bg-amber-500/10 border-amber-500/30 text-amber-200' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'}`}>
            {linkMessage}
          </div>
        )}

        {/* ================= PRIMARY DASHBOARD VIEW ================= */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-fadeIn">
            {selectedDevice.project === 'relay-test' ? (
              <RelayTestDashboard mode="service" />
            ) : selectedDevice.project === 'light-control' ? (
              <LightControlDashboard mode="service" device={selectedDevice} />
            ) : (
              <GenericFleetPreviewDashboard
                device={selectedDevice}
                onSwitchToLightControl={() => setSelectedDevice(defaultDevices[1])}
                onSwitchToRelayPilot={() => setSelectedDevice(defaultDevices[0])}
              />
            )}
          </div>
        )}

        {/* ================= SUPPORT VIEW ================= */}
        {activeTab === 'support' && (
          <div className="max-w-3xl mx-auto space-y-6 animate-fadeIn">
            <div className="rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-6 space-y-3">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Wrench className="h-5 w-5 text-cyan-400" /> Hardware Provisioning & Troubleshooting
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Step-by-step guidance for provisioning, flashing, and operating the GKB ESP32 Smart Relay module.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-2">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Bluetooth className="h-4 w-4 text-cyan-400" /> Web Bluetooth Requirements
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Web Bluetooth is supported natively on Google Chrome, Microsoft Edge, and Opera on Windows, macOS, Linux, and Android. On iOS devices, Web Bluetooth requires browsers like Bluefy.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-2">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Key className="h-4 w-4 text-purple-400" /> Factory Reset (Clear Wi-Fi)
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  To wipe stored Wi-Fi credentials and return the ESP32 to BLE pairing mode, hold the onboard <strong>BOOT button (GPIO 0) for 5 seconds</strong>. The status LED will flash 5 times.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ================= CONTACT VIEW ================= */}
        {activeTab === 'contact' && (
          <div className="max-w-2xl mx-auto space-y-6 animate-fadeIn text-center">
            <div className="rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-8 space-y-4">
              <h3 className="text-2xl font-black text-white">GKB Technologies Hardware Engineering</h3>
              <p className="text-xs text-slate-300 leading-relaxed max-w-lg mx-auto">
                Dedicated client & enterprise engineering support for IoT telemetry nodes, microcontroller firmware, and embedded relay controllers.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-mono text-cyan-300 pt-3">
                <span className="flex items-center gap-1.5"><Mail className="h-4 w-4 text-cyan-400" /> support@gkb-technologies.com</span>
                <span className="flex items-center gap-1.5"><Globe className="h-4 w-4 text-purple-400" /> https://gkb-devices.netlify.app</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Login Modal */}
      {loginModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fadeIn">
          <div className="relative w-full max-w-md rounded-2xl border border-cyan-500/40 bg-slate-950 p-6 text-white shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold">{creatingAccount ? 'Create Portal Account' : 'Portal Sign In'}</h3>
              <button type="button" onClick={() => setLoginModalOpen(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>

            {loginError && <p className="text-xs text-red-300 bg-red-500/10 p-2.5 rounded-lg border border-red-500/30">{loginError}</p>}
            {loginMessage && <p className="text-xs text-emerald-300 bg-emerald-500/10 p-2.5 rounded-lg border border-emerald-500/30">{loginMessage}</p>}

            <form onSubmit={handleAuthSubmit} className="space-y-3 text-xs">
              {creatingAccount && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="First Name"
                    value={signupFirstName}
                    onChange={e => setSignupFirstName(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2.5 text-white focus:border-cyan-400"
                    required
                  />
                  <input
                    type="text"
                    placeholder="Last Name"
                    value={signupLastName}
                    onChange={e => setSignupLastName(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2.5 text-white focus:border-cyan-400"
                    required
                  />
                </div>
              )}
              <input
                type="email"
                placeholder="Email Address"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2.5 text-white focus:border-cyan-400"
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2.5 text-white focus:border-cyan-400"
                required
              />
              <button
                type="submit"
                disabled={loginBusy}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 text-black font-bold uppercase tracking-wider text-xs hover:opacity-90 cursor-pointer"
              >
                {loginBusy ? 'Authenticating...' : creatingAccount ? 'Register Account' : 'Sign In'}
              </button>
            </form>

            <div className="text-center pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setCreatingAccount(!creatingAccount)}
                className="text-xs text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
              >
                {creatingAccount ? 'Already registered? Sign In' : 'New Client? Create Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
