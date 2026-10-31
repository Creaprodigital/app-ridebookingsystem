/**
 * Field pickers + formatters shared by the ride screens. The backend exposes
 * ride data with several shapes (flat or nested under `booking`), so every
 * picker tries the known variants in order.
 */

export function pickAddress(m: any, type: 'pickup' | 'dropoff') {
  const b = m?.booking || {};
  return (
    b[`${type}_address`] ||
    m?.[`${type}_address`] ||
    m?.[type]?.address ||
    m?.[`${type}`] ||
    m?.[`${type}_location`]?.address ||
    (type === 'dropoff' ? 'À disposition' : '—')
  );
}

export function pickDt(m: any) {
  return (
    m?.booking?.pickup_at ||
    m?.pickup_at ||
    m?.scheduled_at ||
    m?.pickup_time ||
    m?.created_at
  );
}

export function pickPax(m: any) {
  return m?.booking?.pax ?? m?.pax ?? m?.passengers ?? m?.passenger_count;
}

export function pickVehicleCategory(m: any) {
  return (
    m?.booking?.vehicle_category_label ||
    m?.vehicle_category_label ||
    m?.booking?.vehicle_category ||
    m?.vehicle_category
  );
}

export function pickAmount(m: any) {
  return (
    m?.amount ??
    m?.pricing?.final ??
    m?.price ??
    m?.fare ??
    m?.total ??
    m?.booking?.price
  );
}

export function pickDistance(m: any) {
  return (
    m?.distance_km ??
    m?.pricing?.distance_km ??
    m?.distance ??
    m?.booking?.distance_km
  );
}

/** "89,00 €" — French formatting; "—" when the value is not a number. */
export function fmtEuro(v: any, decimals = 2) {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} €`;
}

/** "89 €" when the amount is round, "89,50 €" otherwise. */
export function fmtPrice(v: any) {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n)) return '—';
  return fmtEuro(n, Number.isInteger(n) ? 0 : 2);
}

/** Splits "Hôtel X, 25 Av. Y, 75008 Paris" into a title and the remainder. */
export function splitAddress(addr: string): { title: string; detail: string } {
  const s = String(addr || '').trim();
  const i = s.indexOf(',');
  if (i <= 0) return { title: s, detail: '' };
  return { title: s.slice(0, i).trim(), detail: s.slice(i + 1).trim() };
}

export function fmtTime(dt?: string | Date) {
  if (!dt) return '';
  const d = new Date(dt);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Aujourd'hui", "Demain", "Hier" or "sam. 1 nov.". */
export function fmtDay(dt?: string | Date) {
  if (!dt) return '';
  const d = new Date(dt);
  if (!Number.isFinite(d.getTime())) return '';
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return "Aujourd'hui";
  if (sameDay(d, tomorrow)) return 'Demain';
  if (sameDay(d, yesterday)) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Section header for grouped lists: "Aujourd'hui · vendredi 31 oct." */
export function fmtDayHeader(dt?: string | Date) {
  if (!dt) return '';
  const d = new Date(dt);
  if (!Number.isFinite(d.getTime())) return '';
  const full = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
  const rel = fmtDay(d);
  return rel === "Aujourd'hui" || rel === 'Demain' || rel === 'Hier' ? `${rel} · ${full}` : full;
}
