// Singleton storing the driver's last known GPS coordinates so they can be
// read from any module (ridesContext, RideRequestModal) without re-plumbing
// React props.

export type DriverCoords = {
  lat: number;
  lng: number;
  ts: number; // epoch ms
};

let cached: DriverCoords | null = null;
const listeners: Array<(c: DriverCoords | null) => void> = [];

export function setLastCoords(c: { lat: number; lng: number } | null) {
  if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) {
    cached = null;
  } else {
    cached = { lat: c.lat, lng: c.lng, ts: Date.now() };
  }
  listeners.forEach((l) => { try { l(cached); } catch {} });
}

export function getLastCoords(): DriverCoords | null {
  return cached;
}

export function subscribeCoords(fn: (c: DriverCoords | null) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}
