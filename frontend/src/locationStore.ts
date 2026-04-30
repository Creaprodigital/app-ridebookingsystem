// Singleton storing the driver's last known GPS coordinates so they can be
// read from any module (ridesContext, RideRequestModal) without re-plumbing
// React props.
//
// Two layers:
//   • In-memory `cached` — fastest, used by everything in foreground.
//   • SecureStore (via prefs) — survives background → foreground transitions
//     (e.g. when the app resumes after being backgrounded). The in-memory
//     cache is rehydrated lazily.

import { prefGet, prefSet } from './prefs';

export type DriverCoords = {
  lat: number;
  lng: number;
  ts: number; // epoch ms
};

const STORAGE_KEY = 'driver_last_coords_v1';
let cached: DriverCoords | null = null;
let hydrated = false;
const listeners: Array<(c: DriverCoords | null) => void> = [];

async function persist(c: DriverCoords | null) {
  try {
    if (!c) await prefSet(STORAGE_KEY, '');
    else await prefSet(STORAGE_KEY, JSON.stringify(c));
  } catch {}
}

export function setLastCoords(c: { lat: number; lng: number } | null) {
  if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) {
    cached = null;
  } else {
    cached = { lat: c.lat, lng: c.lng, ts: Date.now() };
  }
  hydrated = true;
  // fire listeners synchronously
  listeners.forEach((l) => { try { l(cached); } catch {} });
  // persist async (no await)
  void persist(cached);
}

export function getLastCoords(): DriverCoords | null {
  return cached;
}

/**
 * Loads the persisted coords from SecureStore into the in-memory cache.
 * Should be called once at app startup so a recently captured background
 * GPS update is available before the foreground watcher gets its first fix.
 */
export async function hydrateLastCoords(): Promise<DriverCoords | null> {
  if (hydrated) return cached;
  try {
    const raw = await prefGet(STORAGE_KEY, '');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng)) {
        cached = { lat: Number(parsed.lat), lng: Number(parsed.lng), ts: Number(parsed.ts) || Date.now() };
        hydrated = true;
        listeners.forEach((l) => { try { l(cached); } catch {} });
        return cached;
      }
    }
  } catch {}
  hydrated = true;
  return null;
}

export function subscribeCoords(fn: (c: DriverCoords | null) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}
