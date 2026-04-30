/**
 * Helpers to classify rides as "immediate" or "scheduled".
 *
 * Rule (3.a — explicit backend field):
 *   We look at common explicit fields the backend may expose. Fallback to
 *   the pickup time when nothing is found — anything within 30 min from
 *   now is treated as immediate.
 */

const IMMEDIATE_KEYWORDS = [
  'immediate',
  'immediat',
  'immédiat',
  'now',
  'instant',
  'asap',
  'on_demand',
  'ondemand',
  'realtime',
  'live',
];
const SCHEDULED_KEYWORDS = [
  'scheduled',
  'planned',
  'plan',
  'planifie',
  'planifié',
  'planifiée',
  'reservation',
  'réservation',
  'future',
  'later',
  'differe',
  'différé',
];

const IMMEDIATE_WINDOW_MS = 30 * 60 * 1000;

function asString(...candidates: any[]): string {
  for (const c of candidates) {
    if (c == null) continue;
    return String(c).toLowerCase();
  }
  return '';
}

export function isImmediateRide(item: any): boolean {
  if (!item) return false;

  // 1) Explicit boolean flags
  if (
    item.is_immediate === true ||
    item?.booking?.is_immediate === true ||
    item?.immediate === true ||
    item?.is_now === true ||
    item?.booking?.is_now === true
  ) return true;

  if (
    item.is_scheduled === true ||
    item?.booking?.is_scheduled === true ||
    item?.scheduled === true
  ) return false;

  // 2) Explicit string fields ("type", "kind", "mode", "category", "ride_type", "booking_type")
  const tokens = [
    asString(item.type, item?.booking?.type),
    asString(item.kind, item?.booking?.kind),
    asString(item.mode, item?.booking?.mode),
    asString(item.ride_type, item?.booking?.ride_type),
    asString(item.booking_type, item?.booking?.booking_type),
    asString(item.category, item?.booking?.category),
  ].filter(Boolean);

  for (const t of tokens) {
    if (IMMEDIATE_KEYWORDS.some((k) => t.includes(k))) return true;
    if (SCHEDULED_KEYWORDS.some((k) => t.includes(k))) return false;
  }

  // 3) Time-based fallback
  const pickupAt = item?.booking?.pickup_at || item?.pickup_at || item?.scheduled_at;
  if (!pickupAt) return true; // no scheduled time → immediate
  try {
    const t = new Date(pickupAt).getTime();
    if (!Number.isFinite(t)) return true;
    return t - Date.now() <= IMMEDIATE_WINDOW_MS;
  } catch {
    return true;
  }
}

export function isScheduledRide(item: any): boolean {
  return !isImmediateRide(item);
}

// ──────────────────────────────────────────────────────────────────────────
// Distance / ETA helpers (used to filter rides too far away and to display
// the estimated arrival time inside the request modal).
// ──────────────────────────────────────────────────────────────────────────

export function pickPickupCoords(item: any): { lat: number; lng: number } | null {
  const lat =
    item?.booking?.pickup_lat ??
    item?.pickup_lat ??
    item?.pickup?.lat ??
    item?.pickup_location?.lat;
  const lng =
    item?.booking?.pickup_lng ??
    item?.pickup_lng ??
    item?.pickup?.lng ??
    item?.pickup_location?.lng;
  if (lat == null || lng == null) return null;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { lat: a, lng: b };
}

/**
 * Great-circle distance in kilometres between two points.
 */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const aa =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

/**
 * Rough ETA estimate in minutes assuming a 30 km/h average urban speed.
 * Always returns at least 1 to avoid showing "0 min".
 */
export function estimateEtaMin(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 1;
  const min = Math.round((distanceKm / 30) * 60);
  return Math.max(1, min);
}
