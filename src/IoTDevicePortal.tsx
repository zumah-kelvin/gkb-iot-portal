import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { relayControlEnabled, relaySupabase, relaySupabaseConfigError } from './supabase';
import BleProvisioningModal from './BleProvisioningModal';
import LightControlDashboard from './LightControlDashboard';
import WaterTankDashboard from './WaterTankDashboard';
import SmartSecurityDashboard from './SmartSecurityDashboard';
import FanRegulatorDashboard from './FanRegulatorDashboard';
import {
  Cpu, Shield, Wrench, Info, Phone, PhoneCall, Mail, Globe,
  User, Lock, LogOut, CheckCircle, AlertTriangle,
  ArrowRight, Sun, Moon, Zap, Wifi, Radio, Key,
  Copy, Download, Code, Check, Printer, Bluetooth, QrCode, X, RefreshCw,
  Layers, Lightbulb, Power, Droplets, Fuel, Gauge, Wind, FlaskConical,
  ShieldCheck, Sparkles, MapPin, Plus, Trash2, Search, CheckCircle2,
  Eye, EyeOff, Users, PauseCircle, PlayCircle, HelpCircle, Activity, FileText, Sliders, Send, ExternalLink,
  Menu, MoreVertical
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

export type PortalTab = 'fleet' | 'deploy' | 'customer-devices' | 'my-devices' | 'add-device' | 'dashboard' | 'support' | 'contact';

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
function RelayTestDashboard({ mode = 'service', isAdmin = false }: { mode?: 'test' | 'service'; isAdmin?: boolean }) {
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
  const [showArchitectureModal, setShowArchitectureModal] = useState(false);

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
    <section aria-labelledby="relay-test-title" className="mx-auto max-w-5xl space-y-2.5">
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

      {/* Unified Compact Hardware Header Card */}
      <header className="rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-slate-900/95 via-slate-900/80 to-purple-950/40 p-3 sm:p-4 shadow-lg shadow-cyan-500/5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 to-purple-600 text-black shadow-md shadow-cyan-500/20 shrink-0">
              <Zap className="h-5 w-5 text-black fill-black" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <h2 id="relay-test-title" className="text-base sm:text-lg font-black text-white">
                  ESP32 Relay Test & Provisioning Center
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-cyan-300 border border-cyan-500/30">
                  GKB-RELAY-0001
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                  BLE GATT Active
                </span>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5 max-w-2xl">
                Primary testing ground for Web Bluetooth (BLE) handshake, zero-trust casing QR verification, and cloud relay actuation.
              </p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setShowLabelInModal(false);
                setProvisionModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 px-3 py-2 text-xs font-black uppercase tracking-wider text-black shadow-md shadow-cyan-500/20 hover:opacity-90 transition-all cursor-pointer"
            >
              <Bluetooth className="h-3.5 w-3.5" />
              <QrCode className="h-3.5 w-3.5" />
              <span>Provision ESP32</span>
            </button>
            {isAdmin && (
              <>
                <button
              type="button"
              onClick={() => {
                setShowLabelInModal(true);
                setProvisionModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/10 px-2.5 py-2 text-xs font-bold text-purple-200 hover:bg-purple-500/20 transition-all cursor-pointer"
              title="Print casing QR sticker label"
            >
              <Printer className="h-3.5 w-3.5 text-purple-400" />
              <span className="hidden sm:inline">QR Sticker</span>
            </button>
            <button
              type="button"
              onClick={() => setShowFirmwareModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-2.5 py-2 text-xs font-bold text-slate-300 hover:text-cyan-300 hover:border-cyan-500/40 transition-all cursor-pointer"
              title="Inspect ESP32 Arduino C++ firmware"
            >
              <Code className="h-3.5 w-3.5 text-cyan-400" />
              <span className="hidden sm:inline">Firmware</span>
            </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setShowArchitectureModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/60 px-2.5 py-2 text-xs font-medium text-slate-300 hover:text-cyan-300 hover:border-cyan-500/30 transition-all cursor-pointer"
              title="View BLE & Cloud 3-Step Architecture Flow"
            >
              <Info className="h-3.5 w-3.5 text-cyan-400" />
              <span className="hidden md:inline">How It Works</span>
            </button>
          </div>
        </div>

        {/* Pinout and Hardware Specs Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 mt-2 text-[11px] text-slate-400 border-t border-slate-800/60 font-mono">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1 text-cyan-300">
              <Cpu className="h-3 w-3 text-cyan-400" /> Relay: <strong className="text-white">GPIO 23</strong>
            </span>
            <span className="flex items-center gap-1 text-purple-300">
              <Radio className="h-3 w-3 text-purple-400" /> LED: <strong className="text-white">GPIO 2</strong>
            </span>
            <span className="flex items-center gap-1 text-amber-300">
              <Key className="h-3 w-3 text-amber-400" /> Reset: <strong className="text-white">BOOT (0) 5s</strong>
            </span>
          </div>
          <span className="text-[10px] text-slate-500 hidden sm:inline">
            Endpoint: <code className="text-slate-400 font-mono">public.relay_status (relay_01)</code>
          </span>
        </div>
      </header>

      {/* Relay Hardware Output & Animated Visualizer */}
      <div className="grid gap-3 md:grid-cols-[1.3fr_1fr] items-stretch">
        <section aria-label="Animated car relay output" className={`flex flex-col items-center justify-center rounded-2xl border p-4 sm:p-5 transition-colors ${relayOn ? 'border-emerald-400/30 bg-emerald-400/[0.04]' : 'border-slate-800 bg-slate-900/70'}`}>
          <svg role="img" aria-label={relayOn ? 'Car with spinning tires' : 'Stationary car with stopped tires'} viewBox="0 0 440 220" className="w-full max-w-sm h-36 sm:h-44">
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
          <p className={`mt-2 text-xs sm:text-sm font-semibold ${relayOn ? 'text-emerald-300' : 'text-slate-400'}`}>
            {relayOn ? 'Relay ON · GPIO 23 Output HIGH · Wheels Spinning' : 'Relay OFF · GPIO 23 Output LOW · Stationary'}
          </p>
        </section>

        <section aria-label="Relay switch control" className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${mode === 'test' ? 'bg-slate-500' : connectionState === 'connected' ? 'bg-emerald-400' : connectionState === 'error' ? 'bg-red-400' : 'bg-amber-400'}`} />
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {mode === 'test' ? 'Simulated relay' : connectionState === 'connected' ? 'Supabase connected' : connectionState === 'error' ? 'Supabase error' : 'Connecting to Supabase'}
            </p>
          </div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Relay output · relay_01</p>
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
              {lastSyncedAt && <p className="text-center text-[10px] text-slate-400">Last cloud sync: {lastSyncedAt.toLocaleTimeString()}</p>}
              {relayError && (
                <div role="alert" className="w-full max-w-xs rounded-xl border border-red-500/40 bg-red-950/60 p-2.5 text-left">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-red-200">
                      <p className="font-semibold text-red-100">{relayError}</p>
                      {(relayError.includes('42501') || relayError.includes('permission denied')) && (
                        <div className="mt-2 text-[11px] text-amber-200 bg-amber-950/60 border border-amber-500/40 rounded-lg p-2 space-y-1">
                          <p className="font-bold text-amber-300">Supabase SQL Grant Required</p>
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
                            className="inline-flex items-center gap-1.5 rounded bg-amber-500/20 px-2 py-1 text-[10px] font-bold text-amber-300 hover:bg-amber-500/30 border border-amber-500/50 cursor-pointer"
                          >
                            <Copy className="h-3 w-3" /> Copy SQL Grant
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {relayMessage && <p role="status" className="max-w-64 text-center text-xs leading-relaxed text-emerald-300 font-semibold">{relayMessage}</p>}
              <p className="max-w-64 text-center text-[11px] leading-relaxed text-slate-400">
                ESP32 polls <code className="text-cyan-300 font-mono">public.relay_status</code> every 2.5s and switches GPIO 23.
              </p>
            </>
          )}
        </section>
      </div>

      {/* Architecture Flow Inspection Modal */}
      {showArchitectureModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fadeIn">
          <div className="relative w-full max-w-3xl rounded-3xl border border-cyan-500/40 bg-slate-950 p-6 sm:p-7 text-white shadow-[0_0_50px_rgba(6,182,212,0.25)] space-y-4">
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                  <Info className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">ESP32 BLE & Cloud Architecture Flow</h3>
                  <p className="text-xs text-slate-400">Zero-Trust Casing Verification, Local GATT Pairing & NVS Flash Commit</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowArchitectureModal(false)}
                className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-cyan-500/20 bg-slate-900/60 p-4 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-cyan-500/20 text-[10px] font-bold text-cyan-300">1</span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">BLE Local Handshake</span>
                </div>
                <p className="text-xs font-bold text-white">Web Bluetooth GATT Server</p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Discovers ESP32 beacon and establishes encrypted local GATT channel without cloud dependencies.
                </p>
              </div>

              <div className="rounded-xl border border-purple-500/20 bg-slate-900/60 p-4 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-purple-500/20 text-[10px] font-bold text-purple-300">2</span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-purple-300">QR Tag Verification</span>
                </div>
                <p className="text-xs font-bold text-white">Zero-Trust Casing Key</p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Scans physical QR sticker with phone camera. Transmits VERIFY:GKB-RELAY-0001 over BLE for hardware authentication.
                </p>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-slate-900/60 p-4 space-y-1.5">
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

            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400 flex items-center justify-between">
              <span>Cloud Status Endpoint: <code className="text-cyan-300 font-mono">public.relay_status (relay_01)</code></span>
              <button
                type="button"
                onClick={() => setShowArchitectureModal(false)}
                className="px-4 py-1.5 rounded-lg bg-cyan-500 text-slate-950 font-bold hover:bg-cyan-400 cursor-pointer"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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

  // User-Friendly Auth States
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(() => window.localStorage.getItem('gkb-remember-me') === 'true');
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');

  // Admin Fleet and Customer States
  const [allCustomerDevices, setAllCustomerDevices] = useState<any[]>([]);
  const [customerDevicesLoading, setCustomerDevicesLoading] = useState(false);
  const [customerFilter, setCustomerFilter] = useState('');
  const [complaints, setComplaints] = useState<any[]>([]);
  const [complaintsLoading, setComplaintsLoading] = useState(false);
  const [complaintFilter, setComplaintFilter] = useState<'all' | 'pending' | 'resolved'>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

    if (creatingAccount) {
      if (loginPassword !== signupConfirmPassword) {
        setLoginError('Passwords do not match. Please verify both password entries.');
        setLoginBusy(false);
        return;
      }
      if (loginPassword.length < 6) {
        setLoginError('Password must be at least 6 characters long.');
        setLoginBusy(false);
        return;
      }
    }

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
          setSignupConfirmPassword('');
          return;
        }
      } else {
        const identifier = loginEmail.trim();
        const credentials = identifier.includes('@')
          ? { email: identifier, password: loginPassword }
          : { phone: identifier, password: loginPassword };
        const { error } = await relaySupabase.auth.signInWithPassword(credentials);
        if (error) throw error;

        // Remember login identifier if checked
        if (rememberMe) {
          window.localStorage.setItem('gkb-remember-me', 'true');
          window.localStorage.setItem('gkb-saved-login', identifier);
        } else {
          window.localStorage.removeItem('gkb-remember-me');
          window.localStorage.removeItem('gkb-saved-login');
        }
      }
      setLoginModalOpen(false);
      setLoginError('');
      setLoginMessage('');
    } catch (err) {
      const msg = formatSupabaseError(err);
      if (msg.toLowerCase().includes('invalid login credentials')) {
        setLoginError('Invalid login credentials. Please check your email/phone and password, or create an account if new.');
      } else {
        setLoginError(msg);
      }
    } finally {
      setLoginBusy(false);
    }
  };

  const handleForgotPassword = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const targetEmail = (forgotEmail || loginEmail).trim();
    if (!targetEmail || !targetEmail.includes('@')) {
      setLoginError('Please enter a valid email address to receive password reset instructions.');
      return;
    }
    if (!relaySupabase) return;
    setLoginBusy(true);
    setLoginError('');
    setLoginMessage('');
    try {
      const { error } = await relaySupabase.auth.resetPasswordForEmail(targetEmail, {
        redirectTo: window.location.origin
      });
      if (error) throw error;
      setLoginMessage(`Password reset link sent to ${targetEmail}! Please check your email inbox.`);
      setForgotPasswordMode(false);
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

  // Copy Key helper
  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  // Admin Auto-Generate Next Key
  const handleGenerateNextKey = (project: StudentProject) => {
    let prefix = 'GKB-DEV';
    if (project === 'relay-test') prefix = 'GKB-RELAY';
    else if (project === 'light-control') prefix = 'GKB-LIGHT';
    else if (project === 'fan-regulator') prefix = 'GKB-FAN';
    else if (project === 'smart-security-system') prefix = 'GKB-SEC';
    else if (project === 'water-tank-monitor') prefix = 'GKB-SWP';
    else if (project === 'fuel-tank-monitor') prefix = 'GKB-IUFT';
    else if (project === 'prepaid-energy-meter') prefix = 'GKB-SPEM';

    const existingKeys = deployedDevices.map(d => d.key.toUpperCase());
    let counter = 1;
    while (counter < 9999) {
      const candidate = `${prefix}-${String(counter).padStart(4, '0')}`;
      if (!existingKeys.includes(candidate)) {
        setDeployKey(candidate);
        break;
      }
      counter++;
    }
  };

  // Admin: Fetch all customer linked devices across Ghana
  const fetchAllCustomerDevices = useCallback(async () => {
    if (!relaySupabase || !isAdmin) return;
    setCustomerDevicesLoading(true);
    try {
      const { data, error } = await relaySupabase
        .from('gkb_user_devices')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data) {
        setAllCustomerDevices(data);
      }
    } catch (err) {
      console.warn('Could not load all customer devices:', err);
    } finally {
      setCustomerDevicesLoading(false);
    }
  }, [isAdmin]);

  // Admin: Toggle billing pause on customer device
  const handleTogglePauseCustomerDevice = async (userId: string, deviceKey: string, currentPaused: boolean) => {
    if (!relaySupabase || !isAdmin) return;
    try {
      const nextPaused = !currentPaused;
      const { error } = await relaySupabase
        .from('gkb_user_devices')
        .update({ is_paused: nextPaused })
        .eq('user_id', userId)
        .eq('device_key', deviceKey);
      if (error) throw error;
      setAllCustomerDevices(prev => prev.map(d =>
        (d.user_id === userId && d.device_key === deviceKey) ? { ...d, is_paused: nextPaused } : d
      ));
    } catch (err) {
      alert(formatSupabaseError(err));
    }
  };

  // Admin: Remote unlink customer device
  const handleDeleteCustomerDevice = async (userId: string, deviceKey: string) => {
    if (!relaySupabase || !isAdmin) return;
    if (!window.confirm(`Are you sure you want to unlink customer device "${deviceKey}"?`)) return;
    try {
      const { error } = await relaySupabase
        .from('gkb_user_devices')
        .delete()
        .eq('user_id', userId)
        .eq('device_key', deviceKey);
      if (error) throw error;
      setAllCustomerDevices(prev => prev.filter(d => !(d.user_id === userId && d.device_key === deviceKey)));
    } catch (err) {
      alert(formatSupabaseError(err));
    }
  };

  // Fetch support tickets
  const fetchComplaints = useCallback(async () => {
    if (!relaySupabase) return;
    setComplaintsLoading(true);
    try {
      let query = relaySupabase
        .from('gkb_complaints')
        .select('*')
        .order('created_at', { ascending: false });
      if (user && !isAdmin) {
        query = query.eq('user_id', user.id);
      }
      const { data, error } = await query;
      if (!error && data) {
        setComplaints(data);
      }
    } catch (err) {
      console.warn('Could not load complaints:', err);
    } finally {
      setComplaintsLoading(false);
    }
  }, [user, isAdmin]);

  const handleToggleSolveComplaint = async (id: string, currentSolved: boolean) => {
    if (!relaySupabase || !isAdmin) return;
    try {
      const nextSolved = !currentSolved;
      const { error } = await relaySupabase
        .from('gkb_complaints')
        .update({ solved: nextSolved })
        .eq('id', id);
      if (error) throw error;
      setComplaints(prev => prev.map(c => c.id === id ? { ...c, solved: nextSolved } : c));
    } catch (err) {
      alert(formatSupabaseError(err));
    }
  };

  const handleDeleteComplaint = async (id: string) => {
    if (!relaySupabase || !isAdmin) return;
    if (!window.confirm('Delete this support ticket permanently?')) return;
    try {
      const { error } = await relaySupabase
        .from('gkb_complaints')
        .delete()
        .eq('id', id);
      if (error) throw error;
      setComplaints(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      alert(formatSupabaseError(err));
    }
  };

  useEffect(() => {
    if (!user) return;
    if (isAdmin) {
      void fetchAllCustomerDevices();
    }
    void fetchComplaints();
  }, [user, isAdmin, fetchAllCustomerDevices, fetchComplaints]);

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
              className="h-10 w-10 shrink-0 rounded-xl object-contain bg-slate-900 border border-cyan-500/30 p-1 shadow-[0_0_15px_rgba(6,182,212,0.2)]"
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
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-500/30 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:text-cyan-300 cursor-pointer transition-colors"
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
                {forgotPasswordMode
                  ? 'Enter your registered email below to receive a secure password recovery link.'
                  : 'Sign in to monitor and control your deployed smart hardware, or create a new client account.'}
              </p>
            </div>

            {/* Tablist Switcher (hidden in forgot password mode) */}
            {!forgotPasswordMode && (
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
            )}

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

            {/* Forgot Password Recovery Mode */}
            {forgotPasswordMode ? (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-300 mb-1.5 block">Account Email Address</label>
                  <div className="relative">
                    <input
                      type="email"
                      placeholder="name@example.com"
                      value={forgotEmail || loginEmail}
                      onChange={e => setForgotEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-cyan-400 focus:outline-none transition-colors"
                      required
                    />
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3 pointer-events-none" />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setForgotPasswordMode(false);
                      setLoginError('');
                    }}
                    className="flex-1 py-3 rounded-xl border border-slate-800 bg-slate-950 text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loginBusy}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 text-slate-950 text-xs font-black uppercase tracking-wider shadow-lg shadow-cyan-500/25 hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {loginBusy ? 'Sending Link...' : 'Send Reset Link'}
                  </button>
                </div>
              </form>
            ) : (
              /* Standard Sign In / Create Account Form */
              <form onSubmit={handleAuthSubmit} className="space-y-4">
                {creatingAccount && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs font-medium text-slate-300">
                        First Name
                        <input
                          type="text"
                          autoComplete="given-name"
                          maxLength={80}
                          placeholder="Kelvin"
                          value={signupFirstName}
                          onChange={event => setSignupFirstName(event.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none transition-colors"
                          required
                        />
                      </label>
                      <label className="block text-xs font-medium text-slate-300">
                        Last Name
                        <input
                          type="text"
                          autoComplete="family-name"
                          maxLength={80}
                          placeholder="Zumah"
                          value={signupLastName}
                          onChange={event => setSignupLastName(event.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none transition-colors"
                          required
                        />
                      </label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs font-medium text-slate-300">
                        Phone Number
                        <input
                          type="tel"
                          autoComplete="tel"
                          maxLength={30}
                          placeholder="024 000 0000 / +233..."
                          value={signupPhone}
                          onChange={event => setSignupPhone(event.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none transition-colors"
                          required
                        />
                      </label>
                      <label className="block text-xs font-medium text-slate-300">
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
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-slate-300">
                      {creatingAccount ? 'Email Address' : 'Email or Phone Number'}
                    </label>
                    {!creatingAccount && (
                      <button
                        type="button"
                        onClick={() => {
                          setLoginEmail('zumkel023@gmail.com');
                          setLoginError('');
                        }}
                        className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors inline-flex items-center gap-1 cursor-pointer bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/30"
                        title="Click to auto-fill CEO admin email"
                      >
                        <Zap className="w-2.5 h-2.5 text-cyan-400" /> Admin Quick-Fill
                      </button>
                    )}
                  </div>
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
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-slate-300">
                      {creatingAccount ? 'Create Password' : 'Password'}
                    </label>
                    {!creatingAccount && (
                      <button
                        type="button"
                        onClick={() => {
                          setForgotPasswordMode(true);
                          setLoginError('');
                          setLoginMessage('');
                        }}
                        className="text-[11px] text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={creatingAccount ? 'new-password' : 'current-password'}
                      minLength={6}
                      placeholder="••••••••••••"
                      value={loginPassword}
                      onChange={e => setLoginPassword(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-cyan-400 focus:outline-none transition-colors"
                      required
                    />
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3 pointer-events-none" />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer p-0.5 rounded"
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Confirm Password in Create Account mode */}
                {creatingAccount && (
                  <div>
                    <label className="text-xs font-medium text-slate-300 mb-1.5 block">Confirm Password</label>
                    <div className="relative">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        minLength={6}
                        placeholder="••••••••••••"
                        value={signupConfirmPassword}
                        onChange={e => setSignupConfirmPassword(e.target.value)}
                        className={`w-full pl-10 pr-10 py-2.5 bg-slate-950 border rounded-xl text-xs text-white focus:outline-none transition-colors ${
                          signupConfirmPassword
                            ? loginPassword === signupConfirmPassword
                              ? 'border-emerald-500/60 focus:border-emerald-400'
                              : 'border-rose-500/60 focus:border-rose-400'
                            : 'border-slate-800 focus:border-cyan-400'
                        }`}
                        required
                      />
                      <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3 pointer-events-none" />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        tabIndex={-1}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer p-0.5 rounded"
                        title={showConfirmPassword ? 'Hide password' : 'Show password'}
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {signupConfirmPassword && (
                      <p className={`text-[11px] mt-1 flex items-center gap-1 ${
                        loginPassword === signupConfirmPassword ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {loginPassword === signupConfirmPassword ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" /> Passwords match
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="w-3.5 h-3.5" /> Passwords do not match
                          </>
                        )}
                      </p>
                    )}
                  </div>
                )}

                {/* Remember Me Checkbox */}
                {!creatingAccount && (
                  <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={e => setRememberMe(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-cyan-400/30 h-4 w-4 cursor-pointer"
                      />
                      <span>Remember my account on this browser</span>
                    </label>
                  </div>
                )}

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
            )}

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
      <header className="relative z-50 border-b border-cyan-500/30 bg-slate-950/90 backdrop-blur-md sticky top-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-3">
          {/* Brand - Clean without overflowing badge */}
          <div
            className="flex min-w-0 items-center space-x-3 cursor-pointer shrink-0"
            onClick={() => setActiveTab(isAdmin ? 'fleet' : 'my-devices')}
          >
            <img
              src="/gkb-company-logo.png"
              alt="GKB Technologies logo"
              className="h-10 w-10 sm:h-11 sm:w-11 shrink-0 rounded-xl object-contain bg-slate-900 border border-cyan-500/30 p-1 shadow-[0_0_15px_rgba(6,182,212,0.2)]"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base lg:text-lg font-black tracking-wider bg-gradient-to-r from-cyan-400 via-sky-300 to-purple-400 bg-clip-text text-transparent whitespace-nowrap">
                  GKB TECHNOLOGIES
                </h1>
                {isAdmin ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] font-mono font-bold text-purple-300 border border-purple-500/40 shrink-0">
                    <ShieldCheck className="h-3 w-3" /> ADMIN
                  </span>
                ) : (
                  <span className="hidden sm:inline-flex items-center rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300 border border-cyan-500/40 shrink-0">
                    IoT Fleet Cloud
                  </span>
                )}
              </div>
              <p className="hidden sm:block text-[10px] text-cyan-400/70 tracking-widest uppercase whitespace-nowrap">
                Hardware BLE & QR Provisioning · Cloud Fleet Control
              </p>
            </div>
          </div>

          {/* Navigation Bar - Responsive & Spacious */}
          <nav aria-label="Main navigation" className="hidden lg:flex items-center gap-1.5 shrink-0">
            {isAdmin ? (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('fleet')}
                  className={`px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                    activeTab === 'fleet'
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/60 shadow-[0_0_15px_rgba(6,182,212,0.25)]'
                      : 'text-slate-400 hover:text-cyan-300'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Layers className="h-4 w-4" />
                    Fleet Hub
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('deploy');
                    setDeployError('');
                    setDeploySuccess('');
                  }}
                  className={`px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                    activeTab === 'deploy'
                      ? 'bg-purple-500/15 text-purple-300 border border-purple-400/60 shadow-[0_0_15px_rgba(168,85,247,0.25)]'
                      : 'text-slate-400 hover:text-purple-300'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Key className="h-4 w-4" />
                    Deploy Keys
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('customer-devices')}
                  className={`px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                    activeTab === 'customer-devices'
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/60 shadow-[0_0_15px_rgba(6,182,212,0.25)]'
                      : 'text-slate-400 hover:text-cyan-300'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Users className="h-4 w-4" />
                    Customer Devices {allCustomerDevices.length > 0 && `(${allCustomerDevices.length})`}
                  </span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('my-devices')}
                  className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                    activeTab === 'my-devices'
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/60 shadow-[0_0_15px_rgba(6,182,212,0.25)]'
                      : 'text-slate-400 hover:text-cyan-300'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
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
                  className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                    activeTab === 'add-device'
                      ? 'bg-gradient-to-r from-cyan-500 to-purple-600 text-black font-black shadow-[0_0_15px_rgba(6,182,212,0.35)]'
                      : 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/20'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Plus className="h-4 w-4" />
                    Add Device
                  </span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/60 shadow-[0_0_15px_rgba(6,182,212,0.25)]'
                  : 'text-slate-400 hover:text-cyan-300'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Cpu className="h-4 w-4" />
                Active Device
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('support')}
              className={`px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                activeTab === 'support'
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/60 shadow-[0_0_15px_rgba(6,182,212,0.25)]'
                  : 'text-slate-400 hover:text-cyan-300'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Wrench className="h-4 w-4" />
                {isAdmin ? 'Support Desk' : 'Support & Docs'}
                {isAdmin && complaints.filter(c => !c.solved).length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 bg-rose-500 text-white text-[10px] font-bold rounded-full">
                    {complaints.filter(c => !c.solved).length}
                  </span>
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('contact')}
              className={`px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                activeTab === 'contact'
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/60 shadow-[0_0_15px_rgba(6,182,212,0.25)]'
                  : 'text-slate-400 hover:text-cyan-300'
              }`}
            >
              Contact
            </button>
          </nav>

          {/* Right Actions & Admin Profile */}
          <div className="flex shrink-0 items-center space-x-2 sm:space-x-3">
            <button
              type="button"
              onClick={() => setIsLightMode(!isLightMode)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-500/30 bg-slate-900 px-2.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-cyan-400 hover:text-cyan-300 sm:px-3 cursor-pointer"
            >
              {isLightMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              <span className="hidden sm:inline">{isLightMode ? 'Dark' : 'Light'}</span>
            </button>

            {user && (
              <>
                <div className="flex items-center space-x-2 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.15)]">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center text-xs font-black text-slate-950 shadow-md">
                      {isAdmin ? 'Z' : (user.firstName ? user.firstName[0] : (user.email[0] || 'U')).toUpperCase()}
                    </div>
                    <div className="hidden sm:block text-left">
                      <p className="text-xs font-bold text-white leading-none">
                        {isAdmin ? 'Zumah Kelvin (CEO)' : (user.firstName ? `${user.firstName} ${user.lastName}` : user.email)}
                      </p>
                      <span className="text-[9px] uppercase font-mono text-cyan-400 font-bold flex items-center gap-1 mt-0.5">
                        {isAdmin ? <><ShieldCheck className="w-2.5 h-2.5 text-purple-400" /> SYSTEM ADMIN</> : user.role}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Explicit Dedicated Logout Button */}
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  title="Sign out of GKB IoT Portal"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/40 hover:border-rose-400/70 text-xs font-bold transition-all cursor-pointer shadow-[0_0_12px_rgba(244,63,94,0.15)] shrink-0"
                >
                  <LogOut className="h-4 w-4 text-rose-400" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </>
            )}

            {/* Three lines / dots menu toggle button to open up the menu bar */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(prev => !prev)}
              title={mobileMenuOpen ? 'Close Menu' : 'Open Menu (Navigation & Settings)'}
              aria-label={mobileMenuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
              className="inline-flex items-center justify-center p-2 rounded-xl border border-cyan-500/40 bg-slate-900 text-cyan-300 hover:text-white hover:border-cyan-400 hover:bg-cyan-500/15 transition-all cursor-pointer shadow-[0_0_12px_rgba(6,182,212,0.15)]"
            >
              {mobileMenuOpen ? <X className="h-5 w-5 text-rose-400" /> : <Menu className="h-5 w-5 text-cyan-400" />}
            </button>
          </div>
        </div>

        {/* Dropdown / Responsive Menu Drawer */}
        {mobileMenuOpen && (
          <div className="border-t border-cyan-500/20 bg-slate-950/95 backdrop-blur-xl px-4 py-5 shadow-2xl animate-fadeIn space-y-4">
            {user && (
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center text-sm font-black text-slate-950 shadow-md">
                    {isAdmin ? 'Z' : (user.firstName ? user.firstName[0] : (user.email[0] || 'U')).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white leading-tight">
                      {isAdmin ? 'Zumah Kelvin (CEO)' : (user.firstName ? `${user.firstName} ${user.lastName}` : user.email)}
                    </p>
                    <p className="text-xs text-slate-400">{user.email}</p>
                    <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-mono font-bold uppercase text-cyan-400">
                      {isAdmin ? <><ShieldCheck className="w-3 h-3 text-purple-400" /> SYSTEM ADMIN</> : user.role}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    void handleSignOut();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/40 text-xs font-bold hover:bg-rose-500/25 transition-colors cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5 text-rose-400" />
                  Logout
                </button>
              </div>
            )}

            {/* Menu Navigation Links */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {isAdmin ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setActiveTab('fleet'); setMobileMenuOpen(false); }}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-left cursor-pointer ${
                      activeTab === 'fleet' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50' : 'text-slate-300 hover:bg-slate-900 hover:text-cyan-300'
                    }`}
                  >
                    <Layers className="h-4 w-4 text-cyan-400" />
                    <span>Fleet Hub</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveTab('deploy'); setDeployError(''); setDeploySuccess(''); setMobileMenuOpen(false); }}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-left cursor-pointer ${
                      activeTab === 'deploy' ? 'bg-purple-500/20 text-purple-300 border border-purple-400/50' : 'text-slate-300 hover:bg-slate-900 hover:text-purple-300'
                    }`}
                  >
                    <Key className="h-4 w-4 text-purple-400" />
                    <span>Deploy Keys</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveTab('customer-devices'); setMobileMenuOpen(false); }}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-left cursor-pointer ${
                      activeTab === 'customer-devices' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50' : 'text-slate-300 hover:bg-slate-900 hover:text-cyan-300'
                    }`}
                  >
                    <Users className="h-4 w-4 text-cyan-400" />
                    <span>Customer Devices {allCustomerDevices.length > 0 && `(${allCustomerDevices.length})`}</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => { setActiveTab('my-devices'); setMobileMenuOpen(false); }}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-left cursor-pointer ${
                      activeTab === 'my-devices' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50' : 'text-slate-300 hover:bg-slate-900 hover:text-cyan-300'
                    }`}
                  >
                    <Radio className="h-4 w-4 text-cyan-400" />
                    <span>My Devices {linkedDevices.length > 0 && `(${linkedDevices.length})`}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveTab('add-device'); setClientLinkError(''); setClientLinkSuccess(''); setMobileMenuOpen(false); }}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-left cursor-pointer ${
                      activeTab === 'add-device' ? 'bg-gradient-to-r from-cyan-500 to-purple-600 text-black font-black' : 'text-cyan-300 hover:bg-slate-900'
                    }`}
                  >
                    <Plus className="h-4 w-4" />
                    <span>+ Add Device</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => { setActiveTab('dashboard'); setMobileMenuOpen(false); }}
                className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-left cursor-pointer ${
                  activeTab === 'dashboard' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50' : 'text-slate-300 hover:bg-slate-900 hover:text-cyan-300'
                }`}
              >
                <Cpu className="h-4 w-4 text-cyan-400" />
                <span>Active Device</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('support'); setMobileMenuOpen(false); }}
                className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-left cursor-pointer ${
                  activeTab === 'support' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50' : 'text-slate-300 hover:bg-slate-900 hover:text-cyan-300'
                }`}
              >
                <Wrench className="h-4 w-4 text-cyan-400" />
                <span>{isAdmin ? 'Support Desk' : 'Support & Docs'}</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('contact'); setMobileMenuOpen(false); }}
                className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all text-left cursor-pointer ${
                  activeTab === 'contact' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50' : 'text-slate-300 hover:bg-slate-900 hover:text-cyan-300'
                }`}
              >
                <Phone className="h-4 w-4 text-cyan-400" />
                <span>Contact Engineering</span>
              </button>
            </div>

            {/* Logout button at bottom of menu drawer */}
            {user && (
              <div className="pt-2 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    void handleSignOut();
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-rose-500/20 to-red-600/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition-all font-black text-sm cursor-pointer shadow-[0_0_15px_rgba(244,63,94,0.2)]"
                >
                  <LogOut className="h-4 w-4 text-rose-400" />
                  <span>Log Out of GKB IoT Portal</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Mobile Navigation */}
        <nav className="flex lg:hidden gap-1.5 overflow-x-auto border-t border-slate-800/70 px-3 py-2 scrollbar-none items-center">
          {isAdmin ? (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('fleet')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${activeTab === 'fleet' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}
              >
                Fleet Hub
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
                onClick={() => setActiveTab('customer-devices')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${activeTab === 'customer-devices' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}
              >
                Customer Devices {allCustomerDevices.length > 0 && `(${allCustomerDevices.length})`}
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
            {isAdmin ? 'Support Desk' : 'Support'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('contact')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${activeTab === 'contact' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}
          >
            Contact
          </button>
          {user && (
            <button
              type="button"
              onClick={() => void handleSignOut()}
              title="Sign out of GKB IoT Portal"
              className="px-3 py-1.5 rounded-md text-xs font-bold whitespace-nowrap cursor-pointer bg-rose-500/15 text-rose-300 border border-rose-500/40 flex items-center gap-1.5 shrink-0 ml-auto hover:bg-rose-500/25 transition-all"
            >
              <LogOut className="h-3.5 w-3.5 text-rose-400" />
              <span>Logout</span>
            </button>
          )}
        </nav>
      </header>

      {/* Main Body */}
      <main className={`max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 ${activeTab === 'dashboard' ? 'py-2.5 sm:py-3 space-y-2.5' : 'py-8 space-y-8'}`}>

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
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-slate-300 font-bold">Hardware Key (Device Token)</label>
                      <button
                        type="button"
                        onClick={() => handleGenerateNextKey(deployProject)}
                        className="text-[10px] font-mono font-bold text-purple-300 hover:text-purple-200 transition-colors inline-flex items-center gap-1 cursor-pointer bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/30"
                        title="Click to automatically suggest next serial key"
                      >
                        <Sparkles className="w-2.5 h-2.5 text-purple-400" /> Auto-Generate
                      </button>
                    </div>
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
            {/* Executive Command Hero */}
            <section className="rounded-3xl border border-cyan-500/30 bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 p-6 sm:p-8 shadow-[0_0_35px_rgba(6,182,212,0.15)] space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-400/40 bg-purple-400/10 px-3 py-1 text-xs font-mono font-bold uppercase tracking-wider text-purple-300">
                  <ShieldCheck className="h-3.5 w-3.5" /> GKB Executive Fleet Hub
                </span>
                <span className="text-xs font-mono font-bold text-cyan-300 bg-cyan-500/10 px-3 py-1 rounded-full border border-cyan-500/30 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Supabase RLS & Telemetry Active
                </span>
              </div>

              <div>
                <h2 className="text-2xl sm:text-4xl font-black tracking-tight text-white leading-tight">
                  HARDWARE FLEET COMMAND CENTER
                </h2>
                <p className="max-w-2xl text-xs sm:text-sm text-slate-300 mt-1 leading-relaxed">
                  Real-time administration portal for provisioned ESP32 microcontroller nodes, customer deployments across Ghana, and cloud telemetry streams.
                </p>
              </div>

              {/* Executive KPI Stats Bar */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                <div className="p-4 rounded-2xl border border-cyan-500/20 bg-slate-950/80">
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-[11px] font-mono uppercase tracking-wider font-semibold">Deployed Fleet Keys</span>
                    <Key className="w-4 h-4 text-cyan-400" />
                  </div>
                  <p className="text-2xl font-black text-white font-mono">{deployedDevices.length}</p>
                  <p className="text-[10px] text-cyan-400 mt-1">Authorized factory keys</p>
                </div>

                <div className="p-4 rounded-2xl border border-purple-500/20 bg-slate-950/80 cursor-pointer hover:border-purple-400/50 transition-colors" onClick={() => setActiveTab('customer-devices')}>
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-[11px] font-mono uppercase tracking-wider font-semibold">Customer Nodes</span>
                    <Users className="w-4 h-4 text-purple-400" />
                  </div>
                  <p className="text-2xl font-black text-white font-mono">{allCustomerDevices.length}</p>
                  <p className="text-[10px] text-purple-400 mt-1 flex items-center gap-1">
                    <span>Manage customer accounts</span>
                    <ArrowRight className="w-3 h-3" />
                  </p>
                </div>

                <div className="p-4 rounded-2xl border border-emerald-500/20 bg-slate-950/80">
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-[11px] font-mono uppercase tracking-wider font-semibold">Cloud Gateway</span>
                    <Wifi className="w-4 h-4 text-emerald-400" />
                  </div>
                  <p className="text-xl font-black text-emerald-400 font-mono">2.4GHz + BLE</p>
                  <p className="text-[10px] text-slate-400 mt-1">Web Bluetooth v4.2 GATT</p>
                </div>

                <div className="p-4 rounded-2xl border border-rose-500/20 bg-slate-950/80 cursor-pointer hover:border-rose-400/50 transition-colors" onClick={() => setActiveTab('support')}>
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-[11px] font-mono uppercase tracking-wider font-semibold">Support Desk</span>
                    <Wrench className="w-4 h-4 text-rose-400" />
                  </div>
                  <p className="text-2xl font-black text-white font-mono">
                    {complaints.filter(c => !c.solved).length} <span className="text-xs font-normal text-slate-400 font-sans">pending</span>
                  </p>
                  <p className="text-[10px] text-rose-400 mt-1 flex items-center gap-1">
                    <span>{complaints.length} total tickets</span>
                    <ArrowRight className="w-3 h-3" />
                  </p>
                </div>
              </div>

              {/* Quick Actions Bar */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('deploy');
                    setDeployError('');
                    setDeploySuccess('');
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-500/15 border border-purple-400/50 text-purple-300 text-xs font-bold hover:bg-purple-500/25 transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Deploy New Hardware Key
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('customer-devices')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500/15 border border-cyan-400/50 text-cyan-300 text-xs font-bold hover:bg-cyan-500/25 transition-all cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5" /> Review Customer Devices ({allCustomerDevices.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBleTargetDevice(selectedDevice || deployedDevices[0]);
                    setBleModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold hover:bg-slate-700 transition-all cursor-pointer"
                >
                  <Bluetooth className="w-3.5 h-3.5 text-cyan-400" /> Open BLE Provisioner
                </button>
              </div>

              {/* Compact Key Search */}
              <div className="pt-2">
                <form onSubmit={handleKeySearch} className="flex max-w-xl flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    placeholder="Quick jump by hardware key (e.g. GKB-LIGHT-0001, GKB-RELAY-0001…)"
                    value={inputKey}
                    onChange={e => setInputKey(e.target.value)}
                    className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-xs text-white focus:border-cyan-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={linkBusy}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-cyan-500 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-950 shadow-md shadow-cyan-500/20 hover:bg-cyan-400 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <Cpu className="h-3.5 w-3.5" />
                    Launch
                  </button>
                </form>

                {linkMessage && (
                  <p className={`text-xs p-2.5 rounded-lg border mt-2 ${linkMessageIsError ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
                    {linkMessage}
                  </p>
                )}
              </div>
            </section>

            {/* Hardware Fleet Catalog Cards */}
            <section className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-xl sm:text-2xl font-black text-white">Active Fleet Systems ({deployedDevices.length})</h3>
                  <p className="text-xs text-slate-400 mt-1">Select any production hardware node to launch its live control interface or print casing QR stickers.</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {deployedDevices.map(device => {
                  const isLight = device.project === 'light-control';
                  const isRelay = device.project === 'relay-test';
                  const isSecurity = device.project === 'smart-security-system';
                  const isWater = device.project === 'water-tank-monitor';
                  const isFan = device.project === 'fan-regulator';

                  return (
                    <article
                      key={device.key}
                      className={`flex flex-col justify-between p-5 rounded-2xl border transition-all duration-200 ${
                        isLight
                          ? 'border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-slate-900 to-slate-950 shadow-[0_0_20px_rgba(245,158,11,0.1)]'
                          : isRelay
                            ? 'border-cyan-500/40 bg-gradient-to-br from-cyan-500/10 via-slate-900 to-slate-950 shadow-[0_0_20px_rgba(6,182,212,0.1)]'
                            : isSecurity
                              ? 'border-rose-500/40 bg-gradient-to-br from-rose-500/10 via-slate-900 to-slate-950 shadow-[0_0_20px_rgba(244,63,94,0.1)]'
                              : isWater
                                ? 'border-sky-500/40 bg-gradient-to-br from-sky-500/10 via-slate-900 to-slate-950 shadow-[0_0_20px_rgba(14,165,233,0.1)]'
                                : isFan
                                  ? 'border-blue-500/40 bg-gradient-to-br from-blue-500/10 via-slate-900 to-slate-950 shadow-[0_0_20px_rgba(59,130,246,0.1)]'
                                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => handleCopyKey(device.key)}
                            className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold px-2 py-0.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:border-cyan-400 transition-colors cursor-pointer"
                            title="Click to copy key"
                          >
                            <span>{device.key}</span>
                            {copiedKey === device.key ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-400" />}
                          </button>
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Verified Node
                          </span>
                        </div>

                        <div>
                          <h4 className="text-base font-bold text-white flex items-center gap-2">
                            {isLight ? (
                              <Lightbulb className="h-4 w-4 text-amber-400 shrink-0" />
                            ) : isRelay ? (
                              <Cpu className="h-4 w-4 text-cyan-400 shrink-0" />
                            ) : isWater ? (
                              <Droplets className="h-4 w-4 text-sky-400 shrink-0" />
                            ) : isSecurity ? (
                              <Shield className="h-4 w-4 text-rose-400 shrink-0" />
                            ) : isFan ? (
                              <Wind className="h-4 w-4 text-blue-400 shrink-0" />
                            ) : device.project === 'fuel-tank-monitor' ? (
                              <Fuel className="h-4 w-4 text-emerald-400 shrink-0" />
                            ) : (
                              <Zap className="h-4 w-4 text-yellow-400 shrink-0" />
                            )}
                            {device.name}
                          </h4>
                          <p className="text-xs text-slate-400 mt-1 leading-relaxed">{device.lastAlert}</p>
                        </div>
                      </div>

                      <div className="mt-5 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDevice(device);
                            setActiveTab('dashboard');
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wider bg-slate-800 text-slate-100 hover:bg-cyan-500 hover:text-slate-950 transition-all cursor-pointer shadow-md"
                        >
                          <span>Open Live Control</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setBleTargetDevice(device);
                            setBleModalOpen(true);
                          }}
                          title="Print / View Casing QR Sticker"
                          className="p-2.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-purple-300 hover:border-purple-400/60 transition-colors cursor-pointer"
                        >
                          <QrCode className="w-4 h-4" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {/* ================= ADMIN ONLY: CUSTOMER DEVICES & BILLING CONTROL ================= */}
        {isAdmin && activeTab === 'customer-devices' && (
          <div className="space-y-8 animate-fadeIn">
            <div className="p-6 sm:p-8 rounded-3xl border border-cyan-500/30 bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 shadow-[0_0_35px_rgba(6,182,212,0.15)]">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-cyan-300">
                <Users className="h-3.5 w-3.5" /> Customer Accounts Fleet
              </span>
              <h2 className="text-2xl sm:text-4xl font-black text-white mt-2">Customer Registered Devices</h2>
              <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl">
                Inspect all customer-linked smart systems registered across Ghana. You can pause billing (suspending live cloud telemetry on delinquent accounts) or unlink devices remotely.
              </p>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 space-y-4 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Radio className="w-4 h-4 text-cyan-400" /> Registered Customer Nodes ({allCustomerDevices.length})
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">Live links stored in public.gkb_user_devices with RLS security.</p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Filter customer devices..."
                      value={customerFilter}
                      onChange={e => setCustomerFilter(e.target.value)}
                      className="rounded-xl border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                    />
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5 pointer-events-none" />
                  </div>
                  <button
                    type="button"
                    onClick={() => void fetchAllCustomerDevices()}
                    className="p-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-cyan-300 cursor-pointer"
                    title="Refresh customer devices"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${customerDevicesLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {allCustomerDevices.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs space-y-2">
                  <Users className="w-8 h-8 text-slate-600 mx-auto" />
                  <p>No customer devices have been linked yet.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950/80 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-3 px-3">Device Key</th>
                        <th className="py-3 px-3">Device Name</th>
                        <th className="py-3 px-3">User ID</th>
                        <th className="py-3 px-3">Billing Status</th>
                        <th className="py-3 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {allCustomerDevices
                        .filter(d =>
                          !customerFilter ||
                          d.device_key.toLowerCase().includes(customerFilter.toLowerCase()) ||
                          d.device_name.toLowerCase().includes(customerFilter.toLowerCase()) ||
                          (d.user_id && d.user_id.toLowerCase().includes(customerFilter.toLowerCase()))
                        )
                        .map(device => {
                          const isPaused = Boolean(device.is_paused);

                          return (
                            <tr key={`${device.user_id}-${device.device_key}`} className="hover:bg-slate-800/40 transition-colors">
                              <td className="py-3 px-3 font-mono font-bold text-cyan-300 whitespace-nowrap">
                                {device.device_key}
                              </td>
                              <td className="py-3 px-3 font-medium text-white">
                                {device.device_name}
                              </td>
                              <td className="py-3 px-3 text-slate-400 font-mono text-[10px] whitespace-nowrap">
                                {device.user_id ? `${device.user_id.slice(0, 8)}...` : 'Unknown'}
                              </td>
                              <td className="py-3 px-3 whitespace-nowrap">
                                {isPaused ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 border border-rose-500/40 text-rose-300">
                                    <PauseCircle className="w-3 h-3" /> Billing Paused
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 border border-emerald-500/40 text-emerald-300">
                                    <PlayCircle className="w-3 h-3" /> Active & Online
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-3 text-right whitespace-nowrap space-x-2">
                                <button
                                  type="button"
                                  onClick={() => void handleTogglePauseCustomerDevice(device.user_id, device.device_key, isPaused)}
                                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                    isPaused
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                                  }`}
                                >
                                  {isPaused ? 'Restore Service' : 'Pause Billing'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteCustomerDevice(device.user_id, device.device_key)}
                                  title="Unlink customer device"
                                  className="p-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= 5. PRIMARY DASHBOARD VIEW ================= */}
        {activeTab === 'dashboard' && (
          <div className="space-y-2.5 animate-fadeIn">
            {/* Top Navigation & Fast Device Selector Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2 sm:p-2.5 rounded-xl border border-slate-800 bg-slate-900/95 shadow-md">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab(isAdmin ? 'fleet' : 'my-devices');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer shrink-0"
                >
                  <ArrowRight className="h-3.5 w-3.5 rotate-180" />
                  <span>{isAdmin ? 'Fleet Hub' : 'My Devices'}</span>
                </button>

                <div className="hidden sm:flex items-center gap-1.5 text-xs">
                  <span className="text-slate-400">Node:</span>
                  <span className="font-mono font-bold text-cyan-300 bg-slate-950 px-2 py-0.5 rounded border border-cyan-500/30 text-[11px]">
                    {selectedDevice?.key}
                  </span>
                </div>
              </div>

              {/* Fast Device Switcher Pills (Horizontal 1-Line Strip) */}
              {isAdmin ? (
                <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full no-scrollbar">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 hidden xl:inline mr-1">Switch:</span>
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
                        title={d.name}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/30 ring-1 ring-cyan-300'
                            : 'border border-slate-800/80 bg-slate-950/70 text-slate-300 hover:text-white hover:border-slate-700'
                        }`}
                      >
                        <span className="font-mono text-[10px] opacity-75 mr-1">{d.key.replace('GKB-', '')}</span>
                        <span>{d.name.split(' (')[0].replace('ESP32 ', '').replace('Smart ', '')}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                linkedDevices.length > 1 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
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
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/30'
                              : 'border border-slate-800 bg-slate-950 text-slate-300 hover:text-white'
                          }`}
                        >
                          {d.name.split(' (')[0]}
                        </button>
                      );
                    })}
                  </div>
                )
              )}

              {/* Right Action: BLE Provision */}
              {selectedDevice && (
                <button
                  type="button"
                  onClick={() => {
                    setBleTargetDevice(selectedDevice);
                    setBleModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 transition-colors cursor-pointer shrink-0"
                >
                  <Bluetooth className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">BLE Provision</span>
                </button>
              )}
            </div>

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
              <RelayTestDashboard mode="service" isAdmin={isAdmin} />
            ) : selectedDevice.project === 'light-control' ? (
              <LightControlDashboard mode="service" device={selectedDevice} isAdmin={isAdmin} />
            ) : selectedDevice.project === 'water-tank-monitor' || selectedDevice.key === 'GKB-SWP-0001' ? (
              <WaterTankDashboard mode="service" device={selectedDevice} isAdmin={isAdmin} />
            ) : selectedDevice.project === 'smart-security-system' || selectedDevice.key === 'GKB-SEC-0001' ? (
              <SmartSecurityDashboard mode="service" device={selectedDevice} isAdmin={isAdmin} />
            ) : selectedDevice.project === 'fan-regulator' || selectedDevice.key === 'GKB-FAN-0001' || selectedDevice.key === 'GKB-SFLC-0001' ? (
              <FanRegulatorDashboard mode="service" device={selectedDevice} isAdmin={isAdmin} />
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

        {/* ================= 6. SUPPORT VIEW (WITH ADMIN COMPLAINTS DESK) ================= */}
        {activeTab === 'support' && (
          <div className="max-w-4xl mx-auto space-y-8 animate-fadeIn">
            {isAdmin && (
              /* Admin Complaints / Support Desk */
              <div className="p-6 sm:p-8 rounded-3xl border border-rose-500/30 bg-slate-900/90 shadow-xl space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                  <div>
                    <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-rose-400 bg-rose-500/10 px-2.5 py-0.5 rounded-full border border-rose-500/30 uppercase">
                      <ShieldCheck className="w-3.5 h-3.5" /> Helpdesk Administration
                    </span>
                    <h3 className="text-xl sm:text-2xl font-black text-white mt-1">Customer Support Complaints ({complaints.length})</h3>
                  </div>

                  {/* Filter Pills */}
                  <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setComplaintFilter('all')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${complaintFilter === 'all' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}
                    >
                      All ({complaints.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setComplaintFilter('pending')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${complaintFilter === 'pending' ? 'bg-rose-500 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                      Pending ({complaints.filter(c => !c.solved).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setComplaintFilter('resolved')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${complaintFilter === 'resolved' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}
                    >
                      Resolved ({complaints.filter(c => c.solved).length})
                    </button>
                  </div>
                </div>

                {complaints.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">No customer support complaints currently filed.</p>
                ) : (
                  <div className="space-y-3">
                    {complaints
                      .filter(c => {
                        if (complaintFilter === 'pending') return !c.solved;
                        if (complaintFilter === 'resolved') return c.solved;
                        return true;
                      })
                      .map(item => (
                        <div
                          key={item.id}
                          className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            item.solved ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white">{item.client_email || 'Customer'}</span>
                              <span className="text-[10px] text-slate-500 font-mono">
                                {new Date(item.created_at).toLocaleDateString()}
                              </span>
                              {item.solved ? (
                                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30">
                                  Resolved
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-rose-400 bg-rose-500/20 px-2 py-0.5 rounded-full border border-rose-500/30">
                                  Action Required
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed">{item.complaint}</p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                            <button
                              type="button"
                              onClick={() => void handleToggleSolveComplaint(item.id, Boolean(item.solved))}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                item.solved
                                  ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                  : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-md shadow-emerald-500/20'
                              }`}
                            >
                              {item.solved ? 'Reopen Ticket' : 'Mark Resolved'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteComplaint(item.id)}
                              className="p-1.5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors cursor-pointer"
                              title="Delete ticket"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Hardware Troubleshooting Docs */}
            <div className="rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-6 space-y-3">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Wrench className="h-5 w-5 text-cyan-400" /> Hardware Provisioning & Troubleshooting
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Step-by-step guidance for provisioning, flashing, and operating GKB ESP32 Smart Systems.
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
          <div className="max-w-4xl mx-auto space-y-8 animate-fadeIn">
            {/* Header Banner */}
            <div className="text-center rounded-3xl border border-cyan-500/30 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-8 sm:p-10 space-y-4 shadow-[0_0_40px_rgba(6,182,212,0.15)] relative overflow-hidden">
              <div className="absolute top-0 right-1/4 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute bottom-0 left-1/4 w-72 h-72 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3.5 py-1 text-xs font-bold uppercase tracking-widest text-cyan-300">
                <Radio className="h-3.5 w-3.5 animate-pulse" /> Direct Engineering Support
              </span>

              <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
                GKB Technologies Hardware Engineering
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-2xl mx-auto">
                Dedicated client & enterprise engineering support for IoT telemetry nodes, microcontroller firmware, and embedded relay controllers.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-3 text-xs font-mono text-cyan-300 pt-2">
                <a
                  href="mailto:support@gkb-technologies.com"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-cyan-400 hover:text-cyan-200 transition-colors"
                >
                  <Mail className="h-4 w-4 text-cyan-400" /> support@gkb-technologies.com
                </a>
                <a
                  href="https://gkb-devices.netlify.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-purple-400 hover:text-purple-200 transition-colors"
                >
                  <Globe className="h-4 w-4 text-purple-400" /> https://gkb-devices.netlify.app
                </a>
              </div>
            </div>

            {/* Responsive Interactive Contact Buttons Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              {/* WhatsApp Button */}
              <a
                href="https://wa.me/233552117787"
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex items-center justify-between p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-emerald-500/10 via-emerald-600/10 to-slate-900/90 border border-emerald-500/40 hover:border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.15)] hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all duration-300 hover:scale-[1.02] cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
                    {/* Authentic WhatsApp SVG */}
                    <svg className="w-6 h-6 fill-current text-emerald-400" viewBox="0 0 24 24">
                      <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white group-hover:text-emerald-300 transition-colors">
                        WhatsApp
                      </h3>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Chat
                      </span>
                    </div>
                    <p className="text-sm font-mono text-emerald-400 font-bold mt-0.5">
                      +233 552 117 787
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Direct WhatsApp message & technician support
                    </p>
                  </div>
                </div>
                <div className="shrink-0 p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 group-hover:bg-emerald-500 group-hover:text-slate-950 transition-all">
                  <ExternalLink className="w-4 h-4" />
                </div>
              </a>

              {/* Direct Phone Call Button */}
              <a
                href="tel:+233552117787"
                className="group relative flex items-center justify-between p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-cyan-500/10 via-sky-600/10 to-slate-900/90 border border-cyan-500/40 hover:border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.15)] hover:shadow-[0_0_30px_rgba(6,182,212,0.3)] transition-all duration-300 hover:scale-[1.02] cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 group-hover:scale-110 transition-transform">
                    <PhoneCall className="w-6 h-6 text-cyan-400" />
                  </div>
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white group-hover:text-cyan-300 transition-colors">
                        Direct Phone Call
                      </h3>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                        Voice
                      </span>
                    </div>
                    <p className="text-sm font-mono text-cyan-400 font-bold mt-0.5">
                      +233 552 117 787
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      One-tap cellular phone call to lead engineering
                    </p>
                  </div>
                </div>
                <div className="shrink-0 p-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 group-hover:bg-cyan-500 group-hover:text-slate-950 transition-all">
                  <Phone className="w-4 h-4" />
                </div>
              </a>

              {/* Instagram Button */}
              <a
                href="https://instagram.com/gkb_technologies"
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex items-center justify-between p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-pink-500/10 via-purple-600/10 to-slate-900/90 border border-pink-500/40 hover:border-pink-400 shadow-[0_0_20px_rgba(236,72,153,0.15)] hover:shadow-[0_0_30px_rgba(236,72,153,0.3)] transition-all duration-300 hover:scale-[1.02] cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-500/20 to-purple-500/20 border border-pink-500/40 flex items-center justify-center text-pink-400 group-hover:scale-110 transition-transform">
                    {/* Authentic Instagram SVG */}
                    <svg className="w-6 h-6 fill-current text-pink-400" viewBox="0 0 24 24">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white group-hover:text-pink-300 transition-colors">
                        Instagram
                      </h3>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/30">
                        Official
                      </span>
                    </div>
                    <p className="text-sm font-mono text-pink-400 font-bold mt-0.5">
                      @gkb_technologies
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Product updates, live demonstrations & reels
                    </p>
                  </div>
                </div>
                <div className="shrink-0 p-2.5 rounded-xl bg-pink-500/20 border border-pink-500/40 text-pink-300 group-hover:bg-pink-500 group-hover:text-slate-950 transition-all">
                  <ExternalLink className="w-4 h-4" />
                </div>
              </a>

              {/* TikTok Button */}
              <a
                href="https://www.tiktok.com/@gkbtech"
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex items-center justify-between p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-purple-500/10 via-slate-900 to-cyan-500/10 border border-purple-500/40 hover:border-cyan-400 shadow-[0_0_20px_rgba(168,85,247,0.15)] hover:shadow-[0_0_30px_rgba(6,182,212,0.25)] transition-all duration-300 hover:scale-[1.02] cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                    {/* Authentic TikTok SVG */}
                    <svg className="w-6 h-6 fill-current text-cyan-300" viewBox="0 0 24 24">
                      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.24 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white group-hover:text-cyan-300 transition-colors">
                        TikTok
                      </h3>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                        Videos
                      </span>
                    </div>
                    <p className="text-sm font-mono text-cyan-400 font-bold mt-0.5">
                      @gkbtech
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Hardware clips, test runs & tech tutorials
                    </p>
                  </div>
                </div>
                <div className="shrink-0 p-2.5 rounded-xl bg-purple-500/20 border border-purple-500/40 text-purple-300 group-hover:bg-purple-500 group-hover:text-slate-950 transition-all">
                  <ExternalLink className="w-4 h-4" />
                </div>
              </a>
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
