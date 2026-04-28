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
