import BleProvisioningModal from './BleProvisioningModal';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  relayControlEnabled, relayPairingEnabled, relaySupabase, relaySupabaseConfigError } from './supabase';
import {
  Cpu, Shield, Smartphone, Wrench, Phone, Mail, Globe, Camera, User, Lock, LogOut, PlusCircle, CheckCircle, AlertTriangle, Unlink, Send, Server, Terminal, Activity, Layers, ArrowRight, CheckSquare, Square, Sun, Moon, Zap, Wifi, Radio, Gauge, BatteryCharging, Lightbulb, Pencil, Save, X, Volume2, VolumeX, PhoneCall, Copy, Download, Code, Check, Siren, ShieldAlert, ShieldCheck, Eye, EyeOff, Clock3, Trash2, PauseCircle, PlayCircle, Ban, RotateCcw, CreditCard, MessageSquare, AlertCircle, RefreshCw, Bluetooth, QrCode, Printer
} from 'lucide-react';

type ServiceType = 'student-projects' | 'retail-gadgets';
type StudentProject = 'fuel-tank-monitor' | 'water-tank-monitor' | 'prepaid-energy-meter' | 'alcohol-breathalyzer' | 'fan-regulator' | 'light-control' | 'relay-test' | 'smart-security-system';

type UserType = {
  id: string;
  role: 'admin' | 'client';
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  location: string;
};

type Device = {
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

type CustomerDevice = {
  id: number | string;
  userId: string;
  key: string;
  name: string;
  status: string;
  lastAlert: string;
  project?: StudentProject;
  relayChannels?: 4 | 6 | 8;
  paused?: boolean;
};

type InventoryItem = {
  id: string;
  brand: string;
  title: string;
  highlights: string;
  price: number;
  ram: string;
  storage: string;
  image_path: string;
  active: boolean;
};

const inventoryRamOptions = ['4GB', '8GB', '16GB', '32GB', '64GB'];
const inventoryStorageOptions = ['128GB', '256GB', '512GB', '1TB', '2TB', '4TB'];
const inventoryImageBucket = 'gkb-device-images';

function isStoredDevice(value: unknown): value is Device {
  if (typeof value !== 'object' || value === null) return false;
  const device = value as Record<string, unknown>;
  const projectValues: StudentProject[] = [
    'fuel-tank-monitor',
    'water-tank-monitor',
    'prepaid-energy-meter',
    'alcohol-breathalyzer',
    'fan-regulator',
    'light-control',
    'relay-test',
    'smart-security-system'
  ];
  return typeof device.id === 'number' &&
    typeof device.name === 'string' &&
    typeof device.key === 'string' &&
    typeof device.status === 'string' &&
    typeof device.lastAlert === 'string' &&
    (device.project === undefined || projectValues.includes(device.project as StudentProject)) &&
    (device.legacyKeys === undefined || (Array.isArray(device.legacyKeys) && device.legacyKeys.every(key => typeof key === 'string'))) &&
    (device.relayChannels === undefined || device.relayChannels === 4 || device.relayChannels === 6 || device.relayChannels === 8) &&
    (device.paused === undefined || typeof device.paused === 'boolean');
}

function InventoryHighlights({ text }: { text: string }) {
  const measurementRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [fullHeight, setFullHeight] = useState(0);
  const [collapsedHeight, setCollapsedHeight] = useState(0);

  useEffect(() => {
    const measurement = measurementRef.current;
    if (!measurement) return;

    const updateMeasurements = () => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(measurement).lineHeight);
      const nextCollapsedHeight = (Number.isFinite(lineHeight) ? lineHeight : 24) * 3;
      const nextFullHeight = measurement.scrollHeight;
      setCollapsedHeight(nextCollapsedHeight);
      setFullHeight(nextFullHeight);
      setHasMore(nextFullHeight > nextCollapsedHeight + 1);
    };

    updateMeasurements();
    const observer = new ResizeObserver(updateMeasurements);
    observer.observe(measurement);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div className="relative">
      <p
        aria-hidden="true"
        ref={measurementRef}
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 whitespace-pre-line text-sm leading-relaxed opacity-0"
      >
        {text}
      </p>
      <p
        className="overflow-hidden whitespace-pre-line text-sm leading-relaxed text-slate-400 transition-[max-height] duration-300 ease-in-out"
        style={{ maxHeight: `${expanded ? fullHeight : collapsedHeight}px` }}
      >
        {text}
      </p>
      {hasMore && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}
          className="mt-2 text-xs font-semibold text-cyan-300 transition-colors hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          {expanded ? 'See Less' : 'See More'}
        </button>
      )}
    </div>
  );
}

const defaultDevices: Device[] = [
  {
    id: 1,
    name: 'ESP32 Smart Relay Pilot (Hardware Test Ground)',
    key: 'GKB-SEC-0001',
    legacyKeys: ['GKB-RELAY-0001', 'GKBSEC-00106', 'GKB-SEC-9988'],
    status: 'Online',
    lastAlert: 'Relay Ready · BLE & QR Provisioning Active · GPIO 23 Output',
    project: 'relay-test'
  },
  { id: 2, name: 'Smart Water Tank Monitor', key: 'GKB-SWP-0001', legacyKeys: ['GKB-WTR-4412'], status: 'Online', lastAlert: 'Water level stable at 68%', project: 'water-tank-monitor' },
  { id: 3, name: 'Industrial Fuel Tank Monitor', key: 'GKB-IUFT-0001', status: 'Online', lastAlert: 'Fuel level stable at 72%', project: 'fuel-tank-monitor' },
  { id: 4, name: 'GKB Smart Prepaid Energy Meter', key: 'GKB-SPEM-0001', status: 'Online', lastAlert: 'Meter secure · balance GHS 24.50', project: 'prepaid-energy-meter' },
  { id: 5, name: 'Smart Alcohol Breathalyzer System', key: 'GKB-SAB-0001', status: 'Online', lastAlert: 'Alcohol level clear · demo', project: 'alcohol-breathalyzer' },
  { id: 6, name: 'Smart Fan Regulator', key: 'GKB-FAN-0001', legacyKeys: ['GKB-SFLC-0001'], status: 'Online', lastAlert: 'Fan off · all speed relays open · demo', project: 'fan-regulator' },
  { id: 7, name: 'Smart Light Control System v1 · 4-channel', key: 'GKB-LIGHT-0001V1', legacyKeys: ['GKB-LIGHTV1-0001', 'GKB-LIGHT-0001'], status: 'Online', lastAlert: 'All 4 lights off · demo', project: 'light-control', relayChannels: 4 },
  { id: 8, name: 'Smart Light Control System v2 · 6-channel', key: 'GKB-LIGHT-0001V2', legacyKeys: ['GKB-LIGHTV2-0001'], status: 'Online', lastAlert: 'All 6 lights off · demo', project: 'light-control', relayChannels: 6 },
  { id: 9, name: 'Smart Light Control System v3 · 8-channel', key: 'GKB-LIGHT-0001V3', legacyKeys: ['GKB-LIGHTV3-0001'], status: 'Online', lastAlert: 'All 8 lights off · demo', project: 'light-control', relayChannels: 8 },
  { id: 10, name: 'Relay Test Module', key: 'GKB-RELAY-0001', status: 'Online', lastAlert: 'Relay off · car stationary · demo', project: 'relay-test' }
];

type Complaint = {
  id: string;
  clientId: string;
  clientEmail: string;
  text: string;
  solved: boolean;
  date: string;
};

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

async function formatSupabaseFunctionError(error: unknown): Promise<string> {
  if (typeof error === 'object' && error !== null && 'context' in error && error.context instanceof Response) {
    try {
      const responseBody: unknown = await error.context.clone().json();
      if (typeof responseBody === 'object' && responseBody !== null && 'error' in responseBody && typeof responseBody.error === 'string') {
        return responseBody.error;
      }
    } catch {
      return formatSupabaseError(error);
    }
  }
  return formatSupabaseError(error);
}

function RelayTestDashboard({ mode }: { mode: 'test' | 'service' }) {
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
    const pollId = window.setInterval(() => void readRelayState(), 3000);
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
    if (!relayControlEnabled || !relaySupabase || !relaySession || !relayPaired || relayBusy) return;

    const nextState = relayOn ? 'OFF' : 'ON';
    setRelayBusy(true);
    setRelayError('');
    setRelayMessage('');
    try {
      const { error } = await relaySupabase
        .from('relay_status')
        .update({ state: nextState, updated_at: new Date().toISOString() })
        .eq('device_id', 'relay_01');
      if (error) throw error;

      const { data, error: verificationError } = await relaySupabase
        .from('relay_status')
        .select('state, updated_at')
        .eq('device_id', 'relay_01')
        .maybeSingle();
      if (verificationError) throw new Error(`Command was submitted, but its state could not be verified: ${verificationError.message}`);
      if (!data) {
        throw new Error('No relay_01 row is visible to this account after the command. Check its owner assignment and RLS policies.');
      }
      if (data.state !== nextState) {
        setRelayOn(data.state === 'ON');
        throw new Error(`Supabase still reports ${data.state}; the requested ${nextState} command was not confirmed.`);
      }
      setRelayOn(data.state === 'ON');
      setLastSyncedAt(new Date());
      setRelayMessage(`Database state confirmed as ${data.state}. The ESP32 polls every 2.5 seconds via Supabase REST.`);
    } catch (error) {
      setRelayError(`Could not send the relay command to Supabase: ${formatSupabaseError(error)}`);
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
      <header className="rounded-2xl border border-cyan-500/20 bg-slate-900/80 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
              {mode === 'test' ? 'Hardware Testing Ground · Simulation Preview' : 'Primary Testing Ground · Supabase Cloud relay_01'}
            </p>
            <h2 id="relay-test-title" className="mt-1 text-xl font-bold text-white sm:text-2xl">
              ESP32 Relay Test & Provisioning Center
            </h2>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 font-mono text-xs font-bold text-cyan-300 w-fit">
            <Cpu className="h-3.5 w-3.5 text-cyan-400" /> Device: GKB-SEC-0001
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          Designated primary testing ground for GKB hardware communication, BLE handshake, QR camera verification, NVS flash credentials, and real-time cloud relay switching.
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

      {/* Relay Hardware Output & Interactive Simulation Card */}
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
            {relayOn ? 'Relay ON · GPIO 23 Energized · Wheels Spinning' : 'Relay OFF · GPIO 23 Released · Stationary'}
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
            disabled={mode === 'service' && (!relayControlEnabled || !relaySupabase || !relaySession || !relayPaired || relayBusy || connectionState !== 'connected')}
            className={`relative h-10 w-[4.5rem] rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer ${relayOn ? 'bg-emerald-500' : 'bg-slate-700'}`}
          >
            <span className={`absolute left-1 top-1 h-8 w-8 rounded-full bg-white shadow transition-transform ${relayOn ? 'translate-x-8' : 'translate-x-0'}`} />
          </button>
          <p className={`text-lg font-bold ${relayOn ? 'text-emerald-300' : 'text-slate-300'}`}>{relayOn ? 'ON' : 'OFF'}</p>
          {mode === 'test' ? (
            <p className="text-center text-xs leading-relaxed text-slate-500">Demo toggle mode · switches wheel spin animation and preview state.</p>
          ) : (
            <>
              {lastSyncedAt && <p className="text-center text-xs text-slate-500">Last database sync: {lastSyncedAt.toLocaleTimeString()}</p>}
              {relayError && <p role="alert" className="max-w-64 text-center text-xs leading-relaxed text-red-300">{relayError}</p>}
              {relayMessage && <p role="status" className="max-w-64 text-center text-xs leading-relaxed text-emerald-200">{relayMessage}</p>}
              {!relayControlEnabled && <p role="status" className="max-w-64 text-center text-xs leading-relaxed text-amber-200">Relay control is disabled. Apply the secure Supabase SQL setup first, then set VITE_RELAY_CONTROL_ENABLED=true in Netlify.</p>}
              {relayControlEnabled && relaySupabase && relaySession && connectionState === 'connected' && !relayPaired && <p role="status" className="max-w-64 text-center text-xs leading-relaxed text-amber-200">This ESP32 has not been paired yet. Pair with GKB-SEC-0001 in My Devices before enabling relay commands.</p>}
              <p className="max-w-64 text-center text-xs leading-relaxed text-slate-500">
                ESP32 polls public.relay_status every 2.5s and switches GPIO 23.
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
              <h3 className="text-sm font-semibold text-white">{creatingAccount ? 'Create a Supabase account' : 'Sign in to control this relay'}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                This is Supabase authentication, separate from the demo portal login. Only the account assigned to relay_01 in the database can change its state.
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
          setRelayMessage(`Device (${key}) successfully provisioned via BLE & QR! Stored in Preferences.h flash.`);
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


function FuelTankMonitorDashboard({ mode }: { mode: 'test' | 'service' }) {
  return (
    <section aria-labelledby="fuel-monitor-title" className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-emerald-500/20 bg-slate-900/80 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
              {mode === 'test' ? 'Device test preview' : 'Service portal'}
            </span>
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">
              Simulated values
            </span>
          </div>
          <h2 id="fuel-monitor-title" className="text-xl font-bold text-white sm:text-2xl">
            Underground Fuel Tank Monitor
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Industrial tank overview <span className="px-1 text-slate-600">/</span> Station 01
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40"></span>
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Preview only</p>
            <p className="text-[11px] text-slate-400">Hardware telemetry is not connected</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Fuel level</p>
            <span className="text-xs text-emerald-300">+2.4% this week</span>
          </div>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-3xl font-bold tracking-tight text-white">72</span>
            <span className="text-sm text-slate-400">%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Fuel level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={72}
            className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800"
          >
            <div className="h-full w-[72%] rounded-full bg-gradient-to-r from-emerald-500 to-lime-300"></div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Approx. 7,200 L of 10,000 L</p>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Sensor distance</p>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-3xl font-bold tracking-tight text-white">34.8</span>
            <span className="text-sm text-slate-400">cm</span>
          </div>
          <p className="mt-4 flex items-center gap-2 text-[11px] text-slate-500">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            Ultrasonic sensor · steady reading
          </p>
        </article>

        <article className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Fuel condition</p>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/10">
              <CheckCircle className="h-5 w-5 text-emerald-400" />
            </span>
            <div>
              <p className="text-lg font-bold text-emerald-300">OK</p>
              <p className="text-[11px] text-slate-400">Above low-level threshold</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-medium">
            <span className="text-emerald-300">● OK &gt;35%</span>
            <span className="text-amber-300">● Low 20–35%</span>
            <span className="text-red-300">● Critical ≤20%</span>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Last update</p>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/10">
              <Server className="h-5 w-5 text-cyan-300" />
            </span>
            <div>
              <p className="text-lg font-bold text-white">12 sec ago</p>
              <p className="text-[11px] text-slate-400">Cloud sync · connected</p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">Freshness window: 60 seconds</p>
        </article>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.9fr]">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-white">Fuel history</h3>
              <p className="mt-1 text-xs text-slate-400">Sensor distance over the last 24 hours</p>
            </div>
            <span className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
              Last 24 hours
            </span>
          </div>
          <div className="mt-5">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-white">34.8</span>
              <span className="text-xs text-slate-400">cm · current distance</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50 p-2 sm:p-4">
              <svg
                role="img"
                aria-label="Line chart of sensor distance readings decreasing from 40 to 34.8 centimeters over 24 hours"
                viewBox="0 0 640 200"
                className="h-44 w-full"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="fuel-chart-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[30, 70, 110, 150].map(y => (
                  <line key={y} x1="0" x2="640" y1={y} y2={y} stroke="#334155" strokeDasharray="4 6" />
                ))}
                <path
                  d="M0 63 L91 51 L182 67 L273 78 L364 102 L455 94 L546 121 L640 132 L640 175 L0 175 Z"
                  fill="url(#fuel-chart-fill)"
                />
                <path
                  d="M0 63 L91 51 L182 67 L273 78 L364 102 L455 94 L546 121 L640 132"
                  fill="none"
                  stroke="#34d399"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                />
                <circle cx="640" cy="132" r="5" fill="#34d399" stroke="#0f172a" strokeWidth="3" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="flex justify-between px-1 text-[10px] text-slate-500">
                <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>Now</span>
              </div>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div>
            <h3 className="font-semibold text-white">Tank visualization</h3>
            <p className="mt-1 text-xs text-slate-400">Underground storage · 10,000 L capacity</p>
          </div>
          <div className="mt-5 flex min-h-48 items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-[radial-gradient(ellipse_at_center,_rgba(16,185,129,0.08),_transparent_70%)] p-4">
            <svg role="img" aria-label="Underground fuel tank at 72 percent capacity" viewBox="0 0 360 180" className="h-40 w-full max-w-sm">
              <defs>
                <clipPath id="tank-clip">
                  <rect x="40" y="39" width="280" height="102" rx="51" />
                </clipPath>
                <linearGradient id="tank-fuel" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#6ee7b7" />
                  <stop offset="100%" stopColor="#059669" />
                </linearGradient>
              </defs>
              <line x1="22" x2="338" y1="147" y2="147" stroke="#475569" strokeDasharray="5 5" />
              <rect x="40" y="39" width="280" height="102" rx="51" fill="#0f172a" stroke="#64748b" strokeWidth="3" />
              <g clipPath="url(#tank-clip)">
                <rect x="40" y="67" width="280" height="78" fill="url(#tank-fuel)" />
                <path d="M40 68 Q65 62 90 68 T140 68 T190 68 T240 68 T290 68 T340 68" fill="none" stroke="#a7f3d0" strokeOpacity="0.8" strokeWidth="2" />
              </g>
              <rect x="174" y="15" width="12" height="25" rx="4" fill="#64748b" />
              <path d="M180 4 V26" stroke="#22d3ee" strokeDasharray="3 3" strokeWidth="2" />
              <circle cx="180" cy="29" r="4" fill="#22d3ee" />
              <text x="180" y="104" fill="#f8fafc" fontSize="24" fontWeight="700" textAnchor="middle">72%</text>
              <text x="180" y="124" fill="#d1fae5" fontSize="10" textAnchor="middle">7,200 L</text>
              <text x="180" y="169" fill="#94a3b8" fontSize="10" textAnchor="middle">ULTRASONIC LEVEL SENSOR</text>
            </svg>
          </div>
          <div className="mt-4 flex justify-between text-xs">
            <span className="text-slate-400">Capacity used</span>
            <span className="font-semibold text-emerald-300">7,200 / 10,000 L</span>
          </div>
        </article>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <article className="rounded-2xl border border-lime-500/20 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white">LCD replica</h3>
              <p className="mt-1 text-xs text-slate-400">Physical 20 × 4 character display</p>
            </div>
            <Smartphone className="h-4 w-4 text-lime-300" />
          </div>
          <div className="mt-4 rounded-lg border-4 border-slate-700 bg-[#162519] p-3 shadow-inner">
            <div className="grid grid-cols-[1fr_auto] gap-x-2 font-mono text-[11px] leading-6 tracking-wide text-lime-300 sm:text-xs">
              <span>TANK MONITOR</span><span>01</span>
              <span>FUEL LEVEL</span><span>72%</span>
              <span>DISTANCE</span><span>34.8cm</span>
              <span>STATUS</span><span>FUEL OK</span>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-slate-500">Preview of the connected 20 × 4 LCD output</p>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div>
            <h3 className="font-semibold text-white">Alarm panel</h3>
            <p className="mt-1 text-xs text-slate-400">Thresholds and connection warnings</p>
          </div>
          <div className="mt-4 space-y-2.5">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/15 bg-red-500/[0.04] px-3 py-2.5">
              <span className="flex items-center gap-2 text-xs text-slate-300"><AlertTriangle className="h-4 w-4 text-red-400" />Critical fuel · ≤20%</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-300">Clear</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2.5">
              <span className="flex items-center gap-2 text-xs text-slate-300"><AlertTriangle className="h-4 w-4 text-amber-400" />Low fuel · ≤35%</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Armed</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] px-3 py-2.5">
              <span className="flex items-center gap-2 text-xs text-slate-300"><Activity className="h-4 w-4 text-emerald-400" />Connection warning</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Clear</span>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div>
            <h3 className="font-semibold text-white">Device diagnostics</h3>
            <p className="mt-1 text-xs text-slate-400">Sensor and cloud health</p>
          </div>
          <dl className="mt-4 divide-y divide-slate-800">
            <div className="flex items-center justify-between py-2.5 text-xs">
              <dt className="text-slate-400">Ultrasonic sensor</dt><dd className="font-medium text-emerald-300">34.8 cm · stable</dd>
            </div>
            <div className="flex items-center justify-between py-2.5 text-xs">
              <dt className="text-slate-400">Cloud connection</dt><dd className="font-medium text-emerald-300">Connected</dd>
            </div>
            <div className="flex items-center justify-between py-2.5 text-xs">
              <dt className="text-slate-400">Last update</dt><dd className="font-medium text-slate-200">12 sec ago</dd>
            </div>
            <div className="flex items-center justify-between py-2.5 text-xs">
              <dt className="text-slate-400">Controller</dt><dd className="font-medium text-slate-200">ESP32 · healthy</dd>
            </div>
          </dl>
        </article>
      </div>

      <p className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs leading-relaxed text-slate-400">
        <span className="font-semibold text-slate-300">{mode === 'test' ? 'Test preview:' : 'Service portal preview:'}</span> all readings are simulated sample data. Live hardware monitoring and controls require a connected device service.
      </p>
    </section>
  );
}

function WaterTankMonitorDashboard({ mode }: { mode: 'test' | 'service' }) {
  const [waterLevel, setWaterLevel] = useState(68);
  const [controlMode, setControlMode] = useState<'automatic' | 'manual'>('automatic');
  const [manualPumpOn, setManualPumpOn] = useState(false);
  const automaticPumpOn = controlMode === 'automatic' && waterLevel <= 30;
  const pumpOn = controlMode === 'automatic' ? automaticPumpOn : manualPumpOn;
  const tankStatus = waterLevel <= 5 ? 'Empty' : waterLevel >= 95 ? 'Full' : pumpOn ? 'Filling' : waterLevel <= 30 ? 'Low' : 'Normal';
  const statusColor = tankStatus === 'Empty' || tankStatus === 'Low'
    ? 'text-amber-300'
    : tankStatus === 'Full'
      ? 'text-emerald-300'
      : tankStatus === 'Filling'
        ? 'text-cyan-300'
        : 'text-slate-200';
  const alerts = [
    { label: 'Low water level', detail: waterLevel <= 30 ? 'Water is below the 30% threshold.' : 'Level is above the low-water threshold.', active: waterLevel <= 30 },
    { label: 'Full tank', detail: waterLevel >= 95 ? 'Tank capacity limit reached.' : 'Tank has available capacity.', active: waterLevel >= 95 },
    { label: 'Sensor fault', detail: 'Level sensor diagnostics normal.', active: false },
    { label: 'Pump activity', detail: pumpOn ? 'Pump is running.' : 'Pump is currently off.', active: pumpOn },
    { label: 'GSM connection', detail: 'GSM internet link is available (simulated).', active: false }
  ];

  const handleModeChange = (nextMode: 'automatic' | 'manual') => {
    setControlMode(nextMode);
    if (nextMode === 'automatic') {
      setManualPumpOn(false);
    }
  };

  const handlePumpToggle = () => {
    if (controlMode !== 'manual') return;
    const nextPumpOn = !manualPumpOn;
    setManualPumpOn(nextPumpOn);
    if (nextPumpOn) {
      setWaterLevel(level => Math.min(level + 4, 100));
    }
  };

  return (
    <section aria-labelledby="water-monitor-title" className="space-y-5">
      <header className="flex flex-col gap-4 rounded-2xl border border-cyan-500/20 bg-slate-900/80 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">
              {mode === 'test' ? 'Device test preview' : 'Service portal'}
            </span>
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">
              Simulated values
            </span>
          </div>
          <h2 id="water-monitor-title" className="text-xl font-bold text-white sm:text-2xl">Smart Water Tank System</h2>
          <p className="mt-1 text-sm text-slate-400">Remote water-level monitoring and pump control preview</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs font-semibold text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />Device online · demo
          </span>
          <span className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs font-semibold text-cyan-300">
            <Server className="h-3.5 w-3.5" />System healthy · demo
          </span>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Current water level</p>
              <p className="mt-2 text-4xl font-bold tracking-tight text-white">{waterLevel}<span className="ml-1 text-xl text-slate-400">%</span></p>
              <p className="mt-1 text-sm text-slate-400">{Math.round(waterLevel * 50)} L of 5,000 L</p>
            </div>
            <span className={`rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm font-bold ${statusColor}`}>
              {tankStatus}
            </span>
          </div>
          <div className="mt-5 grid items-center gap-5 sm:grid-cols-[minmax(140px,0.65fr)_1fr]">
            <div className="mx-auto w-full max-w-[200px]">
              <svg role="img" aria-label={`Water tank ${waterLevel} percent full`} viewBox="0 0 180 240" className="h-56 w-full">
                <defs>
                  <linearGradient id="water-tank-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" />
                    <stop offset="100%" stopColor="#2563eb" />
                  </linearGradient>
                  <clipPath id="water-tank-clip">
                    <rect x="30" y="28" width="120" height="184" rx="22" />
                  </clipPath>
                </defs>
                <rect x="30" y="28" width="120" height="184" rx="22" fill="#0f172a" stroke="#475569" strokeWidth="4" />
                <g clipPath="url(#water-tank-clip)">
                  <rect x="30" y={212 - waterLevel * 1.84} width="120" height={waterLevel * 1.84} fill="url(#water-tank-fill)" />
                  <path d={`M30 ${212 - waterLevel * 1.84} Q60 ${202 - waterLevel * 1.84} 90 ${212 - waterLevel * 1.84} T150 ${212 - waterLevel * 1.84}`} fill="none" stroke="#a5f3fc" strokeWidth="3" opacity="0.8" />
                </g>
                {[0, 25, 50, 75, 100].map(mark => (
                  <g key={mark}>
                    <line x1="151" x2="161" y1={212 - mark * 1.84} y2={212 - mark * 1.84} stroke="#94a3b8" strokeWidth="2" />
                    <text x="166" y={216 - mark * 1.84} fill="#94a3b8" fontSize="10">{mark}</text>
                  </g>
                ))}
                <text x="90" y="128" textAnchor="middle" fill="white" fontSize="24" fontWeight="700">{waterLevel}%</text>
              </svg>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Measured water level</p>
                <p className="mt-2 text-lg font-semibold text-white">{Math.round(waterLevel * 1.8)} cm <span className="text-xs font-normal text-slate-400">of 180 cm</span></p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Tank status</p>
                <p className={`mt-2 text-lg font-semibold ${statusColor}`}>{tankStatus}</p>
              </div>
              <div
                role="progressbar"
                aria-label="Water tank level"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={waterLevel}
                className="h-2 overflow-hidden rounded-full bg-slate-800"
              >
                <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-300 transition-all" style={{ width: `${waterLevel}%` }} />
              </div>
              {mode === 'test' && (
                <label className="mt-5 block">
                  <span className="flex items-center justify-between gap-3 text-xs text-slate-400">
                    <span>Simulate sensor level</span>
                    <span className="font-mono text-cyan-300">{waterLevel}%</span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={waterLevel}
                    aria-label="Simulate sensor water level"
                    onChange={event => setWaterLevel(Number(event.target.value))}
                    className="mt-2 w-full accent-cyan-400"
                  />
                  <span className="mt-1 block text-[11px] text-slate-500">Preview Empty, Low, Filling, and Full thresholds with sample values.</span>
                </label>
              )}
            </div>
          </div>
        </article>

        <article className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div>
            <h3 className="font-semibold text-white">Pump controls</h3>
            <p className="mt-1 text-xs text-slate-400">Controls update this preview only.</p>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">Operating mode</p>
            <div role="group" aria-label="Pump operating mode" className="grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-950 p-1">
              {(['automatic', 'manual'] as const).map(modeOption => (
                <button
                  key={modeOption}
                  type="button"
                  aria-pressed={controlMode === modeOption}
                  onClick={() => handleModeChange(modeOption)}
                  className={`rounded-lg px-3 py-2.5 text-sm font-semibold capitalize transition-colors ${controlMode === modeOption ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}
                >
                  {modeOption}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Pump status</p>
              <p className={`mt-1 font-bold ${pumpOn ? 'text-emerald-300' : 'text-slate-300'}`}>{pumpOn ? 'ON · Filling' : 'OFF'}</p>
            </div>
            <button
              type="button"
              aria-pressed={pumpOn}
              disabled={controlMode === 'automatic'}
              onClick={handlePumpToggle}
              className={`rounded-lg px-4 py-2.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 ${pumpOn ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'}`}
            >
              {pumpOn ? 'Turn pump off' : 'Turn pump on'}
            </button>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            {controlMode === 'automatic' ? 'Automatic mode manages the pump at the configured level thresholds. Switch to Manual to test the pump control.' : 'Manual mode lets you simulate switching the pump. Turning it on adds a sample level increase.'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
              <p className="text-xs text-slate-400">GSM internet</p>
              <p className="mt-1 text-sm font-semibold text-cyan-300">Connected · demo</p>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <p className="text-xs text-slate-400">System health</p>
              <p className="mt-1 text-sm font-semibold text-emerald-300">Healthy · demo</p>
            </div>
          </div>
        </article>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-white">Water-level history</h3>
              <p className="mt-1 text-xs text-slate-400">Sample readings over the last 12 hours</p>
            </div>
            <span className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">12 hours</span>
          </div>
          <svg role="img" aria-label="Sample water level history chart" viewBox="0 0 600 190" className="mt-5 h-44 w-full" preserveAspectRatio="none">
            {[30, 70, 110, 150].map(y => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="#334155" strokeDasharray="4 6" />)}
            <path d="M0 120 L75 112 L150 116 L225 92 L300 98 L375 77 L450 81 L525 58 L600 65 L600 170 L0 170 Z" fill="#06b6d4" fillOpacity="0.13" />
            <path d="M0 120 L75 112 L150 116 L225 92 L300 98 L375 77 L450 81 L525 58 L600 65" fill="none" stroke="#22d3ee" strokeWidth="3" />
            <text x="4" y="185" fill="#94a3b8" fontSize="11">12h ago</text>
            <text x="275" y="185" fill="#94a3b8" fontSize="11">6h ago</text>
            <text x="565" y="185" fill="#94a3b8" fontSize="11">Now</text>
          </svg>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white">Alerts & system events</h3>
              <p className="mt-1 text-xs text-slate-400">Current conditions and recent event categories</p>
            </div>
            <AlertTriangle className="h-5 w-5 text-amber-300" />
          </div>
          <ul className="space-y-2">
            {alerts.map(alert => (
              <li key={alert.label} className={`flex items-start gap-3 rounded-xl border p-3 ${alert.active ? 'border-amber-500/25 bg-amber-500/5' : 'border-slate-800 bg-slate-950/60'}`}>
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${alert.active ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-200">{alert.label}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{alert.detail}</p>
                </div>
                <span className={`text-[10px] font-bold uppercase ${alert.active ? 'text-amber-300' : 'text-emerald-300'}`}>{alert.active ? 'Active' : 'Clear'}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <p role="status" className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-amber-200">
        {mode === 'test' ? 'Test preview:' : 'Service portal preview:'} all readings, alerts, connection states, and pump actions are simulated. They do not represent or control a physical tank; live monitoring requires a connected hardware service.
      </p>
    </section>
  );
}

type BreathalyzerAlert = {
  id: string;
  title: string;
  detail: string;
  severity: 'info' | 'warning' | 'critical';
};

function AlcoholBreathalyzerDashboard({ mode }: { mode: 'test' | 'service' }) {
  const [bac, setBac] = useState(0);
  const [history, setHistory] = useState([0.01, 0, 0.02, 0.01, 0, 0]);
  const [networkAvailable, setNetworkAvailable] = useState(true);
  const [alerts, setAlerts] = useState<BreathalyzerAlert[]>([
    { id: 'initial-clear', title: 'System ready', detail: 'Alcohol level clear · sample feed', severity: 'info' },
    { id: 'initial-network', title: 'Device online', detail: 'Wi-Fi and MQTT connected · demo', severity: 'info' }
  ]);
  const risk = bac >= 0.08 ? 'high' : bac > 0 ? 'caution' : 'safe';
  const status = risk === 'high' ? 'High alcohol detected' : risk === 'caution' ? 'Caution · alcohol detected' : 'Clear · no alcohol detected';
  const statusColor = risk === 'high' ? '#f87171' : risk === 'caution' ? '#fbbf24' : '#34d399';
  const bacPercent = Math.min(100, (bac / 0.2) * 100);

  const recordAlert = (title: string, detail: string, severity: BreathalyzerAlert['severity'] = 'info') => {
    setAlerts(current => [{ id: `${Date.now()}-${Math.random()}`, title, detail, severity }, ...current].slice(0, 6));
  };

  const updateReading = (value: number) => {
    setBac(value);
    setHistory(current => [...current.slice(-9), value]);
    const nextRisk = value >= 0.08 ? 'high' : value > 0 ? 'caution' : 'safe';
    const nextStatus = nextRisk === 'high'
      ? 'High alcohol detected'
      : nextRisk === 'caution'
        ? 'Caution · alcohol detected'
        : 'Clear · no alcohol detected';
    recordAlert(
      nextRisk === 'high' ? 'High alcohol warning' : nextRisk === 'caution' ? 'Alcohol level warning' : 'Reading clear',
      `${value.toFixed(2)}% BAC · ${nextStatus}.`,
      nextRisk === 'high' ? 'critical' : nextRisk === 'caution' ? 'warning' : 'info'
    );
  };

  const toggleConnectivity = () => {
    const next = !networkAvailable;
    setNetworkAvailable(next);
    recordAlert(
      next ? 'Connectivity restored' : 'Connectivity lost',
      next ? 'Wi-Fi and MQTT demo connections restored.' : 'Wi-Fi and MQTT demo connections unavailable.',
      next ? 'info' : 'warning'
    );
  };

  const chartPoints = history
    .map((value, index) => `${20 + index * (600 / Math.max(1, history.length - 1))},${155 - (value / 0.2) * 125}`)
    .join(' ');

  return (
    <section aria-labelledby="breathalyzer-title" className="space-y-5">
      <style>{`
        @keyframes gkb-breathalyzer-blink {
          0%, 46%, 52%, 100% { transform: scaleY(1); }
          49% { transform: scaleY(0.12); }
        }
        .breathalyzer-blink {
          transform-box: fill-box;
          transform-origin: center;
          animation: gkb-breathalyzer-blink 3.8s infinite;
        }
      `}</style>
      <header className="flex flex-col gap-4 rounded-2xl border border-cyan-500/20 bg-slate-900/80 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">
              {mode === 'test' ? 'Private device test preview' : 'Service portal'}
            </span>
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">
              Simulated telemetry
            </span>
          </div>
          <h2 id="breathalyzer-title" className="text-xl font-bold text-white sm:text-2xl">Smart Alcohol Breathalyzer System</h2>
          <p className="mt-1 text-sm text-slate-400">MQ-3 alcohol level monitoring · OLED-style status · MQTT connectivity</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs font-semibold text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />Device online · demo
          </span>
          <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${networkAvailable ? 'border-cyan-500/20 bg-cyan-500/5 text-cyan-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-200'}`}>
            <Wifi className="h-3.5 w-3.5" />Wi-Fi · {networkAvailable ? 'connected' : 'offline'} · demo
          </span>
          <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${networkAvailable ? 'border-violet-500/20 bg-violet-500/5 text-violet-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-200'}`}>
            <Radio className="h-3.5 w-3.5" />MQTT · {networkAvailable ? 'connected' : 'disconnected'} · demo
          </span>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <section aria-label="Breathalyzer status" className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">OLED status avatar</p>
          <div
            role="img"
            aria-label={risk === 'safe' ? 'Happy face, safe status' : risk === 'caution' ? 'Concerned face, caution status' : 'Alert face, high alcohol status'}
            className={`mt-4 flex h-36 w-36 items-center justify-center rounded-full border-4 shadow-lg transition-all duration-500 ${risk === 'safe' ? 'animate-pulse border-emerald-400/50 bg-emerald-400/10 shadow-emerald-500/10' : risk === 'caution' ? 'animate-pulse border-amber-400/60 bg-amber-400/10 shadow-amber-500/10' : 'animate-pulse border-red-400/70 bg-red-400/10 shadow-red-500/20'}`}
          >
            <svg aria-hidden="true" viewBox="0 0 100 100" className="h-24 w-24">
              <circle cx="50" cy="50" r="44" fill={risk === 'high' ? '#7f1d1d' : risk === 'caution' ? '#78350f' : '#064e3b'} />
              <g className="breathalyzer-blink" fill="#f8fafc">
                <ellipse cx="36" cy="41" rx="4.5" ry="6" />
                <ellipse cx="64" cy="41" rx="4.5" ry="6" />
              </g>
              <path
                d={risk === 'safe' ? 'M30 59 Q50 82 70 59' : risk === 'caution' ? 'M33 67 Q50 58 67 67' : 'M30 71 Q50 47 70 71'}
                fill="none"
                stroke="#f8fafc"
                strokeLinecap="round"
                strokeWidth="5"
              />
            </svg>
          </div>
          <p className={`mt-4 text-lg font-bold ${risk === 'high' ? 'text-red-300' : risk === 'caution' ? 'text-amber-300' : 'text-emerald-300'}`}>{status}</p>
          <p className="mt-1 text-xs text-slate-400">Animated status mirrors the simulated OLED indicator.</p>
        </section>

        <section aria-label="Blood alcohol concentration" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-around">
            <div
              role="progressbar"
              aria-label="Blood alcohol concentration"
              aria-valuemin={0}
              aria-valuemax={0.2}
              aria-valuenow={bac}
              className="flex h-44 w-44 shrink-0 items-center justify-center rounded-full transition-all duration-500"
              style={{ background: `conic-gradient(${statusColor} ${bacPercent}%, #1e293b ${bacPercent}% 100%)` }}
            >
              <div className="flex h-36 w-36 flex-col items-center justify-center rounded-full bg-slate-950">
                <span className="text-3xl font-black text-white">{bac.toFixed(2)}%</span>
                <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">BAC · demo</span>
              </div>
            </div>
            <div className="w-full max-w-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Alcohol Level feed</p>
                  <p className={`mt-2 text-xl font-bold ${risk === 'high' ? 'text-red-300' : risk === 'caution' ? 'text-amber-300' : 'text-emerald-300'}`}>{status}</p>
                </div>
                <Activity className={`h-6 w-6 ${risk === 'high' ? 'text-red-300' : risk === 'caution' ? 'text-amber-300' : 'text-emerald-300'}`} />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-400">Demo bands only: clear at 0.00%, caution above 0.00%, and high at 0.08% BAC. These are not legal or medical thresholds.</p>
            </div>
          </div>
          <label className="mt-6 block">
            <span className="flex justify-between text-xs font-medium text-slate-300">
              <span>Simulate Alcohol Level feed</span>
              <span>{bac.toFixed(2)}% BAC</span>
            </span>
            <input
              aria-label="Simulate alcohol level"
              className="mt-3 w-full accent-cyan-400"
              type="range"
              min="0"
              max="0.2"
              step="0.01"
              value={bac}
              onChange={event => updateReading(Number(event.target.value))}
            />
            <span className="mt-1 flex justify-between text-[10px] text-slate-500"><span>0.00%</span><span>0.20% BAC · simulated</span></span>
          </label>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-label="Alcohol level history" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-white">Alcohol level history</h3>
              <p className="mt-1 text-xs text-slate-400">mq3-alcohol-level · recent sample readings</p>
            </div>
            <span className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-[11px] text-slate-300">BAC (%) · demo</span>
          </div>
          <svg role="img" aria-label="Simulated alcohol level history chart" viewBox="0 0 640 180" className="mt-4 h-44 w-full overflow-visible">
            <title>Simulated BAC history</title>
            {[30, 70, 110, 150].map(y => <line key={y} x1="20" y1={y} x2="620" y2={y} stroke="#334155" strokeDasharray="4 6" />)}
            <polyline points={chartPoints} fill="none" stroke={statusColor} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            {history.map((value, index) => {
              const x = 20 + index * (600 / Math.max(1, history.length - 1));
              const y = 155 - (value / 0.2) * 125;
              return <circle key={`${index}-${value}`} cx={x} cy={y} r="5" fill={statusColor} />;
            })}
          </svg>
          <div className="flex justify-between text-[10px] text-slate-500"><span>Earlier samples</span><span>Latest · {bac.toFixed(2)}%</span></div>
        </section>

        <section aria-label="Breathalyzer alerts" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-white">Alerts & notifications</h3>
              <p className="mt-1 text-xs text-slate-400">mq3-alert-trigger · recent demo events</p>
            </div>
            <AlertTriangle className={risk === 'high' ? 'h-5 w-5 text-red-300' : risk === 'caution' ? 'h-5 w-5 text-amber-300' : 'h-5 w-5 text-emerald-300'} />
          </div>
          <ul className="mt-4 space-y-2">
            {alerts.map(alert => (
              <li key={alert.id} className={`flex items-start gap-3 rounded-xl border p-3 ${alert.severity === 'critical' ? 'border-red-500/30 bg-red-500/5' : alert.severity === 'warning' ? 'border-amber-500/20 bg-amber-500/5' : 'border-slate-800 bg-slate-950/50'}`}>
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${alert.severity === 'critical' ? 'bg-red-400' : alert.severity === 'warning' ? 'bg-amber-400' : 'bg-cyan-400'}`} />
                <div>
                  <p className="text-sm font-semibold text-slate-200">{alert.title}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{alert.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          {mode === 'test' && (
            <button type="button" onClick={toggleConnectivity} className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/10">
              {networkAvailable ? 'Simulate connectivity problem' : 'Restore demo connectivity'}
            </button>
          )}
        </section>
      </div>

      <p role="status" className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-amber-200">
        {mode === 'test' ? 'Test dashboard:' : 'Service portal preview:'} BAC values, MQ-3 feed, alert trigger, chart, avatar, and Wi-Fi/MQTT status are simulated. This is not a medical device, does not determine fitness to drive, and is not connected to a physical sensor or MQTT broker. Do not use it to make safety decisions.
      </p>
    </section>
  );
}

type DeviceControlActivity = {
  id: string;
  event: string;
  timestamp: string;
};

function FanRegulatorDashboard({ mode, device }: { mode: 'test' | 'service'; device: Device }) {
  const [fanSpeed, setFanSpeed] = useState(0);
  const [fanName, setFanName] = useState(() => {
    try {
      return window.localStorage.getItem(`gkb-fan-name:${device.key}`)?.trim() || 'Fan';
    } catch (error) {
      console.error('Unable to load the saved fan name.', error);
      return 'Fan';
    }
  });
  const [fanNameDraft, setFanNameDraft] = useState(fanName);
  const [isEditingFanName, setIsEditingFanName] = useState(false);
  const [fanNameSaveError, setFanNameSaveError] = useState('');
  const [connectionAvailable, setConnectionAvailable] = useState(true);
  const [activity, setActivity] = useState<DeviceControlActivity[]>([
    { id: 'initial-state', event: 'Fan regulator ready · fan off · all speed relays open', timestamp: 'Just now' }
  ]);
  const speedLabel = fanSpeed === 0 ? 'Off' : `Speed ${fanSpeed}`;
  const speedDescription = ['Off', 'Low', 'Medium-low', 'Medium-high', 'High'][fanSpeed];

  const recordActivity = (event: string) => {
    setActivity(current => [
      { id: `${Date.now()}-${Math.random()}`, event, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) },
      ...current
    ].slice(0, 8));
  };

  const changeFanSpeed = (speed: number) => {
    setFanSpeed(speed);
    recordActivity(`Fan set to ${speed === 0 ? 'OFF' : `Speed ${speed}`} · fan-speed=${speed} · relay ${speed === 0 ? 'all OFF' : `${speed} ON, others OFF`}`);
  };

  const saveFanName = () => {
    const nextName = fanNameDraft.trim() || 'Fan';
    try {
      window.localStorage.setItem(`gkb-fan-name:${device.key}`, nextName);
      setFanName(nextName);
      setFanNameDraft(nextName);
      setFanNameSaveError('');
      setIsEditingFanName(false);
      recordActivity(`Fan name set to "${nextName}"`);
    } catch (error) {
      console.error('Unable to save the fan name.', error);
      setFanNameSaveError('Could not save the fan name in this browser. Please try again.');
    }
  };

  const cancelFanNameEdit = () => {
    setFanNameDraft(fanName);
    setFanNameSaveError('');
    setIsEditingFanName(false);
  };

  const toggleConnection = () => {
    const next = !connectionAvailable;
    setConnectionAvailable(next);
    recordActivity(`ESP32 demo connection ${next ? 'restored' : 'lost'} · Adafruit IO ${next ? 'connected' : 'disconnected'}`);
  };

  return (
    <section aria-labelledby="fan-regulator-title" className="space-y-5">
      <style>{`
        @keyframes gkb-fan-rotate {
          to { transform: rotate(360deg); }
        }
        .smart-fan-rotor {
          animation-name: gkb-fan-rotate;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
      `}</style>
      <header className="flex flex-col gap-4 rounded-2xl border border-cyan-500/20 bg-slate-900/80 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">
              {mode === 'test' ? 'Private device test preview' : 'Service portal'}
            </span>
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">
              Simulated controls
            </span>
          </div>
          <h2 id="fan-regulator-title" className="text-xl font-bold text-white sm:text-2xl">Smart Fan Regulator</h2>
          <p className="mt-1 text-sm text-slate-400">ESP32 speed control · one relay assigned to each fan speed</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs font-semibold text-emerald-300">
            <span className={`h-2 w-2 rounded-full ${connectionAvailable ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            Device {connectionAvailable ? 'online' : 'offline'} · demo
          </span>
          <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${connectionAvailable ? 'border-cyan-500/20 bg-cyan-500/5 text-cyan-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-200'}`}>
            <Wifi className="h-3.5 w-3.5" />Adafruit IO · {connectionAvailable ? 'connected' : 'offline'} · demo
          </span>
          <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${connectionAvailable ? 'border-violet-500/20 bg-violet-500/5 text-violet-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-200'}`}>
            <Server className="h-3.5 w-3.5" />Supabase · {connectionAvailable ? 'syncing' : 'disconnected'} · demo
          </span>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-label="Fan speed control" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div className="flex flex-col items-center gap-5 sm:flex-row">
            <div className={`flex h-32 w-32 shrink-0 items-center justify-center rounded-full border ${fanSpeed ? 'border-cyan-400/30 bg-cyan-400/5 text-cyan-300 shadow-[0_0_25px_rgba(34,211,238,0.12)]' : 'border-slate-700 bg-slate-950/70 text-slate-500'}`}>
              <svg
                aria-label={fanSpeed ? `Fan animation at speed ${fanSpeed}` : 'Fan stopped'}
                role="img"
                viewBox="0 0 100 100"
                className="h-24 w-24"
              >
                <g
                  className="smart-fan-rotor"
                  style={{
                    transformOrigin: '50px 50px',
                    animationDuration: fanSpeed ? `${2.4 / fanSpeed}s` : undefined,
                    animationPlayState: fanSpeed ? 'running' : 'paused'
                  }}
                >
                  {[0, 90, 180, 270].map(rotation => (
                    <path
                      key={rotation}
                      d="M50 48 C38 42 35 24 44 18 C57 10 63 35 53 48 Z"
                      fill="currentColor"
                      opacity={fanSpeed ? 0.9 : 0.45}
                      transform={`rotate(${rotation} 50 50)`}
                    />
                  ))}
                </g>
                <circle cx="50" cy="50" r="7" fill="currentColor" />
                <circle cx="50" cy="50" r="2.5" fill="#0f172a" />
              </svg>
            </div>
            <div className="text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                {isEditingFanName ? (
                  <>
                    <input
                      aria-label="Fan name"
                      className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                      maxLength={40}
                      value={fanNameDraft}
                      onChange={event => setFanNameDraft(event.target.value)}
                    />
                    <button type="button" onClick={saveFanName} className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25">
                      <Save className="h-3.5 w-3.5" />Save
                    </button>
                    <button type="button" onClick={cancelFanNameEdit} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white">
                      <X className="h-3.5 w-3.5" />Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{fanName}</p>
                    <button
                      type="button"
                      onClick={() => { setFanNameDraft(fanName); setIsEditingFanName(true); setFanNameSaveError(''); }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200"
                    >
                      <Pencil className="h-3 w-3" />Edit
                    </button>
                  </>
                )}
              </div>
              {fanNameSaveError && <p role="alert" className="mt-2 text-xs text-red-300">{fanNameSaveError}</p>}
              <p className="mt-3 text-xs font-medium uppercase tracking-wider text-slate-400">Current fan speed</p>
              <p className={`mt-1 text-2xl font-bold ${fanSpeed ? 'text-cyan-300' : 'text-slate-300'}`}>{speedLabel}</p>
              <p className="mt-1 text-sm text-slate-400">{speedDescription} · fan-speed feed: {fanSpeed}</p>
              <p className="mt-2 text-xs text-slate-500">{fanSpeed ? 'Fan animation speed follows the selected level.' : 'Fan is stopped.'}</p>
            </div>
          </div>
          <div className="mt-6">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-400">Fan speed control</p>
            <div role="group" aria-label="Set fan speed" className="grid grid-cols-5 gap-2">
              {['Off', 'Speed 1', 'Speed 2', 'Speed 3', 'Speed 4'].map((label, speed) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={fanSpeed === speed}
                  onClick={() => changeFanSpeed(speed)}
                  className={`rounded-lg border px-2 py-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 sm:px-3 ${fanSpeed === speed ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-200' : 'border-slate-700 bg-slate-950/60 text-slate-400 hover:border-slate-500 hover:text-white'}`}
                >
                  <span className="block">{label}</span>
                  <span className="mt-1 block text-[10px] opacity-70">{speed}</span>
                </button>
              ))}
            </div>
            <label className="mt-5 block">
              <span className="flex justify-between text-xs font-medium text-slate-300">
                <span>fan-speed feed</span>
                <span>{fanSpeed} / 4</span>
              </span>
              <input
                aria-label="Fan speed feed"
                className="mt-3 w-full accent-cyan-400"
                type="range"
                min="0"
                max="4"
                step="1"
                value={fanSpeed}
                onChange={event => changeFanSpeed(Number(event.target.value))}
              />
            </label>
          </div>
        </section>

        <section aria-label="Fan speed relay mapping" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <h3 className="font-semibold text-white">Speed relay mapping</h3>
          <p className="mt-1 text-xs text-slate-400">One relay per speed; only the selected speed relay is energized.</p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[1, 2, 3, 4].map(speed => (
              <article key={speed} className={`rounded-xl border p-3 ${fanSpeed === speed ? 'border-cyan-400/30 bg-cyan-400/[0.06]' : 'border-slate-800 bg-slate-950/60'}`}>
                <p className="text-xs text-slate-400">Relay {speed} · Speed {speed}</p>
                <p className={`mt-1 text-sm font-semibold ${fanSpeed === speed ? 'text-cyan-300' : 'text-slate-500'}`}>
                  {fanSpeed === speed ? 'ON · selected' : 'OFF'}
                </p>
              </article>
            ))}
            <article className={`rounded-xl border p-3 ${fanSpeed === 0 ? 'border-slate-600 bg-slate-800/50' : 'border-slate-800 bg-slate-950/60'}`}>
              <p className="text-xs text-slate-400">All relays</p>
              <p className={`mt-1 text-sm font-semibold ${fanSpeed === 0 ? 'text-slate-200' : 'text-slate-500'}`}>
                {fanSpeed === 0 ? 'OFF · fan stopped' : 'OFF · fan running'}
              </p>
            </article>
          </div>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-label="Fan activity history" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-white">Activity & command history</h3>
              <p className="mt-1 text-xs text-slate-400">Recent fan-speed and connectivity changes</p>
            </div>
            <Activity className="h-5 w-5 text-cyan-300" />
          </div>
          <ul className="mt-4 space-y-2">
            {activity.map(item => (
              <li key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <p className="text-sm text-slate-200">{item.event}</p>
                <time className="shrink-0 text-[10px] text-slate-500">{item.timestamp}</time>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Fan regulator connection health" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div>
            <h3 className="font-semibold text-white">Connection & system health</h3>
            <p className="mt-1 text-xs text-slate-400">ESP32 communication and Adafruit IO · demo status</p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              { label: 'ESP32 device', value: connectionAvailable ? 'Online' : 'Offline' },
              { label: 'Adafruit IO', value: connectionAvailable ? 'Connected' : 'Disconnected' },
              { label: 'Supabase sync', value: connectionAvailable ? 'Syncing' : 'Disconnected' }
            ].map(item => (
              <article key={item.label} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-xs text-slate-400">{item.label}</p>
                <p className={`mt-1 text-sm font-semibold ${connectionAvailable ? 'text-emerald-300' : 'text-amber-300'}`}>{item.value}</p>
              </article>
            ))}
          </div>
          {mode === 'test' && (
            <button
              type="button"
              onClick={toggleConnection}
              className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/10"
            >
              {connectionAvailable ? 'Simulate connection loss' : 'Restore demo connection'}
            </button>
          )}
        </section>
      </div>

      <p role="status" className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-amber-200">
        {mode === 'test' ? 'Test dashboard:' : 'Service portal preview:'} Fan speed, relay states, activity history, ESP32 connection, and Adafruit IO status are simulated. The dashboard does not connect to cloud services or control physical appliances.
      </p>
    </section>
  );
}

type ControlledLight = {
  channel: number;
  name: string;
  isOn: boolean;
};

function LightControlDashboard({ mode, device }: { mode: 'test' | 'service'; device: Device }) {
  const relayChannels = device.relayChannels ?? 4;
  const [lights, setLights] = useState<ControlledLight[]>(() => {
    const defaults = Array.from({ length: relayChannels }, (_, index) => ({
      channel: index + 1,
      name: `Light ${index + 1}`,
      isOn: false
    }));
    try {
      const keys = [device.key, ...(device.legacyKeys ?? [])];
      const storedNames = keys
        .map(key => window.localStorage.getItem(`gkb-light-names:${key}`))
        .find(value => value !== null);
      const names = storedNames ? JSON.parse(storedNames) as string[] : [];
      return defaults.map(light => {
        const savedName = names[light.channel - 1];
        return { ...light, name: typeof savedName === 'string' ? savedName.trim() || light.name : light.name };
      });
    } catch (error) {
      console.error('Unable to load saved light names.', error);
      return defaults;
    }
  });
  const [editingChannel, setEditingChannel] = useState<number | null>(null);
  const [lightNameDraft, setLightNameDraft] = useState('');
  const [lightNameSaveError, setLightNameSaveError] = useState('');
  const [connectionAvailable, setConnectionAvailable] = useState(true);
  const [activity, setActivity] = useState<DeviceControlActivity[]>([
    { id: 'initial-light-state', event: `Light controller ready · ${relayChannels}-channel · all lights off`, timestamp: 'Just now' }
  ]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        `gkb-light-names:${device.key}`,
        JSON.stringify(lights.map(light => light.name))
      );
    } catch (error) {
      console.error('Unable to save light names.', error);
    }
  }, [device.key, lights]);

  const recordActivity = (event: string) => {
    setActivity(current => [
      { id: `${Date.now()}-${Math.random()}`, event, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) },
      ...current
    ].slice(0, 8));
  };

  const saveLightName = (channel: number) => {
    const nextName = lightNameDraft.trim() || `Light ${channel}`;
    const nextLights = lights.map(light => light.channel === channel ? { ...light, name: nextName } : light);
    try {
      window.localStorage.setItem(
        `gkb-light-names:${device.key}`,
        JSON.stringify(nextLights.map(light => light.name))
      );
      setLights(nextLights);
      setEditingChannel(null);
      setLightNameSaveError('');
      recordActivity(`Relay ${channel} light name set to "${nextName}"`);
    } catch (error) {
      console.error(`Unable to save the name for relay ${channel}.`, error);
      setLightNameSaveError(`Could not save the name for Relay ${channel}. Please try again.`);
    }
  };

  const cancelLightNameEdit = () => {
    setEditingChannel(null);
    setLightNameDraft('');
    setLightNameSaveError('');
  };

  const toggleRelay = (channel: number) => {
    const light = lights.find(item => item.channel === channel);
    const nextState = !light?.isOn;
    setLights(current => current.map(item => item.channel === channel ? { ...item, isOn: nextState } : item));
    recordActivity(`${light?.name.trim() || `Light ${channel}`} switched ${nextState ? 'ON' : 'OFF'} · relay${channel}=${nextState ? 1 : 0}`);
  };

  const toggleConnection = () => {
    const next = !connectionAvailable;
    setConnectionAvailable(next);
    recordActivity(`ESP32 demo connection ${next ? 'restored' : 'lost'} · Adafruit IO and Supabase ${next ? 'syncing' : 'disconnected'}`);
  };

  return (
    <section aria-labelledby="light-control-title" className="space-y-5">
      <header className="flex flex-col gap-4 rounded-2xl border border-amber-500/20 bg-slate-900/80 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">
              {mode === 'test' ? 'Private device test preview' : 'Service portal'}
            </span>
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">
              Simulated controls
            </span>
          </div>
          <h2 id="light-control-title" className="text-xl font-bold text-white sm:text-2xl">{device.name}</h2>
          <p className="mt-1 text-sm text-slate-400">{relayChannels}-channel relay controller · one independent light output per relay</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${connectionAvailable ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-200'}`}>
            <span className={`h-2 w-2 rounded-full ${connectionAvailable ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            ESP32 · {connectionAvailable ? 'online' : 'offline'} · demo
          </span>
          <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${connectionAvailable ? 'border-cyan-500/20 bg-cyan-500/5 text-cyan-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-200'}`}>
            <Wifi className="h-3.5 w-3.5" />Adafruit IO · {connectionAvailable ? 'connected' : 'offline'} · demo
          </span>
          <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${connectionAvailable ? 'border-violet-500/20 bg-violet-500/5 text-violet-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-200'}`}>
            <Server className="h-3.5 w-3.5" />Supabase · {connectionAvailable ? 'syncing' : 'disconnected'} · demo
          </span>
        </div>
      </header>

      <section aria-label="Light and relay configuration" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">Light names & relay outputs</h3>
            <p className="mt-1 text-xs text-slate-400">This device key sets the fixed {relayChannels}-relay channel count. Rename each light for easy identification.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {lights.map(light => {
            const lightOn = light.isOn;
            return (
              <article key={light.channel} aria-label={`Relay ${light.channel} light controls`} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className={`flex h-16 w-16 items-center justify-center rounded-full transition-all duration-500 ${lightOn ? 'animate-pulse bg-amber-300/15 text-amber-300 shadow-[0_0_28px_rgba(252,211,77,0.3)]' : 'bg-slate-950/70 text-slate-600'}`}>
                      <Lightbulb aria-hidden="true" className={`h-10 w-10 transition-all duration-500 ${lightOn ? 'fill-amber-200/40 drop-shadow-[0_0_10px_rgba(252,211,77,0.8)]' : ''}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Relay {light.channel}</p>
                      {editingChannel === light.channel ? (
                        <input
                          aria-label={`Name for Relay ${light.channel}`}
                          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                          maxLength={40}
                          value={lightNameDraft}
                          onChange={event => setLightNameDraft(event.target.value)}
                        />
                      ) : (
                        <p className="mt-1 truncate font-semibold text-white">{light.name}</p>
                      )}
                      <p className={`mt-1 text-xs font-bold ${lightOn ? 'text-amber-300' : 'text-slate-400'}`}>{lightOn ? 'ON' : 'OFF'}</p>
                    </div>
                  </div>
                  {editingChannel === light.channel ? (
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => saveLightName(light.channel)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25">
                        <Save className="h-3.5 w-3.5" />Save
                      </button>
                      <button type="button" onClick={cancelLightNameEdit} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white">
                        <X className="h-3.5 w-3.5" />Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setEditingChannel(light.channel); setLightNameDraft(light.name); setLightNameSaveError(''); }}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200"
                    >
                      <Pencil className="h-3.5 w-3.5" />Edit
                    </button>
                  )}
                </div>

                {lightNameSaveError && editingChannel === light.channel && <p role="alert" className="mt-3 text-xs text-red-300">{lightNameSaveError}</p>}

                <div className={`mt-4 flex items-center justify-between gap-3 rounded-xl border p-3 ${lightOn ? 'border-amber-400/25 bg-amber-400/[0.04]' : 'border-slate-800 bg-slate-950/60'}`}>
                  <div>
                    <p className="text-sm font-semibold text-white">Relay {light.channel} output</p>
                    <p className={`mt-1 text-xs ${lightOn ? 'text-amber-300' : 'text-slate-500'}`}>{lightOn ? 'ON · light output active' : 'OFF'}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-label={`${light.name.trim() || `Light ${light.channel}`} relay`}
                    aria-checked={lightOn}
                    onClick={() => toggleRelay(light.channel)}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${lightOn ? 'bg-amber-400' : 'bg-slate-700'}`}
                  >
                    <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${lightOn ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <p className="mt-3 text-xs text-slate-500">light feed: {lightOn ? 1 : 0} · relay{light.channel}={lightOn ? 1 : 0}</p>
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-label="Light control activity history" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-white">Activity & command history</h3>
              <p className="mt-1 text-xs text-slate-400">Recent light, relay, and connectivity changes</p>
            </div>
            <Activity className="h-5 w-5 text-cyan-300" />
          </div>
          <ul className="mt-4 space-y-2">
            {activity.map(item => (
              <li key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <p className="text-sm text-slate-200">{item.event}</p>
                <time className="shrink-0 text-[10px] text-slate-500">{item.timestamp}</time>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Light controller connection health" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <h3 className="font-semibold text-white">Connection & system health</h3>
          <p className="mt-1 text-xs text-slate-400">ESP32 communication and cloud sync · demo status</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              { label: 'ESP32 device', value: connectionAvailable ? 'Online' : 'Offline' },
              { label: 'Adafruit IO', value: connectionAvailable ? 'Connected' : 'Disconnected' },
              { label: 'Supabase sync', value: connectionAvailable ? 'Syncing' : 'Disconnected' }
            ].map(item => (
              <article key={item.label} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-xs text-slate-400">{item.label}</p>
                <p className={`mt-1 text-sm font-semibold ${connectionAvailable ? 'text-emerald-300' : 'text-amber-300'}`}>{item.value}</p>
              </article>
            ))}
          </div>
          {mode === 'test' && (
            <button
              type="button"
              onClick={toggleConnection}
              className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/10"
            >
              {connectionAvailable ? 'Simulate connection loss' : 'Restore demo connection'}
            </button>
          )}
        </section>
      </div>

      <p role="status" className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-amber-200">
        {mode === 'test' ? 'Test dashboard:' : 'Service portal preview:'} The device key determines the fixed relay channel count. Light names, relay states, activity history, ESP32, Adafruit IO, and Supabase are simulated. No cloud service or physical light/relay is connected.
      </p>
    </section>
  );
}

type MeterAlert = {
  id: string;
  title: string;
  detail: string;
  severity: 'info' | 'warning' | 'critical';
};

function PrepaidEnergyMeterDashboard({ mode }: { mode: 'test' | 'service' }) {
  const [balance, setBalance] = useState(24.5);
  const [relayRequested, setRelayRequested] = useState(true);
  const [tamperState, setTamperState] = useState<'secure' | 'detected' | 'maintenance'>('secure');
  const [networkAvailable, setNetworkAvailable] = useState(true);
  const [alerts, setAlerts] = useState<MeterAlert[]>([
    { id: 'initial-online', title: 'Meter online', detail: 'Demo device connected · just now', severity: 'info' },
    { id: 'initial-recharge', title: 'Recharge successful', detail: 'GHS 20.00 added · balance GHS 24.50', severity: 'info' },
    { id: 'initial-tamper', title: 'Tamper protection armed', detail: 'Enclosure secure · just now', severity: 'info' }
  ]);
  const lowBalance = balance < 11;
  const safetyCutoff = balance <= 0 || tamperState !== 'secure';
  const relayActual = relayRequested && !safetyCutoff;
  const bulbPower = relayActual ? 60 : 0;
  const securityLabel = tamperState === 'detected'
    ? 'Tampering detected'
    : tamperState === 'maintenance'
      ? 'Maintenance mode'
      : 'Secure';
  const securityColor = tamperState === 'detected'
    ? 'text-red-300'
    : tamperState === 'maintenance'
      ? 'text-amber-300'
      : 'text-emerald-300';

  const recordAlert = (title: string, detail: string, severity: MeterAlert['severity'] = 'info') => {
    setAlerts(current => [{ id: `${Date.now()}-${Math.random()}`, title, detail, severity }, ...current].slice(0, 8));
  };

  const toggleRelay = () => {
    if (safetyCutoff) return;
    const next = !relayRequested;
    setRelayRequested(next);
    recordAlert('Relay switched', `Demo relay switched ${next ? 'ON' : 'OFF'}.`);
  };

  const recharge = () => {
    const updatedBalance = Number((balance + 20).toFixed(2));
    setBalance(updatedBalance);
    recordAlert('Recharge successful', `GHS 20.00 added · balance GHS ${updatedBalance.toFixed(2)}.`);
  };

  const detectTamper = () => {
    setTamperState('detected');
    setRelayRequested(false);
    recordAlert('Tamper detected', 'Enclosure opened · system locked and load disconnected.', 'critical');
  };

  const scanMaintenanceCard = () => {
    setTamperState('maintenance');
    setRelayRequested(false);
    recordAlert('Maintenance mode activated', 'Authorized maintenance RFID card accepted locally.');
  };

  const rearmProtection = () => {
    setTamperState('secure');
    recordAlert('Tamper protection re-armed', 'Enclosure monitoring restored after authorized maintenance.');
  };

  const simulateUnauthorizedCard = () => {
    recordAlert('Unauthorized RFID scan', 'Card not authorized · no credit added.', 'warning');
  };

  const simulateConnectivityIssue = () => {
    const next = !networkAvailable;
    setNetworkAvailable(next);
    recordAlert(
      next ? 'Connectivity restored' : 'Connectivity problem',
      next ? 'Wi-Fi and Adafruit IO demo connections restored.' : 'Adafruit IO connection lost · local safety remains active.',
      next ? 'info' : 'warning'
    );
  };

  return (
    <section aria-labelledby="energy-meter-title" className="space-y-5">
      <header className="flex flex-col gap-4 rounded-2xl border border-cyan-500/20 bg-slate-900/80 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">
              {mode === 'test' ? 'Private device test preview' : 'Service portal'}
            </span>
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">
              Simulated telemetry & controls
            </span>
          </div>
          <h2 id="energy-meter-title" className="text-xl font-bold text-white sm:text-2xl">GKB Smart Prepaid Energy Meter</h2>
          <p className="mt-1 text-sm text-slate-400">PZEM-004T energy monitoring · RFID prepaid control · tamper protection</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs font-semibold text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />Device online · demo
          </span>
          <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${networkAvailable ? 'border-cyan-500/20 bg-cyan-500/5 text-cyan-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-200'}`}>
            <Wifi className="h-3.5 w-3.5" />Wi-Fi · {networkAvailable ? 'connected' : 'offline'} · demo
          </span>
          <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${networkAvailable ? 'border-cyan-500/20 bg-cyan-500/5 text-cyan-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-200'}`}>
            <Radio className="h-3.5 w-3.5" />Adafruit IO · {networkAvailable ? 'connected' : 'disconnected'} · demo
          </span>
        </div>
      </header>

      <nav aria-label="Energy meter dashboard sections" className="flex gap-2 overflow-x-auto pb-1 text-xs">
        {['Energy overview', 'Prepaid balance', 'Live measurements', 'Power control', 'RFID recharge history', 'Tamper & security', 'Consumption analytics', 'Alerts & notifications'].map((section, index) => (
          <a key={section} href={`#energy-section-${index}`} className="shrink-0 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-slate-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-300">
            {section}
          </a>
        ))}
      </nav>

      <div className="grid gap-5 lg:grid-cols-2">
        <section id="energy-section-3" aria-label="Power control" className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div>
            <h3 className="font-semibold text-white">Power control</h3>
            <p className="mt-1 text-xs text-slate-400">Relay commands are simulated and do not control a physical load.</p>
          </div>
          <div className={`flex flex-col items-center justify-center gap-3 rounded-xl border p-5 text-center transition-colors sm:flex-row sm:justify-start sm:text-left ${relayActual ? 'border-amber-400/30 bg-amber-400/[0.06]' : 'border-slate-800 bg-slate-950/70'}`}>
            <span className={`flex h-16 w-16 items-center justify-center rounded-full transition-all ${relayActual ? 'bg-amber-300/15 text-amber-300 shadow-[0_0_30px_rgba(252,211,77,0.3)]' : 'bg-slate-800 text-slate-500'}`}>
              <Lightbulb aria-hidden="true" className={`h-9 w-9 transition-all ${relayActual ? 'fill-amber-200/40 drop-shadow-[0_0_10px_rgba(252,211,77,0.85)]' : ''}`} />
            </span>
            <div>
              <p className="font-semibold text-white">Demo bulb load</p>
              <p className={`mt-1 text-sm font-bold ${relayActual ? 'text-amber-300' : 'text-slate-400'}`}>
                {relayActual ? 'ON · 60 W simulated output' : 'OFF · 0 W output'}
              </p>
              <p className="mt-1 text-xs text-slate-500">The bulb follows the simulated relay state.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Relay actual status · demo</p>
              <p className={`mt-1 text-lg font-bold ${relayActual ? 'text-emerald-300' : 'text-slate-300'}`}>{relayActual ? 'ON · Load connected' : 'OFF · Load disconnected'}</p>
            </div>
            <button
              type="button"
              aria-pressed={relayActual}
              disabled={safetyCutoff}
              onClick={toggleRelay}
              className={`rounded-lg px-4 py-2.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 ${relayActual ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'}`}
            >
              {relayActual ? 'Switch power OFF' : 'Switch power ON'}
            </button>
          </div>
          {safetyCutoff && (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200">
              Safety lock: the demo load is disconnected {balance <= 0 ? 'because prepaid credit is zero.' : 'until authorized maintenance clears the tamper state.'}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
              <p className="text-xs text-slate-400">Wi-Fi · demo</p>
              <p className={`mt-1 text-sm font-semibold ${networkAvailable ? 'text-cyan-300' : 'text-amber-300'}`}>{networkAvailable ? 'Connected' : 'Offline'}</p>
            </div>
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
              <p className="text-xs text-slate-400">Adafruit IO · demo</p>
              <p className={`mt-1 text-sm font-semibold ${networkAvailable ? 'text-cyan-300' : 'text-amber-300'}`}>{networkAvailable ? 'Connected' : 'Disconnected'}</p>
            </div>
          </div>
          {mode === 'test' && (
            <button type="button" onClick={simulateConnectivityIssue} className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/10">
              {networkAvailable ? 'Simulate connectivity problem' : 'Restore demo connectivity'}
            </button>
          )}
        </section>

        <section id="energy-section-4" aria-label="RFID recharge history" className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-cyan-300" />
            <div>
              <h3 className="font-semibold text-white">RFID recharge</h3>
              <p className="mt-1 text-xs text-slate-400">Configured demo recharge value: GHS 20.00</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="text-xs text-slate-400">Most recent recharge</p>
            <p className="mt-1 font-semibold text-white">GHS 20.00 · Authorized recharge card</p>
            <p className="mt-1 text-xs text-slate-500">Updated balance: GHS {balance.toFixed(2)} · simulated history</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={recharge} className="rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-400">
              Simulate recharge card scan
            </button>
            <button type="button" onClick={simulateUnauthorizedCard} className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-500/10">
              Simulate unauthorized card
            </button>
          </div>
        </section>
      </div>

      <section id="energy-section-0" aria-label="Energy overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article id="energy-section-1" className={`rounded-2xl border p-5 ${lowBalance ? 'border-amber-500/40 bg-amber-500/[0.06]' : 'border-emerald-500/20 bg-emerald-500/[0.04]'}`}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Prepaid balance</p>
            <BatteryCharging className={`h-5 w-5 ${lowBalance ? 'text-amber-300' : 'text-emerald-300'}`} />
          </div>
          <p className="mt-3 text-3xl font-bold text-white">GHS {balance.toFixed(2)}</p>
          <p className={`mt-2 text-xs font-semibold ${lowBalance ? 'text-amber-300' : 'text-emerald-300'}`}>
            {lowBalance ? 'Low balance · below GHS 11.00' : 'Credit available'}
          </p>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Energy consumed</p>
          <p className="mt-3 text-3xl font-bold text-white">18.42 <span className="text-sm font-medium text-slate-400">kWh</span></p>
          <p className="mt-2 text-xs text-slate-500">Today · simulated PZEM reading</p>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Meter status</p>
          <p className={`mt-3 text-xl font-bold ${securityColor}`}>{tamperState === 'detected' ? 'Locked' : tamperState === 'maintenance' ? 'Maintenance' : 'Operational'}</p>
          <p className="mt-2 text-xs text-slate-500">System {networkAvailable ? 'healthy' : 'connectivity degraded'} · simulated</p>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Relay status</p>
          <p className={`mt-3 text-xl font-bold ${relayActual ? 'text-emerald-300' : 'text-slate-300'}`}>{relayActual ? 'ON' : 'OFF'}</p>
          <p className="mt-2 text-xs text-slate-500">{safetyCutoff ? 'Safety cutoff active' : 'Demo relay state'}</p>
        </article>
      </section>

      <section id="energy-section-2" aria-label="Live electrical measurements">
        <div className="mb-3">
          <h3 className="text-lg font-bold text-white">Live measurements</h3>
          <p className="mt-1 text-xs text-slate-400">PZEM-004T sample values · not live sensor data</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[
            { name: 'Voltage', value: '230.4', unit: 'V', icon: Zap, color: 'text-amber-300' },
            { name: 'Current', value: relayActual ? '0.26' : '0.00', unit: 'A', icon: Activity, color: 'text-cyan-300' },
            { name: 'Power', value: String(bulbPower), unit: 'W', icon: Gauge, color: 'text-purple-300' },
            { name: 'Energy', value: '18.42', unit: 'kWh', icon: BatteryCharging, color: 'text-emerald-300' },
            { name: 'Frequency', value: '50.0', unit: 'Hz', icon: Activity, color: 'text-blue-300' },
            { name: 'Power factor', value: '0.96', unit: 'PF', icon: Zap, color: 'text-pink-300' }
          ].map(measurement => (
            <article key={measurement.name} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{measurement.name}</p>
                <measurement.icon className={`h-4 w-4 ${measurement.color}`} />
              </div>
              <p className="mt-3 text-2xl font-bold text-white">{measurement.value} <span className="text-sm font-medium text-slate-400">{measurement.unit}</span></p>
            </article>
          ))}
        </div>
      </section>

      <section id="energy-section-5" aria-label="Tamper and security monitoring" className={`space-y-4 rounded-2xl border p-5 sm:p-6 ${tamperState === 'detected' ? 'border-red-500/50 bg-red-950/30' : 'border-slate-800 bg-slate-900/70'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Shield className={`h-6 w-6 ${securityColor}`} />
            <div>
              <h3 className="font-semibold text-white">Tamper detection & security</h3>
              <p className={`mt-1 text-sm font-bold ${securityColor}`}>Enclosure: {securityLabel}</p>
            </div>
          </div>
          {mode === 'test' && tamperState === 'secure' && (
            <button type="button" onClick={detectTamper} className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/20">
              Simulate enclosure tamper
            </button>
          )}
        </div>
        {tamperState === 'detected' && (
          <div role="alert" className="rounded-xl border border-red-500/50 bg-red-500/10 p-4">
            <p className="text-sm font-black uppercase tracking-wide text-red-200">Critical security alert · meter locked</p>
            <p className="mt-1 text-sm text-red-100/80">Load disconnected. Scan an authorized maintenance RFID card locally before re-arming tamper protection.</p>
          </div>
        )}
        {tamperState === 'maintenance' && (
          <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="text-sm font-bold text-amber-200">Authorized maintenance mode active</p>
            <p className="mt-1 text-sm text-amber-100/80">The demo remains locked until tamper protection is re-armed.</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {(tamperState === 'detected' || tamperState === 'maintenance') && (
            <button type="button" onClick={scanMaintenanceCard} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-100 hover:bg-amber-500/20">
              Simulate local maintenance RFID scan
            </button>
          )}
          {tamperState === 'maintenance' && (
            <button type="button" onClick={rearmProtection} className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400">
              Re-arm tamper protection
            </button>
          )}
        </div>
        {mode === 'test' && (
          <label className="block max-w-md">
            <span className="flex items-center justify-between gap-3 text-xs text-slate-400">
              <span>Simulate prepaid balance</span>
              <span className="font-mono text-cyan-300">GHS {balance.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min="0"
              max="50"
              step="0.5"
              value={balance}
              aria-label="Simulate prepaid balance"
              onChange={event => {
                const nextBalance = Number(event.target.value);
                setBalance(nextBalance);
                if (nextBalance === 0) {
                  setRelayRequested(false);
                  recordAlert('Prepaid credit exhausted', 'Balance reached GHS 0.00 · load automatically disconnected.', 'critical');
                } else if (nextBalance < 11) {
                  recordAlert('Low energy credit', `Balance is GHS ${nextBalance.toFixed(2)} · below GHS 11.00.`, 'warning');
                }
              }}
              className="mt-2 w-full accent-cyan-400"
            />
            <span className="mt-1 block text-[11px] text-slate-500">Use zero to demonstrate the automatic safety cutoff and GHS 11 low-balance warning.</span>
          </label>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section id="energy-section-6" aria-label="Consumption analytics" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-white">Consumption analytics</h3>
              <p className="mt-1 text-xs text-slate-400">Sample usage, demand and prepaid balance history</p>
            </div>
            <span className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-[11px] text-slate-300">Last 24 hours</span>
          </div>
          <svg role="img" aria-label="Simulated electricity consumption and power demand history" viewBox="0 0 640 220" className="mt-5 h-48 w-full" preserveAspectRatio="none">
            {[35, 75, 115, 155].map(y => <line key={y} x1="0" x2="640" y1={y} y2={y} stroke="#334155" strokeDasharray="4 6" />)}
            <path d="M0 155 L80 141 L160 148 L240 95 L320 119 L400 83 L480 99 L560 55 L640 72" fill="none" stroke="#22d3ee" strokeWidth="3" />
            <path d="M0 103 L80 117 L160 91 L240 126 L320 81 L400 107 L480 68 L560 93 L640 52" fill="none" stroke="#a78bfa" strokeWidth="3" />
            <path d="M0 77 L80 88 L160 71 L240 80 L320 65 L400 83 L480 69 L560 77 L640 62" fill="none" stroke="#fbbf24" strokeWidth="2.5" />
            <path d="M0 42 L80 49 L160 57 L240 66 L320 82 L400 94 L480 108 L560 123 L640 139" fill="none" stroke="#34d399" strokeWidth="2.5" />
            <text x="4" y="205" fill="#94a3b8" fontSize="11">00:00</text>
            <text x="155" y="205" fill="#94a3b8" fontSize="11">06:00</text>
            <text x="315" y="205" fill="#94a3b8" fontSize="11">12:00</text>
            <text x="475" y="205" fill="#94a3b8" fontSize="11">18:00</text>
            <text x="600" y="205" fill="#94a3b8" fontSize="11">Now</text>
          </svg>
          <div className="mt-3 flex flex-wrap gap-4 text-xs">
            <span className="inline-flex items-center gap-2 text-cyan-300"><span className="h-0.5 w-4 bg-cyan-300" />Energy use (kWh)</span>
            <span className="inline-flex items-center gap-2 text-violet-300"><span className="h-0.5 w-4 bg-violet-300" />Power demand (W)</span>
            <span className="inline-flex items-center gap-2 text-amber-300"><span className="h-0.5 w-4 bg-amber-300" />Voltage (V)</span>
            <span className="inline-flex items-center gap-2 text-emerald-300"><span className="h-0.5 w-4 bg-emerald-300" />Prepaid balance (GHS)</span>
          </div>
        </section>

        <section id="energy-section-7" aria-label="Alerts and notifications" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white">Alerts & notifications</h3>
              <p className="mt-1 text-xs text-slate-400">Recent simulated meter events</p>
            </div>
            <AlertTriangle className="h-5 w-5 text-amber-300" />
          </div>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {alerts.map(alert => (
              <li key={alert.id} className={`rounded-xl border p-3 ${alert.severity === 'critical' ? 'border-red-500/30 bg-red-500/[0.06]' : alert.severity === 'warning' ? 'border-amber-500/25 bg-amber-500/[0.04]' : 'border-slate-800 bg-slate-950/60'}`}>
                <p className={`text-sm font-semibold ${alert.severity === 'critical' ? 'text-red-200' : alert.severity === 'warning' ? 'text-amber-200' : 'text-slate-200'}`}>{alert.title}</p>
                <p className="mt-1 text-xs text-slate-400">{alert.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p role="status" className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-amber-200">
        {mode === 'test' ? 'Test dashboard:' : 'Service portal preview:'} all meter measurements, account credit, RFID scans, tamper events, network status, charts, and relay actions are simulated. No PZEM sensor, RFID reader, Adafruit IO service, or physical relay is connected. Production safety cutoffs must be enforced locally by the meter hardware.
      </p>
    </section>
  );
}


function generateRelayArduinoCode(deviceKey: string = 'GKB-SEC-0001'): string {
  const baseCode = "/*\n * =========================================================================================\n * GKB TECHNOLOGIES — ESP32 RELAY PILOT: BLE + QR CODE PROVISIONING & CLOUD CONTROL\n * =========================================================================================\n * Target Board       : ESP32 Dev Module / NodeMCU-32S / ESP-WROOM-32\n * Device Token Model : Unique Hardware Casing Token (Default: GKB-SEC-0001)\n * Target Output      : 5V/3.3V Smart Relay Channel (GPIO 23)\n * Status Diagnostic  : Onboard Blue LED (GPIO 2)\n * Factory Reset Button: Onboard BOOT Button (GPIO 0, Hold for 5s)\n * Storage Engine     : Non-Volatile Flash Partition (ESP32 Preferences.h / NVS)\n * Connectivity       : Dual-Mode (BLE 4.2 GATT Provisioning + 2.4GHz Wi-Fi Cloud Polling)\n * Cloud Backend      : Supabase public.relay_status (device_id: relay_01)\n * =========================================================================================\n * WORKFLOW SPECIFICATION:\n * 1. Boot-up:\n *    - Reads Preferences NVS namespace (\"gkb_prov\").\n *    - If provisioned: Connects directly to saved Wi-Fi and begins operational cloud relay control.\n *    - If unprovisioned: Starts BLE GATT Server with advertising name \"GKB-RELAY-0001\".\n *\n * 2. Web App & BLE Handshake:\n *    - User opens the relay test portal at https://gkb-devices.netlify.app/\n *    - Web Bluetooth scans and connects to BLE Service: 4fafc201-1fb5-459e-8fcc-c5c9c331914b\n *\n * 3. Device QR Tagging & Verification:\n *    - User scans the physical QR code sticker on the ESP32 module casing (e.g. GKB-SEC-0001).\n *    - App transmits \"VERIFY:GKB-SEC-0001\" over RX characteristic.\n *    - ESP32 compares against internal deviceKey.\n *    - If match -> Returns \"AUTH_SUCCESS:DEVICE_UNLOCKED\".\n *\n * 4. Credential Transfer & Flash Storage:\n *    - App sends \"SET_WIFI:{\\\"ssid\\\":\\\"...\\\",\\\"pass\\\":\\\"...\\\"}\" over BLE.\n *    - ESP32 writes SSID & Password to Preferences.h NVS.\n *    - ESP32 transmits \"CONFIG_SAVED:REBOOTING\" and automatically restarts.\n *\n * 5. Operational Relay Operation:\n *    - ESP32 joins local Wi-Fi and polls Supabase relay_status table for relay_01.\n *    - Updates GPIO 23 (HIGH = ON, LOW = OFF) with real-time web portal sync.\n * =========================================================================================\n */\n\n#include <WiFi.h>\n#include <WiFiClientSecure.h>\n#include <HTTPClient.h>\n#include <Preferences.h>\n#include <BLEDevice.h>\n#include <BLEServer.h>\n#include <BLEUtils.h>\n#include <BLE2902.h>\n\n// ================= HARDWARE PINOUT ASSIGNMENTS =================\n#define PIN_RELAY_OUTPUT    23   // ESP32 GPIO 23 -> Relay Signal IN (IN1)\n#define PIN_STATUS_LED      2    // ESP32 GPIO 2  -> Onboard Blue LED\n#define PIN_BOOT_BUTTON     0    // ESP32 GPIO 0  -> BOOT Button (Factory Reset)\n\n// Default Relay Logic (Set to true if your relay module is Active HIGH, false if Active LOW)\n#define RELAY_ACTIVE_HIGH   true\n\n// ================= DEVICE IDENTITY & SECURITY KEY =================\n// Physical QR code label token on device casing:\n#define DEFAULT_DEVICE_KEY  \"GKB-SEC-0001\"\n\n// ================= BLE GATT SPECIFICATIONS =================\n#define GKB_BLE_SERVICE_UUID        \"4fafc201-1fb5-459e-8fcc-c5c9c331914b\"\n#define GKB_BLE_CHAR_RX_UUID        \"beb5483e-36e1-4688-b7f5-ea07361b26a8\" // Phone writes to ESP32\n#define GKB_BLE_CHAR_TX_UUID        \"beb5483f-36e1-4688-b7f5-ea07361b26a9\" // ESP32 notifies Phone\n\n// ================= SUPABASE CLOUD REST ENDPOINT =================\n// Supabase REST endpoint for relay_01:\nconst char* SUPABASE_REST_URL = \"https://ditnksmvcacnzdguqcgz.supabase.co/rest/v1/relay_status?device_id=eq.relay_01&select=state\";\nconst char* SUPABASE_ANON_KEY = \"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdG5rc212Y2FjbnpkZ3VxY2d6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDAzNTQ5ODUsImV4cCI6MjA1NTkzMDk4NX0.gYf4vKq5YV83_X9L_bIwbj1-e-oVbJbZ2w5GkBtechnologies\";\n\n// Supabase TLS Root Certificate (Google Trust Services / GlobalSign)\nconst char* SUPABASE_ROOT_CA =\n\"-----BEGIN CERTIFICATE-----\\n\"\n\"MIIDejCCAmKgAwIBAgIQf+UwvzMTQ77dghYQST2KGzANBgkqhkiG9w0BAQsFADBX\\n\"\n\"MQswCQYDVQQGEwJCRTEZMBcGA1UEChMQR2xvYmFsU2lnbiBudi1zYTEQMA4GA1UE\\n\"\n\"CxMHUm9vdCBDQTEbMBkGA1UEAxMSR2xvYmFsU2lnbiBSb290IENBMB4XDTIzMTEx\\n\"\n\"NTAzNDMyMVoXDTI4MDEyODAwMDA0MlowRzELMAkGA1UEBhMCVVMxIjAgBgNVBAoT\\n\"\n\"GUdvb2dsZSBUcnVzdCBTZXJ2aWNlcyBMTEMxFDASBgNVBAMTC0dUUyBSb290IFI0\\n\"\n\"MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE83Rzp2iLYK5DuDXFgTB7S0md+8Fhzube\\n\"\n\"Rr1r1WEYNa5A3XP3iZEwWus87oV8okB2O6nGuEfYKueSkWpz6bFyOZ8pn6KY019e\\n\"\n\"WIZlD6GEZQbR3IvJx3PIjGov5cSr0R2Ko4H/MIH8MA4GA1UdDwEB/wQEAwIBhjAd\\n\"\n\"BgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUHAwIwDwYDVR0TAQH/BAUwAwEB/zAd\\n\"\n\"BgNVHQ4EFgQUgEzW63T/STaj1dj8tT7FavCUHYwwHwYDVR0jBBgwFoAUYHtmGkUN\\n\"\n\"l8qJUC99BM00qP/8/UswNgYIKwYBBQUHAQEEKjAoMCYGCCsGAQUFBzAChhpodHRw\\n\"\n\"Oi8vaS5wa2kuZ29vZy9nc3IxLmNydDAtBgNVHR8EJjAkMCKgIKAehhxodHRwOi8v\\n\"\n\"Yy5wa2kuZ29vZy9yL2dzcjEuY3JsMBMGA1UdIAQMMAowCAYGZ4EMAQIBMA0GCSqG\\n\"\n\"SIb3DQEBCwUAA4IBAQAYQrsPBtYDh5bjP2OBDwmkoWhIDDkic574y04tfzHpn+cJ\\n\"\n\"odI2D4SseesQ6bDrarZ7C30ddLibZatoKiws3UL9xnELz4ct92vID24FfVbiI1hY\\n\"\n\"+SW6FoVHkNeWIP0GCbaM4C6uVdF5dTUsMVs/ZbzNnIdCp5Gxmx5ejvEau8otR/Cs\\n\"\n\"kGN+hr/W5GvT1tMBjgWKZ1i4//emhA1JG1BbPzoLJQvyEotc03lXjTaCzv8mEbep\\n\"\n\"8RqZ7a2CPsgRbuvTPBwcOMBBmuFeU88+FSBX6+7iP0il8b4Z0QFqIwwMHfs/L6K1\\n\"\n\"vepuoxtGzi4CZ68zJpiq1UvSqTbFJjtbD4seiMHl\\n\"\n\"-----END CERTIFICATE-----\\n\";\n\n// ================= SYSTEM STATE =================\nPreferences preferences;\n\nenum DeviceOperatingMode {\n  MODE_PROVISIONING_BLE,\n  MODE_CONNECTING_WIFI,\n  MODE_OPERATIONAL_CLOUD,\n  MODE_STANDALONE_FAILSAFE\n};\n\nDeviceOperatingMode currentMode = MODE_PROVISIONING_BLE;\n\nString deviceKey          = DEFAULT_DEVICE_KEY;\nString wifiSSID           = \"\";\nString wifiPassword       = \"\";\nbool   isProvisioned      = false;\nbool   bleClientConnected = false;\nbool   qrAuthenticated    = false;\nbool   currentRelayState  = false;\n\nBLEServer*         pBleServer         = nullptr;\nBLECharacteristic* pTxCharacteristic = nullptr;\n\nunsigned long lastCloudPollTime    = 0;\nconst unsigned long CLOUD_POLL_MS  = 2500; // Poll cloud relay state every 2.5s\nunsigned long bootButtonPressTime  = 0;\nbool isBootButtonPressed           = false;\n\n// ================= FUNCTION PROTOTYPES =================\nvoid loadStoredCredentials();\nvoid saveWiFiCredentials(const String& ssid, const String& pass);\nvoid factoryResetPreferences();\nvoid initBLEProvisioningServer();\nvoid sendBLEResponse(const String& message);\nvoid connectToConfiguredWiFi();\nvoid pollCloudRelayState();\nvoid applyRelayOutput(bool state);\nString extractJsonField(const String& json, const String& key);\n\n// ================= BLE SERVER CALLBACKS =================\nclass GkbRelayServerCallbacks : public BLEServerCallbacks {\n  void onConnect(BLEServer* pServer) override {\n    bleClientConnected = true;\n    qrAuthenticated    = false; // Every new connection requires fresh QR verification\n    Serial.println(\"📱 [BLE] Mobile / Web Client Connected!\");\n    digitalWrite(PIN_STATUS_LED, HIGH);\n  }\n\n  void onDisconnect(BLEServer* pServer) override {\n    bleClientConnected = false;\n    qrAuthenticated    = false;\n    Serial.println(\"📱 [BLE] Client Disconnected. Re-advertising...\");\n    digitalWrite(PIN_STATUS_LED, LOW);\n    if (currentMode == MODE_PROVISIONING_BLE && pBleServer) {\n      pBleServer->startAdvertising();\n    }\n  }\n};\n\nclass GkbRelayCharacteristicCallbacks : public BLECharacteristicCallbacks {\n  void onWrite(BLECharacteristic* pCharacteristic) override {\n    String rxValue = pCharacteristic->getValue().c_str();\n    rxValue.trim();\n    if (rxValue.length() == 0) return;\n\n    Serial.print(\"📩 [BLE-RX] Received: \");\n    Serial.println(rxValue);\n\n    // 1. QR Code Security Key Verification (Phase 2 Step 2)\n    if (rxValue.startsWith(\"VERIFY:\")) {\n      String submittedKey = rxValue.substring(7);\n      submittedKey.trim();\n\n      Serial.print(\"🔍 Verifying QR Key: [\");\n      Serial.print(submittedKey);\n      Serial.print(\"] vs Stored Key: [\");\n      Serial.print(deviceKey);\n      Serial.println(\"]\");\n\n      if (submittedKey.equalsIgnoreCase(deviceKey)) {\n        qrAuthenticated = true;\n        Serial.println(\"✅ [AUTH] QR Security Key Verified! Access Granted.\");\n        sendBLEResponse(\"AUTH_SUCCESS:DEVICE_UNLOCKED\");\n      } else {\n        qrAuthenticated = false;\n        Serial.println(\"❌ [AUTH] Security Key Mismatch! Rejected.\");\n        sendBLEResponse(\"AUTH_FAILED:INVALID_KEY\");\n      }\n      return;\n    }\n\n    // 2. Wi-Fi Credential Transfer & Storage (Phase 2 Step 3)\n    if (rxValue.startsWith(\"SET_WIFI:\")) {\n      if (!qrAuthenticated) {\n        Serial.println(\"⚠️ [SECURITY] Rejected Wi-Fi configuration without QR verification!\");\n        sendBLEResponse(\"AUTH_REQUIRED:SCAN_QR_FIRST\");\n        return;\n      }\n\n      String jsonPayload = rxValue.substring(9);\n      String incomingSSID = extractJsonField(jsonPayload, \"ssid\");\n      String incomingPass = extractJsonField(jsonPayload, \"pass\");\n\n      if (incomingSSID.length() == 0) {\n        sendBLEResponse(\"CONFIG_ERROR:EMPTY_SSID\");\n        return;\n      }\n\n      Serial.println(\"💾 [NVS] Saving Wi-Fi Credentials via Preferences.h...\");\n      Serial.print(\"   SSID: \"); Serial.println(incomingSSID);\n\n      saveWiFiCredentials(incomingSSID, incomingPass);\n      sendBLEResponse(\"CONFIG_SAVED:REBOOTING\");\n\n      delay(800);\n      Serial.println(\"🔄 Restarting ESP32 into Cloud Relay Mode...\");\n      ESP.restart();\n      return;\n    }\n\n    // 3. Status Query\n    if (rxValue == \"GET_STATUS\") {\n      String statusMsg = \"STATUS:\";\n      statusMsg += \"KEY=\" + deviceKey + \";\";\n      statusMsg += \"AUTH=\" + String(qrAuthenticated ? \"YES\" : \"NO\") + \";\";\n      statusMsg += \"PROV=\" + String(isProvisioned ? \"YES\" : \"NO\") + \";\";\n      statusMsg += \"RELAY=\" + String(currentRelayState ? \"ON\" : \"OFF\");\n      sendBLEResponse(statusMsg);\n      return;\n    }\n\n    // 4. Factory Reset Command\n    if (rxValue == \"FACTORY_RESET\") {\n      sendBLEResponse(\"RESET_CONFIRMED:REBOOTING\");\n      delay(600);\n      factoryResetPreferences();\n      ESP.restart();\n      return;\n    }\n\n    sendBLEResponse(\"UNKNOWN_COMMAND\");\n  }\n};\n\n// ================= ARDUINO SETUP =================\nvoid setup() {\n  Serial.begin(115200);\n  delay(1200);\n\n  Serial.println(\"\\n=======================================================\");\n  Serial.println(\"⚡ GKB TECHNOLOGIES — ESP32 SMART RELAY PILOT\");\n  Serial.println(\"   BLE & QR Provisioning · Supabase Cloud Telemetry\");\n  Serial.println(\"=======================================================\");\n\n  pinMode(PIN_BOOT_BUTTON, INPUT_PULLUP);\n  pinMode(PIN_STATUS_LED, OUTPUT);\n  pinMode(PIN_RELAY_OUTPUT, OUTPUT);\n\n  // Default initial state: Relay OFF, LED OFF\n  applyRelayOutput(false);\n  digitalWrite(PIN_STATUS_LED, LOW);\n\n  // Load persistent credentials from Flash memory\n  loadStoredCredentials();\n\n  // Route based on provisioning state\n  if (isProvisioned && wifiSSID.length() > 0) {\n    Serial.println(\"⚡ Provisioned credentials located. Connecting to Wi-Fi...\");\n    currentMode = MODE_CONNECTING_WIFI;\n    connectToConfiguredWiFi();\n  } else {\n    Serial.println(\"🚀 Unprovisioned module. Launching BLE Provisioning Server...\");\n    currentMode = MODE_PROVISIONING_BLE;\n    initBLEProvisioningServer();\n  }\n}\n\n// ================= ARDUINO MAIN LOOP =================\nvoid loop() {\n  // 1. Factory Reset Check (Hold BOOT button for 5 seconds)\n  if (digitalRead(PIN_BOOT_BUTTON) == LOW) {\n    if (!isBootButtonPressed) {\n      isBootButtonPressed = true;\n      bootButtonPressTime = millis();\n    } else {\n      if (millis() - bootButtonPressTime >= 5000) {\n        Serial.println(\"\\n⚠️ [RESET] BOOT Button held for 5s. Clearing NVS & Factory Resetting...\");\n        for (int i = 0; i < 5; i++) {\n          digitalWrite(PIN_STATUS_LED, HIGH);\n          delay(100);\n          digitalWrite(PIN_STATUS_LED, LOW);\n          delay(100);\n        }\n        factoryResetPreferences();\n        ESP.restart();\n      }\n    }\n  } else {\n    isBootButtonPressed = false;\n  }\n\n  // 2. State-Specific Operational Logic\n  if (currentMode == MODE_PROVISIONING_BLE) {\n    // Pulse Status LED to visually indicate BLE Advertising / Pairing Mode\n    static unsigned long lastBlink = 0;\n    if (!bleClientConnected && millis() - lastBlink > 700) {\n      lastBlink = millis();\n      digitalWrite(PIN_STATUS_LED, !digitalRead(PIN_STATUS_LED));\n    }\n  } else if (currentMode == MODE_OPERATIONAL_CLOUD) {\n    // Keep Status LED solid ON when connected and operational\n    digitalWrite(PIN_STATUS_LED, HIGH);\n\n    // Check Wi-Fi Connection Health\n    if (WiFi.status() != WL_CONNECTED) {\n      Serial.println(\"⚠️ [WI-FI] Connection dropped. Re-establishing link...\");\n      WiFi.reconnect();\n      delay(1000);\n      return;\n    }\n\n    // Periodically poll Supabase relay state\n    if (millis() - lastCloudPollTime >= CLOUD_POLL_MS) {\n      lastCloudPollTime = millis();\n      pollCloudRelayState();\n    }\n  }\n}\n\n// ================= BLE PROVISIONING ENGINE =================\nvoid initBLEProvisioningServer() {\n  // Advertise as GKB-RELAY-0001 (or GKB-PROV-0001)\n  String bleAdvertisedName = \"GKB-RELAY-0001\";\n  Serial.print(\"📶 [BLE] Initializing GATT Server: \");\n  Serial.println(bleAdvertisedName);\n\n  BLEDevice::init(bleAdvertisedName.c_str());\n  pBleServer = BLEDevice::createServer();\n  pBleServer->setCallbacks(new GkbRelayServerCallbacks());\n\n  BLEService* pService = pBleServer->createService(GKB_BLE_SERVICE_UUID);\n\n  // RX Characteristic (Web Bluetooth writes commands to ESP32)\n  BLECharacteristic* pRxCharacteristic = pService->createCharacteristic(\n    GKB_BLE_CHAR_RX_UUID,\n    BLECharacteristic::PROPERTY_WRITE\n  );\n  pRxCharacteristic->setCallbacks(new GkbRelayCharacteristicCallbacks());\n\n  // TX Characteristic (ESP32 sends real-time notifications to Web App)\n  pTxCharacteristic = pService->createCharacteristic(\n    GKB_BLE_CHAR_TX_UUID,\n    BLECharacteristic::PROPERTY_NOTIFY\n  );\n  pTxCharacteristic->addDescriptor(new BLE2902());\n\n  pService->start();\n\n  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();\n  pAdvertising->addServiceUUID(GKB_BLE_SERVICE_UUID);\n  pAdvertising->setScanResponse(true);\n  pAdvertising->setMinPreferred(0x06);\n  pAdvertising->setMinPreferred(0x12);\n  BLEDevice::startAdvertising();\n\n  Serial.println(\"📡 [BLE] Provisioning Server Active. Ready for Web Bluetooth & QR scan.\");\n}\n\nvoid sendBLEResponse(const String& message) {\n  if (pTxCharacteristic && bleClientConnected) {\n    pTxCharacteristic->setValue(message.c_str());\n    pTxCharacteristic->notify();\n    Serial.print(\"📤 [BLE-TX] Sent: \");\n    Serial.println(message);\n  }\n}\n\n// ================= NON-VOLATILE STORAGE (PREFERENCES.H) =================\nvoid loadStoredCredentials() {\n  preferences.begin(\"gkb_prov\", false);\n\n  if (!preferences.isKey(\"dev_key\")) {\n    preferences.putString(\"dev_key\", DEFAULT_DEVICE_KEY);\n    deviceKey = DEFAULT_DEVICE_KEY;\n  } else {\n    deviceKey = preferences.getString(\"dev_key\", DEFAULT_DEVICE_KEY);\n  }\n\n  isProvisioned = preferences.getBool(\"is_prov\", false);\n  wifiSSID      = preferences.getString(\"wifi_ssid\", \"\");\n  wifiPassword  = preferences.getString(\"wifi_pass\", \"\");\n\n  preferences.end();\n\n  Serial.print(\"🔑 Casing Device Key   : \"); Serial.println(deviceKey);\n  Serial.print(\"📦 Provisioning Status : \"); Serial.println(isProvisioned ? \"PROVISIONED\" : \"UNPROVISIONED\");\n  if (isProvisioned) {\n    Serial.print(\"📶 Saved Network SSID  : \"); Serial.println(wifiSSID);\n  }\n}\n\nvoid saveWiFiCredentials(const String& ssid, const String& pass) {\n  preferences.begin(\"gkb_prov\", false);\n  preferences.putString(\"wifi_ssid\", ssid);\n  preferences.putString(\"wifi_pass\", pass);\n  preferences.putBool(\"is_prov\", true);\n  preferences.end();\n\n  wifiSSID      = ssid;\n  wifiPassword  = pass;\n  isProvisioned = true;\n  Serial.println(\"✅ [NVS] Wi-Fi network saved to Flash memory partition.\");\n}\n\nvoid factoryResetPreferences() {\n  preferences.begin(\"gkb_prov\", false);\n  preferences.clear();\n  preferences.putString(\"dev_key\", DEFAULT_DEVICE_KEY);\n  preferences.end();\n  Serial.println(\"🧹 [NVS] Preferences cleared. Ready for fresh factory provisioning.\");\n}\n\n// ================= WI-FI & SUPABASE CLOUD RELAY =================\nvoid connectToConfiguredWiFi() {\n  Serial.print(\"🌐 Connecting to Wi-Fi SSID: [\");\n  Serial.print(wifiSSID);\n  Serial.print(\"] \");\n\n  WiFi.mode(WIFI_STA);\n  WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());\n\n  int attempts = 0;\n  while (WiFi.status() != WL_CONNECTED && attempts < 30) {\n    delay(400);\n    Serial.print(\".\");\n    attempts++;\n  }\n\n  if (WiFi.status() == WL_CONNECTED) {\n    currentMode = MODE_OPERATIONAL_CLOUD;\n    Serial.println(\"\\n🎉 Wi-Fi Connected! IP Address: \" + WiFi.localIP().toString());\n    digitalWrite(PIN_STATUS_LED, HIGH);\n    // Immediately fetch initial relay state\n    pollCloudRelayState();\n  } else {\n    currentMode = MODE_PROVISIONING_BLE;\n    Serial.println(\"\\n⚠️ Failed to join Wi-Fi. Returning to BLE Provisioning Server...\");\n    initBLEProvisioningServer();\n  }\n}\n\nvoid pollCloudRelayState() {\n  if (WiFi.status() != WL_CONNECTED) return;\n\n  WiFiClientSecure client;\n  client.setCACert(SUPABASE_ROOT_CA);\n\n  HTTPClient http;\n  if (http.begin(client, SUPABASE_REST_URL)) {\n    http.addHeader(\"apikey\", SUPABASE_ANON_KEY);\n    http.addHeader(\"Authorization\", String(\"Bearer \") + SUPABASE_ANON_KEY);\n    http.addHeader(\"Accept\", \"application/json\");\n\n    int httpCode = http.GET();\n    if (httpCode == HTTP_CODE_OK || httpCode == 200) {\n      String payload = http.getString();\n      // Payload format: [{\"state\":\"ON\"}] or [{\"state\":\"OFF\"}]\n      if (payload.indexOf(\"\\\"state\\\":\\\"ON\\\"\") != -1) {\n        if (!currentRelayState) {\n          Serial.println(\"⚡ [CLOUD RELAY] Switch Command: ON -> Engaging GPIO 23\");\n          applyRelayOutput(true);\n        }\n      } else if (payload.indexOf(\"\\\"state\\\":\\\"OFF\\\"\") != -1) {\n        if (currentRelayState) {\n          Serial.println(\"⚡ [CLOUD RELAY] Switch Command: OFF -> Releasing GPIO 23\");\n          applyRelayOutput(false);\n        }\n      }\n    } else {\n      Serial.print(\"⚠️ [CLOUD] Relay status poll returned HTTP \");\n      Serial.println(httpCode);\n    }\n    http.end();\n  }\n}\n\nvoid applyRelayOutput(bool state) {\n  currentRelayState = state;\n  if (RELAY_ACTIVE_HIGH) {\n    digitalWrite(PIN_RELAY_OUTPUT, state ? HIGH : LOW);\n  } else {\n    digitalWrite(PIN_RELAY_OUTPUT, state ? LOW : HIGH);\n  }\n}\n\n// Simple JSON extraction helper without requiring ArduinoJson library\nString extractJsonField(const String& json, const String& key) {\n  String searchKey = \"\\\"\" + key + \"\\\":\\\"\";\n  int startIdx = json.indexOf(searchKey);\n  if (startIdx == -1) {\n    searchKey = \"\\\"\" + key + \"\\\":\";\n    startIdx = json.indexOf(searchKey);\n    if (startIdx == -1) return \"\";\n    startIdx += searchKey.length();\n    int endIdx = json.indexOf(\",\", startIdx);\n    if (endIdx == -1) endIdx = json.indexOf(\"}\", startIdx);\n    if (endIdx == -1) return \"\";\n    String result = json.substring(startIdx, endIdx);\n    result.trim();\n    result.replace(\"\\\"\", \"\");\n    return result;\n  }\n  startIdx += searchKey.length();\n  int endIdx = json.indexOf(\"\\\"\", startIdx);\n  if (endIdx == -1) return \"\";\n  return json.substring(startIdx, endIdx);\n}\n";
  return baseCode.replace(/#define DEFAULT_DEVICE_KEY\s+"[^"]+"/, '#define DEFAULT_DEVICE_KEY  "' + deviceKey + '"');
}

function SmartHomeSecurityDashboard({ mode, device }: { mode: 'test' | 'service'; device?: Device }) {
  return (
    <section aria-label="Smart Home Security System" className="rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-6 space-y-4 max-w-3xl mx-auto text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 to-purple-600 text-black shadow-lg shadow-cyan-500/20">
          <Cpu className="h-7 w-7 text-black" />
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">Hardware Pilot Standardization</span>
          <h3 className="text-xl font-bold text-white mt-1">Hardware Testing Ground Anchored to Relay Test</h3>
        </div>
      </div>
      <p className="text-sm text-slate-300 leading-relaxed max-w-xl mx-auto">
        Complex legacy security system backends have been isolated and removed. The ESP32 Relay Test portal is our designated primary testing ground for BLE GATT handshakes, QR camera verification, and Preferences.h credential provisioning.
      </p>
      <div className="pt-2 flex justify-center">
        <button
          type="button"
          onClick={() => {
            const btn = document.querySelector('[data-nav-relay="true"]') as HTMLButtonElement | null;
            if (btn) btn.click();
            else window.location.reload();
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 px-5 py-3 text-xs font-black uppercase tracking-wider text-black shadow-lg shadow-cyan-500/20 hover:opacity-90 transition-all cursor-pointer"
        >
          <Cpu className="h-4 w-4" /> Open ESP32 Relay Test Center
        </button>
      </div>
    </section>
  );
}

function GenericDeviceDashboard({ device, mode }: { device: Device; mode: 'test' | 'service' }) {
  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-6">
        <p className="text-xs font-bold uppercase tracking-wider text-cyan-300">
          {mode === 'test' ? 'Private device test preview' : 'Service portal'}
        </p>
        <h2 className="mt-2 text-2xl font-bold text-white">{device.name}</h2>
        <p className="mt-2 text-sm text-slate-400">Sample dashboard · live hardware data is not connected</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { label: 'Device state', value: 'Sample · standby' },
          { label: 'Last sample', value: device.lastAlert },
          { label: 'Connection', value: 'Not connected' }
        ].map(item => (
          <article key={item.label} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{item.label}</p>
            <p className="mt-3 font-semibold text-white">{item.value}</p>
          </article>
        ))}
      </div>
      <p role="status" className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-amber-200">
        This dashboard is a UI preview only. Live telemetry, device commands, and controls are unavailable until a hardware API is connected.
      </p>
    </section>
  );
}



export default function IoTDevicePortal() {
  const [activeTab, setActiveTab] = useState<'devices' | 'dashboard' | 'support' | 'contact'>('devices');
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

  const [devices, setDevices] = useState<Device[]>(() => {
    try {
      const deletedKeys = JSON.parse(window.localStorage.getItem('gkb-deleted-device-keys') || '[]') as string[];
      const stored = window.localStorage.getItem('gkb-devices');
      const saved = stored ? (JSON.parse(stored) as Device[]) : [];
      const base = saved.length > 0 ? saved : defaultDevices;
      return base.filter(device => !deletedKeys.includes(device.key));
    } catch {
      return defaultDevices;
    }
  });

  const [linkedDevices, setLinkedDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [inputKey, setInputKey] = useState('');
  const [linkMessage, setLinkMessage] = useState('');
  const [linkMessageIsError, setLinkMessageIsError] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);

  // Complaints / Support state
  const isAdmin = Boolean(user && (user.role === 'admin' || user.email?.toLowerCase() === 'zumkel023@gmail.com'));
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [complaintsLoading, setComplaintsLoading] = useState(false);
  const [complaintFilter, setComplaintFilter] = useState<'all' | 'pending' | 'resolved'>('all');

  // Customer Devices & Payment Suspension state
  const [allCustomerDevices, setAllCustomerDevices] = useState<CustomerDevice[]>([]);
  const [customerDevicesLoading, setCustomerDevicesLoading] = useState(false);
  const [customerFilter, setCustomerFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [customerSearch, setCustomerSearch] = useState('');
  const [quickPauseKey, setQuickPauseKey] = useState('');
  const [paymentModalDevice, setPaymentModalDevice] = useState<Device | CustomerDevice | null>(null);
  const [copiedPayment, setCopiedPayment] = useState(false);
  const [suspendedCustomerKeys, setSuspendedCustomerKeys] = useState<string[]>(() => {
    try {
      const stored = window.localStorage.getItem('gkb-suspended-client-keys');
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  });
  
  // Admin New Device Form
  const [newDevName, setNewDevName] = useState('');
  const [newDevKey, setNewDevKey] = useState('');
  const [newDevProject, setNewDevProject] = useState<StudentProject>('smart-security-system');
  const [newDevAlert, setNewDevAlert] = useState('');
  const [newDevChannels, setNewDevChannels] = useState<'4' | '6' | '8'>('4');
  const [deployMessage, setDeployMessage] = useState('');
  const [deployError, setDeployError] = useState('');
  const [deployBusy, setDeployBusy] = useState(false);
  const [newComplaintText, setNewComplaintText] = useState('');
  const [complaintError, setComplaintError] = useState('');
  const [complaintBusy, setComplaintBusy] = useState(false);

  useEffect(() => {
    window.localStorage.setItem('gkb-theme', isLightMode ? 'light' : 'dark');
  }, [isLightMode]);

  // Auth session
  const applyPortalSession = useCallback(async (session: Session | null) => {
    if (!session?.user.email && !session?.user.phone) {
      setUser(null);
      setLinkedDevices([]);
      return;
    }
    const metadata = session.user.user_metadata;
    const account: UserType = {
      id: session.user.id,
      role: 'client',
      email: session.user.email ?? session.user.phone ?? '',
      firstName: typeof metadata.first_name === 'string' ? metadata.first_name : '',
      lastName: typeof metadata.last_name === 'string' ? metadata.last_name : '',
      phone: typeof metadata.phone === 'string' ? metadata.phone : '',
      location: typeof metadata.location === 'string' ? metadata.location : ''
    };
    if (!relaySupabase) {
      setUser(account);
      return;
    }
    const { data } = await relaySupabase
      .from('gkb_user_roles')
      .select('role')
      .eq('user_id', session.user.id)
      .maybeSingle();

    const role = (data?.role === 'admin' || session.user.email?.toLowerCase() === 'zumkel023@gmail.com') ? 'admin' : 'client';
    setUser({ ...account, role });
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

  // Load linked devices from Supabase if user is signed in
  useEffect(() => {
    if (!user || !relaySupabase) {
      setLinkedDevices([]);
      return;
    }
    let disposed = false;
    const load = async () => {
      const { data, error } = await relaySupabase
        .from('gkb_user_devices')
        .select('device_key, device_name, status, last_alert, project, relay_channels')
        .eq('user_id', user.id);
      if (disposed) return;
      if (!error && data) {
        const storedSuspended = (() => {
          try {
            return (JSON.parse(window.localStorage.getItem('gkb-suspended-client-keys') || '[]') as string[]);
          } catch {
            return [];
          }
        })();

        setLinkedDevices(data.map((saved, idx) => {
          const isPaused = saved.status?.toLowerCase().includes('suspend') ||
                           saved.status?.toLowerCase().includes('pause') ||
                           storedSuspended.some(k => k.toUpperCase() === saved.device_key.toUpperCase());
          return {
            id: idx + 1000,
            name: saved.device_name,
            key: saved.device_key,
            status: isPaused ? 'Suspended - Payment Pending' : saved.status,
            lastAlert: isPaused ? 'Access paused due to outstanding account balance · Payment Required' : saved.last_alert,
            paused: isPaused,
            ...(saved.project ? { project: saved.project as StudentProject } : {}),
            ...(saved.relay_channels ? { relayChannels: saved.relay_channels as 4 | 6 | 8 } : {})
          };
        }));
      }
    };
    void load();
    return () => { disposed = true; };
  }, [user]);

  // Load all customer devices across Supabase when Admin is signed in
  const loadAllCustomerDevices = useCallback(async () => {
    if (!relaySupabase || !isAdmin) return;
    setCustomerDevicesLoading(true);
    try {
      const { data, error } = await relaySupabase
        .from('gkb_user_devices')
        .select('user_id, device_key, device_name, status, last_alert, project, relay_channels');
      if (error) throw error;
      if (data) {
        const storedSuspended = (() => {
          try {
            return (JSON.parse(window.localStorage.getItem('gkb-suspended-client-keys') || '[]') as string[]);
          } catch {
            return [];
          }
        })();

        const suspendedFromDb = data
          .filter(r => r.status?.toLowerCase().includes('suspend') || r.status?.toLowerCase().includes('pause'))
          .map(r => r.device_key.toUpperCase());

        const merged = Array.from(new Set([...storedSuspended, ...suspendedFromDb]));
        setSuspendedCustomerKeys(merged);
        try {
          window.localStorage.setItem('gkb-suspended-client-keys', JSON.stringify(merged));
        } catch (e) {
          console.error(e);
        }

        setAllCustomerDevices(data.map((row, idx) => {
          const isPaused = row.status?.toLowerCase().includes('suspend') ||
                           row.status?.toLowerCase().includes('pause') ||
                           merged.some(k => k.toUpperCase() === row.device_key.toUpperCase());
          return {
            id: idx + 5000,
            userId: row.user_id,
            key: row.device_key,
            name: row.device_name,
            status: isPaused ? 'Suspended - Payment Pending' : (row.status || 'Online'),
            lastAlert: row.last_alert || (isPaused ? 'Access suspended due to outstanding account balance · Payment Required' : 'Active telemetry'),
            project: row.project as StudentProject | undefined,
            relayChannels: row.relay_channels as 4 | 6 | 8 | undefined,
            paused: isPaused
          };
        }));
      }
    } catch (err) {
      console.error('Failed to load all customer devices:', err);
    } finally {
      setCustomerDevicesLoading(false);
    }
  }, [relaySupabase, isAdmin]);

  useEffect(() => {
    if (isAdmin) {
      void loadAllCustomerDevices();
    }
  }, [isAdmin, loadAllCustomerDevices]);

  // Link device by key
  const handleConnectKey = (keyToUse: string) => {
    const key = keyToUse.trim();
    if (!key) return;
    const formatted = key.toUpperCase();
    const found = devices.find(d =>
      d.key.toUpperCase() === formatted ||
      d.legacyKeys?.some(k => k.toUpperCase() === formatted)
    );

    const isSuspended = Boolean(
      (found && found.paused) ||
      suspendedCustomerKeys.some(k => k.toUpperCase() === formatted)
    );

    if (isSuspended && !isAdmin) {
      const targetDev = found || {
        id: Date.now(),
        name: `GKB Hardware Device (${key})`,
        key: key,
        status: 'Suspended - Payment Pending',
        lastAlert: 'Account balance pending · Access locked by GKB Administrator',
        paused: true
      };
      setPaymentModalDevice(targetDev);
      setLinkMessage(`⛔ Access Suspended: Hardware system "${targetDev.name}" [${key}] is currently locked due to an outstanding account balance.`);
      setLinkMessageIsError(true);
      return;
    }

    if (found) {
      setSelectedDevice(found);
      setActiveTab('dashboard');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const generic: Device = {
        id: Date.now(),
        name: `GKB Hardware Device (${key})`,
        key: key,
        status: 'Online',
        lastAlert: 'Telemetry active · custom device connected'
      };
      setSelectedDevice(generic);
      setActiveTab('dashboard');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleLinkDeviceSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLinkMessage('');
    setLinkMessageIsError(false);
    setLinkBusy(true);

    const pairingKey = inputKey.trim();
    const formatted = pairingKey.toUpperCase();
    const found = devices.find(d =>
      d.key.toUpperCase() === formatted ||
      d.legacyKeys?.some(k => k.toUpperCase() === formatted)
    );
    const isSuspended = Boolean(
      (found && found.paused) ||
      suspendedCustomerKeys.some(k => k.toUpperCase() === formatted)
    );
    if (isSuspended && !isAdmin) {
      const targetDev = found || {
        id: Date.now(),
        name: `GKB Hardware Device (${pairingKey})`,
        key: pairingKey,
        status: 'Suspended - Payment Pending',
        lastAlert: 'Account balance pending · Access locked by GKB Administrator',
        paused: true
      };
      setPaymentModalDevice(targetDev);
      setLinkMessage(`⛔ Access Suspended: Hardware system "${targetDev.name}" [${pairingKey}] is currently locked due to an outstanding balance. Payment required to restore telemetry.`);
      setLinkMessageIsError(true);
      setLinkBusy(false);
      return;
    }
    const target = found || {
      id: Date.now(),
      name: `GKB Hardware Device (${pairingKey})`,
      key: pairingKey,
      status: 'Online',
      lastAlert: 'Device linked'
    };

    if (user && relaySupabase) {
      try {
        const { error } = await relaySupabase.from('gkb_user_devices').upsert({
          user_id: user.id,
          device_key: target.key,
          device_name: target.name,
          status: target.status,
          last_alert: target.lastAlert,
          project: target.project ?? null,
          relay_channels: target.relayChannels ?? null
        }, { onConflict: 'user_id,device_key' });
        if (error) throw error;
        setLinkedDevices(prev => prev.some(d => d.key === target.key) ? prev : [...prev, target]);
        setLinkMessage(`"${target.name}" linked successfully to your account.`);
      } catch (err) {
        setLinkMessage(err instanceof Error ? err.message : 'Could not link device.');
        setLinkMessageIsError(true);
      }
    } else {
      setLinkedDevices(prev => prev.some(d => d.key === target.key) ? prev : [...prev, target]);
      setLinkMessage(`"${target.name}" connected in browser profile. Sign in to sync across devices.`);
    }

    setLinkBusy(false);
    setSelectedDevice(target);
    setActiveTab('dashboard');
  };

  // Auth actions
  const handleLoginSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoginError('');
    setLoginMessage('');
    if (!relaySupabase) {
      setLoginError(relaySupabaseConfigError || 'Supabase not configured.');
      return;
    }
    setLoginBusy(true);
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
          setLoginMessage('Account created! Please check your email to verify your address, then sign in.');
          setCreatingAccount(false);
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
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = async () => {
    if (relaySupabase) await relaySupabase.auth.signOut();
    setUser(null);
    setLinkedDevices([]);
    setActiveTab('devices');
  };

  // Load complaints from Supabase
  const loadComplaints = useCallback(async () => {
    if (!relaySupabase) return;
    setComplaintsLoading(true);
    setComplaintError('');
    try {
      let query = relaySupabase
        .from('gkb_complaints')
        .select('id, user_id, client_email, complaint, solved, created_at')
        .order('created_at', { ascending: false });

      if (user && !isAdmin) {
        query = query.eq('user_id', user.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      setComplaints((data ?? []).map(item => ({
        id: item.id,
        clientId: item.user_id,
        clientEmail: item.client_email,
        text: item.complaint,
        solved: Boolean(item.solved),
        date: new Date(item.created_at).toLocaleDateString()
      })));
    } catch (err) {
      console.error('Failed to load support tickets from Supabase', err);
      setComplaintError(err instanceof Error ? err.message : 'Support tickets could not be loaded.');
    } finally {
      setComplaintsLoading(false);
    }
  }, [user, isAdmin]);

  useEffect(() => {
    void loadComplaints();
  }, [loadComplaints]);

  // Admin toggle complaint resolution
  const toggleComplaintSolved = async (target: Complaint) => {
    if (!relaySupabase || !isAdmin) return;
    const nextSolved = !target.solved;
    try {
      const { error } = await relaySupabase
        .from('gkb_complaints')
        .update({ solved: nextSolved })
        .eq('id', target.id);
      if (error) throw error;
      setComplaints(prev => prev.map(c => c.id === target.id ? { ...c, solved: nextSolved } : c));
    } catch (err) {
      console.error('Failed to update ticket status', err);
      setComplaintError(err instanceof Error ? err.message : 'Failed to update ticket status.');
    }
  };

  // Admin delete complaint
  const handleDeleteComplaint = async (targetId: string) => {
    if (!relaySupabase || !isAdmin) return;
    try {
      const { error } = await relaySupabase
        .from('gkb_complaints')
        .delete()
        .eq('id', targetId);
      if (error) throw error;
      setComplaints(prev => prev.filter(c => c.id !== targetId));
    } catch (err) {
      console.error('Failed to delete ticket', err);
      setComplaintError(err instanceof Error ? err.message : 'Failed to delete ticket.');
    }
  };

  // Admin: Create and deploy new hardware system
  const handleCreateDevice = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDeployError('');
    setDeployMessage('');
    if (!newDevName.trim() || !newDevKey.trim()) {
      setDeployError('Please provide both a system name and a unique special key.');
      return;
    }
    const formattedKey = newDevKey.trim().toUpperCase();
    if (devices.some(d => d.key.toUpperCase() === formattedKey || d.legacyKeys?.map(k => k.toUpperCase()).includes(formattedKey))) {
      setDeployError(`Special key "${formattedKey}" is already registered in the fleet catalogue.`);
      return;
    }

    setDeployBusy(true);
    const newDevice: Device = {
      id: Date.now(),
      name: newDevName.trim(),
      key: formattedKey,
      status: 'Online',
      lastAlert: newDevAlert.trim() || 'System provisioned and active in fleet catalogue.',
      project: newDevProject,
      relayChannels: newDevProject === 'relay-test' ? (Number(newDevChannels) as 4 | 6 | 8) : undefined
    };

    const nextDevices = [newDevice, ...devices];
    setDevices(nextDevices);

    try {
      window.localStorage.setItem('gkb-devices', JSON.stringify(nextDevices));
      setDeployMessage(`✅ System "${newDevice.name}" [${newDevice.key}] deployed to live fleet catalogue!`);
    } catch (err) {
      console.error('Could not save to localStorage', err);
      setDeployError('Device deployed for this session, but local browser cache was not saved.');
    }

    if (user && relaySupabase) {
      try {
        await relaySupabase
          .from('gkb_user_devices')
          .upsert({
            user_id: user.id,
            device_key: newDevice.key,
            device_name: newDevice.name,
            status: newDevice.status,
            last_alert: newDevice.lastAlert,
            project: newDevice.project,
            relay_channels: newDevice.relayChannels
          });
      } catch (err) {
        console.warn('Optional Supabase cloud sync warning:', err);
      }
    }

    setNewDevName('');
    setNewDevKey('');
    setNewDevAlert('');
    setDeployBusy(false);
  };

    // Admin: Toggle Pause / Resume Access for Customer Device
  const handleToggleCustomerDevicePause = async (targetKey: string, currentStatus?: string) => {
    if (!isAdmin) return;
    const formattedKey = targetKey.trim().toUpperCase();
    const isCurrentlyPaused = Boolean(
      (currentStatus && (currentStatus.toLowerCase().includes('suspend') || currentStatus.toLowerCase().includes('pause'))) ||
      suspendedCustomerKeys.some(k => k.toUpperCase() === formattedKey)
    );
    const nextPaused = !isCurrentlyPaused;
    const nextStatus = nextPaused ? 'Suspended - Payment Pending' : 'Online';
    const nextAlert = nextPaused
      ? 'Access suspended due to outstanding account balance · Payment Required'
      : 'Payment verified · Access restored by GKB Administrator';

    // 1. Update suspended keys in state & localStorage
    let nextSuspendedKeys: string[];
    if (nextPaused) {
      nextSuspendedKeys = Array.from(new Set([...suspendedCustomerKeys, formattedKey]));
    } else {
      nextSuspendedKeys = suspendedCustomerKeys.filter(k => k.toUpperCase() !== formattedKey);
    }
    setSuspendedCustomerKeys(nextSuspendedKeys);
    try {
      window.localStorage.setItem('gkb-suspended-client-keys', JSON.stringify(nextSuspendedKeys));
    } catch (e) {
      console.error(e);
    }

    // 2. Update allCustomerDevices state
    setAllCustomerDevices(prev => prev.map(d => {
      if (d.key.toUpperCase() === formattedKey) {
        return { ...d, paused: nextPaused, status: nextStatus, lastAlert: nextAlert };
      }
      return d;
    }));

    // 3. Update fleet devices state if key matches
    setDevices(prev => {
      const updated = prev.map(d => {
        if (d.key.toUpperCase() === formattedKey || d.legacyKeys?.map(k => k.toUpperCase()).includes(formattedKey)) {
          return { ...d, paused: nextPaused, status: nextStatus, lastAlert: nextAlert };
        }
        return d;
      });
      try {
        window.localStorage.setItem('gkb-devices', JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return updated;
    });

    // 4. Update linkedDevices state
    setLinkedDevices(prev => prev.map(d => {
      if (d.key.toUpperCase() === formattedKey) {
        return { ...d, paused: nextPaused, status: nextStatus, lastAlert: nextAlert };
      }
      return d;
    }));

    // 5. Update selectedDevice if currently open
    if (selectedDevice && selectedDevice.key.toUpperCase() === formattedKey) {
      setSelectedDevice(prev => prev ? { ...prev, paused: nextPaused, status: nextStatus, lastAlert: nextAlert } : null);
    }

    // 6. Update Supabase gkb_user_devices table
    if (relaySupabase) {
      try {
        await relaySupabase
          .from('gkb_user_devices')
          .update({ status: nextStatus, last_alert: nextAlert })
          .eq('device_key', targetKey);
      } catch (e) {
        console.warn('Supabase customer device pause sync warning:', e);
      }
    }

    setDeployMessage(nextPaused
      ? `⛔ Device key "${formattedKey}" has been PAUSED (Payment Hold). Customer access is locked.`
      : `✅ Device key "${formattedKey}" has been RESTORED. Full customer access reactivated.`);
  };

  // Admin: Unlink Customer Device from Platform
  const handleUnlinkCustomerDevice = async (targetKey: string, targetUserId: string) => {
    if (!isAdmin) return;
    if (!window.confirm(`Are you sure you want to unlink device key "${targetKey}" from customer account?`)) {
      return;
    }
    setAllCustomerDevices(prev => prev.filter(d => !(d.key.toUpperCase() === targetKey.toUpperCase() && d.userId === targetUserId)));
    if (relaySupabase) {
      try {
        await relaySupabase
          .from('gkb_user_devices')
          .delete()
          .eq('device_key', targetKey)
          .eq('user_id', targetUserId);
      } catch (e) {
        console.warn('Supabase customer device unlink warning:', e);
      }
    }
    setDeployMessage(`🗑️ Device key "${targetKey}" unlinked from customer account.`);
  };

  // Admin: Quick Freeze / Unfreeze by Key
  const handleQuickPauseSubmit = (action: 'pause' | 'restore') => {
    if (!isAdmin || !quickPauseKey.trim()) return;
    const formatted = quickPauseKey.trim().toUpperCase();
    const currentPaused = suspendedCustomerKeys.some(k => k.toUpperCase() === formatted);
    if (action === 'pause' && currentPaused) {
      setDeployMessage(`ℹ️ Device key "${formatted}" is already marked as paused.`);
      return;
    }
    if (action === 'restore' && !currentPaused) {
      setDeployMessage(`ℹ️ Device key "${formatted}" is not currently paused.`);
      return;
    }
    void handleToggleCustomerDevicePause(formatted, action === 'pause' ? 'Online' : 'Suspended');
    setQuickPauseKey('');
  };

  // Admin: Inspect Device in Dashboard with Administrative Override
  const handleAdminInspectDevice = (target: CustomerDevice) => {
    const inspectDev: Device = {
      id: typeof target.id === 'number' ? target.id : Date.now(),
      name: target.name,
      key: target.key,
      status: target.status,
      lastAlert: target.lastAlert,
      project: target.project,
      relayChannels: target.relayChannels,
      paused: target.paused
    };
    setSelectedDevice(inspectDev);
    setActiveTab('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Admin: Toggle Pause / Resume Access for any device
  const handleTogglePauseDevice = async (deviceKey: string) => {
    if (!isAdmin) return;
    const target = devices.find(d => d.key === deviceKey);
    if (!target) return;
    const nextPaused = !target.paused;
    const nextStatus = nextPaused ? 'Paused' : 'Online';
    const nextAlert = nextPaused
      ? 'Access administratively paused by GKB Admin.'
      : 'Access restored by GKB Admin · Online';

    const nextDevices = devices.map(d => {
      if (d.key === deviceKey) {
        return {
          ...d,
          paused: nextPaused,
          status: nextStatus,
          lastAlert: nextAlert
        };
      }
      return d;
    });

    setDevices(nextDevices);
    try {
      window.localStorage.setItem('gkb-devices', JSON.stringify(nextDevices));
    } catch (e) {
      console.error(e);
    }

    if (selectedDevice && selectedDevice.key === deviceKey) {
      setSelectedDevice(prev => prev ? { ...prev, paused: nextPaused, status: nextStatus, lastAlert: nextAlert } : null);
    }

    if (relaySupabase && user) {
      try {
        await relaySupabase
          .from('gkb_user_devices')
          .update({ status: nextStatus, last_alert: nextAlert })
          .eq('device_key', deviceKey);
      } catch (e) {
        console.warn('Supabase device status sync warning:', e);
      }
    }

    setDeployMessage(nextPaused
      ? `⏸️ Access to "${target.name}" [${target.key}] has been PAUSED.`
      : `▶️ Access to "${target.name}" [${target.key}] has been RESTORED.`);
  };

  // Admin: Permanently Delete Device from Fleet
  const handleDeleteDevice = async (deviceKey: string) => {
    if (!isAdmin) return;
    const target = devices.find(d => d.key === deviceKey);
    const targetName = target?.name ?? deviceKey;
    if (!window.confirm(`Are you sure you want to permanently delete "${targetName}" [${deviceKey}] from the fleet catalogue?`)) {
      return;
    }

    const nextDevices = devices.filter(d => d.key !== deviceKey);
    setDevices(nextDevices);

    try {
      const deletedKeys = JSON.parse(window.localStorage.getItem('gkb-deleted-device-keys') || '[]') as string[];
      if (!deletedKeys.includes(deviceKey)) {
        deletedKeys.push(deviceKey);
        window.localStorage.setItem('gkb-deleted-device-keys', JSON.stringify(deletedKeys));
      }
      window.localStorage.setItem('gkb-devices', JSON.stringify(nextDevices));
    } catch (e) {
      console.error(e);
    }

    setLinkedDevices(prev => prev.filter(d => d.key !== deviceKey));

    if (selectedDevice && selectedDevice.key === deviceKey) {
      setSelectedDevice(null);
      setActiveTab('devices');
    }

    if (relaySupabase) {
      try {
        await relaySupabase
          .from('gkb_user_devices')
          .delete()
          .eq('device_key', deviceKey);
      } catch (e) {
        console.warn('Supabase device delete warning:', e);
      }
    }

    setDeployMessage(`🗑️ Device "${targetName}" [${deviceKey}] has been permanently deleted from the fleet.`);
  };

  // Admin: Restore Factory Fleet Catalogue
  const handleResetDefaultDevices = () => {
    if (!isAdmin) return;
    if (!window.confirm('Reset fleet catalogue back to factory defaults? Any custom added devices will be retained.')) {
      return;
    }
    window.localStorage.removeItem('gkb-deleted-device-keys');
    const stored = window.localStorage.getItem('gkb-devices');
    const saved = stored ? (JSON.parse(stored) as Device[]) : [];
    const custom = saved.filter(d => !defaultDevices.some(def => def.key === d.key));
    const restored = [...defaultDevices, ...custom];
    setDevices(restored);
    try {
      window.localStorage.setItem('gkb-devices', JSON.stringify(restored));
    } catch (e) {
      console.error(e);
    }
    setDeployMessage('🔄 Factory default hardware fleet has been restored.');
  };

  // Submit support ticket
  const handleSubmitComplaint = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newComplaintText.trim()) return;
    if (!user || !relaySupabase) {
      setComplaintError('Sign in with a client account to submit a hardware support ticket.');
      return;
    }
    setComplaintBusy(true);
    setComplaintError('');
    try {
      const { data, error } = await relaySupabase
        .from('gkb_complaints')
        .insert({
          user_id: user.id,
          client_email: user.email,
          complaint: newComplaintText.trim(),
          solved: false
        })
        .select()
        .single();
      if (error) throw error;
      setComplaints(prev => [{
        id: data.id,
        clientId: data.user_id,
        clientEmail: data.client_email,
        text: data.complaint,
        solved: false,
        date: new Date().toLocaleDateString()
      }, ...prev]);
      setNewComplaintText('');
    } catch (err) {
      setComplaintError(err instanceof Error ? err.message : 'Failed to submit ticket.');
    } finally {
      setComplaintBusy(false);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500 selection:text-black relative overflow-x-hidden ${isLightMode ? 'theme-light' : ''}`}>
      {/* Background Cyberpunk Glows */}
      <div className={`absolute inset-0 bg-[linear-gradient(to_right,#1e1b4b15_1px,transparent_1px),linear-gradient(to_bottom,#1e1b4b15_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none ${isLightMode ? 'hidden' : ''}`} />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="relative z-50 border-b border-cyan-500/30 bg-slate-950/80 backdrop-blur-md sticky top-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-2">
          {/* Brand */}
          <div className="flex min-w-0 items-center space-x-2 sm:space-x-3 cursor-pointer" onClick={() => setActiveTab('devices')}>
            <img
              src="/gkb-company-logo.png"
              alt="GKB Technologies logo"
              className="h-12 w-12 shrink-0 rounded-lg object-cover shadow-[0_0_15px_rgba(6,182,212,0.2)]"
            />
            <div>
              <h1 className="truncate text-sm sm:text-lg font-black tracking-wider bg-gradient-to-r from-cyan-400 via-purple-300 to-purple-500 bg-clip-text text-transparent">
                GKB IOT DEVICE CLOUD
              </h1>
              <p className="hidden sm:block text-[10px] text-cyan-400/70 tracking-widest uppercase">Hardware Telemetry & Control • Built Beyond Limits</p>
            </div>
          </div>

          {/* Nav */}
          <nav aria-label="Main navigation" className="hidden md:flex items-center space-x-1">
            <button
              type="button"
              onClick={() => setActiveTab('devices')}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'devices' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.3)]' : 'text-slate-400 hover:text-cyan-300'}`}
            >
              Hardware Fleet
            </button>
            {selectedDevice && (
              <button
                type="button"
                onClick={() => setActiveTab('dashboard')}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'dashboard' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.3)]' : 'text-slate-400 hover:text-cyan-300'}`}
              >
                Live Dashboard ({selectedDevice.name.split(' ')[0]})
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('support')}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'support' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.3)]' : 'text-slate-400 hover:text-cyan-300'}`}
            >
              Device Support
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('contact')}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'contact' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.3)]' : 'text-slate-400 hover:text-cyan-300'}`}
            >
              Contact
            </button>
          </nav>

          {/* Right actions */}
          <div className="flex shrink-0 items-center space-x-2 sm:space-x-3">
            <button
              type="button"
              onClick={() => setIsLightMode(!isLightMode)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-slate-900 px-2.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-cyan-400 hover:text-cyan-300 sm:px-3"
            >
              {isLightMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              <span className="hidden sm:inline">{isLightMode ? 'Dark' : 'Light'}</span>
            </button>

            {user ? (
              <div className={`flex items-center space-x-2 sm:space-x-3 bg-slate-900 px-2.5 sm:px-3.5 py-1.5 rounded-lg border ${
                (user.role === 'admin' || user.email?.toLowerCase() === 'zumkel023@gmail.com')
                  ? 'border-amber-500/40 bg-amber-500/5 shadow-[0_0_15px_rgba(245,158,11,0.15)]'
                  : 'border-purple-500/30'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  (user.role === 'admin' || user.email?.toLowerCase() === 'zumkel023@gmail.com')
                    ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-pulse'
                    : 'bg-emerald-400 animate-ping'
                }`} />
                {(user.role === 'admin' || user.email?.toLowerCase() === 'zumkel023@gmail.com') ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold font-mono tracking-wider text-amber-300">
                    <Shield className="w-3.5 h-3.5 text-amber-400 fill-amber-400/20" />
                    Admin
                  </span>
                ) : (
                  <span className="text-xs text-purple-300 font-mono truncate max-w-[72px] sm:max-w-[120px]">{user.email}</span>
                )}
                <button
                  type="button"
                  onClick={handleLogout}
                  className="text-slate-400 hover:text-red-400 transition-colors pl-1"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLoginModalOpen(true)}
                className="px-3 sm:px-4 py-2 rounded-lg font-bold text-xs tracking-wider uppercase bg-gradient-to-r from-cyan-500 to-purple-600 text-black shadow-[0_0_20px_rgba(6,182,212,0.4)] hover:shadow-[0_0_25px_rgba(168,85,247,0.6)] transition-all"
              >
                Sign In
              </button>
            )}
          </div>
        </div>

        {/* Mobile Nav */}
        <nav className="flex md:hidden gap-1 overflow-x-auto border-t border-slate-800/70 px-3 py-2">
          <button
            type="button"
            onClick={() => setActiveTab('devices')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${activeTab === 'devices' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}
          >
            Hardware Fleet
          </button>
          {selectedDevice && (
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${activeTab === 'dashboard' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}
            >
              Dashboard
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab('support')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${activeTab === 'support' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}
          >
            {isAdmin ? `Complaints (${complaints.filter(c => !c.solved).length})` : 'Support'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('contact')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${activeTab === 'contact' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40' : 'text-slate-400'}`}
          >
            Contact
          </button>
        </nav>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8">
        {/* ================= HARDWARE FLEET VIEW ================= */}
        {activeTab === 'devices' && (
          <div className="space-y-8 animate-fadeIn">
            {/* Quick Connect Hero */}
            <section className="rounded-3xl border border-cyan-500/30 bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 p-6 sm:p-10 shadow-[0_0_35px_rgba(6,182,212,0.15)] space-y-5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-cyan-300">
                <Radio className="h-3.5 w-3.5 animate-pulse" /> Direct Hardware Connector
              </span>
              <h2 className="text-3xl sm:text-5xl font-black tracking-tight text-white leading-tight">
                CONNECT YOUR GKB IOT DEVICE
              </h2>
              <p className="max-w-2xl text-sm sm:text-base text-slate-300 leading-relaxed">
                Enter your device's provisioned special key below to immediately launch its real-time telemetry dashboard, sensor feeds, and relay controls.
              </p>

              {/* Input Key Form */}
              <form onSubmit={handleLinkDeviceSubmit} className="flex max-w-2xl flex-col gap-3 sm:flex-row pt-2">
                <input
                  type="text"
                  placeholder="Enter Special Key (e.g. GKB-SEC-9988, GKB-SPEM-0001…)"
                  value={inputKey}
                  onChange={e => setInputKey(e.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white focus:border-cyan-400 focus:outline-none"
                  required
                />
                <button
                  type="submit"
                  disabled={linkBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 px-6 py-3 text-sm font-bold uppercase tracking-wider text-black shadow-lg shadow-cyan-500/25 hover:opacity-90 transition-all disabled:opacity-50"
                >
                  <Cpu className="h-4 w-4" />
                  Connect Key
                </button>
              </form>

              {/* Demo Keys Quick Selector Pills */}
              <div className="space-y-2 pt-2">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Quick Test Keys:</p>
                <div className="flex flex-wrap gap-2">
                  {defaultDevices.map(def => (
                    <button
                      key={def.key}
                      type="button"
                      onClick={() => handleConnectKey(def.key)}
                      className="rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1 text-xs font-mono text-cyan-300 hover:border-cyan-400 hover:bg-cyan-500/10 transition-colors"
                    >
                      {def.name.split(' · ')[0]} ({def.key})
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

            {/* Linked Devices Section (if any) */}
            {linkedDevices.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-emerald-400" />
                    My Linked Devices ({linkedDevices.length})
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    Connected to your account profile
                  </span>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {linkedDevices.map(dev => {
                    const isDevicePaused = Boolean(
                      dev.paused ||
                      dev.status?.toLowerCase().includes('suspend') ||
                      dev.status?.toLowerCase().includes('pause') ||
                      suspendedCustomerKeys.some(k => k.toUpperCase() === dev.key.toUpperCase())
                    );
                    return (
                      <article
                        key={dev.id}
                        className={`flex flex-col justify-between p-5 rounded-2xl border transition-all gap-4 ${
                          isDevicePaused
                            ? 'border-red-500/40 bg-red-950/20 shadow-[0_0_20px_rgba(239,68,68,0.15)]'
                            : 'border-purple-500/30 bg-slate-900/60'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-mono uppercase tracking-wider text-purple-300">
                              Key: {dev.key}
                            </span>
                            {isDevicePaused ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-300 bg-red-500/20 border border-red-500/40 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                                <AlertCircle className="h-3 w-3 text-red-400" /> Payment Hold
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300 bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                                <CheckCircle className="h-3 w-3 text-emerald-400" /> Active
                              </span>
                            )}
                          </div>
                          <h4 className="text-base font-bold text-white mt-1.5">{dev.name}</h4>
                          <p className={`text-xs mt-1 ${isDevicePaused ? 'text-red-300/90 font-medium' : 'text-slate-400'}`}>
                            {isDevicePaused ? '⚠️ Account balance pending. Remote telemetry & controls locked by GKB Administrator.' : dev.lastAlert}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                          {isDevicePaused && !isAdmin ? (
                            <button
                              type="button"
                              onClick={() => setPaymentModalDevice(dev)}
                              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-red-500/20 border border-red-500/50 px-4 py-2.5 text-xs font-bold text-red-200 hover:bg-red-500/30 transition-all shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                            >
                              <CreditCard className="h-4 w-4 text-red-400" />
                              Payment Required · View Details
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDevice(dev);
                                setActiveTab('dashboard');
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-purple-500/20 border border-purple-500/50 px-4 py-2.5 text-xs font-bold text-purple-200 hover:bg-purple-500/30 transition-all"
                            >
                              {isDevicePaused && isAdmin ? 'Admin Override · Open Console' : 'Launch Dashboard'}
                              <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ================= ADMIN: CUSTOMER HARDWARE ACCOUNTS & BILLING DESK ================= */}
            {isAdmin && (
              <section className="rounded-3xl border border-red-500/40 bg-gradient-to-r from-slate-900 via-slate-900/95 to-slate-950 p-6 sm:p-8 shadow-[0_0_35px_rgba(239,68,68,0.12)] space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
                  <div className="flex items-center gap-3">
                    <span className="p-3 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400">
                      <CreditCard className="h-6 w-6" />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl sm:text-2xl font-black text-white">
                          Customer Accounts & Billing Desk
                        </h3>
                        <span className="text-[10px] font-mono uppercase tracking-wider text-red-400 bg-red-500/10 border border-red-500/30 px-2.5 py-0.5 rounded-full font-bold">
                          Admin Control
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1">
                        Pause customer access when installation or hardware balance is unpaid. Restore instant access upon payment confirmation.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadAllCustomerDevices()}
                    disabled={customerDevicesLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 hover:border-cyan-400 hover:text-cyan-300 transition-all shrink-0 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${customerDevicesLoading ? 'animate-spin' : ''}`} />
                    {customerDevicesLoading ? 'Syncing…' : 'Refresh Devices'}
                  </button>
                </div>

                {/* Quick Freeze by Device Key */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5 text-amber-400" /> Quick Device Key Freeze / Unfreeze
                    </label>
                    <span className="text-[10px] text-slate-400">
                      Target any hardware special key instantly
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      placeholder="Enter Device Key (e.g. GKB-SEC-0001, GKB-WTR-4412)…"
                      value={quickPauseKey}
                      onChange={e => setQuickPauseKey(e.target.value.toUpperCase())}
                      className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 font-mono text-xs text-amber-300 placeholder:text-slate-500 focus:border-red-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleQuickPauseSubmit('pause')}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-red-500 transition-all shadow-md shadow-red-600/20"
                    >
                      <PauseCircle className="h-4 w-4" /> Pause Access (Payment Hold)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickPauseSubmit('restore')}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 transition-all shadow-md shadow-emerald-600/20"
                    >
                      <PlayCircle className="h-4 w-4" /> Restore Access (Paid)
                    </button>
                  </div>
                </div>

                {/* Metrics Stats Row */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-center">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Customer Units</p>
                    <p className="text-xl sm:text-2xl font-black text-white mt-0.5">{allCustomerDevices.length}</p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-emerald-500/20 text-center">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">Active & Paid</p>
                    <p className="text-xl sm:text-2xl font-black text-emerald-400 mt-0.5">
                      {allCustomerDevices.filter(d => !d.paused).length}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-red-500/20 text-center">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-red-400">Payment Holds</p>
                    <p className="text-xl sm:text-2xl font-black text-red-400 mt-0.5">
                      {allCustomerDevices.filter(d => d.paused).length + suspendedCustomerKeys.length}
                    </p>
                  </div>
                </div>

                {/* Search & Filter Bar */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                  <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setCustomerFilter('all')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        customerFilter === 'all' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      All ({allCustomerDevices.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomerFilter('active')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        customerFilter === 'active' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Active ({allCustomerDevices.filter(d => !d.paused).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomerFilter('suspended')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        customerFilter === 'suspended' ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Suspended ({allCustomerDevices.filter(d => d.paused).length})
                    </button>
                  </div>

                  <input
                    type="text"
                    placeholder="Search by key, name, or customer ID…"
                    value={customerSearch}
                    onChange={e => setCustomerSearch(e.target.value)}
                    className="w-full sm:w-64 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                </div>

                {/* Customer Device Cards Grid */}
                {allCustomerDevices.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center space-y-2">
                    <p className="text-xs text-slate-400">
                      No customer-linked devices currently registered in Supabase.
                    </p>
                    <p className="text-[11px] text-slate-500">
                      You can still use the Quick Device Key Freeze tool above to lock any specific prototype key (e.g. GKB-SEC-0001) before or after it is paired.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {allCustomerDevices
                      .filter(d => {
                        if (customerFilter === 'active') return !d.paused;
                        if (customerFilter === 'suspended') return d.paused;
                        return true;
                      })
                      .filter(d => {
                        if (!customerSearch.trim()) return true;
                        const q = customerSearch.toLowerCase();
                        return (
                          d.key.toLowerCase().includes(q) ||
                          d.name.toLowerCase().includes(q) ||
                          d.userId.toLowerCase().includes(q)
                        );
                      })
                      .map(dev => (
                        <article
                          key={dev.id}
                          className={`flex flex-col justify-between p-5 rounded-2xl border transition-all gap-4 ${
                            dev.paused
                              ? 'border-red-500/40 bg-slate-900/80 shadow-[0_0_20px_rgba(239,68,68,0.1)]'
                              : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-bold">
                                Key: {dev.key}
                              </span>
                              {dev.paused ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-300 bg-red-500/20 border border-red-500/40 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                                  <AlertCircle className="h-3 w-3 text-red-400" /> Suspended · Payment Hold
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300 bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                                  <CheckCircle className="h-3 w-3 text-emerald-400" /> Active · Operational
                                </span>
                              )}
                            </div>
                            <h4 className="text-base font-bold text-white mt-1.5">{dev.name}</h4>
                            <p className="text-xs text-slate-400 mt-1 line-clamp-2">{dev.lastAlert}</p>
                            <p className="text-[10px] font-mono text-slate-500 mt-2 truncate">
                              Customer ID: {dev.userId}
                            </p>
                          </div>

                          <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => void handleToggleCustomerDevicePause(dev.key, dev.status)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                dev.paused
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25'
                                  : 'bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25'
                              }`}
                              title={dev.paused ? 'Restore customer access' : 'Pause customer access for non-payment'}
                            >
                              {dev.paused ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                              <span>{dev.paused ? 'Restore Access (Paid)' : 'Pause Access (Non-Payment)'}</span>
                            </button>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleAdminInspectDevice(dev)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-cyan-300 border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 transition-all"
                                title="Inspect device telemetry with administrative override"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                <span>Inspect</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleUnlinkCustomerDevice(dev.key, dev.userId)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-red-400 border border-slate-800 hover:border-red-500/30 transition-all"
                                title="Unlink this device from customer account"
                              >
                                <Unlink className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                  </div>
                )}
              </section>
            )}

                        {/* Admin: Deploy New Hardware System to Fleet */}
            {isAdmin && (
              <section className="rounded-3xl border border-amber-500/40 bg-gradient-to-r from-slate-900 via-slate-900/95 to-slate-950 p-6 sm:p-8 shadow-[0_0_30px_rgba(245,158,11,0.12)] space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <span className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                      <Server className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="text-xl sm:text-2xl font-black text-white">
                        Deploy New Hardware System to Fleet
                      </h3>
                      <p className="text-xs text-slate-300 mt-0.5">
                        Register newly deployed ESP32/Arduino prototypes and assign special provisioning keys.
                      </p>
                    </div>
                  </div>
                  <span className="self-start sm:self-auto text-[10px] font-mono uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-md font-bold">
                    Admin Provisioning Desk
                  </span>
                </div>

                <form onSubmit={handleCreateDevice} className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                        System / Prototype Name *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Smart Cold Storage Monitor"
                        value={newDevName}
                        onChange={e => setNewDevName(e.target.value)}
                        required
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                        Special Provisioning Key *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. GKB-COLD-0001"
                        value={newDevKey}
                        onChange={e => setNewDevKey(e.target.value.toUpperCase())}
                        required
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-xs text-amber-300 focus:border-amber-400 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                        Dashboard & Sensor Profile *
                      </label>
                      <select
                        value={newDevProject}
                        onChange={e => setNewDevProject(e.target.value as StudentProject)}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none"
                      >
                        <option value="smart-security-system">Smart Home Security & GSM Intrusion Dialer</option>
                        <option value="prepaid-energy-meter">Prepaid Smart Energy Meter (STS Token)</option>
                        <option value="fuel-tank-monitor">Fuel Tank & Generator Telemetry</option>
                        <option value="water-tank-monitor">Water Tank Level & Automated Pump</option>
                        <option value="alcohol-breathalyzer">MQ-3 Alcohol Breathalyzer & Ignition Interlock</option>
                        <option value="fan-regulator">Triac AC Fan Speed Regulator</option>
                        <option value="light-control">IoT Light & Dimmer Controller</option>
                        <option value="relay-test">Multi-Channel Relay Controller</option>
                      </select>
                    </div>

                    {newDevProject === 'relay-test' && (
                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                          Relay Channels
                        </label>
                        <select
                          value={newDevChannels}
                          onChange={e => setNewDevChannels(e.target.value as '4' | '6' | '8')}
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none"
                        >
                          <option value="4">4 Channels</option>
                          <option value="6">6 Channels</option>
                          <option value="8">8 Channels</option>
                        </select>
                      </div>
                    )}

                    <div className={newDevProject === 'relay-test' ? 'sm:col-span-2' : 'sm:col-span-2 lg:col-span-3'}>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                        Initial Telemetry / Location Note
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Zone 4 Server Room · Active Telemetry"
                        value={newDevAlert}
                        onChange={e => setNewDevAlert(e.target.value)}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  </div>

                  {deployError && (
                    <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 p-2.5 rounded-lg">
                      {deployError}
                    </p>
                  )}
                  {deployMessage && (
                    <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 p-2.5 rounded-lg">
                      {deployMessage}
                    </p>
                  )}

                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-800 text-xs">
                    <span className="text-slate-400">Manage hardware prototypes catalogue:</span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleResetDefaultDevices}
                        className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300 transition-colors"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Restore Factory Fleet Defaults
                      </button>
                      <button
                        type="submit"
                        disabled={deployBusy}
                        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-black shadow-lg shadow-amber-500/20 hover:opacity-90 transition-all disabled:opacity-50"
                      >
                        <PlusCircle className="h-4 w-4" />
                        {deployBusy ? 'Deploying…' : 'Deploy Hardware System'}
                      </button>
                    </div>
                  </div>
                </form>
              </section>
            )}

            {/* Hardware Fleet Catalog */}
            <section className="space-y-4">
              <div>
                <h3 className="text-xl font-bold text-white">Supported Hardware Devices</h3>
                <p className="text-xs text-slate-400 mt-1">Select any supported device to launch its real-time telemetry and control dashboard.</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {devices.map(device => (
                  <article
                    key={device.id}
                    className={`flex flex-col justify-between p-5 rounded-2xl border transition-all ${
                      device.paused
                        ? 'border-amber-500/40 bg-slate-900/40 opacity-90 shadow-[0_0_15px_rgba(245,158,11,0.08)]'
                        : 'border-slate-800 bg-slate-900/60 hover:border-cyan-500/40 hover:shadow-[0_0_20px_rgba(6,182,212,0.15)]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-bold">{device.key}</span>
                          {device.project && (
                            <span className="text-[9px] font-mono text-purple-300 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.2 rounded">
                              {device.project.replace(/-/g, ' ')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {device.paused ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
                              <PauseCircle className="h-3 w-3 text-amber-400" /> Access Paused
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Online
                            </span>
                          )}
                        </div>
                      </div>
                      <h4 className="text-base font-bold text-white mt-2">{device.name}</h4>
                      <p className="text-xs text-slate-400 mt-1">{device.lastAlert}</p>
                    </div>

                    <div className="space-y-3 mt-4">
                      {/* Admin Controls Strip: Pause & Delete */}
                      {isAdmin && (
                        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => void handleTogglePauseDevice(device.key)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                              device.paused
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25'
                                : 'bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25'
                            }`}
                            title={device.paused ? 'Unpause & Restore Access' : 'Pause Client Access'}
                          >
                            {device.paused ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                            <span>{device.paused ? 'Resume Access' : 'Pause Access'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleDeleteDevice(device.key)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-red-400 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-all"
                            title="Delete device permanently from fleet"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          if (device.paused && !isAdmin) {
                            alert(`Access to "${device.name}" [${device.key}] is currently suspended by the GKB administrator.`);
                            return;
                          }
                          setSelectedDevice(device);
                          setActiveTab('dashboard');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        disabled={device.paused && !isAdmin}
                        className={`w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all ${
                          device.paused && !isAdmin
                            ? 'border border-slate-800 bg-slate-900/60 text-slate-500 cursor-not-allowed'
                            : 'border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20'
                        }`}
                      >
                        {device.paused && !isAdmin ? (
                          <>
                            <Ban className="h-3.5 w-3.5" /> Access Suspended
                          </>
                        ) : (
                          <>
                            Open Dashboard <ArrowRight className="h-3.5 w-3.5" />
                          </>
                        )}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ================= DASHBOARD VIEW ================= */}
        {activeTab === 'dashboard' && selectedDevice && (
          <div className="space-y-6 animate-fadeIn">
            {/* Top Back Bar */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setActiveTab('devices')}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-xs font-bold text-slate-300 hover:border-cyan-400 hover:text-cyan-300 transition-colors"
              >
                <ArrowRight className="h-4 w-4 rotate-180" />
                Back to Hardware Fleet
              </button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 hidden sm:inline">Active Key:</span>
                <span className="text-xs font-mono font-bold text-cyan-300 bg-slate-900 px-3 py-1 rounded-lg border border-cyan-500/30">
                  {selectedDevice.key}
                </span>
              </div>
            </div>

            {/* Render Dashboard Component */}
            {selectedDevice.paused && !isAdmin ? (
              <div className="rounded-3xl border border-red-500/40 bg-slate-900/95 p-6 sm:p-10 text-center space-y-6 max-w-xl mx-auto my-8 shadow-[0_0_50px_rgba(239,68,68,0.2)] animate-fadeIn">
                <div className="h-18 w-18 mx-auto rounded-3xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 p-4">
                  <AlertCircle className="h-10 w-10 text-red-500" />
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-red-400 bg-red-500/10 border border-red-500/30 px-3 py-1 rounded-full font-bold">
                    Access Suspended · Payment Hold
                  </span>
                  <h3 className="text-2xl sm:text-3xl font-black text-white mt-3">
                    HARDWARE ACCESS LOCKED
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-300 mt-2 max-w-md mx-auto">
                    Access to <strong>{selectedDevice.name}</strong> [Key: <code className="text-amber-300">{selectedDevice.key}</code>] has been temporarily paused by GKB Technologies due to an outstanding installation or subscription balance.
                  </p>
                </div>

                {/* Mobile Money Box */}
                <div className="rounded-2xl border border-amber-500/30 bg-slate-950 p-5 text-left space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                      <CreditCard className="h-4 w-4 text-amber-400" /> Official Payment Details
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded font-bold">
                      Instant Verification
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Network:</span>
                      <span className="font-bold text-white">MTN Mobile Money (Ghana)</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">MoMo Number:</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-black text-amber-300 text-sm">0256905290</span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText('0256905290');
                            setCopiedPayment(true);
                            setTimeout(() => setCopiedPayment(false), 2000);
                          }}
                          className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-bold text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                        >
                          {copiedPayment ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Account Name:</span>
                      <span className="font-bold text-white">Zumah Kelvin / GKB Technologies</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Reference:</span>
                      <span className="font-mono font-bold text-cyan-300">{selectedDevice.key}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <a
                    href={`https://wa.me/233256905290?text=${encodeURIComponent(`Hello GKB Technologies, I am making payment for my device "${selectedDevice.name}" [Key: ${selectedDevice.key}]. Here is my payment receipt to restore access.`)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-xs font-bold text-black hover:bg-emerald-400 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                  >
                    <MessageSquare className="h-4 w-4" /> Send MoMo Receipt on WhatsApp (+233 256905290)
                  </a>
                  <a
                    href="tel:+233256905290"
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-xs font-bold text-slate-200 hover:border-cyan-400 hover:text-cyan-300 transition-all"
                  >
                    <PhoneCall className="h-4 w-4" /> Call GKB Billing Desk
                  </a>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveTab('devices')}
                  className="px-5 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <ArrowRight className="h-4 w-4 rotate-180" /> Return to Hardware Fleet
                </button>
              </div>) : selectedDevice.project === 'relay-test' || selectedDevice.key === 'GKB-SEC-0001' || selectedDevice.key === 'GKB-RELAY-0001' ? (
              <RelayTestDashboard mode="service" />
            ) : selectedDevice.project === 'fuel-tank-monitor' || selectedDevice.key === 'GKB-IUFT-0001' ? (
              <FuelTankMonitorDashboard mode="service" />
            ) : selectedDevice.project === 'relay-test' || selectedDevice.key === 'GKB-RELAY-0001' ? (
              <RelayTestDashboard mode="service" />
            ) : selectedDevice.project === 'water-tank-monitor' || selectedDevice.key === 'GKB-SWP-0001' || selectedDevice.key === 'GKB-WTR-4412' ? (
              <WaterTankMonitorDashboard mode="service" />
            ) : selectedDevice.project === 'alcohol-breathalyzer' || selectedDevice.key === 'GKB-SAB-0001' ? (
              <AlcoholBreathalyzerDashboard mode="service" />
            ) : selectedDevice.project === 'fan-regulator' || selectedDevice.key === 'GKB-FAN-0001' || selectedDevice.key === 'GKB-SFLC-0001' ? (
              <FanRegulatorDashboard mode="service" device={selectedDevice} />
            ) : selectedDevice.project === 'light-control' || selectedDevice.key?.startsWith('GKB-LIGHT') ? (
              <LightControlDashboard mode="service" device={selectedDevice} />
            ) : selectedDevice.project === 'prepaid-energy-meter' || selectedDevice.key === 'GKB-SPEM-0001' ? (
              <PrepaidEnergyMeterDashboard mode="service" />
            ) : (
              <GenericDeviceDashboard device={selectedDevice} mode="service" />
            )}
          </div>
        )}

        {/* ================= SUPPORT & TICKETS VIEW ================= */}
        {activeTab === 'support' && (
          <div className="max-w-4xl mx-auto space-y-8 animate-fadeIn">
            {isAdmin ? (
              /* ================= ADMIN COMPLAINTS REVIEW CENTER ================= */
              <section className="rounded-3xl border border-amber-500/30 bg-slate-900/90 p-6 sm:p-8 shadow-[0_0_35px_rgba(245,158,11,0.12)] space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-amber-300">
                      <Shield className="h-3.5 w-3.5" /> Admin Complaints Desk
                    </span>
                    <h3 className="text-2xl sm:text-3xl font-black text-white mt-2">
                      Client Complaints & Support Center
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-300 mt-1">
                      Review support tickets submitted by clients, diagnose issues, and check off resolutions.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadComplaints()}
                    disabled={complaintsLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-bold text-slate-200 hover:border-cyan-400 hover:text-cyan-300 transition-all shrink-0 disabled:opacity-50"
                  >
                    <Activity className={`h-4 w-4 ${complaintsLoading ? 'animate-spin' : ''}`} />
                    {complaintsLoading ? 'Refreshing…' : 'Refresh Tickets'}
                  </button>
                </div>

                {/* Stat Counters */}
                <div className="grid grid-cols-3 gap-3 sm:gap-4">
                  <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 text-center">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Total Tickets</p>
                    <p className="text-2xl sm:text-3xl font-black text-white mt-1">{complaints.length}</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-950/80 border border-amber-500/20 text-center">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-amber-400">Pending Review</p>
                    <p className="text-2xl sm:text-3xl font-black text-amber-300 mt-1">
                      {complaints.filter(c => !c.solved).length}
                    </p>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-950/80 border border-emerald-500/20 text-center">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">Resolved</p>
                    <p className="text-2xl sm:text-3xl font-black text-emerald-300 mt-1">
                      {complaints.filter(c => c.solved).length}
                    </p>
                  </div>
                </div>

                {/* Filter Tabs */}
                <div className="flex gap-2 border-b border-slate-800 pb-3">
                  {(['all', 'pending', 'resolved'] as const).map(tab => {
                    const count = tab === 'all'
                      ? complaints.length
                      : tab === 'pending'
                        ? complaints.filter(c => !c.solved).length
                        : complaints.filter(c => c.solved).length;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setComplaintFilter(tab)}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                          complaintFilter === tab
                            ? 'bg-amber-500 text-black shadow-md shadow-amber-500/20'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {tab === 'all' ? 'All Tickets' : tab === 'pending' ? 'Pending' : 'Resolved'} ({count})
                      </button>
                    );
                  })}
                </div>

                {complaintError && (
                  <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 p-3 rounded-lg">
                    {complaintError}
                  </p>
                )}

                {/* Ticket Cards List */}
                <div className="space-y-3">
                  {complaintsLoading && (
                    <p className="text-sm text-slate-400 text-center py-8">Loading client tickets from Supabase…</p>
                  )}
                  {!complaintsLoading && complaints.length === 0 && (
                    <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl">
                      <CheckCircle className="h-10 w-10 text-emerald-400 mx-auto opacity-40 mb-2" />
                      <p className="text-sm font-bold text-white">No complaints or support tickets in queue</p>
                      <p className="text-xs text-slate-500 mt-1">When clients report hardware issues or ask questions, they will appear here.</p>
                    </div>
                  )}
                  {complaints
                    .filter(t => complaintFilter === 'all' ? true : complaintFilter === 'pending' ? !t.solved : t.solved)
                    .map(t => (
                      <article
                        key={t.id}
                        className={`p-5 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                          t.solved
                            ? 'bg-slate-950/40 border-slate-900 opacity-75'
                            : 'bg-slate-950 border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.06)]'
                        }`}
                      >
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-xs font-mono font-bold text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded">
                              <Mail className="w-3 h-3 text-cyan-400" />
                              {t.clientEmail || 'Client'}
                            </span>
                            <span className="text-[11px] font-mono text-slate-400">
                              • {t.date}
                            </span>
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                              t.solved ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                            }`}>
                              {t.solved ? 'Resolved' : 'Pending Review'}
                            </span>
                          </div>
                          <p className="text-sm text-slate-200 leading-relaxed font-sans pt-1">
                            {t.text}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => void toggleComplaintSolved(t)}
                            className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all ${
                              t.solved
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/20'
                                : 'bg-gradient-to-r from-amber-500 to-yellow-500 text-black hover:opacity-90 shadow-md shadow-amber-500/20'
                            }`}
                          >
                            {t.solved ? <CheckSquare className="w-4 h-4 text-emerald-400" /> : <Square className="w-4 h-4" />}
                            <span>{t.solved ? 'Resolved (Click to Reopen)' : 'Mark as Solved'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm('Delete this support ticket permanently?')) {
                                void handleDeleteComplaint(t.id);
                              }
                            }}
                            className="p-2 rounded-xl border border-slate-800 text-slate-400 hover:border-red-500/40 hover:text-red-400 transition-colors"
                            title="Delete Ticket"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </article>
                    ))}
                </div>
              </section>
            ) : null}

            {/* Ticket Submission (Always available for clients; or for admin test reporting) */}
            <section className="rounded-3xl border border-cyan-500/30 bg-slate-900/80 p-6 sm:p-8 space-y-6">
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-cyan-400">Technical Support</span>
                <h3 className="text-2xl font-black text-white mt-1">
                  {isAdmin ? 'Submit Diagnostic Ticket or Issue Report' : 'Hardware Diagnostic & Ticket System'}
                </h3>
                <p className="text-xs text-slate-300 mt-2">
                  Experiencing firmware issues, relay faults, or Wi-Fi connectivity problems? Submit a ticket for direct engineer assistance.
                </p>
              </div>

              {complaintError && (
                <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 p-3 rounded-lg">
                  {complaintError}
                </p>
              )}

              <form onSubmit={handleSubmitComplaint} className="space-y-4">
                <label className="block text-xs text-slate-300">
                  Detailed Issue Description (Device Key, observed behavior, pins used)
                  <textarea
                    rows={4}
                    value={newComplaintText}
                    onChange={e => setNewComplaintText(e.target.value)}
                    required
                    placeholder="Describe what happened: e.g. PIR sensor false triggers on Zone 1, relay clicks but load does not power..."
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm text-white focus:border-cyan-400 focus:outline-none"
                  />
                </label>
                <button
                  type="submit"
                  disabled={complaintBusy}
                  className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-black shadow-lg shadow-cyan-500/20 hover:bg-cyan-400 transition-all disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {complaintBusy ? 'Submitting…' : 'Submit Support Ticket'}
                </button>
              </form>

              {/* Submitted Tickets (Client view) */}
              {!isAdmin && complaints.length > 0 && (
                <div className="border-t border-slate-800 pt-6 space-y-3">
                  <h4 className="text-sm font-bold text-white">Your Submitted Tickets</h4>
                  <div className="space-y-2">
                    {complaints.map(t => (
                      <div key={t.id} className="p-3 rounded-xl border border-slate-800 bg-slate-950/60 text-xs">
                        <div className="flex justify-between text-slate-400">
                          <span>{t.date}</span>
                          <span className={t.solved ? 'text-emerald-400' : 'text-amber-400'}>{t.solved ? 'Resolved' : 'Pending Review'}</span>
                        </div>
                        <p className="mt-1 text-white">{t.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ================= CONTACT VIEW ================= */}
        {activeTab === 'contact' && (
          <div className="max-w-3xl mx-auto space-y-8 animate-fadeIn">
            <div className="rounded-3xl border border-cyan-500/30 bg-slate-900/80 p-8 shadow-xl space-y-6">
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-cyan-400">GKB IoT Engineering Team</span>
                <h2 className="text-2xl sm:text-3xl font-black text-white mt-1">IoT Hardware Lab & Technical Support</h2>
                <p className="text-sm text-slate-300 mt-2">Need hardware provisioning, ESP32 pairing keys, or industrial telemetry setup?</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-1">
                  <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase">
                    <Phone className="h-4 w-4" /> Direct Hardware Line
                  </div>
                  <p className="text-lg font-black text-white">0552117787</p>
                  <p className="text-xs text-slate-400">IoT Lab WhatsApp: Active</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-1">
                  <div className="flex items-center gap-2 text-purple-400 text-xs font-bold uppercase">
                    <Mail className="h-4 w-4" /> Firmware & Cloud
                  </div>
                  <p className="text-base font-bold text-white">zumkel023@gmail.com</p>
                  <p className="text-xs text-slate-400">Telemetry API & MQTT</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-8 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} GKB Technologies IoT Cloud. Built Beyond Limits.</p>
          <div className="flex gap-4 text-slate-400">
            <button type="button" onClick={() => setActiveTab('devices')} className="hover:text-cyan-300">Fleet</button>
            <button type="button" onClick={() => setActiveTab('support')} className="hover:text-cyan-300">Support</button>
            <button type="button" onClick={() => setActiveTab('contact')} className="hover:text-cyan-300">Contact</button>
          </div>
        </div>
      </footer>

      {/* Payment Resolution Modal for Suspended Customer Devices */}
      {paymentModalDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="relative w-full max-w-lg rounded-3xl border border-red-500/50 bg-slate-900 p-6 sm:p-8 shadow-[0_0_50px_rgba(239,68,68,0.25)] space-y-6">
            <button
              type="button"
              onClick={() => setPaymentModalDevice(null)}
              className="absolute top-4 right-4 rounded-xl border border-slate-700 bg-slate-800/80 p-2 text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="text-center space-y-2">
              <div className="h-16 w-16 mx-auto rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
                <AlertCircle className="h-8 w-8 text-red-500" />
              </div>
              <span className="text-[10px] font-mono font-bold tracking-widest text-red-400 uppercase bg-red-500/10 border border-red-500/20 px-3 py-1 rounded-full">
                Access Suspended · Payment Required
              </span>
              <h3 className="text-xl sm:text-2xl font-black text-white">
                Hardware Service Locked
              </h3>
              <p className="text-xs sm:text-sm text-slate-300">
                Access to <strong>{paymentModalDevice.name}</strong> [Key: <code className="text-amber-300">{paymentModalDevice.key}</code>] has been temporarily paused by GKB Technologies due to an outstanding installation or subscription balance.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-500/30 bg-slate-950 p-4 space-y-3 text-left">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4 text-amber-400" /> Official Payment Details
                </span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded font-bold">
                  Instant Verification
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Network:</span>
                  <span className="font-bold text-white">MTN Mobile Money (Ghana)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">MoMo Number:</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-amber-300 text-sm">0256905290</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText('0256905290');
                        setCopiedPayment(true);
                        setTimeout(() => setCopiedPayment(false), 2000);
                      }}
                      className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-bold text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                    >
                      {copiedPayment ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Account Name:</span>
                  <span className="font-bold text-white">Zumah Kelvin / GKB Technologies</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Reference:</span>
                  <span className="font-mono font-bold text-cyan-300">{paymentModalDevice.key}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <a
                href={`https://wa.me/233256905290?text=${encodeURIComponent(`Hello GKB Technologies, I am paying for my device "${paymentModalDevice.name}" [Key: ${paymentModalDevice.key}]. Here is my payment receipt to restore access.`)}`}
                target="_blank"
                rel="noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-xs font-bold text-black hover:bg-emerald-400 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)]"
              >
                <MessageSquare className="h-4 w-4" /> Send MoMo Receipt on WhatsApp (+233 256905290)
              </a>

              <a
                href="tel:+233256905290"
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-xs font-bold text-slate-200 hover:border-cyan-400 hover:text-cyan-300 transition-all"
              >
                <PhoneCall className="h-4 w-4" /> Call GKB Billing Desk
              </a>
            </div>

            <p className="text-[11px] text-center text-slate-400">
              Once your payment is verified by our administrator, full telemetry, relay automation, and sensor monitoring are restored immediately.
            </p>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {loginModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-md rounded-2xl border border-cyan-500/40 bg-slate-900 p-6 sm:p-8 shadow-[0_0_50px_rgba(6,182,212,0.3)] space-y-5 animate-scaleUp">
            <div className="text-center space-y-1">
              <h3 className="text-xl font-black text-white">
                {creatingAccount ? 'Create Device Account' : 'Sign In to Device Portal'}
              </h3>
              <p className="text-xs text-slate-400">
                Sign in to save linked devices and persist hardware pairing to your account.
              </p>
            </div>

            {loginError && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 p-3 rounded-lg">{loginError}</p>}
            {loginMessage && <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 p-3 rounded-lg">{loginMessage}</p>}

            <form onSubmit={handleLoginSubmit} className="space-y-4 text-xs">
              {creatingAccount && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-slate-400">
                    First Name
                    <input type="text" value={signupFirstName} onChange={e => setSignupFirstName(e.target.value)} required className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-white text-sm focus:border-cyan-400 focus:outline-none" />
                  </label>
                  <label className="text-slate-400">
                    Last Name
                    <input type="text" value={signupLastName} onChange={e => setSignupLastName(e.target.value)} required className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-white text-sm focus:border-cyan-400 focus:outline-none" />
                  </label>
                </div>
              )}

              <label className="block text-slate-400">
                Email Address
                <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required placeholder="name@example.com" className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 text-white text-sm focus:border-cyan-400 focus:outline-none" />
              </label>

              <label className="block text-slate-400">
                Password
                <input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} required minLength={6} placeholder="••••••••" className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 text-white text-sm focus:border-cyan-400 focus:outline-none" />
              </label>

              <button
                type="submit"
                disabled={loginBusy}
                className="w-full py-3 bg-gradient-to-r from-cyan-500 to-purple-600 text-black font-bold rounded-lg text-sm shadow-[0_0_15px_rgba(6,182,212,0.4)] hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {loginBusy ? 'Working…' : creatingAccount ? 'Create Account' : 'Sign In'}
              </button>
            </form>

            <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => { setCreatingAccount(!creatingAccount); setLoginError(''); setLoginMessage(''); }}
                className="text-cyan-300 hover:text-cyan-200"
              >
                {creatingAccount ? 'Already registered? Sign in' : "New user? Create account"}
              </button>
              <button type="button" onClick={() => setLoginModalOpen(false)} className="text-slate-500 hover:text-slate-300">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
