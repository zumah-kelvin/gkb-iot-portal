# GKB Technologies — IoT Device Portal

Dedicated client and enterprise hardware dashboard for connecting, monitoring, and controlling smart IoT devices.

## Features
- **Key-Based Device Connection**: Clients enter their hardware's unique device license key (e.g., `GKB-SEC-9988`, `GKB-SPEM-0001`, `GKB-SWP-0001`, `GKB-IUFT-0001`, `GKB-SAB-0001`, `GKB-FAN-0001`, `GKB-LIGHT-0001V1`, `GKB-RELAY-0001`) to instantly bind and open their telemetry dashboard.
- **Dedicated Telemetry Dashboards**:
  1. **Smart Home Security System**: Motion detection monitoring with blinking visual alarm, status logs, arm/disarm toggle, and Web Audio siren/buzzer.
  2. **8/6/4-Channel Smart Relay Control**: Individual channel toggles with real-time Supabase state sync and ping telemetry.
  3. **Fuel Tank Monitor**: Real-time ultrasonic fuel level, volume in liters, refuel history, and leak alerts.
  4. **Overhead Water Tank Monitor**: Dual-tank depth sensor readings, water pump automation, and dry-run protection.
  5. **Prepaid Smart Energy Meter**: Voltage, current, power factor, kWh usage tracking, and top-up token recharge.
  6. **Smart Alcohol Breathalyzer**: Blood Alcohol Content (BAC) sensor readings, sobriety status indicators, and threshold logs.
  7. **Smart Fan Regulator**: Speed presets, timer mode, and RPM telemetry.
  8. **Smart Lighting System**: Room brightness levels, RGB scheduling, and automation rules.
- **Client Device Registry**: Save multiple paired devices to local storage and switch between them seamlessly.
- **Direct Support / Troubleshooting Ticket Submission**: Instant client assistance for hardware deployment and antenna/relay calibration.

## Local Setup & Development

```bash
npm install
npm run dev
```

Build for production:
```bash
npm run build
npm run preview
```

## Environment Configuration (`.env`)
```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
```

## Independent Netlify Deployment

1. Initialize git and push to a new GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit for GKB IoT Device Portal"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/gkb-iot-portal.git
   git push -u origin main
   ```
2. In the Netlify Dashboard:
   - Click **Add new site → Import an existing project**.
   - Select the `gkb-iot-portal` GitHub repository.
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Add environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Click **Deploy Site**.
