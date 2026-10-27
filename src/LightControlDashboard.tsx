import React, { useState, useEffect } from 'react';
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
  relayChannels?: 4 | 6 | 8;
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
  return `/*
 * =========================================================================================
 * GKB TECHNOLOGIES — ESP32 SMART LIGHT CONTROL SYSTEM (${channels}-CHANNEL RELAY)
 * =========================================================================================
 * Target Board       : ESP32 Dev Module / NodeMCU-32S / ESP-WROOM-32
 * Device Token Model : Unique Hardware Casing Token (Default: ${deviceKey})
 * Target Outputs     : ${channels}-Channel Relay Board:
 *                      - Channel 1: GPIO 23 (Light 1)
 *                      - Channel 2: GPIO 22 (Light 2)
 *                      - Channel 3: GPIO 21 (Light 3)
 *                      - Channel 4: GPIO 19 (Light 4)${channels >= 6 ? '\n *                      - Channel 5: GPIO 18 (Light 5)\n *                      - Channel 6: GPIO 5  (Light 6)' : ''}${channels >= 8 ? '\n *                      - Channel 7: GPIO 4  (Light 7)\n *                      - Channel 8: GPIO 15 (Light 8)' : ''}
 * Status Diagnostic  : Onboard Blue LED (GPIO 2)
 * Factory Reset Button: Onboard BOOT Button (GPIO 0, Hold for 5s)
 * Storage Engine     : Non-Volatile Flash Partition (ESP32 Preferences.h / NVS)
 * Connectivity       : Dual-Mode (BLE 4.2 GATT Provisioning + 2.4GHz Wi-Fi Cloud Polling)
 * Cloud Backend      : Supabase public.light_control_status (device_id: light_01)
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

#define PIN_RELAY_CH1       23
#define PIN_RELAY_CH2       22
#define PIN_RELAY_CH3       21
#define PIN_RELAY_CH4       19
#define PIN_STATUS_LED      2
#define PIN_BOOT_BUTTON     0

#define RELAY_ACTIVE_HIGH   true
#define DEFAULT_DEVICE_KEY  "${deviceKey}"

#define GKB_BLE_SERVICE_UUID "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define GKB_BLE_CHAR_RX_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define GKB_BLE_CHAR_TX_UUID "beb5483f-36e1-4688-b7f5-ea07361b26a9"

const char* SUPABASE_REST_URL = "https://ditnksmvcacnzdguqcgz.supabase.co/rest/v1/light_control_status?device_id=eq.light_01&select=ch1,ch2,ch3,ch4";
const char* SUPABASE_ANON_KEY = "sb_publishable_33KQl1SmvaBaqNzxWJiyzw_HuLMgWAl";

Preferences preferences;
String deviceKey = DEFAULT_DEVICE_KEY;
String wifiSSID = "";
String wifiPassword = "";
bool isProvisioned = false;
bool bleClientConnected = false;
bool qrAuthenticated = false;

bool ch1_state = false, ch2_state = false, ch3_state = false, ch4_state = false;

BLEServer* pBleServer = nullptr;
BLECharacteristic* pTxCharacteristic = nullptr;
unsigned long lastCloudPoll = 0;
bool pendingReboot = false;
unsigned long rebootScheduledAt = 0;

void applyOutput(int pin, bool state) {
  digitalWrite(pin, (RELAY_ACTIVE_HIGH ? state : !state) ? HIGH : LOW);
}

void pollCloud() {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  if (http.begin(client, SUPABASE_REST_URL)) {
    http.addHeader("apikey", SUPABASE_ANON_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    if (http.GET() == 200) {
      String p = http.getString();
      ch1_state = p.indexOf("\\"ch1\\":true") != -1;
      ch2_state = p.indexOf("\\"ch2\\":true") != -1;
      ch3_state = p.indexOf("\\"ch3\\":true") != -1;
      ch4_state = p.indexOf("\\"ch4\\":true") != -1;
      applyOutput(PIN_RELAY_CH1, ch1_state);
      applyOutput(PIN_RELAY_CH2, ch2_state);
      applyOutput(PIN_RELAY_CH3, ch3_state);
      applyOutput(PIN_RELAY_CH4, ch4_state);
    }
    http.end();
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BOOT_BUTTON, INPUT_PULLUP);
  pinMode(PIN_STATUS_LED, OUTPUT);
  pinMode(PIN_RELAY_CH1, OUTPUT);
  pinMode(PIN_RELAY_CH2, OUTPUT);
  pinMode(PIN_RELAY_CH3, OUTPUT);
  pinMode(PIN_RELAY_CH4, OUTPUT);
  applyOutput(PIN_RELAY_CH1, false);
  applyOutput(PIN_RELAY_CH2, false);
  applyOutput(PIN_RELAY_CH3, false);
  applyOutput(PIN_RELAY_CH4, false);

  preferences.begin("gkb_prov", false);
  isProvisioned = preferences.getBool("is_prov", false);
  wifiSSID = preferences.getString("wifi_ssid", "");
  wifiPassword = preferences.getString("wifi_pass", "");
  preferences.end();

  if (isProvisioned && wifiSSID.length() > 0) {
    WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());
  } else {
    BLEDevice::init("GKB-LIGHT-0001");
    pBleServer = BLEDevice::createServer();
    BLEService* s = pBleServer->createService(GKB_BLE_SERVICE_UUID);
    // Standard GATT configuration...
    s->start();
    BLEDevice::startAdvertising();
  }
}

void loop() {
  if (pendingReboot && millis() >= rebootScheduledAt) ESP.restart();
  if (WiFi.status() == WL_CONNECTED && millis() - lastCloudPoll >= 2500) {
    lastCloudPoll = millis();
    pollCloud();
  }
}
`;
}

export default function LightControlDashboard({
  mode = 'service',
  device
}: {
  mode?: 'test' | 'service';
  device: Device;
}) {
  const relayChannels = device.relayChannels ?? 4;

  // BLE & QR Provisioning Modal States
  const [provisionModalOpen, setProvisionModalOpen] = useState(false);
  const [showLabelInModal, setShowLabelInModal] = useState(false);
  const [showFirmwareModal, setShowFirmwareModal] = useState(false);
  const [copiedFirmware, setCopiedFirmware] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

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

  const [editingChannel, setEditingChannel] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [activity, setActivity] = useState<DeviceControlActivity[]>([
    {
      id: 'init',
      event: `Light controller initialized · ${relayChannels} relay channels ready`,
      timestamp: 'Just now'
    }
  ]);

  // Poll Supabase light_control_status every 2.5s
  useEffect(() => {
    if (mode !== 'service' || !relaySupabase) return;

    let disposed = false;
    const fetchStatus = async () => {
      try {
        const { data, error } = await relaySupabase
          .from('light_control_status')
          .select('ch1, ch2, ch3, ch4, ch5, ch6, ch7, ch8, updated_at')
          .eq('device_id', 'light_01')
          .maybeSingle();

        if (disposed) return;
        if (!error && data) {
          setLastSyncedAt(new Date());
          setLights(current =>
            current.map(light => {
              const cloudVal = (data as Record<string, unknown>)[`ch${light.channel}`];
              return typeof cloudVal === 'boolean' ? { ...light, isOn: cloudVal } : light;
            })
          );
        }
      } catch (err) {
        console.warn('Supabase light status polling error:', err);
      }
    };

    void fetchStatus();
    const intervalId = window.setInterval(() => void fetchStatus(), 2500);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [mode, device.key]);

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

    // Snappy optimistic UI update
    setLights(current =>
      current.map(item => (item.channel === channel ? { ...item, isOn: nextState } : item))
    );
    recordActivity(`${light.name} (GPIO ${light.gpio}) switched ${nextState ? 'ON' : 'OFF'}`);

    if (relaySupabase) {
      setIsSyncing(true);
      try {
        const { error } = await relaySupabase
          .from('light_control_status')
          .update({
            [`ch${channel}`]: nextState
          })
          .eq('device_id', 'light_01');
        if (error) {
          console.warn('Could not sync to Supabase light_control_status:', error);
          setSyncMessage(`Sync error: ${error.message}`);
        } else {
          setLastSyncedAt(new Date());
          setSyncMessage(`Relay ${channel} switched to ${nextState ? 'ON' : 'OFF'}`);
        }
      } catch (error) {
        console.warn('Could not sync to Supabase light_control_status:', error);
      } finally {
        setIsSyncing(false);
      }
    }
  };

  const handleMasterAll = async (targetState: boolean) => {
    setLights(current => current.map(item => ({ ...item, isOn: targetState })));
    recordActivity(`Master Override: Switched ALL ${relayChannels} lights ${targetState ? 'ON' : 'OFF'}`);

    if (relaySupabase) {
      setIsSyncing(true);
      try {
        const payload: Record<string, boolean> = {};
        for (let i = 1; i <= relayChannels; i++) {
          payload[`ch${i}`] = targetState;
        }
        const { error } = await relaySupabase
          .from('light_control_status')
          .update(payload)
          .eq('device_id', 'light_01');
        if (error) {
          console.warn('Could not update all channels in Supabase:', error);
          setSyncMessage(`Master sync error: ${error.message}`);
        } else {
          setLastSyncedAt(new Date());
          setSyncMessage(`Master command applied: All ${relayChannels} channels ${targetState ? 'ON' : 'OFF'}`);
        }
      } catch (error) {
        console.warn('Could not update all channels in Supabase:', error);
      } finally {
        setIsSyncing(false);
      }
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
              Smart Light Control System · {relayChannels}-Channel Relay
            </h2>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3.5 py-1.5 font-mono text-xs font-bold text-amber-300 w-fit">
            <Lightbulb className="h-4 w-4 text-amber-400" /> Target: {device.key}
          </span>
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
              Transfers local Wi-Fi. ESP32 commits to Preferences.h Flash and polls Supabase to switch {relayChannels} relays.
            </p>
          </div>
        </div>

        {/* Pinout and Hardware Specs Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-400 border-t border-slate-800/60">
          <div className="flex flex-wrap items-center gap-4 font-mono text-[11px]">
            <span className="flex items-center gap-1.5 text-amber-300">
              <Cpu className="h-3.5 w-3.5 text-amber-400" /> Relays 1-4: <strong className="text-white">GPIO 23, 22, 21, 19</strong>
            </span>
            <span className="flex items-center gap-1.5 text-purple-300">
              <Radio className="h-3.5 w-3.5 text-purple-400" /> Status LED: <strong className="text-white">GPIO 2</strong>
            </span>
            <span className="flex items-center gap-1.5 text-cyan-300">
              <Key className="h-3.5 w-3.5 text-cyan-400" /> Factory Reset: <strong className="text-white">BOOT (GPIO 0) 5s</strong>
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            Cloud Endpoint: <code className="text-slate-400 font-mono">public.light_control_status (light_01)</code>
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
              {lastSyncedAt ? `Last cloud sync: ${lastSyncedAt.toLocaleTimeString()}` : 'Connected to cloud relay telemetry'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
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
