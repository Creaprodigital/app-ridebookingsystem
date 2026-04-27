# SharedRide Driver — Mobile App (Expo)

## Overview
Application mobile Expo React Native pour chauffeurs VTC, consommant le backend existant RideBookingSystem (`https://shared-ride-pool.emergent.host`).

## Architecture
- **Frontend only**: Expo SDK 54 + expo-router (file-based navigation).
- **Backend consumed**: `https://shared-ride-pool.emergent.host/api/*` (FastAPI multi-tenant). No local backend used (the default /app/backend remains untouched).
- **Storage**: expo-secure-store (native) / localStorage (web) for JWT bearer token.
- **Maps**: Google Maps JS via WebView with custom dark style + Advanced Markers (key: AIzaSyDVwowfZPXY4JW1UD1bdEZAqZQiCZzSdEY).

## Screens
1. **Login** (`/login`) — email + password → `POST /api/auth/login` → `access_token` stored.
2. **Home / Map** (`/(tabs)/index`) — Live GPS (expo-location), online/offline shift toggle (`PATCH /api/driver/shift`), pushes location every 10 s while on shift (`POST /api/driver/location`), shows counts of assigned/available.
3. **Missions** (`/(tabs)/missions`) — Two tabs:
   - **Mes missions** → `GET /api/driver/missions`.
   - **Disponibles** → `GET /api/driver/internal-marketplace` with claim button → `POST /api/driver/internal-marketplace/{id}/claim`.
4. **Mission detail** (`/mission/[id]`) — Map with pickup/dropoff markers, price, route, passenger call, "Open navigation" (deep link to Google/Apple Maps), and slide-to-confirm button that advances status through:
   - `assigned → en_route → arrived → in_progress → completed` via `PATCH /api/driver/missions/{id}/status`.
5. **Earnings** (`/(tabs)/earnings`) — `GET /api/driver/wallet` with balance, today/week breakdown, and transactions list.
6. **Profile** (`/(tabs)/profile`) — `GET /api/driver/profile`, logout.

## Design
Dark Command Center theme based on `design_guidelines.json` (primary `#F5B72E` on `#0A0A0A`).

## Environment Variables
- `EXPO_PUBLIC_API_BASE=https://shared-ride-pool.emergent.host`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSyDVwowfZPXY4JW1UD1bdEZAqZQiCZzSdEY`

## Notes
- Registration is not exposed in the driver app: drivers are provisioned by fleet operators via the existing pro web app.
- MongoDB is not accessed directly from the mobile app — all operations go through the backend's REST API.
