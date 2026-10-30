import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { relayControlEnabled, relaySupabase, relaySupabaseConfigError } from './supabase';
import BleProvisioningModal from './BleProvisioningModal';
import LightControlDashboard from './LightControlDashboard';
import WaterTankDashboard from './WaterTankDashboard';
import SmartSecurityDashboard from './SmartSecurityDashboard';
import FanRegulatorDashboard from './FanRegulatorDashboard';
import {
  Cpu, Shield, Wrench, Phone, Mail, Globe,
  User, Lock, LogOut, CheckCircle, AlertTriangle,
  ArrowRight, Sun, Moon, Zap, Wifi, Radio, Key,
  Copy, Download, Code, Check, Printer, Bluetooth, QrCode, X, RefreshCw,
  Layers, Lightbulb, Power, Droplets, Fuel, Gauge, Wind, FlaskConical,
  ShieldCheck, Sparkles, MapPin, Plus, Trash2, Search, CheckCircle2
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
  | 'smart-security-system'
  | 'fuel-tank-monitor'
  | 'prepaid-energy-meter'
  | 'fan-regulator'
  | 'alcohol-breathalyzer';

export type PortalTab = 'fleet' | 'deploy' | 'my-devices' | 'add-device' | 'dashboard' | 'support' | 'contact';

export type Device = {
  id: number;
  name: string;
  key: string;
  status: string;
  lastAlert: string;
  project?: StudentProject;
  legacyKeys?: string[];
  relayChannels?: 2 | 4 | 6 | 8;
  paused?: boolean;
};

// ================= GKB HARDWARE FLEET =================
const defaultDevices: Device[] = [
  {
    id: 1,
    name: 'ESP32 Smart Relay Pilot (Single Relay)',
    key: 'GKB-RELAY-0001',
    legacyKeys: ['GKB-RELAY-0001'],
    status: 'Verified',
    lastAlert: 'Single Relay Active · BLE & QR Verified · GPIO 23 Cloud Switched',
    project: 'relay-test'
  },
  {
    id: 2,
    name: 'Smart Light Controls (Multi-Channel Relay)',
    key: 'GKB-LIGHT-0001',
    legacyKeys: ['GKB-LIGHT-0001V1', 'GKB-LIGHT-0001V2', 'GKB-LIGHT-0001V3', 'GKB-LIGHTV1-0001', 'GKB-RELAY-0001'],
    status: 'Active Target',
    lastAlert: 'Universal 2, 4, 6 & 8-Channel Relay Board · Unified Firmware · Dropdown Configured',
    project: 'light-control',
    relayChannels: 4
  },
  {
    id: 5,
    name: 'Smart Water Tank Monitor',
    key: 'GKB-SWP-0001',
    legacyKeys: ['GKB-WTR-4412'],
    status: 'Active Target',
    lastAlert: 'JSN-SR04T Ultrasonic Telemetry · Submersible Pump Relay GPIO 23 · BLE & QR Provisioning',
    project: 'water-tank-monitor'
  },
  {
    id: 3,
    name: 'Smart Home Security System v1',
    key: 'GKB-SEC-0001',
    status: 'Active Target',
    lastAlert: 'PIR Motion (GPIO 15) · Siren Strobe (GPIO 23) · Buzzer (GPIO 19) · GSM SIM800L Auto-Dial & SMS',
    project: 'smart-security-system'
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
    status: 'Active Target',
    lastAlert: 'Multi-speed capacitor relay bank · DHT22 Environmental Telemetry · Auto-Thermal Trigger',
    project: 'fan-regulator'
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

function generateRelayArduinoCode(deviceKey: string = 'GKB-RELAY-0001'): string {
  const baseCode = "/*\n * =========================================================================================\n * GKB TECHNOLOGIES — ESP32 RELAY PILOT: BLE + QR CODE PROVISIONING & CLOUD CONTROL\n * =========================================================================================\n * Target Board       : ESP32 Dev Module / NodeMCU-32S / ESP-WROOM-32\n * Device Token Model : Unique Hardware Casing Token (Default: GKB-RELAY-0001)\n * Target Output      : 5V/3.3V Smart Relay Channel (GPIO 23)\n * Status Diagnostic  : Onboard Blue LED (GPIO 2)\n * Factory Reset Button: Onboard BOOT Button (GPIO 0, Hold for 5s)\n * Storage Engine     : Non-Volatile Flash Partition (ESP32 Preferences.h / NVS)\n * Connectivity       : Dual-Mode (BLE 4.2 GATT Provisioning + 2.4GHz Wi-Fi Cloud Polling)\n * Cloud Backend      : Supabase public.relay_status (device_id: relay_01)\n * =========================================================================================\n * WORKFLOW SPECIFICATION:\n * 1. Boot-up:\n *    - Reads Preferences NVS namespace (\"gkb_prov\").\n *    - If provisioned: Connects directly to saved Wi-Fi and begins operational cloud relay control.\n *    - If unprovisioned: Starts BLE GATT Server with advertising name \"GKB-RELAY-0001\".\n *\n * 2. Web App & BLE Handshake:\n *    - User opens the relay test portal at https://gkb-devices.netlify.app/\n *    - Web Bluetooth scans and connects to BLE Service: 4fafc201-1fb5-459e-8fcc-c5c9c331914b\n *\n * 3. Device QR Tagging & Verification:\n *    - User scans the physical QR code sticker on the ESP32 module casing (e.g. GKB-RELAY-0001).\n *    - App transmits \"VERIFY:GKB-RELAY-0001\" over RX characteristic.\n *    - ESP32 compares against internal deviceKey.\n *    - If match -> Returns \"AUTH_SUCCESS:DEVICE_UNLOCKED\".\n *\n * 4. Credential Transfer & Flash Storage:\n *    - App sends \"SET_WIFI:{\\\"ssid\\\":\\\"...\\\",\\\"pass\\\":\\\"...\\\"}\" over BLE.\n *    - ESP32 writes SSID & Password to Preferences.h NVS.\n *    - ESP32 transmits \"CONFIG_SAVED:REBOOTING\" and restarts.\n *\n * 5. Operational Relay Operation:\n *    - ESP32 joins local Wi-Fi and polls Supabase relay_status table for relay_01.\n *    - Updates GPIO 23 (HIGH = ON, LOW = OFF) with real-time web portal sync.\n * =========================================================================================\n */\n\n#include <WiFi.h>\n#include <WiFiClientSecure.h>\n#include <HTTPClient.h>\n#include <Preferences.h>\n#include <BLEDevice.h>\n#include <BLEServer.h>\n#include <BLEUtils.h>\n#include <BLE2902.h>\n\n// ================= HARDWARE PINOUT ASSIGNMENTS =================\n#define PIN_RELAY_OUTPUT    23   // ESP32 GPIO 23 -> Relay Signal IN (IN1)\n#define PIN_STATUS_LED      2    // ESP32 GPIO 2  -> Onboard Blue LED\n#define PIN_BOOT_BUTTON     0    // ESP32 GPIO 0  -> BOOT Button (Factory Reset)\n\n// Default Relay Logic (Set to true if your relay module is Active HIGH, false if Active LOW)\n#define RELAY_ACTIVE_HIGH   true\n\n// ================= DEVICE IDENTITY & SECURITY KEY =================\n// Physical QR code label token on device casing:\n#define DEFAULT_DEVICE_KEY  \"GKB-RELAY-0001\"\n\n// ================= BLE GATT SPECIFICATIONS =================\n#define GKB_BLE_SERVICE_UUID        \"4fafc201-1fb5-459e-8fcc-c5c9c331914b\"\n#define GKB_BLE_CHAR_RX_UUID        \"beb5483e-36e1-4688-b7f5-ea07361b26a8\" // Phone writes to ESP32\n#define GKB_BLE_CHAR_TX_UUID        \"beb5483f-36e1-4688-b7f5-ea07361b26a9\" // ESP32 notifies Phone\n\n// ================= SUPABASE CLOUD REST ENDPOINT =================\n// Supabase REST endpoint for relay_01:\nconst char* SUPABASE_REST_URL = \"https://ditnksmvcacnzdguqcgz.supabase.co/rest/v1/relay_status?device_id=eq.relay_01&select=state\";\n// Valid Supabase publishable key for public.relay_status:\nconst char* SUPABASE_ANON_KEY = \"sb_publishable_33KQl1SmvaBaqNzxWJiyzw_HuLMgWAl\";\n\n// ================= SYSTEM STATE =================\nPreferences preferences;\n\nenum DeviceOperatingMode {\n  MODE_PROVISIONING_BLE,\n  MODE_CONNECTING_WIFI,\n  MODE_OPERATIONAL_CLOUD,\n  MODE_STANDALONE_FAILSAFE\n};\n\nDeviceOperatingMode currentMode = MODE_PROVISIONING_BLE;\n\nString deviceKey          = DEFAULT_DEVICE_KEY;\nString wifiSSID           = \"\";\nString wifiPassword       = \"\";\nbool   isProvisioned      = false;\nbool   bleClientConnected = false;\nbool   qrAuthenticated    = false;\nbool   currentRelayState  = false;\n\nBLEServer*         pBleServer         = nullptr;\nBLECharacteristic* pTxCharacteristic = nullptr;\n\nunsigned long lastCloudPollTime    = 0;\nconst unsigned long CLOUD_POLL_MS  = 2500; // Poll cloud relay state every 2.5s\nunsigned long bootButtonPressTime  = 0;\nbool isBootButtonPressed           = false;\nbool pendingReboot                 = false;\nunsigned long rebootScheduledAt    = 0;\n\n// ================= FUNCTION PROTOTYPES =================\nvoid loadStoredCredentials();\nvoid saveWiFiCredentials(const String& ssid, const String& pass);\nvoid factoryResetPreferences();\nvoid initBLEProvisioningServer();\nvoid sendBLEResponse(const String& message);\nvoid connectToConfiguredWiFi();\nvoid pollCloudRelayState();\nvoid applyRelayOutput(bool state);\nString extractJsonField(const String& json, const String& key);\n\n// ================= BLE SERVER CALLBACKS =================\nclass GkbRelayServerCallbacks : public BLEServerCallbacks {\n  void onConnect(BLEServer* pServer) override {\n    bleClientConnected = true;\n    qrAuthenticated    = false; // Every new connection requires fresh QR verification\n    Serial.println(\"📱 [BLE] Mobile / Web Client Connected!\");\n    digitalWrite(PIN_STATUS_LED, HIGH);\n  }\n\n  void onDisconnect(BLEServer* pServer) override {\n    bleClientConnected = false;\n    qrAuthenticated    = false;\n    Serial.println(\"📱 [BLE] Client Disconnected. Re-advertising...\");\n    digitalWrite(PIN_STATUS_LED, LOW);\n    if (currentMode == MODE_PROVISIONING_BLE && pBleServer) {\n      pBleServer->startAdvertising();\n    }\n  }\n};\n\nclass GkbRelayCharacteristicCallbacks : public BLECharacteristicCallbacks {\n  void onWrite(BLECharacteristic* pCharacteristic) override {\n    String rxValue = pCharacteristic->getValue().c_str();\n    rxValue.trim();\n    if (rxValue.length() == 0) return;\n\n    Serial.print(\"📩 [BLE-RX] Received: \");\n    Serial.println(rxValue);\n\n    // 1. QR Code Security Key Verification (Phase 2 Step 2)\n    if (rxValue.startsWith(\"VERIFY:\")) {\n      String submittedKey = rxValue.substring(7);\n      submittedKey.trim();\n\n      Serial.print(\"🔍 Verifying QR Key: [\");\n      Serial.print(submittedKey);\n      Serial.print(\"] vs Stored Key: [\");\n      Serial.print(deviceKey);\n      Serial.println(\"]\");\n\n      if (submittedKey.equalsIgnoreCase(deviceKey) || submittedKey.equalsIgnoreCase(DEFAULT_DEVICE_KEY) || submittedKey.equalsIgnoreCase(\"GKB-RELAY-0001\")) {\n        qrAuthenticated = true;\n        Serial.println(\"✅ [AUTH] QR Security Key Verified! Access Granted.\");\n        sendBLEResponse(\"AUTH_SUCCESS:DEVICE_UNLOCKED\");\n      } else {\n        qrAuthenticated = false;\n        Serial.println(\"❌ [AUTH] Security Key Mismatch! Rejected.\");\n        sendBLEResponse(\"AUTH_FAILED:INVALID_KEY\");\n      }\n      return;\n    }\n\n    // 2. Wi-Fi Credential Transfer & Storage (Phase 2 Step 3)\n    if (rxValue.startsWith(\"SET_WIFI:\")) {\n      if (!qrAuthenticated) {\n        Serial.println(\"⚠️ [SECURITY] Rejected Wi-Fi configuration without QR verification!\");\n        sendBLEResponse(\"AUTH_REQUIRED:SCAN_QR_FIRST\");\n        return;\n      }\n\n      String jsonPayload = rxValue.substring(9);\n      String incomingSSID = extractJsonField(jsonPayload, \"ssid\");\n      String incomingPass = extractJsonField(jsonPayload, \"pass\");\n\n      if (incomingSSID.length() == 0) {\n        sendBLEResponse(\"CONFIG_ERROR:EMPTY_SSID\");\n        return;\n      }\n\n      Serial.println(\"💾 [NVS] Saving Wi-Fi Credentials via Preferences.h...\");\n      Serial.print(\"   SSID: \"); Serial.println(incomingSSID);\n\n      saveWiFiCredentials(incomingSSID, incomingPass);\n      sendBLEResponse(\"CONFIG_SAVED:REBOOTING\");\n\n      // Non-blocking scheduled restart: Allows BLE GATT Write Acknowledgment to flush cleanly to Chrome\n      pendingReboot = true;\n      rebootScheduledAt = millis() + 2500;\n      Serial.println(\"🔄 Wi-Fi saved! Scheduled restart into Cloud Relay Mode in 2.5s (flushing BLE buffers)...\"\n      );\n      return;\n    }\n\n    // 3. Status Query\n    if (rxValue == \"GET_STATUS\") {\n      String statusMsg = \"STATUS:\";\n      statusMsg += \"KEY=\" + deviceKey + \";\";\n      statusMsg += \"AUTH=\" + String(qrAuthenticated ? \"YES\" : \"NO\") + \";\";\n      statusMsg += \"PROV=\" + String(isProvisioned ? \"YES\" : \"NO\") + \";\";\n      statusMsg += \"RELAY=\" + String(currentRelayState ? \"ON\" : \"OFF\");\n      sendBLEResponse(statusMsg);\n      return;\n    }\n\n    // 4. Factory Reset Command\n    if (rxValue == \"FACTORY_RESET\") {\n      sendBLEResponse(\"RESET_CONFIRMED:REBOOTING\");\n      factoryResetPreferences();\n      pendingReboot = true;\n      rebootScheduledAt = millis() + 1500;\n      return;\n    }\n\n    sendBLEResponse(\"UNKNOWN_COMMAND\");\n  }\n};\n\n// ================= ARDUINO SETUP =================\nvoid setup() {\n  Serial.begin(115200);\n  delay(1200);\n\n  Serial.println(\"\\n=======================================================\");\n  Serial.println(\"⚡ GKB TECHNOLOGIES — ESP32 SMART RELAY PILOT\");\n  Serial.println(\"   BLE & QR Provisioning · Supabase Cloud Telemetry\");\n  Serial.println(\"=======================================================\");\n\n  pinMode(PIN_BOOT_BUTTON, INPUT_PULLUP);\n  pinMode(PIN_STATUS_LED, OUTPUT);\n  pinMode(PIN_RELAY_OUTPUT, OUTPUT);\n\n  // Default initial state: Relay OFF, LED OFF\n  applyRelayOutput(false);\n  digitalWrite(PIN_STATUS_LED, LOW);\n\n  // Load persistent credentials from Flash memory\n  loadStoredCredentials();\n\n  // Route based on provisioning state\n  if (isProvisioned && wifiSSID.length() > 0) {\n    Serial.println(\"⚡ Provisioned credentials located. Connecting to Wi-Fi...\");\n    currentMode = MODE_CONNECTING_WIFI;\n    connectToConfiguredWiFi();\n  } else {\n    Serial.println(\"🚀 Unprovisioned module. Launching BLE Provisioning Server...\");\n    currentMode = MODE_PROVISIONING_BLE;\n    initBLEProvisioningServer();\n  }\n}\n\n// ================= ARDUINO MAIN LOOP =================\nvoid loop() {\n  // 0. Non-blocking Scheduled Reboot Handler (allows clean BLE GATT ACK transmission before restart)\n  if (pendingReboot && millis() >= rebootScheduledAt) {\n    Serial.println(\"🔄 Rebooting ESP32 into Cloud Relay Mode...\");\n    ESP.restart();\n  }\n\n  // 1. Factory Reset Check (Hold BOOT button for 5 seconds)\n  if (digitalRead(PIN_BOOT_BUTTON) == LOW) {\n    if (!isBootButtonPressed) {\n      isBootButtonPressed = true;\n      bootButtonPressTime = millis();\n    } else {\n      if (millis() - bootButtonPressTime >= 5000) {\n        Serial.println(\"\\n⚠️ [RESET] BOOT Button held for 5s. Clearing NVS & Factory Resetting...\");\n        for (int i = 0; i < 5; i++) {\n          digitalWrite(PIN_STATUS_LED, HIGH);\n          delay(100);\n          digitalWrite(PIN_STATUS_LED, LOW);\n          delay(100);\n        }\n        factoryResetPreferences();\n        ESP.restart();\n      }\n    }\n  } else {\n    isBootButtonPressed = false;\n  }\n\n  // 2. State-Specific Operational Logic\n  if (currentMode == MODE_PROVISIONING_BLE) {\n    // Pulse Status LED to visually indicate BLE Advertising / Pairing Mode\n    static unsigned long lastBlink = 0;\n    if (!bleClientConnected && millis() - lastBlink > 700) {\n      lastBlink = millis();\n      digitalWrite(PIN_STATUS_LED, !digitalRead(PIN_STATUS_LED));\n    }\n  } else if (currentMode == MODE_OPERATIONAL_CLOUD) {\n    // Keep Status LED solid ON when connected and operational\n    digitalWrite(PIN_STATUS_LED, HIGH);\n\n    // Check Wi-Fi Connection Health\n    if (WiFi.status() != WL_CONNECTED) {\n      Serial.println(\"⚠️ [WI-FI] Connection dropped. Re-establishing link...\");\n      WiFi.reconnect();\n      delay(1000);\n      return;\n    }\n\n    // Periodically poll Supabase relay state\n    if (millis() - lastCloudPollTime >= CLOUD_POLL_MS) {\n      lastCloudPollTime = millis();\n      pollCloudRelayState();\n    }\n  }\n}\n\n// ================= BLE PROVISIONING ENGINE =================\nvoid initBLEProvisioningServer() {\n  // Advertise as GKB-RELAY-0001 (or GKB-PROV-0001)\n  String bleAdvertisedName = \"GKB-RELAY-0001\";\n  Serial.print(\"📶 [BLE] Initializing GATT Server: \");\n  Serial.println(bleAdvertisedName);\n\n  BLEDevice::init(bleAdvertisedName.c_str());\n  pBleServer = BLEDevice::createServer();\n  pBleServer->setCallbacks(new GkbRelayServerCallbacks());\n\n  BLEService* pService = pBleServer->createService(GKB_BLE_SERVICE_UUID);\n\n  // RX Characteristic (Web Bluetooth writes commands to ESP32)\n  BLECharacteristic* pRxCharacteristic = pService->createCharacteristic(\n    GKB_BLE_CHAR_RX_UUID,\n    BLECharacteristic::PROPERTY_WRITE\n  );\n  pRxCharacteristic->setCallbacks(new GkbRelayCharacteristicCallbacks());\n\n  // TX Characteristic (ESP32 sends real-time notifications to Web App)\n  pTxCharacteristic = pService->createCharacteristic(\n    GKB_BLE_CHAR_TX_UUID,\n    BLECharacteristic::PROPERTY_NOTIFY\n  );\n  pTxCharacteristic->addDescriptor(new BLE2902());\n\n  pService->start();\n\n  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();\n  pAdvertising->addServiceUUID(GKB_BLE_SERVICE_UUID);\n  pAdvertising->setScanResponse(true);\n  pAdvertising->setMinPreferred(0x06);\n  pAdvertising->setMinPreferred(0x12);\n  BLEDevice::startAdvertising();\n\n  Serial.println(\"📡 [BLE] Provisioning Server Active. Ready for Web Bluetooth & QR scan.\");\n}\n\nvoid sendBLEResponse(const String& message) {\n  if (pTxCharacteristic && bleClientConnected) {\n    pTxCharacteristic->setValue(message.c_str());\n    pTxCharacteristic->notify();\n    Serial.print(\"📤 [BLE-TX] Sent: \");\n    Serial.println(message);\n  }\n}\n\n// ================= NON-VOLATILE STORAGE (PREFERENCES.H) =================\nvoid loadStoredCredentials() {\n  preferences.begin(\"gkb_prov\", false);\n\n  if (!preferences.isKey(\"dev_key\")) {\n    preferences.putString(\"dev_key\", DEFAULT_DEVICE_KEY);\n    deviceKey = DEFAULT_DEVICE_KEY;\n  } else {\n    deviceKey = preferences.getString(\"dev_key\", DEFAULT_DEVICE_KEY);\n  }\n\n  isProvisioned = preferences.getBool(\"is_prov\", false);\n  wifiSSID      = preferences.getString(\"wifi_ssid\", \"\");\n  wifiPassword  = preferences.getString(\"wifi_pass\", \"\");\n\n  preferences.end();\n\n  Serial.print(\"🔑 Casing Device Key   : \"); Serial.println(deviceKey);\n  Serial.print(\"📦 Provisioning Status : \"); Serial.println(isProvisioned ? \"PROVISIONED\" : \"UNPROVISIONED\");\n  if (isProvisioned) {\n    Serial.print(\"📶 Saved Network SSID  : \"); Serial.println(wifiSSID);\n  }\n}\n\nvoid saveWiFiCredentials(const String& ssid, const String& pass) {\n  preferences.begin(\"gkb_prov\", false);\n  preferences.putString(\"wifi_ssid\", ssid);\n  preferences.putString(\"wifi_pass\", pass);\n  preferences.putBool(\"is_prov\", true);\n  preferences.end();\n\n  wifiSSID      = ssid;\n  wifiPassword  = pass;\n  isProvisioned = true;\n  Serial.println(\"✅ [NVS] Wi-Fi network saved to Flash memory partition.\");\n}\n\nvoid factoryResetPreferences() {\n  preferences.begin(\"gkb_prov\", false);\n  preferences.clear();\n  preferences.putString(\"dev_key\", DEFAULT_DEVICE_KEY);\n  preferences.end();\n  Serial.println(\"🧹 [NVS] Preferences cleared. Ready for fresh factory provisioning.\");\n}\n\n// ================= WI-FI & SUPABASE CLOUD RELAY =================\nvoid connectToConfiguredWiFi() {\n  Serial.print(\"🌐 Connecting to Wi-Fi SSID: [\");\n  Serial.print(wifiSSID);\n  Serial.print(\"] \");\n\n  WiFi.mode(WIFI_STA);\n  WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());\n\n  int attempts = 0;\n  while (WiFi.status() != WL_CONNECTED && attempts < 30) {\n    delay(400);\n    Serial.print(\".\");\n    attempts++;\n  }\n\n  if (WiFi.status() == WL_CONNECTED) {\n    currentMode = MODE_OPERATIONAL_CLOUD;\n    Serial.println(\"\\n🎉 Wi-Fi Connected! IP Address: \" + WiFi.localIP().toString());\n    digitalWrite(PIN_STATUS_LED, HIGH);\n    // Immediately fetch initial relay state\n    pollCloudRelayState();\n  } else {\n    currentMode = MODE_PROVISIONING_BLE;\n    Serial.println(\"\\n⚠️ Failed to join Wi-Fi. Returning to BLE Provisioning Server...\");\n    initBLEProvisioningServer();\n  }\n}\n\nvoid pollCloudRelayState() {\n  if (WiFi.status() != WL_CONNECTED) return;\n\n  WiFiClientSecure client;\n  // Use setInsecure to allow reliable HTTPS REST polling without requiring local NTP clock sync on the ESP32\n  client.setInsecure();\n\n  HTTPClient http;\n  if (http.begin(client, SUPABASE_REST_URL)) {\n    http.addHeader(\"apikey\", SUPABASE_ANON_KEY);\n    http.addHeader(\"Authorization\", String(\"Bearer \") + SUPABASE_ANON_KEY);\n    http.addHeader(\"Accept\", \"application/json\");\n\n    int httpCode = http.GET();\n    if (httpCode == HTTP_CODE_OK || httpCode == 200) {\n      String payload = http.getString();\n      // Payload format: [{\"state\":\"ON\"}] or [{\"state\":\"OFF\"}]\n      if (payload.indexOf(\"\\\"state\\\":\\\"ON\\\"\") != -1) {\n        if (!currentRelayState) {\n          Serial.println(\"⚡ [CLOUD RELAY] Switch Command: ON -> Engaging GPIO 23\");\n          applyRelayOutput(true);\n        }\n      } else if (payload.indexOf(\"\\\"state\\\":\\\"OFF\\\"\") != -1) {\n        if (currentRelayState) {\n          Serial.println(\"⚡ [CLOUD RELAY] Switch Command: OFF -> Releasing GPIO 23\");\n          applyRelayOutput(false);\n        }\n      }\n    } else {\n      Serial.print(\"⚠️ [CLOUD] Relay status poll returned HTTP \");\n      Serial.println(httpCode);\n    }\n    http.end();\n  }\n}\n\nvoid applyRelayOutput(bool state) {\n  currentRelayState = state;\n  if (RELAY_ACTIVE_HIGH) {\n    digitalWrite(PIN_RELAY_OUTPUT, state ? HIGH : LOW);\n  } else {\n    digitalWrite(PIN_RELAY_OUTPUT, state ? LOW : HIGH);\n  }\n}\n\n// Simple JSON extraction helper without requiring ArduinoJson library\nString extractJsonField(const String& json, const String& key) {\n  String searchKey = \"\\\"\" + key + \"\\\":\\\"\";\n  int startIdx = json.indexOf(searchKey);\n  if (startIdx == -1) {\n    searchKey = \"\\\"\" + key + \"\\\":\";\n    startIdx = json.indexOf(searchKey);\n    if (startIdx == -1) return \"\";\n    startIdx += searchKey.length();\n    int endIdx = json.indexOf(\",\", startIdx);\n    if (endIdx == -1) endIdx = json.indexOf(\"}\", startIdx);\n    if (endIdx == -1) return \"\";\n    String result = json.substring(startIdx, endIdx);\n    result.trim();\n    result.replace(\"\\\"\", \"\");\n    return result;\n  }\n  startIdx += searchKey.length();\n  int endIdx = json.indexOf(\"\\\"\", startIdx);\n  if (endIdx == -1) return \"\";\n  return json.substring(startIdx, endIdx);\n}\n";
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
            <Cpu className="h-4 w-4 text-cyan-400" /> Active Hardware: GKB-RELAY-0001
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
                  Target: GKB-RELAY-0001
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
              Scans physical QR sticker with phone camera. Transmits VERIFY:GKB-RELAY-0001 over BLE for hardware authentication.
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
        initialDeviceKey="GKB-RELAY-0001"
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
                    navigator.clipboard.writeText(generateRelayArduinoCode('GKB-RELAY-0001'));
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
                    const blob = new Blob([generateRelayArduinoCode('GKB-RELAY-0001')], { type: 'text/plain' });
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
              <code>{generateRelayArduinoCode('GKB-RELAY-0001')}</code>
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
  onSwitchToRelayPilot,
  onSwitchToWaterTank,
  onSwitchToSecurity,
  onSwitchToFanRegulator
}: {
  device: Device;
  onSwitchToLightControl: () => void;
  onSwitchToRelayPilot: () => void;
  onSwitchToWaterTank?: () => void;
  onSwitchToSecurity?: () => void;
  onSwitchToFanRegulator?: () => void;
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
      <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-cyan-500/10 via-slate-900 to-slate-900 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-300 shrink-0">
            <Shield className="h-6 w-6 text-red-400" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">Active Hardware Targets: Smart Security & Water Monitor</h4>
            <p className="text-xs text-slate-400">
              PIR Motion (GPIO 15), Siren Strobe (GPIO 23), Ultrasonic Tank Depth, and Web BLE Provisioning.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onSwitchToSecurity && (
            <button
              type="button"
              onClick={onSwitchToSecurity}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/50 bg-red-500/15 px-4 py-2 text-xs font-bold text-red-300 hover:bg-red-500/25 transition-all cursor-pointer shadow-md shadow-red-500/10"
            >
              <Shield className="h-4 w-4" /> Smart Security
            </button>
          )}
          {onSwitchToWaterTank && (
            <button
              type="button"
              onClick={onSwitchToWaterTank}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-2 text-xs font-bold text-slate-950 hover:opacity-90 transition-all cursor-pointer shadow-lg shadow-cyan-500/20"
            >
              <Droplets className="h-4 w-4" /> Water Tank Monitor
            </button>
          )}
          {onSwitchToFanRegulator && (
            <button
              type="button"
              onClick={onSwitchToFanRegulator}
              className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/50 bg-cyan-500/15 px-4 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-500/25 transition-all cursor-pointer shadow-md shadow-cyan-500/10"
            >
              <Wind className="h-4 w-4" /> Smart Fan
            </button>
          )}
          <button
            type="button"
            onClick={onSwitchToLightControl}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/20 transition-all cursor-pointer"
          >
            <Lightbulb className="h-4 w-4" /> Light Control
          </button>
          <button
            type="button"
            onClick={onSwitchToRelayPilot}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 hover:text-white transition-all cursor-pointer"
          >
            <Cpu className="h-4 w-4" /> Relay Pilot
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
  const [activeTab, setActiveTab] = useState<PortalTab>('my-devices');
  const [isLightMode, setIsLightMode] = useState(
    () => window.localStorage.getItem('gkb-theme') === 'light'
  );
  const [user, setUser] = useState<UserType | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
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

  // Admin identity check
  const isAdmin = Boolean(user && (user.role === 'admin' || user.email?.toLowerCase() === 'zumkel023@gmail.com'));

  // ================= DEPLOYED HARDWARE REGISTRY (Admin Deployed Keys) =================
  const [deployedDevices, setDeployedDevices] = useState<Device[]>(() => {
    try {
      const stored = window.localStorage.getItem('gkb-deployed-devices');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return defaultDevices;
  });

  // ================= CLIENT LINKED DEVICES (User's Saved Hardware) =================
  const [linkedDevices, setLinkedDevices] = useState<Device[]>(() => {
    try {
      const stored = window.localStorage.getItem('gkb-user-linked-devices');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  // Selected device for live dashboard
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(defaultDevices[1]);

  // Bluetooth Provisioning Modal State
  const [bleModalOpen, setBleModalOpen] = useState(false);
  const [bleTargetDevice, setBleTargetDevice] = useState<Device | null>(null);

  // Client "Add New Device" State
  const [clientKeyInput, setClientKeyInput] = useState('');
  const [clientLinkBusy, setClientLinkBusy] = useState(false);
  const [clientLinkError, setClientLinkError] = useState('');
  const [clientLinkSuccess, setClientLinkSuccess] = useState('');

  // Admin "Deploy Hardware Key" Form State
  const [deployKey, setDeployKey] = useState('');
  const [deployName, setDeployName] = useState('');
  const [deployProject, setDeployProject] = useState<StudentProject>('relay-test');
  const [deployChannels, setDeployChannels] = useState<2 | 4 | 6 | 8>(4);
  const [deployNotes, setDeployNotes] = useState('');
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployError, setDeployError] = useState('');
  const [deploySuccess, setDeploySuccess] = useState('');
  const [deploySearchFilter, setDeploySearchFilter] = useState('');

  // General fleet connector state
  const [inputKey, setInputKey] = useState('');
  const [linkMessage, setLinkMessage] = useState('');
  const [linkMessageIsError, setLinkMessageIsError] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);

  useEffect(() => {
    window.localStorage.setItem('gkb-devices', JSON.stringify(defaultDevices));
  }, []);

  useEffect(() => {
    window.localStorage.setItem('gkb-theme', isLightMode ? 'light' : 'dark');
  }, [isLightMode]);

  // Fetch Admin Deployed Devices from Supabase public.gkb_deployed_devices
  const fetchDeployedDevices = useCallback(async () => {
    if (!relaySupabase) return;
    try {
      const { data, error } = await relaySupabase
        .from('gkb_deployed_devices')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data && Array.isArray(data) && data.length > 0) {
        const customDevices: Device[] = data.map((row: any, idx: number) => ({
          id: 1000 + idx,
          name: row.device_name,
          key: row.device_key,
          status: row.status || 'Verified',
          lastAlert: row.last_alert || 'Hardware key active on cloud',
          project: row.project as StudentProject,
          relayChannels: row.relay_channels
        }));

        const combined = [...defaultDevices];
        for (const cd of customDevices) {
          const existingIdx = combined.findIndex(d => d.key.toUpperCase() === cd.key.toUpperCase());
          if (existingIdx >= 0) {
            combined[existingIdx] = { ...combined[existingIdx], ...cd };
          } else {
            combined.push(cd);
          }
        }
        setDeployedDevices(combined);
        window.localStorage.setItem('gkb-deployed-devices', JSON.stringify(combined));
      }
    } catch (err) {
      console.warn('Could not load deployed devices from Supabase:', err);
    }
  }, []);

  useEffect(() => {
    void fetchDeployedDevices();
  }, [fetchDeployedDevices]);

  // Load Client Linked Devices from Supabase public.gkb_user_devices
  useEffect(() => {
    if (!user) {
      setLinkedDevices([]);
      return;
    }
    let disposed = false;
    const fetchUserDevices = async () => {
      // 1. Check local storage cache for this user
      try {
        const local = window.localStorage.getItem(`gkb-linked-devices:${user.id}`);
        if (local && !disposed) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setLinkedDevices(parsed);
          }
        }
      } catch {}

      // 2. Fetch from Supabase gkb_user_devices
      if (!relaySupabase) return;
      try {
        const { data, error } = await relaySupabase
          .from('gkb_user_devices')
          .select('*')
          .eq('user_id', user.id);
        if (disposed) return;
        if (!error && data) {
          const mapped: Device[] = data.map((row: any) => {
            const catalogMatch = deployedDevices.find(d => d.key.toUpperCase() === row.device_key.toUpperCase());
            return {
              id: catalogMatch?.id || (Date.now() + Math.random()),
              name: row.device_name || catalogMatch?.name || 'GKB Smart Device',
              key: row.device_key,
              status: row.status || catalogMatch?.status || 'Verified Node',
              lastAlert: row.last_alert || catalogMatch?.lastAlert || 'Active telemetry node',
              project: (row.project || catalogMatch?.project || 'smart-security-system') as StudentProject,
              relayChannels: row.relay_channels || catalogMatch?.relayChannels
            };
          });
          setLinkedDevices(mapped);
          window.localStorage.setItem(`gkb-linked-devices:${user.id}`, JSON.stringify(mapped));
          if (mapped.length > 0) {
            setSelectedDevice(prev => {
              if (prev && mapped.some(d => d.key === prev.key)) return prev;
              return mapped[0];
            });
          }
        }
      } catch (err) {
        console.warn('Could not load user devices from Supabase:', err);
      }
    };

    void fetchUserDevices();
    return () => { disposed = true; };
  }, [user, deployedDevices]);

  // Route activeTab correctly based on role when session is loaded
  useEffect(() => {
    if (!sessionLoading && user) {
      if (isAdmin) {
        // Admin default
        if (activeTab === 'add-device') setActiveTab('deploy');
      } else {
        // Client: Cannot access full fleet or deploy tabs
        if (activeTab === 'fleet' || activeTab === 'deploy') {
          setActiveTab('my-devices');
        }
      }
    }
  }, [user, isAdmin, sessionLoading]);

  // Auth session management
  const applyPortalSession = useCallback(async (session: Session | null) => {
    if (!session?.user.email && !session?.user.phone) {
      setUser(null);
      return;
    }
    const metadata = session.user.user_metadata;
    let role: 'admin' | 'client' = (metadata?.role === 'admin' || session.user.email?.toLowerCase() === 'zumkel023@gmail.com') ? 'admin' : 'client';
    if (relaySupabase) {
      try {
        const { data } = await relaySupabase
          .from('gkb_user_roles')
          .select('role')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (data?.role === 'admin') role = 'admin';
      } catch {
        // ignore fallback
      }
    }
    const account: UserType = {
      id: session.user.id,
      role,
      email: session.user.email || '',
      firstName: typeof metadata?.first_name === 'string' ? metadata.first_name : '',
      lastName: typeof metadata?.last_name === 'string' ? metadata.last_name : '',
      phone: session.user.phone || (typeof metadata?.phone === 'string' ? metadata.phone : ''),
      location: typeof metadata?.location === 'string' ? metadata.location : ''
    };
    setUser(account);
    if (role === 'admin') {
      setActiveTab('fleet');
    } else {
      setActiveTab('my-devices');
    }
  }, []);

  useEffect(() => {
    if (!relaySupabase) {
      setSessionLoading(false);
      return;
    }
    let disposed = false;
    const { data: { subscription } } = relaySupabase.auth.onAuthStateChange((_event, session) => {
      if (!disposed) {
        void applyPortalSession(session);
        setSessionLoading(false);
      }
    });
    void relaySupabase.auth.getSession().then(({ data }) => {
      if (!disposed) {
        void applyPortalSession(data.session);
        setSessionLoading(false);
      }
    }).catch(() => {
      if (!disposed) setSessionLoading(false);
    });
    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, [applyPortalSession]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relaySupabase) {
      setLoginError(relaySupabaseConfigError || 'Database connection error.');
      return;
    }
    setLoginBusy(true);
    setLoginError('');
    setLoginMessage('');

    try {
      if (creatingAccount) {
        const { data, error } = await relaySupabase.auth.signUp({
          email: loginEmail.trim(),
          password: loginPassword,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              first_name: signupFirstName.trim(),
              last_name: signupLastName.trim(),
              phone: signupPhone.trim(),
              location: signupLocation.trim()
            }
          }
        });
        if (error) throw error;
        if (!data.session) {
          setLoginMessage('Account created! Check your email to confirm your address, then sign in.');
          setCreatingAccount(false);
          setLoginPassword('');
          return;
        }
      } else {
        const identifier = loginEmail.trim();
        const credentials = identifier.includes('@')
          ? { email: identifier, password: loginPassword }
          : { phone: identifier, password: loginPassword };
        const { error } = await relaySupabase.auth.signInWithPassword(credentials);
        if (error) throw error;
      }
      setLoginModalOpen(false);
      setLoginError('');
      setLoginMessage('');
    } catch (err) {
      setLoginError(formatSupabaseError(err));
    } finally {
      setLoginBusy(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!loginEmail.trim() || !relaySupabase) return;
    setLoginBusy(true);
    try {
      const { error } = await relaySupabase.auth.resend({
        type: 'signup',
        email: loginEmail.trim()
      });
      if (error) throw error;
      setLoginMessage('Confirmation email resent. Check your inbox and spam folder.');
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
    setLinkedDevices([]);
  };

  // ================= CLIENT ACTION: VERIFY KEY & CONNECT VIA BLUETOOTH =================
  const handleClientKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setClientLinkBusy(true);
    setClientLinkError('');
    setClientLinkSuccess('');

    const clean = clientKeyInput.trim().toUpperCase();
    if (!clean) {
      setClientLinkError('Please enter your hardware device key.');
      setClientLinkBusy(false);
      return;
    }

    // 1. Verify if key exists in deployed devices (Admin deployed fleet)
    const matched = deployedDevices.find(d =>
      d.key.toUpperCase() === clean ||
      d.legacyKeys?.some(k => k.toUpperCase() === clean)
    );

    if (!matched) {
      setClientLinkError(
        `❌ Invalid Device Key: Hardware key "${clean}" does not exist or has not been deployed by GKB Technologies. Please check the label on your physical casing or contact GKB support.`
      );
      setClientLinkBusy(false);
      return;
    }

    // 2. Verified! Save link to user's account and launch Bluetooth pairing
    try {
      if (user && relaySupabase) {
        await relaySupabase.from('gkb_user_devices').upsert({
          user_id: user.id,
          device_key: matched.key,
          device_name: matched.name,
          status: matched.status,
          last_alert: matched.lastAlert,
          project: matched.project ?? null,
          relay_channels: matched.relayChannels ?? null
        }, { onConflict: 'user_id,device_key' });
      }

      const nextList = linkedDevices.some(d => d.key === matched.key)
        ? linkedDevices
        : [...linkedDevices, matched];
      setLinkedDevices(nextList);
      if (user) {
        window.localStorage.setItem(`gkb-linked-devices:${user.id}`, JSON.stringify(nextList));
      }

      setSelectedDevice(matched);
      setBleTargetDevice(matched);
      setClientLinkSuccess(`✅ Hardware Key "${matched.key}" verified for ${matched.name}! Launching Bluetooth pairing...`);
      setClientKeyInput('');

      // Open Bluetooth Provisioning Modal
      setBleModalOpen(true);
    } catch (err) {
      console.error('Failed to save linked device:', err);
      // Fallback local save for smooth UX
      const nextList = linkedDevices.some(d => d.key === matched.key)
        ? linkedDevices
        : [...linkedDevices, matched];
      setLinkedDevices(nextList);
      setSelectedDevice(matched);
      setBleTargetDevice(matched);
      setClientLinkSuccess(`✅ Hardware Key "${matched.key}" verified for ${matched.name}! Launching Bluetooth pairing...`);
      setClientKeyInput('');
      setBleModalOpen(true);
    } finally {
      setClientLinkBusy(false);
    }
  };

  // ================= CLIENT ACTION: UNLINK DEVICE =================
  const handleUnlinkClientDevice = async (device: Device) => {
    if (!window.confirm(`Unlink "${device.name}" (${device.key}) from your account? This removes it from your active device list.`)) {
      return;
    }
    try {
      if (user && relaySupabase) {
        await relaySupabase
          .from('gkb_user_devices')
          .delete()
          .eq('user_id', user.id)
          .eq('device_key', device.key);
      }
      const updated = linkedDevices.filter(d => d.key !== device.key);
      setLinkedDevices(updated);
      if (user) {
        window.localStorage.setItem(`gkb-linked-devices:${user.id}`, JSON.stringify(updated));
      }
      if (selectedDevice?.key === device.key) {
        setSelectedDevice(updated.length > 0 ? updated[0] : null);
      }
    } catch (err) {
      console.error('Failed to unlink device:', err);
    }
  };

  // ================= ADMIN ACTION: DEPLOY HARDWARE KEY =================
  const handleAdminDeployKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setDeployBusy(true);
    setDeployError('');
    setDeploySuccess('');

    const cleanKey = deployKey.trim().toUpperCase();
    const cleanName = deployName.trim();
    if (!cleanKey) {
      setDeployError('Please enter a hardware device key (e.g. GKB-RELAY-0002, GKB-FAN-0002).');
      setDeployBusy(false);
      return;
    }
    if (!cleanName) {
      setDeployError('Please enter a descriptive device name.');
      setDeployBusy(false);
      return;
    }

    const newDevice: Device = {
      id: Date.now(),
      name: cleanName,
      key: cleanKey,
      project: deployProject,
      relayChannels: deployProject === 'light-control' ? deployChannels : undefined,
      status: 'Verified',
      lastAlert: deployNotes.trim() || `Hardware key deployed by Admin (${new Date().toLocaleDateString()})`
    };

    try {
      if (relaySupabase) {
        const { error } = await relaySupabase.from('gkb_deployed_devices').upsert({
          device_key: cleanKey,
          device_name: cleanName,
          project: deployProject,
          relay_channels: deployProject === 'light-control' ? deployChannels : null,
          status: 'Verified',
          last_alert: newDevice.lastAlert
        }, { onConflict: 'device_key' });
        if (error) {
          console.warn('Supabase upsert warning on gkb_deployed_devices:', error.message);
        }
      }

      const updated = [...deployedDevices];
      const existingIdx = updated.findIndex(d => d.key.toUpperCase() === cleanKey);
      if (existingIdx >= 0) {
        updated[existingIdx] = newDevice;
      } else {
        updated.unshift(newDevice);
      }
      setDeployedDevices(updated);
      window.localStorage.setItem('gkb-deployed-devices', JSON.stringify(updated));

      setDeploySuccess(`✅ Hardware Key "${cleanKey}" successfully deployed for "${cleanName}"! Clients can now link and pair this hardware.`);
      setDeployKey('');
      setDeployName('');
      setDeployNotes('');
    } catch (err) {
      setDeployError(formatSupabaseError(err));
    } finally {
      setDeployBusy(false);
    }
  };

  // ================= ADMIN ACTION: REVOKE / DELETE KEY =================
  const handleAdminRevokeKey = async (keyToRevoke: string) => {
    if (!isAdmin) return;
    if (!window.confirm(`Are you sure you want to revoke and delete hardware key "${keyToRevoke}"? Clients will no longer be able to link this device.`)) {
      return;
    }
    try {
      if (relaySupabase) {
        await relaySupabase
          .from('gkb_deployed_devices')
          .delete()
          .eq('device_key', keyToRevoke);
      }
      const updated = deployedDevices.filter(d => d.key.toUpperCase() !== keyToRevoke.toUpperCase());
      setDeployedDevices(updated);
      window.localStorage.setItem('gkb-deployed-devices', JSON.stringify(updated));
    } catch (err) {
      console.error('Failed to revoke key:', err);
    }
  };

  // Admin Fleet Quick Key Search
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

    const matched = deployedDevices.find(d =>
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
      setLinkMessage(`No hardware device registered with key "${clean}". Verify key or deploy new hardware.`);
    }
    setLinkBusy(false);
  };

  if (sessionLoading) {
    return (
      <div className={`min-h-screen ${isLightMode ? 'bg-slate-100 text-slate-900' : 'bg-slate-950 text-slate-100'} font-sans flex flex-col items-center justify-center p-6 text-center space-y-4`}>
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 to-purple-600 animate-spin blur-lg opacity-70" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Cpu className="w-8 h-8 text-cyan-300 animate-pulse" />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-mono font-bold tracking-wider text-cyan-400 uppercase">GKB Security Gateway</p>
          <p className="text-xs text-slate-400">Verifying security token and session credentials...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={`min-h-screen ${isLightMode ? 'bg-slate-100 text-slate-900' : 'bg-slate-950 text-slate-100'} font-sans relative overflow-x-hidden flex flex-col justify-between`}>
        {/* Ambient Glows */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-600/15 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/15 rounded-full blur-[140px] pointer-events-none" />

        {/* Minimal Gate Header */}
        <header className="border-b border-cyan-500/20 bg-slate-950/70 backdrop-blur-md px-6 py-4 flex items-center justify-between relative z-20">
          <div className="flex items-center space-x-3">
            <img
              src="/gkb-company-logo.png"
              alt="GKB Technologies logo"
              className="h-10 w-10 shrink-0 rounded-lg object-contain bg-slate-900 border border-cyan-500/30 p-1 shadow-[0_0_15px_rgba(6,182,212,0.2)]"
            />
            <div>
              <span className="text-base font-black tracking-wider bg-gradient-to-r from-cyan-400 via-sky-300 to-purple-400 bg-clip-text text-transparent">
                GKB TECHNOLOGIES
              </span>
              <p className="text-[10px] text-cyan-400/70 tracking-widest uppercase">IoT Hardware Fleet Cloud</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsLightMode(!isLightMode)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-500/30 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:text-cyan-300 cursor-pointer"
          >
            {isLightMode ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{isLightMode ? 'Dark' : 'Light'}</span>
          </button>
        </header>

        {/* Auth Gate Card */}
        <main className="flex-1 flex items-center justify-center p-4 sm:p-6 py-12 relative z-10">
          <div className="w-full max-w-lg space-y-6 rounded-3xl border border-cyan-500/30 bg-slate-900/90 p-6 sm:p-8 shadow-[0_0_60px_rgba(6,182,212,0.15)] backdrop-blur-xl animate-fadeIn">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 mb-1 shadow-[0_0_20px_rgba(6,182,212,0.25)]">
                <Lock className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-black tracking-tight text-white">GKB Fleet Access</h2>
              <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                Sign in to monitor and control your deployed smart hardware, or create a new client account.
              </p>
            </div>

            {/* Tablist Switcher */}
            <div role="tablist" aria-label="Account access" className="grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-950 p-1">
              <button
                type="button"
                role="tab"
                aria-selected={!creatingAccount}
                disabled={loginBusy}
                onClick={() => {
                  setCreatingAccount(false);
                  setLoginError('');
                  setLoginMessage('');
                }}
                className={`rounded-lg px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  !creatingAccount
                    ? 'bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.35)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={creatingAccount}
                disabled={loginBusy}
                onClick={() => {
                  setCreatingAccount(true);
                  setLoginError('');
                  setLoginMessage('');
                }}
                className={`rounded-lg px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  creatingAccount
                    ? 'bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.35)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Create Account
              </button>
            </div>

            {/* Error & Message Banners */}
            {loginError && (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-start gap-2 animate-fadeIn">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{loginError}</span>
              </div>
            )}
            {loginMessage && (
              <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-200 flex items-start gap-2 animate-fadeIn">
                <CheckCircle className="h-4 w-4 shrink-0 mt-0.5 text-emerald-400" />
                <span className="leading-relaxed">{loginMessage}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleAuthSubmit} className="space-y-4">
              {creatingAccount && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs font-medium text-slate-400">
                      First Name
                      <input
                        type="text"
                        autoComplete="given-name"
                        maxLength={80}
                        placeholder="John"
                        value={signupFirstName}
                        onChange={event => setSignupFirstName(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none transition-colors"
                        required
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-400">
                      Last Name
                      <input
                        type="text"
                        autoComplete="family-name"
                        maxLength={80}
                        placeholder="Doe"
                        value={signupLastName}
                        onChange={event => setSignupLastName(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none transition-colors"
                        required
                      />
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs font-medium text-slate-400">
                      Phone Number
                      <input
                        type="tel"
                        autoComplete="tel"
                        maxLength={30}
                        placeholder="+233 24 000 0000"
                        value={signupPhone}
                        onChange={event => setSignupPhone(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none transition-colors"
                        required
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-400">
                      Location / City
                      <input
                        type="text"
                        autoComplete="address-level2"
                        maxLength={160}
                        placeholder="Accra, Ghana"
                        value={signupLocation}
                        onChange={event => setSignupLocation(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none transition-colors"
                        required
                      />
                    </label>
                  </div>
                </>
              )}

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">
                  {creatingAccount ? 'Email Address' : 'Email or Phone Number'}
                </label>
                <div className="relative">
                  <input
                    type={creatingAccount ? 'email' : 'text'}
                    autoComplete={creatingAccount ? 'email' : 'username'}
                    placeholder={creatingAccount ? 'name@example.com' : 'you@example.com or +233…'}
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-cyan-400 focus:outline-none transition-colors"
                    required
                  />
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">Password</label>
                <div className="relative">
                  <input
                    type="password"
                    autoComplete={creatingAccount ? 'new-password' : 'current-password'}
                    minLength={6}
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-cyan-400 focus:outline-none transition-colors"
                    required
                  />
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3 pointer-events-none" />
                </div>
              </div>

              <button
                type="submit"
                disabled={loginBusy}
                className="w-full py-3 bg-gradient-to-r from-cyan-500 via-sky-400 to-purple-600 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider shadow-[0_0_20px_rgba(6,182,212,0.4)] hover:brightness-110 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                {loginBusy ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Authenticating...</span>
                  </>
                ) : creatingAccount ? (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Create Client Account</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    <span>Sign In to GKB Fleet</span>
                  </>
                )}
              </button>
            </form>

            {/* Resend confirmation if needed */}
            {loginMessage.includes('confirm your address') && (
              <div className="text-center pt-2">
                <button
                  type="button"
                  disabled={loginBusy}
                  onClick={() => void handleResendConfirmation()}
                  className="text-xs font-semibold text-cyan-300 hover:text-cyan-200 transition-colors underline cursor-pointer"
                >
                  Resend confirmation email
                </button>
              </div>
            )}

            {/* Security Badges */}
            <div className="pt-4 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-[10px] text-slate-400 text-center font-mono">
              <div className="flex flex-col items-center gap-1">
                <ShieldCheck className="w-4 h-4 text-cyan-400" />
                <span>256-Bit TLS</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Wifi className="w-4 h-4 text-purple-400" />
                <span>Supabase RLS</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <QrCode className="w-4 h-4 text-amber-400" />
                <span>Hardware QR Guard</span>
              </div>
            </div>
          </div>
        </main>

        {/* Minimal Gate Footer */}
        <footer className="border-t border-slate-800/60 bg-slate-950/60 py-4 px-6 text-center text-[11px] text-slate-500 font-mono">
          God Knows Best • Built Beyond Limits • GKB Technologies IoT Fleet
        </footer>
      </div>
    );
  }

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
            {isAdmin ? (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('fleet')}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer ${activeTab === 'fleet' ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/60 shadow-[0_0_15px_rgba(6,182,212,0.25)]' : 'text-slate-400 hover:text-cyan-300'}`}
                >
                  <span className="flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    Hardware Fleet
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('deploy');
                    setDeployError('');
                    setDeploySuccess('');
                  }}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer ${activeTab === 'deploy' ? 'bg-purple-500/15 text-purple-300 border border-purple-400/60 shadow-[0_0_15px_rgba(168,85,247,0.25)]' : 'text-slate-400 hover:text-purple-300'}`}
                >
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    Deploy Keys
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('my-devices')}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer ${activeTab === 'my-devices' ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/60 shadow-[0_0_15px_rgba(6,182,212,0.25)]' : 'text-slate-400 hover:text-cyan-300'}`}
                >
                  <span className="flex items-center gap-2">
                    <Radio className="h-4 w-4" />
                    My Devices {linkedDevices.length > 0 && `(${linkedDevices.length})`}
                  </span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('my-devices')}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer ${activeTab === 'my-devices' ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/60 shadow-[0_0_15px_rgba(6,182,212,0.25)]' : 'text-slate-400 hover:text-cyan-300'}`}
                >
                  <span className="flex items-center gap-2">
                    <Radio className="h-4 w-4" />
                    My Devices {linkedDevices.length > 0 && `(${linkedDevices.length})`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('add-device');
                    setClientLinkError('');
                    setClientLinkSuccess('');
                  }}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer ${activeTab === 'add-device' ? 'bg-gradient-to-r from-cyan-500 to-purple-600 text-black font-black shadow-[0_0_15px_rgba(6,182,212,0.35)]' : 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/20'}`}
                >
                  <span className="flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Add New Device
                  </span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer ${activeTab === 'dashboard' ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/60 shadow-[0_0_15px_rgba(6,182,212,0.25)]' : 'text-slate-400 hover:text-cyan-300'}`}
            >
              <span className="flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                Active Device
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

            {user && (
              <div className="flex items-center space-x-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.15)]">
                <div className="flex items-center gap-1.5">
                  <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center text-[10px] font-black text-black">
                    {(user.firstName ? user.firstName[0] : (user.email[0] || 'U')).toUpperCase()}
                  </div>
                  <div className="hidden sm:block text-left">
                    <p className="text-xs font-bold text-white leading-none">{user.firstName ? `${user.firstName} ${user.lastName}` : user.email}</p>
                    <span className="text-[9px] uppercase font-mono text-cyan-400 font-semibold">{user.role}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  title="Sign out of GKB IoT Portal"
                  className="text-slate-400 hover:text-red-400 text-xs cursor-pointer p-1 rounded-lg hover:bg-slate-800 transition-colors ml-1"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Mobile Navigation */}
        <nav className="flex md:hidden gap-1 overflow-x-auto border-t border-slate-800/70 px-3 py-2">
          {isAdmin ? (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('fleet')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${activeTab === 'fleet' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}
              >
                Hardware Fleet
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('deploy');
                  setDeployError('');
                  setDeploySuccess('');
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${activeTab === 'deploy' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/40' : 'text-slate-400'}`}
              >
                Deploy Keys
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('my-devices')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${activeTab === 'my-devices' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}
              >
                My Devices {linkedDevices.length > 0 && `(${linkedDevices.length})`}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('my-devices')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${activeTab === 'my-devices' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}
              >
                My Devices {linkedDevices.length > 0 && `(${linkedDevices.length})`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('add-device');
                  setClientLinkError('');
                  setClientLinkSuccess('');
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${activeTab === 'add-device' ? 'bg-gradient-to-r from-cyan-500 to-purple-600 text-black font-bold' : 'text-cyan-400'}`}
              >
                + Add Device
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${activeTab === 'dashboard' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}
          >
            Active Device
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* ================= 1. CLIENT / USER "MY DEVICES" VIEW ================= */}
        {activeTab === 'my-devices' && (
          <div className="space-y-8 animate-fadeIn">
            {/* Header banner */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 sm:p-8 rounded-3xl border border-cyan-500/30 bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 shadow-[0_0_35px_rgba(6,182,212,0.15)]">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-cyan-300">
                  <Radio className="h-3.5 w-3.5 animate-pulse" /> Client Hardware Portal
                </span>
                <h2 className="text-2xl sm:text-4xl font-black text-white mt-2">
                  My Smart Devices
                </h2>
                <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl">
                  {linkedDevices.length === 0
                    ? 'No hardware devices linked yet. Add your device casing key to pair and launch live telemetry.'
                    : `You have ${linkedDevices.length} linked smart device${linkedDevices.length === 1 ? '' : 's'} ready for live control and monitoring.`}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('add-device');
                  setClientLinkError('');
                  setClientLinkSuccess('');
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 via-sky-400 to-purple-600 px-6 py-3 text-xs sm:text-sm font-black uppercase tracking-wider text-slate-950 shadow-lg shadow-cyan-500/25 hover:brightness-110 transition-all cursor-pointer whitespace-nowrap self-start sm:self-auto"
              >
                <Plus className="h-4 w-4" />
                Add New Device
              </button>
            </div>

            {/* Empty State */}
            {linkedDevices.length === 0 ? (
              <div className="p-10 sm:p-14 rounded-3xl border border-dashed border-slate-800 bg-slate-900/50 text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.2)]">
                  <Cpu className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xl font-bold text-white">No Smart Devices Linked</h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                    You haven't added any GKB Smart Devices to your account. Click below to enter your hardware key and pair via Bluetooth.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('add-device');
                    setClientLinkError('');
                    setClientLinkSuccess('');
                  }}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-cyan-500 text-slate-950 font-bold text-xs uppercase tracking-wider hover:bg-cyan-400 transition-all cursor-pointer shadow-md shadow-cyan-500/20"
                >
                  <Plus className="h-4 w-4" />
                  Add Your First Device
                </button>
              </div>
            ) : (
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {linkedDevices.map(device => {
                  const isLight = device.project === 'light-control';
                  const isRelay = device.project === 'relay-test';
                  const isSecurity = device.project === 'smart-security-system';
                  const isWater = device.project === 'water-tank-monitor';
                  const isFan = device.project === 'fan-regulator';

                  return (
                    <article
                      key={device.key}
                      className="flex flex-col justify-between p-6 rounded-3xl border border-slate-800 bg-slate-900/80 hover:border-cyan-500/40 transition-all duration-200 shadow-lg hover:shadow-cyan-500/10 space-y-5"
                    >
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                            {device.key}
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            {device.status || 'Verified Node'}
                          </span>
                        </div>

                        <div className="flex items-start gap-3">
                          <div className={`p-3 rounded-2xl shrink-0 ${
                            isLight ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' :
                            isRelay ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30' :
                            isSecurity ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30' :
                            isWater ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30' :
                            isFan ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30' :
                            'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                          }`}>
                            {isLight ? <Lightbulb className="w-5 h-5" /> :
                             isRelay ? <Cpu className="w-5 h-5" /> :
                             isSecurity ? <Shield className="w-5 h-5" /> :
                             isWater ? <Droplets className="w-5 h-5" /> :
                             isFan ? <Wind className="w-5 h-5" /> :
                             <Zap className="w-5 h-5" />}
                          </div>
                          <div>
                            <h4 className="text-base font-bold text-white leading-snug">{device.name}</h4>
                            <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">{device.lastAlert}</p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-slate-800/80">
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDevice(device);
                              setActiveTab('dashboard');
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-400 py-2.5 px-3 text-xs font-bold uppercase tracking-wider text-slate-950 shadow-md shadow-cyan-500/20 hover:brightness-110 transition-all cursor-pointer"
                          >
                            <Cpu className="h-3.5 w-3.5" />
                            Open
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDevice(device);
                              setBleTargetDevice(device);
                              setBleModalOpen(true);
                            }}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 py-2.5 px-3 text-xs font-bold text-slate-200 hover:border-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
                          >
                            <Bluetooth className="h-3.5 w-3.5" />
                            BLE Setup
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleUnlinkClientDevice(device)}
                          className="w-full text-center text-[11px] text-slate-500 hover:text-red-400 transition-colors py-1 cursor-pointer"
                        >
                          Unlink device from account
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ================= 2. CLIENT "ADD NEW DEVICE" TAB ================= */}
        {activeTab === 'add-device' && (
          <div className="max-w-2xl mx-auto space-y-6 animate-fadeIn">
            <div className="rounded-3xl border border-cyan-500/30 bg-slate-900/90 p-6 sm:p-10 shadow-[0_0_40px_rgba(6,182,212,0.15)] space-y-6">
              <div className="space-y-2 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.25)] mb-2">
                  <Key className="w-7 h-7" />
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-white">Add New GKB Hardware</h2>
                <p className="text-xs sm:text-sm text-slate-400 max-w-lg mx-auto leading-relaxed">
                  Enter the unique Hardware Key printed on your physical device casing or QR sticker. Our cloud registry will verify the key and immediately initiate Bluetooth pairing.
                </p>
              </div>

              {/* Step indicator */}
              <div className="grid grid-cols-3 gap-2 py-2">
                <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-2.5 text-center">
                  <span className="block text-[10px] font-mono uppercase text-cyan-400 font-bold">Step 1</span>
                  <span className="text-xs font-bold text-white">Key Verify</span>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-center text-slate-500">
                  <span className="block text-[10px] font-mono uppercase font-bold">Step 2</span>
                  <span className="text-xs font-bold">Bluetooth Pair</span>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-center text-slate-500">
                  <span className="block text-[10px] font-mono uppercase font-bold">Step 3</span>
                  <span className="text-xs font-bold">Live Control</span>
                </div>
              </div>

              {/* Error Banner */}
              {clientLinkError && (
                <div className="p-4 rounded-2xl border border-red-500/40 bg-red-500/10 text-red-200 text-xs flex items-start gap-3 animate-fadeIn">
                  <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-red-300">Deployment Verification Failed</p>
                    <p className="leading-relaxed">{clientLinkError}</p>
                  </div>
                </div>
              )}

              {/* Success Banner */}
              {clientLinkSuccess && (
                <div className="p-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 text-xs flex items-start gap-3 animate-fadeIn">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-emerald-300">Key Verified & Linked</p>
                    <p className="leading-relaxed">{clientLinkSuccess}</p>
                  </div>
                </div>
              )}

              {/* Hardware Key Input Form */}
              <form onSubmit={handleClientKeySubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                    Hardware Casing Key:
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      autoFocus
                      placeholder="e.g. GKB-RELAY-0001, GKB-FAN-0001, GKB-SEC-0001"
                      value={clientKeyInput}
                      onChange={e => {
                        setClientKeyInput(e.target.value.toUpperCase());
                        setClientLinkError('');
                      }}
                      className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3.5 pl-11 font-mono text-sm sm:text-base text-cyan-300 tracking-wider placeholder-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                      required
                    />
                    <Key className="w-5 h-5 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={clientLinkBusy}
                  className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-500 via-sky-400 to-purple-600 text-slate-950 font-black text-sm uppercase tracking-wider shadow-[0_0_25px_rgba(6,182,212,0.35)] hover:brightness-110 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2.5"
                >
                  {clientLinkBusy ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Verifying Cloud Key...</span>
                    </>
                  ) : (
                    <>
                      <Bluetooth className="w-4 h-4" />
                      <span>Verify Key & Connect via Bluetooth</span>
                    </>
                  )}
                </button>
              </form>

              {/* Help & Guidelines */}
              <div className="p-4 rounded-2xl border border-slate-800 bg-slate-950/60 text-xs text-slate-400 space-y-2">
                <p className="font-bold text-slate-300 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" /> Key & Provisioning Instructions:
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-400 pl-1">
                  <li>Find the token printed on the white QR sticker attached to your GKB module casing.</li>
                  <li>Ensure your device is powered on. The status LED will pulse indicating ready for BLE connection.</li>
                  <li>Google Chrome, Edge, and Opera natively support Web Bluetooth on Windows, macOS, Linux, and Android.</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* ================= 3. ADMIN ONLY: DEPLOY HARDWARE KEYS ================= */}
        {isAdmin && activeTab === 'deploy' && (
          <div className="space-y-8 animate-fadeIn">
            {/* Admin Header */}
            <div className="p-6 sm:p-8 rounded-3xl border border-purple-500/30 bg-gradient-to-r from-slate-900 via-purple-950/30 to-slate-950 shadow-[0_0_35px_rgba(168,85,247,0.15)]">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-400/40 bg-purple-400/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-purple-300">
                <Sparkles className="h-3.5 w-3.5" /> GKB Admin Gateway
              </span>
              <h2 className="text-2xl sm:text-4xl font-black text-white mt-2">Hardware Deployment & Key Registry</h2>
              <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl">
                Deploy physical hardware keys into the GKB cloud registry. Clients will only be permitted to verify, link, and Bluetooth-provision devices whose keys have been officially deployed here.
              </p>
            </div>

            <div className="grid gap-8 lg:grid-cols-12">
              {/* Deploy New Hardware Key Form (5 cols) */}
              <div className="lg:col-span-5 rounded-3xl border border-purple-500/30 bg-slate-900/90 p-6 space-y-5 shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Plus className="w-4 h-4 text-purple-400" /> Deploy New Hardware Key
                  </h3>
                  <span className="text-[10px] font-mono text-purple-400 uppercase font-bold">Cloud Registry</span>
                </div>

                {deployError && (
                  <p className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-200">
                    {deployError}
                  </p>
                )}
                {deploySuccess && (
                  <p className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-200">
                    {deploySuccess}
                  </p>
                )}

                <form onSubmit={handleAdminDeployKey} className="space-y-4 text-xs">
                  <div>
                    <label className="block text-slate-300 font-bold mb-1">Hardware Key (Device Token)</label>
                    <input
                      type="text"
                      placeholder="e.g. GKB-RELAY-0002, GKB-FAN-0002"
                      value={deployKey}
                      onChange={e => setDeployKey(e.target.value.toUpperCase())}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-cyan-300 focus:border-purple-400 focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1">Device Name / Label</label>
                    <input
                      type="text"
                      placeholder="e.g. Classroom 3 Smart Fan Regulator"
                      value={deployName}
                      onChange={e => setDeployName(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white focus:border-purple-400 focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1">Hardware Project Type</label>
                    <select
                      value={deployProject}
                      onChange={e => setDeployProject(e.target.value as StudentProject)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white focus:border-purple-400 focus:outline-none cursor-pointer"
                    >
                      <option value="relay-test">ESP32 Smart Relay Pilot (Single Relay)</option>
                      <option value="fan-regulator">Smart Fan Regulator (CBB61 5-Wire)</option>
                      <option value="smart-security-system">Smart Home Security System v1 (PIR + Siren + GSM)</option>
                      <option value="light-control">Universal Smart Light Control (Multi-Channel)</option>
                      <option value="water-tank-monitor">Smart Water Tank Monitor & Pump Controller</option>
                      <option value="fuel-tank-monitor">Industrial Fuel Tank Monitor</option>
                      <option value="prepaid-energy-meter">Smart Prepaid Energy Meter</option>
                    </select>
                  </div>

                  {deployProject === 'light-control' && (
                    <div>
                      <label className="block text-slate-300 font-bold mb-1">Relay Channel Board Variant</label>
                      <select
                        value={deployChannels}
                        onChange={e => setDeployChannels(Number(e.target.value) as 2 | 4 | 6 | 8)}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white focus:border-purple-400 focus:outline-none cursor-pointer"
                      >
                        <option value={2}>2-Channel Relay Board</option>
                        <option value={4}>4-Channel Relay Board</option>
                        <option value={6}>6-Channel Relay Board</option>
                        <option value={8}>8-Channel Relay Board</option>
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="block text-slate-300 font-bold mb-1">Production Batch / Hardware Notes</label>
                    <input
                      type="text"
                      placeholder="e.g. Batch 2026 Q4 Production Node"
                      value={deployNotes}
                      onChange={e => setDeployNotes(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white focus:border-purple-400 focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={deployBusy}
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-purple-500 to-cyan-500 text-slate-950 font-black uppercase tracking-wider text-xs shadow-lg shadow-purple-500/20 hover:brightness-110 transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    {deployBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    <span>Deploy Hardware Key</span>
                  </button>
                </form>
              </div>

              {/* Deployed Hardware Keys Table (7 cols) */}
              <div className="lg:col-span-7 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 space-y-4 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Layers className="w-4 h-4 text-cyan-400" /> Active Cloud Hardware Keys ({deployedDevices.length})
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">These physical keys are authorized for client connection.</p>
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Filter keys..."
                      value={deploySearchFilter}
                      onChange={e => setDeploySearchFilter(e.target.value)}
                      className="rounded-xl border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                    />
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5 pointer-events-none" />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950/80 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Device Key</th>
                        <th className="py-2.5 px-3">Device Name</th>
                        <th className="py-2.5 px-3">Project</th>
                        <th className="py-2.5 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {deployedDevices
                        .filter(d =>
                          !deploySearchFilter ||
                          d.key.toLowerCase().includes(deploySearchFilter.toLowerCase()) ||
                          d.name.toLowerCase().includes(deploySearchFilter.toLowerCase())
                        )
                        .map(device => (
                          <tr key={device.key} className="hover:bg-slate-800/40 transition-colors">
                            <td className="py-3 px-3 font-mono font-bold text-cyan-300 whitespace-nowrap">
                              {device.key}
                            </td>
                            <td className="py-3 px-3 font-medium text-white">
                              {device.name}
                            </td>
                            <td className="py-3 px-3 text-slate-400 whitespace-nowrap">
                              <span className="px-2 py-0.5 rounded-md bg-slate-800 text-[10px] font-mono border border-slate-700">
                                {device.project}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap space-x-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedDevice(device);
                                  setActiveTab('dashboard');
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                title="Open Dashboard"
                                className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-cyan-300 hover:border-cyan-400 transition-colors cursor-pointer"
                              >
                                <Cpu className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleAdminRevokeKey(device.key)}
                                title="Revoke and delete key"
                                className="p-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= 4. ADMIN ONLY: HARDWARE FLEET CATALOG ================= */}
        {isAdmin && activeTab === 'fleet' && (
          <div className="space-y-8 animate-fadeIn">
            {/* Quick Connect Hero */}
            <section className="rounded-3xl border border-cyan-500/30 bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 p-6 sm:p-10 shadow-[0_0_35px_rgba(6,182,212,0.15)] space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-cyan-300">
                  <Radio className="h-3.5 w-3.5 animate-pulse" /> Direct Hardware Connector
                </span>
                <span className="text-xs font-mono font-bold text-purple-300 bg-purple-500/10 px-3 py-1 rounded-full border border-purple-500/30">
                  Admin Fleet Overview
                </span>
              </div>

              <h2 className="text-3xl sm:text-5xl font-black tracking-tight text-white leading-tight">
                CONNECT YOUR GKB IOT DEVICE
              </h2>
              <p className="max-w-2xl text-sm sm:text-base text-slate-300 leading-relaxed">
                Enter your device's provisioned special key below to immediately launch its real-time telemetry dashboard, sensor feeds, and relay controls.
              </p>

              {/* Input Key Form */}
              <form onSubmit={handleKeySearch} className="flex max-w-2xl flex-col gap-3 sm:flex-row pt-2">
                <input
                  type="text"
                  placeholder="Enter Special Key (e.g. GKB-LIGHT-0001, GKB-RELAY-0001…)"
                  value={inputKey}
                  onChange={e => setInputKey(e.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white focus:border-cyan-400 focus:outline-none"
                  required
                />
                <button
                  type="submit"
                  disabled={linkBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 px-6 py-3 text-sm font-bold uppercase tracking-wider text-black shadow-lg shadow-cyan-500/25 hover:opacity-90 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <Cpu className="h-4 w-4" />
                  Connect Key
                </button>
              </form>

              {/* Demo Keys Quick Selector Pills */}
              <div className="space-y-2 pt-2">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Quick Test Keys:</p>
                <div className="flex flex-wrap gap-2">
                  {deployedDevices.slice(0, 8).map(def => (
                    <button
                      key={def.key}
                      type="button"
                      onClick={() => {
                        setSelectedDevice(def);
                        setActiveTab('dashboard');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1 text-xs font-mono text-cyan-300 hover:border-cyan-400 hover:bg-cyan-500/10 transition-colors cursor-pointer"
                    >
                      {def.name.split(' (')[0].replace('ESP32 ', '')} ({def.key})
                    </button>
                  ))}
                </div>
              </div>

              {linkMessage && (
                <p className={`text-xs p-3 rounded-lg border ${linkMessageIsError ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
                  {linkMessage}
                </p>
              )}
            </section>

            {/* Hardware Fleet Catalog Cards */}
            <section className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-xl sm:text-2xl font-black text-white">Supported Hardware Devices ({deployedDevices.length})</h3>
                  <p className="text-xs text-slate-400 mt-1">Select any verified hardware node to launch its live control interface and cloud telemetry.</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {deployedDevices.map(device => {
                  const isLight = device.project === 'light-control';
                  const isRelay = device.project === 'relay-test';

                  return (
                    <article
                      key={device.key}
                      className={`flex flex-col justify-between p-5 rounded-2xl border transition-all duration-200 ${
                        isLight
                          ? 'border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-slate-900 to-slate-950 shadow-[0_0_20px_rgba(245,158,11,0.1)]'
                          : isRelay
                            ? 'border-cyan-500/40 bg-gradient-to-br from-cyan-500/10 via-slate-900 to-slate-950 shadow-[0_0_20px_rgba(6,182,212,0.1)]'
                            : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] font-mono uppercase tracking-wider font-bold px-2 py-0.5 rounded-md border ${
                            isLight
                              ? 'text-amber-300 bg-amber-500/15 border-amber-500/30'
                              : isRelay
                                ? 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30'
                                : 'text-slate-300 bg-slate-800 border-slate-700'
                          }`}>
                            {device.key}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Verified Node
                          </span>
                        </div>

                        <div>
                          <h4 className="text-base font-bold text-white flex items-center gap-2">
                            {isLight ? (
                              <Lightbulb className="h-4 w-4 text-amber-400 shrink-0" />
                            ) : isRelay ? (
                              <Cpu className="h-4 w-4 text-cyan-400 shrink-0" />
                            ) : device.project === 'water-tank-monitor' ? (
                              <Droplets className="h-4 w-4 text-sky-400 shrink-0" />
                            ) : device.project === 'fuel-tank-monitor' ? (
                              <Fuel className="h-4 w-4 text-emerald-400 shrink-0" />
                            ) : device.project === 'prepaid-energy-meter' ? (
                              <Zap className="h-4 w-4 text-yellow-400 shrink-0" />
                            ) : device.project === 'fan-regulator' ? (
                              <Wind className="h-4 w-4 text-blue-400 shrink-0" />
                            ) : (
                              <Shield className="h-4 w-4 text-purple-400 shrink-0" />
                            )}
                            {device.name}
                          </h4>
                          <p className="text-xs text-slate-400 mt-1 leading-relaxed">{device.lastAlert}</p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDevice(device);
                          setActiveTab('dashboard');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className={`mt-5 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                          isLight
                            ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-black shadow-md shadow-amber-500/20 hover:opacity-90'
                            : isRelay
                              ? 'bg-gradient-to-r from-cyan-400 to-cyan-500 text-black shadow-md shadow-cyan-500/20 hover:opacity-90'
                              : 'border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white'
                        }`}
                      >
                        Open Dashboard
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {/* ================= 5. PRIMARY DASHBOARD VIEW ================= */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Top Navigation & Status Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl border border-slate-800 bg-slate-900/90 shadow-md">
              <button
                type="button"
                onClick={() => {
                  setActiveTab(isAdmin ? 'fleet' : 'my-devices');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-bold text-slate-200 hover:border-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer w-fit"
              >
                <ArrowRight className="h-4 w-4 rotate-180" />
                {isAdmin ? 'Back to Hardware Fleet' : 'Back to My Devices'}
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400">Active Node:</span>
                {selectedDevice ? (
                  <span className="text-xs font-mono font-bold text-cyan-300 bg-slate-950 px-3 py-1 rounded-lg border border-cyan-500/30">
                    {selectedDevice.name} ({selectedDevice.key})
                  </span>
                ) : (
                  <span className="text-xs text-amber-300 bg-amber-500/10 px-3 py-1 rounded-lg border border-amber-500/30">
                    No Device Selected
                  </span>
                )}
                {selectedDevice && (
                  <button
                    type="button"
                    onClick={() => {
                      setBleTargetDevice(selectedDevice);
                      setBleModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 transition-colors cursor-pointer"
                  >
                    <Bluetooth className="w-3.5 h-3.5" />
                    BLE Provision
                  </button>
                )}
              </div>
            </div>

            {/* Device Switcher Bar */}
            {isAdmin ? (
              /* Admin: Full Fleet Pills Switcher */
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Admin Fleet Quick Switcher:</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {deployedDevices.map(d => {
                    const isSelected = selectedDevice?.key === d.key;
                    return (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => {
                          setSelectedDevice(d);
                          setLinkMessage('');
                        }}
                        className={`p-2.5 rounded-xl border text-left transition-all text-xs cursor-pointer ${
                          isSelected
                            ? 'border-cyan-400 bg-cyan-500/20 shadow-md shadow-cyan-500/20 ring-1 ring-cyan-400'
                            : 'border-slate-800 bg-slate-900/60 hover:bg-slate-850'
                        }`}
                      >
                        <span className="block font-mono text-[10px] text-cyan-300 truncate">{d.key}</span>
                        <span className="block font-bold text-white truncate mt-0.5">{d.name.split(' (')[0].replace('ESP32 ', '')}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Client: Only Their Linked Devices Switcher */
              linkedDevices.length > 1 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">My Devices:</p>
                  <div className="flex flex-wrap gap-2">
                    {linkedDevices.map(d => {
                      const isSelected = selectedDevice?.key === d.key;
                      return (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() => {
                            setSelectedDevice(d);
                            setLinkMessage('');
                          }}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                            isSelected
                              ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-400'
                              : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          {d.name} ({d.key})
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setActiveTab('add-device')}
                      className="px-3 py-1.5 rounded-xl border border-dashed border-cyan-500/40 text-cyan-400 text-xs font-bold hover:bg-cyan-500/10 transition-colors cursor-pointer"
                    >
                      + Add Another Device
                    </button>
                  </div>
                </div>
              )
            )}

            {/* Dashboard Component Display */}
            {!selectedDevice ? (
              <div className="p-12 text-center rounded-3xl border border-slate-800 bg-slate-900/50 space-y-4">
                <Cpu className="w-12 h-12 text-cyan-400 mx-auto opacity-70" />
                <h3 className="text-lg font-bold text-white">No Active Hardware Selected</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Please link a device using your hardware casing key or choose one from My Devices.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('add-device')}
                  className="px-5 py-2.5 rounded-xl bg-cyan-500 text-black font-bold text-xs uppercase cursor-pointer"
                >
                  Add Device Key
                </button>
              </div>
            ) : selectedDevice.project === 'relay-test' ? (
              <RelayTestDashboard mode="service" />
            ) : selectedDevice.project === 'light-control' ? (
              <LightControlDashboard mode="service" device={selectedDevice} />
            ) : selectedDevice.project === 'water-tank-monitor' || selectedDevice.key === 'GKB-SWP-0001' ? (
              <WaterTankDashboard mode="service" device={selectedDevice} />
            ) : selectedDevice.project === 'smart-security-system' || selectedDevice.key === 'GKB-SEC-0001' ? (
              <SmartSecurityDashboard mode="service" device={selectedDevice} />
            ) : selectedDevice.project === 'fan-regulator' || selectedDevice.key === 'GKB-FAN-0001' || selectedDevice.key === 'GKB-SFLC-0001' ? (
              <FanRegulatorDashboard mode="service" device={selectedDevice} />
            ) : (
              <GenericFleetPreviewDashboard
                device={selectedDevice}
                onSwitchToFanRegulator={() => setSelectedDevice(defaultDevices[6])}
                onSwitchToSecurity={() => setSelectedDevice(defaultDevices[3])}
                onSwitchToWaterTank={() => setSelectedDevice(defaultDevices[2])}
                onSwitchToLightControl={() => setSelectedDevice(defaultDevices[1])}
                onSwitchToRelayPilot={() => setSelectedDevice(defaultDevices[0])}
              />
            )}
          </div>
        )}

        {/* ================= 6. SUPPORT VIEW ================= */}
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

        {/* ================= 7. CONTACT VIEW ================= */}
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

      {/* Global Bluetooth Provisioning Modal */}
      <BleProvisioningModal
        isOpen={bleModalOpen}
        onClose={() => {
          setBleModalOpen(false);
          if (selectedDevice) {
            setActiveTab('dashboard');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }}
        onDeviceProvisioned={() => {
          setBleModalOpen(false);
          if (selectedDevice) {
            setActiveTab('dashboard');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }}
        initialDeviceKey={bleTargetDevice?.key || selectedDevice?.key || 'GKB-RELAY-0001'}
        deviceKey={bleTargetDevice?.key || selectedDevice?.key}
        deviceName={bleTargetDevice?.name || selectedDevice?.name}
        channelVariant={bleTargetDevice?.relayChannels || selectedDevice?.relayChannels}
        initialPhone={user?.phone}
      />

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
