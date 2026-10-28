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

## 2026-10-04 — Driver subscription + deployment hardening
- Added Stripe recurring subscription for drivers (saved card, auto monthly debit) with:
  - Full state screen `/subscription` (status badge, next-debit date, manage via Stripe Customer Portal, cancel)
  - UI gate on home: driver cannot go on shift while unpaid (red "ABONNEMENT REQUIS" button + banner)
  - Menu entry "Mon abonnement" with REQUIS / ACTIF status badge
  - 60s background polling + AppState foreground refresh + deep-link listener for `sharedridedriver://subscription/*`
- Moved "Portefeuille" from the bottom tab bar into the Menu
- Replaced the backend stub with a transparent FastAPI → SaaS proxy (`UPSTREAM_API_BASE`), serving `/health` and `/healthz`
- Frontend now reads `EXPO_PUBLIC_BACKEND_URL` first (deploy-rewritable), falls back to `EXPO_PUBLIC_API_BASE`, no hardcoded host
- iOS infoPlist now declares Camera / Microphone / Contacts / Photo Library usage strings
- Dark wallpaper applied to Welcome + Login with 25 % black overlay
- Video splash (3.2 s total: fade-in 250 + visible 2500 + fade-out 450) using H.264 MP4 (native) + VP9 WebM (web)

## Update (Jun 2026) — Pricing uses backend only
- No night/weekend/holiday surcharges: removed surcharge lines from BookingDetailsSheet.
- Pro create booking: removed client-side category multiplier; one backend /public/quote per vehicle category (vehicle_type sent), price shown = backend `final`.
- Fixed getMe() in src/api.ts dropping `tenant` (after app reload tenant was null → no quotes, no tenant Maps key).
- Fix: backend prices per category via `vehicle_category_id` (not `vehicle_type`). Quote + create booking now send vehicle_category_id (vehicle_type kept). STANDARD/VAN now priced with their own rates (e.g. Strasbourg Gare→Airport: 120 € / 209 €).
- Branding: replaced Emergent template icons with RBS logo (icon.png, adaptive-icon.png on white bg, favicon.png) + monochrome notification-icon.png for Android notifications.
- Payment-safety at end of ride (green/orange/red screens): BLOCKED on external backend. Prompt for backend team at /app/memory/backend_payment_prompt.md (GET/POST driver payment endpoints, payment_events, payment_issues, pro resolve). card_onboard => orange "Encaissez XX € par carte". Frontend screens to build once endpoints exist.
- Payment screens: user chose to WAIT for backend deploy before building (checked Jun 2026: /driver/missions/{id}/payment* still 404).
- DONE: End-of-ride payment gate (src/components/EndOfRidePayment.tsx) wired in app/mission/[id].tsx: slide TERMINER → server GET /driver/missions/{id}/payment → green (paid/collected), orange (cash/card, slide J'AI ENCAISSÉ → POST collect w/ idempotency key, then PATCH completed), red (unconfirmed, report issue → finish without collect). Network error → no confirmation, retry. Theme tokens paid*/cash*/alert*.
- Payment screens restyled: black bg always; green/orange/red only on titles, banners, amount, buttons, sliders.
- Maps key: app now calls GET /api/maps/client-key at login/refresh (pro + linked drivers) and applies the tenant key before maps render; falls back to EXPO_PUBLIC_GOOGLE_MAPS_API_KEY if route missing (404 today). Backend prompt: /app/memory/backend_maps_key_prompt.md
