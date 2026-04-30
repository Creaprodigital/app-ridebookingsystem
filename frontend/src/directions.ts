// Google Directions API helper used to draw route polylines on the
// mission detail screen. Caches results in memory so repeated focuses on
// the same screen don't re-hit the API.
//
// Notes:
//   • The encoded polyline is a Google polyline-algorithm string that the
//     Maps JavaScript API can render natively via google.maps.geometry
//     .encoding.decodePath. We pass the encoded string directly to the
//     WebView and decode there, which is faster and ~10× smaller than
//     sending the decoded array.
//   • The API key is the same one that already powers the map tiles.

const KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string;

export type LatLng = { lat: number; lng: number };

export type DirectionsResult = {
  encoded: string;        // encoded polyline
  distanceMeters: number;
  durationSec: number;
};

const cache = new Map<string, DirectionsResult>();

function key(o: LatLng, d: LatLng): string {
  return `${o.lat.toFixed(5)},${o.lng.toFixed(5)}->${d.lat.toFixed(5)},${d.lng.toFixed(5)}`;
}

/**
 * Fetches a driving route from Google Directions API.
 * Returns null on failure (no key, network error, ZERO_RESULTS, etc.).
 */
export async function fetchRoute(
  origin: LatLng,
  destination: LatLng,
  opts?: { signal?: AbortSignal }
): Promise<DirectionsResult | null> {
  if (!KEY) return null;
  if (!origin || !destination) return null;
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return null;
  if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) return null;

  const k = key(origin, destination);
  const cached = cache.get(k);
  if (cached) return cached;

  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${origin.lat},${origin.lng}` +
    `&destination=${destination.lat},${destination.lng}` +
    `&mode=driving&alternatives=false&key=${KEY}`;
  try {
    const res = await fetch(url, { signal: opts?.signal });
    const json: any = await res.json();
    if (json?.status !== 'OK' || !json.routes?.length) return null;
    const route = json.routes[0];
    const encoded: string = route?.overview_polyline?.points;
    if (!encoded) return null;
    const leg = route?.legs?.[0];
    const distanceMeters = Number(leg?.distance?.value ?? 0);
    const durationSec = Number(leg?.duration?.value ?? 0);
    const out: DirectionsResult = { encoded, distanceMeters, durationSec };
    cache.set(k, out);
    return out;
  } catch {
    return null;
  }
}

/**
 * Drops cached entries so a forced refresh re-hits the API.
 * Useful when the driver position has moved significantly while the
 * leg-1 polyline is still rendering.
 */
export function clearDirectionsCache() {
  cache.clear();
}

export function fmtDistanceKm(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export function fmtDurationMin(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '—';
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m}` : `${h} h`;
}
