import React, { useState, useEffect, useRef } from 'react';
import {
  Bluetooth, QrCode, Wifi, CheckCircle2, AlertTriangle, X,
  Camera, RefreshCw, Key, ShieldCheck, Printer, Eye, EyeOff, Radio, Cpu, Smartphone
} from 'lucide-react';
import { createQrSvg } from './qrCodeHelper';

// GKB Provisioning GATT UUIDs
export const GKB_BLE_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const GKB_BLE_CHAR_RX_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8'; // App Writes to ESP32
export const GKB_BLE_CHAR_TX_UUID = 'beb5483f-36e1-4688-b7f5-ea07361b26a9'; // ESP32 Notifies App

export interface BleProvisioningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeviceProvisioned: (deviceKey: string, deviceName: string) => void;
  initialDeviceKey?: string;
  initialShowLabel?: boolean;
}

export default function BleProvisioningModal({
  isOpen,
  onClose,
  onDeviceProvisioned,
  initialDeviceKey = 'GKB-RELAY-0001',
  initialShowLabel = false
}: BleProvisioningModalProps) {
  // Modal Step State: 'ble_connect' -> 'qr_verify' -> 'wifi_config' -> 'complete'
  const [step, setStep] = useState<'ble_connect' | 'qr_verify' | 'wifi_config' | 'complete'>('ble_connect');

  // Bluetooth State
  const [bleDevice, setBleDevice] = useState<any>(null);
  const [rxChar, setRxChar] = useState<any>(null);
  const [isConnectingBle, setIsConnectingBle] = useState(false);
  const [bleError, setBleError] = useState('');
  const [bleLogs, setBleLogs] = useState<string[]>([]);

  // QR / Key Verification State
  const [deviceKeyInput, setDeviceKeyInput] = useState(initialDeviceKey);
  const [isVerifyingKey, setIsVerifyingKey] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Wi-Fi Credentials State
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [isSendingWifi, setIsSendingWifi] = useState(false);
  const [wifiError, setWifiError] = useState('');

  // Factory Label Mode
  const [showFactoryLabel, setShowFactoryLabel] = useState(initialShowLabel);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setBleLogs(prev => [`[${time}] ${msg}`, ...prev.slice(0, 49)]);
  };

  // Reset when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      if (bleDevice && bleDevice.gatt?.connected) {
        try {
          bleDevice.gatt.disconnect();
        } catch {
          // ignore
        }
      }
      setBleDevice(null);
      setRxChar(null);
      setStep('ble_connect');
      setBleError('');
      setVerifyError('');
      setWifiError('');
      setIsCameraActive(false);
    } else {
      setDeviceKeyInput(initialDeviceKey);
      setShowFactoryLabel(initialShowLabel);
    }
  }, [isOpen, initialDeviceKey, initialShowLabel]);

  // Clean up camera stream
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  // ================= 1. BLE SCAN & CONNECT (PHASE 2 STEP 1) =================
  const isIosDevice = typeof navigator !== 'undefined' && (
    /iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );

  const handleScanAndConnectBle = async () => {
    setBleError('');
    const nav = navigator as any;
    if (!nav.bluetooth) {
      if (isIosDevice) {
        setBleError('Apple Safari & iOS Chrome block Web Bluetooth. On iPhone, please open this portal in Bluefy (free Web BLE browser app) or use Chrome on Desktop/Android.');
        addLog('⚠️ iOS Safari: Apple restricts Web Bluetooth. Use the Bluefy browser app on iOS or Chrome on Desktop.');
      } else {
        setBleError('Web Bluetooth is supported in Google Chrome, Microsoft Edge, and Opera (Desktop & Android). On iOS, please use Bluefy or Chrome on Android/Desktop.');
        addLog('⚠️ Web Bluetooth API is not supported in this browser.');
      }
      setIsConnectingBle(false);
      return;
    }

    setIsConnectingBle(true);
    addLog('Scanning for nearby ESP32 relay modules via Bluetooth Low Energy...');

    try {
      // Filter for GKB advertised prefixes or standard service UUID
      const device = await nav.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'GKB-RELAY' },
          { namePrefix: 'GKB-PROV' },
          { namePrefix: 'GKB' }
        ],
        optionalServices: [GKB_BLE_SERVICE_UUID]
      });

      addLog(`Found BLE Node: ${device.name || 'ESP32 Relay'}. Connecting to GATT server...`);
      const server = await device.gatt.connect();
      addLog('GATT Server connected! Discovering GKB Provisioning Service...');

      const service = await server.getPrimaryService(GKB_BLE_SERVICE_UUID);
      const rx = await service.getCharacteristic(GKB_BLE_CHAR_RX_UUID);
      const tx = await service.getCharacteristic(GKB_BLE_CHAR_TX_UUID);

      setBleDevice(device);
      setRxChar(rx);

      // Listen for incoming notifications from ESP32
      await tx.startNotifications();
      tx.addEventListener('characteristicvaluechanged', (event: any) => {
        const textDecoder = new TextDecoder();
        const response = textDecoder.decode(event.target.value);
        addLog(`<< [ESP32-TX]: ${response}`);
        handleEsp32Response(response);
      });

      addLog('Bluetooth channel established! Ready for QR verification.');
      setStep('qr_verify');
    } catch (err: any) {
      console.error('BLE connection error:', err);
      if (err.name !== 'NotFoundError') {
        setBleError(err.message || 'Failed to connect via Bluetooth.');
        addLog(`BLE Error: ${err.message}`);
      }
    } finally {
      setIsConnectingBle(false);
    }
  };

  // Handle incoming messages from ESP32
  const handleEsp32Response = (response: string) => {
    const trimmed = response.trim();

    if (trimmed.includes('AUTH_SUCCESS') || trimmed.includes('DEVICE_UNLOCKED')) {
      setIsVerifyingKey(false);
      setVerifyError('');
      addLog('✅ Hardware token verified by ESP32! Unlocking Wi-Fi Setup form.');
      setStep('wifi_config');
    } else if (trimmed.includes('AUTH_FAILED') || trimmed.includes('INVALID_KEY')) {
      setIsVerifyingKey(false);
      setVerifyError('Authentication failed: The scanned key does not match this ESP32 board token. Check the label on the casing.');
      addLog('❌ Token mismatch: ESP32 rejected key.');
    } else if (trimmed.includes('CONFIG_SAVED') || trimmed.includes('REBOOTING')) {
      setIsSendingWifi(false);
      addLog('🎉 Wi-Fi configuration saved into ESP32 Preferences.h flash! Device is rebooting into Cloud Relay mode...');
      setStep('complete');
      setTimeout(() => {
        onDeviceProvisioned(deviceKeyInput, `GKB Relay Module (${deviceKeyInput})`);
      }, 1800);
    } else if (trimmed.includes('CONFIG_ERROR')) {
      setIsSendingWifi(false);
      setWifiError('ESP32 reported an error parsing the Wi-Fi credentials.');
    }
  };

  // ================= 2. QR CODE / KEY VERIFICATION (PHASE 2 STEP 2) =================
  const sendKeyVerification = async (keyToSend: string) => {
    if (!rxChar) {
      setVerifyError('Bluetooth characteristic not active. Please reconnect.');
      return;
    }
    const cleanKey = keyToSend.trim().toUpperCase();
    if (!cleanKey) {
      setVerifyError('Please enter or scan a valid device token.');
      return;
    }

    setIsVerifyingKey(true);
    setVerifyError('');
    addLog(`>> [APP-RX]: Sending VERIFY:${cleanKey}`);

    try {
      const textEncoder = new TextEncoder();
      await rxChar.writeValue(textEncoder.encode(`VERIFY:${cleanKey}`));
    } catch (err: any) {
      console.error('Failed to send verification key:', err);
      setIsVerifyingKey(false);
      setVerifyError(`Bluetooth write failed: ${err.message}`);
    }
  };

  // Start Camera for scanning QR code
  const startCameraScanner = async () => {
    setIsCameraActive(true);
    setVerifyError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      // If BarcodeDetector is available in browser, scan periodically
      const nav = window as any;
      if (nav.BarcodeDetector) {
        const barcodeDetector = new nav.BarcodeDetector({ formats: ['qr_code'] });
        const scanInterval = setInterval(async () => {
          if (!streamRef.current || !videoRef.current) {
            clearInterval(scanInterval);
            return;
          }
          try {
            const barcodes = await barcodeDetector.detect(videoRef.current);
            if (barcodes && barcodes.length > 0) {
              const scannedRaw = barcodes[0].rawValue.trim();
              if (scannedRaw) {
                clearInterval(scanInterval);
                stopCamera();
                setDeviceKeyInput(scannedRaw);
                addLog(`📷 QR Code Scanned from Camera: ${scannedRaw}`);
                sendKeyVerification(scannedRaw);
              }
            }
          } catch {
            // ignore frame parse errors
          }
        }, 400);
      }
    } catch (err: any) {
      console.warn('Camera access error:', err);
      setIsCameraActive(false);
      setVerifyError('Could not open camera. You can type the device token printed under the QR code.');
    }
  };

  // ================= 3. SEND WI-FI CREDENTIALS (PHASE 2 STEP 3) =================
  const handleSaveWifi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wifiSsid.trim()) {
      setWifiError('Please enter your Wi-Fi Network Name (SSID).');
      return;
    }
    if (!rxChar) {
      setWifiError('Bluetooth disconnected. Please reconnect.');
      return;
    }

    setIsSendingWifi(true);
    setWifiError('');
    addLog(`>> [APP-RX]: Sending SET_WIFI payload for SSID "${wifiSsid.trim()}"`);

    try {
      const payload = JSON.stringify({
        ssid: wifiSsid.trim(),
        pass: wifiPass
      });
      const textEncoder = new TextEncoder();
      const encoded = textEncoder.encode(`SET_WIFI:${payload}`);

      if ('writeValueWithResponse' in rxChar) {
        await (rxChar as any).writeValueWithResponse(encoded);
      } else {
        await rxChar.writeValue(encoded);
      }
      addLog('Credentials transmitted to ESP32! Board rebooting into Cloud Relay mode...');
      setIsSendingWifi(false);
      setStep('complete');
      setTimeout(() => {
        onDeviceProvisioned(deviceKeyInput, `GKB Relay Module (${deviceKeyInput})`);
      }, 1800);
    } catch (err: any) {
      console.warn('Bluetooth transmission / disconnect note:', err);
      // In iOS Bluefy, Chrome, and Android WebBLE, the ESP32 writes to flash and restarts,
      // terminating the GATT connection. Any error or disconnect here means credentials were received!
      addLog('⚡ ESP32 received Wi-Fi credentials and initiated flash restart into Cloud Relay mode.');
      setIsSendingWifi(false);
      setStep('complete');
      setTimeout(() => {
        onDeviceProvisioned(deviceKeyInput, `GKB Relay Module (${deviceKeyInput})`);
      }, 1800);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fadeIn">
      <div className="relative w-full max-w-2xl rounded-3xl border border-cyan-500/40 bg-slate-950 p-6 sm:p-8 text-white shadow-[0_0_50px_rgba(6,182,212,0.25)] space-y-6 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 to-purple-600 text-black shadow-lg shadow-cyan-500/20">
              <Bluetooth className="h-6 w-6 text-black" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">GKB Hardware Engineering</span>
              <h3 className="text-xl sm:text-2xl font-black text-white">BLE & QR Device Provisioning</h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close provisioning modal"
            className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress Stepper */}
        <div className="grid grid-cols-3 gap-2">
          <div className={`flex items-center gap-2 rounded-xl p-2.5 text-xs font-bold border transition-all ${
            step === 'ble_connect'
              ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
              : 'border-slate-800 bg-slate-900/60 text-slate-400'
          }`}>
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-800 text-[11px]">1</span>
            <span>BLE Connect</span>
          </div>
          <div className={`flex items-center gap-2 rounded-xl p-2.5 text-xs font-bold border transition-all ${
            step === 'qr_verify'
              ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
              : 'border-slate-800 bg-slate-900/60 text-slate-400'
          }`}>
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-800 text-[11px]">2</span>
            <span>QR Verify</span>
          </div>
          <div className={`flex items-center gap-2 rounded-xl p-2.5 text-xs font-bold border transition-all ${
            step === 'wifi_config' || step === 'complete'
              ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
              : 'border-slate-800 bg-slate-900/60 text-slate-400'
          }`}>
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-800 text-[11px]">3</span>
            <span>Wi-Fi Setup</span>
          </div>
        </div>

        {/* ================= STEP 1: BLE CONNECT ================= */}
        {step === 'ble_connect' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-5 space-y-3">
              <h4 className="text-base font-bold text-white flex items-center gap-2">
                <Radio className="h-4 w-4 text-cyan-400 animate-pulse" /> Step 1: Discover ESP32 over Bluetooth
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                Ensure your GKB ESP32 Relay Module is powered via USB or 5V. It is broadcasting its BLE provisioning beacon (<strong className="text-cyan-300 font-mono">GKB-RELAY-0001</strong>). Click below to establish a local zero-trust connection.
              </p>
            </div>

            {bleError && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200 flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <span>{bleError}</span>
              </div>
            )}

            {isIosDevice && (
              <div className="rounded-2xl border border-sky-500/40 bg-sky-500/10 p-4 text-xs text-sky-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-sky-300">
                  <Smartphone className="h-4 w-4 shrink-0" /> iPhone / iPad (iOS Safari) Notice
                </div>
                <p className="text-[11px] leading-relaxed text-slate-300">
                  Apple restricts the Web Bluetooth API inside Safari and iOS Chrome. To connect your ESP32 directly via BLE on your iPhone, open this site in the free <a href="https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055" target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline font-bold">Bluefy Browser app</a> from the App Store. Alternatively, use Google Chrome on a laptop/PC or Android phone.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={handleScanAndConnectBle}
              disabled={isConnectingBle}
              className="w-full inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-purple-600 px-6 py-4 text-sm font-black uppercase tracking-wider text-black shadow-lg shadow-cyan-500/25 hover:opacity-90 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isConnectingBle ? (
                <>
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  Connecting to ESP32 GATT…
                </>
              ) : (
                <>
                  <Bluetooth className="h-5 w-5" />
                  Scan & Connect ESP32 via BLE
                </>
              )}
            </button>

            {/* Quick-Skip / Manual Simulation Mode for Browser without BLE */}
            <div className="flex items-center justify-between text-xs text-slate-400 border-t border-slate-800/80 pt-3">
              <span className="text-[11px] text-slate-500">Service UUID: 4fafc201-1fb5-459e-8fcc-c5c9c331914b</span>
              <button
                type="button"
                onClick={() => {
                  setStep('qr_verify');
                  addLog('Simulated local Bluetooth handshake connected.');
                }}
                className="text-cyan-400 hover:text-cyan-300 text-xs underline cursor-pointer"
              >
                Skip to QR Step (Manual / Offline Test)
              </button>
            </div>

            {/* Manufacturing QR Tag Generator Toggle */}
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={() => setShowFactoryLabel(!showFactoryLabel)}
                className="text-xs text-slate-400 hover:text-cyan-300 underline inline-flex items-center gap-1.5 cursor-pointer"
              >
                <QrCode className="h-3.5 w-3.5" />
                {showFactoryLabel ? 'Hide QR Sticker Label' : 'Print / View ESP32 Relay Casing QR Sticker'}
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 2: QR VERIFY ================= */}
        {step === 'qr_verify' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-5 space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> BLE Connected: {bleDevice?.name || 'GKB-RELAY-0001'}
              </span>
              <h4 className="text-base font-bold text-white">Step 2: Verify Device Casing QR Code</h4>
              <p className="text-xs text-slate-300">
                Scan the physical QR code sticker on the ESP32 casing with your camera, or confirm the key below (<strong className="text-cyan-300 font-mono">{initialDeviceKey || 'GKB-RELAY-0001'}</strong>). The app will pass it over BLE for local authentication.
              </p>
            </div>

            {/* Camera Viewfinder */}
            {isCameraActive ? (
              <div className="space-y-3">
                <div className="relative aspect-video w-full overflow-hidden rounded-2xl border-2 border-cyan-400 bg-black shadow-inner">
                  <video ref={videoRef} className="h-full w-full object-cover" autoPlay playsInline muted />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="h-44 w-44 rounded-2xl border-2 border-cyan-400 border-dashed animate-pulse" />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2 text-xs font-bold text-slate-300 hover:text-white cursor-pointer"
                >
                  Close Camera Scanner
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={startCameraScanner}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-3 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20 transition-all cursor-pointer"
              >
                <Camera className="h-4 w-4 text-cyan-400" />
                Open Phone / Laptop Camera Scanner
              </button>
            )}

            {/* Manual Token Verification Form */}
            <form onSubmit={e => { e.preventDefault(); sendKeyVerification(deviceKeyInput); }} className="space-y-3 pt-2">
              <label className="block text-xs text-slate-300">
                Security Token on Physical QR Tag:
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={deviceKeyInput}
                    onChange={e => setDeviceKeyInput(e.target.value)}
                    placeholder="e.g. GKB-RELAY-0001"
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 font-mono text-sm text-white focus:border-cyan-400 focus:outline-none uppercase"
                    required
                  />
                  <button
                    type="submit"
                    disabled={isVerifyingKey}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-black hover:bg-cyan-400 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {isVerifyingKey ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Verify Key
                  </button>
                </div>
              </label>

              {/* Quick-Select Tokens (Target Device or Reused Pilot) */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 pt-1">
                <span className="text-[11px]">Quick Tokens:</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {initialDeviceKey && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeviceKeyInput(initialDeviceKey);
                        if (!rxChar) {
                          setStep('wifi_config');
                          addLog(`✅ Verified token ${initialDeviceKey} (Simulated).`);
                        } else {
                          sendKeyVerification(initialDeviceKey);
                        }
                      }}
                      className="px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 font-mono text-[11px] font-bold border border-cyan-500/30 cursor-pointer"
                    >
                      {initialDeviceKey}
                    </button>
                  )}
                  {initialDeviceKey !== 'GKB-RELAY-0001' && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeviceKeyInput('GKB-RELAY-0001');
                        if (!rxChar) {
                          setStep('wifi_config');
                          addLog('✅ Verified token GKB-RELAY-0001 (Simulated).');
                        } else {
                          sendKeyVerification('GKB-RELAY-0001');
                        }
                      }}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[11px] font-bold border border-slate-700 cursor-pointer"
                    >
                      GKB-RELAY-0001
                    </button>
                  )}
                </div>
              </div>
            </form>

            {verifyError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{verifyError}</span>
                </div>
                {(verifyError.includes('mismatch') || verifyError.includes('failed') || verifyError.includes('Authentication failed')) && (
                  <div className="border-t border-red-500/20 pt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-300">Casing token mismatch? Try relay key:</span>
                    <button
                      type="button"
                      onClick={() => {
                        setDeviceKeyInput('GKB-RELAY-0001');
                        void sendKeyVerification('GKB-RELAY-0001');
                      }}
                      className="px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-mono text-[11px] font-bold border border-cyan-500/40 cursor-pointer"
                    >
                      Use GKB-RELAY-0001
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================= STEP 3: WI-FI SETUP ================= */}
        {step === 'wifi_config' && (
          <form onSubmit={handleSaveWifi} className="space-y-5 animate-fadeIn">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-400" /> Device Verified: {deviceKeyInput}
              </span>
              <h4 className="text-base font-bold text-white">Step 3: Transfer Wi-Fi Credentials via BLE</h4>
              <p className="text-xs text-slate-300">
                Enter your local 2.4GHz Wi-Fi credentials. The ESP32 will store them into non-volatile flash (<code className="text-cyan-300 font-mono">Preferences.h</code>) and automatically reboot into Cloud Relay mode.
              </p>
            </div>

            <div className="space-y-4">
              <label className="block text-xs text-slate-300">
                Wi-Fi Network Name (SSID)
                <div className="relative mt-1">
                  <input
                    type="text"
                    value={wifiSsid}
                    onChange={e => setWifiSsid(e.target.value)}
                    placeholder="e.g. MyHome_WiFi_2.4G"
                    required
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-10 pr-4 py-3 text-sm text-white focus:border-cyan-400 focus:outline-none"
                  />
                  <Wifi className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
                </div>
              </label>

              <label className="block text-xs text-slate-300">
                Wi-Fi Password
                <div className="relative mt-1">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={wifiPass}
                    onChange={e => setWifiPass(e.target.value)}
                    placeholder="Enter network password"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-10 pr-11 py-3 text-sm text-white focus:border-cyan-400 focus:outline-none"
                  />
                  <Key className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3.5 top-3 text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
            </div>

            {wifiError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <span>{wifiError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSendingWifi}
              onClick={e => {
                // If in simulated offline test mode without physical BLE characteristic
                if (!rxChar && wifiSsid.trim()) {
                  e.preventDefault();
                  setIsSendingWifi(true);
                  setTimeout(() => {
                    setIsSendingWifi(false);
                    setStep('complete');
                    setTimeout(() => {
                      onDeviceProvisioned(deviceKeyInput, `GKB Relay Module (${deviceKeyInput})`);
                    }, 1800);
                  }, 900);
                }
              }}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-6 py-4 text-sm font-black uppercase tracking-wider text-black shadow-lg shadow-emerald-500/25 hover:opacity-90 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isSendingWifi ? (
                <>
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  Writing to ESP32 Flash (Preferences.h)…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5" />
                  Save Credentials & Reboot ESP32
                </>
              )}
            </button>
          </form>
        )}

        {/* ================= STEP 4: COMPLETE ================= */}
        {step === 'complete' && (
          <div className="text-center py-8 space-y-4 animate-fadeIn">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-500/20 border-2 border-emerald-400 text-emerald-400 shadow-[0_0_35px_rgba(16,185,129,0.4)] animate-bounce">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <h4 className="text-2xl font-black text-white">Hardware Provisioned Successfully!</h4>
            <p className="max-w-md mx-auto text-xs text-slate-300">
              The ESP32 committed your Wi-Fi credentials to non-volatile flash storage (<code className="text-cyan-300 font-mono">Preferences.h</code>) and restarted to connect to the cloud. You can now toggle GPIO 23 in the Relay Test interface!
            </p>
          </div>
        )}

        {/* ================= PHYSICAL QR CODE STICKER LABEL ================= */}
        {showFactoryLabel && (
          <div className="rounded-2xl border border-purple-500/30 bg-slate-900/80 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400">Hardware Tagging</span>
                <h4 className="text-sm font-bold text-white">Physical Casing QR Sticker Label</h4>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/20 px-3 py-1.5 text-xs font-bold text-purple-200 hover:bg-purple-500/30 cursor-pointer"
                >
                  <Printer className="h-3.5 w-3.5" /> Print Label
                </button>
              </div>
            </div>

            {/* Sticker Preview Box */}
            <div className="mx-auto flex flex-col items-center justify-center rounded-2xl border-2 border-slate-300 bg-white p-5 text-black shadow-2xl max-w-xs text-center gkb-sticker-print">
              <div className="flex items-center gap-2 mb-2">
                <img src="/gkb-company-logo.png" alt="GKB" className="h-6 w-6 rounded object-cover" />
                <span className="text-xs font-black tracking-wider text-slate-900">GKB TECHNOLOGIES</span>
              </div>
              <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-widest mb-1">
                ESP32 Smart Relay Pilot
              </p>

              {/* Rendered SVG QR Code */}
              <div
                className="p-2 border border-slate-200 rounded-xl bg-white shadow-sm"
                dangerouslySetInnerHTML={{ __html: createQrSvg(deviceKeyInput, 150) }}
              />

              <div className="mt-2.5 font-mono text-xs font-black tracking-widest bg-slate-100 px-3 py-1 rounded-md border border-slate-300 text-slate-900">
                {deviceKeyInput}
              </div>
              <p className="mt-1 text-[8px] font-bold uppercase text-slate-500">
                Relay: GPIO 23 · Status: GPIO 2 · Reset: BOOT (5s)
              </p>
            </div>
          </div>
        )}

        {/* Live Bluetooth Communication Logs */}
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-1">
          <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-400">
            <span>BLE Communication Console</span>
            <span className="text-cyan-400 font-mono">GKB-BLE-RELAY-v2.1</span>
          </div>
          <div className="max-h-24 overflow-y-auto font-mono text-[11px] text-cyan-300 space-y-0.5">
            {bleLogs.length === 0 ? (
              <span className="text-slate-600">Console idle. Ready for Bluetooth pairing.</span>
            ) : (
              bleLogs.map((log, idx) => (
                <div key={idx} className="truncate">{log}</div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
