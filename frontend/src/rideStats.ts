import { prefGet, prefSet } from './prefs';

// Acceptance statistics for immediate ride proposals.
//
// Tracked counters:
//   • proposed  : total immediate rides shown to the driver
//   • accepted  : the driver tapped ACCEPTER (and the claim succeeded)
//   • refused   : the driver tapped REFUSER or let the timer expire

const KEY = 'ride_stats_v1';

export type RideStats = {
  proposed: number;
  accepted: number;
  refused: number;
};

const empty: RideStats = { proposed: 0, accepted: 0, refused: 0 };

const listeners: Array<(s: RideStats) => void> = [];
let cache: RideStats | null = null;

async function load(): Promise<RideStats> {
  if (cache) return cache;
  try {
    const raw = await prefGet(KEY, '');
    cache = raw ? JSON.parse(raw) : { ...empty };
  } catch {
    cache = { ...empty };
  }
  return cache!;
}

async function save(next: RideStats) {
  cache = next;
  try { await prefSet(KEY, JSON.stringify(next)); } catch {}
  listeners.forEach((l) => { try { l(next); } catch {} });
}

export async function getStats(): Promise<RideStats> {
  return await load();
}

export function getStatsSync(): RideStats {
  return cache || { ...empty };
}

export async function bumpProposed() {
  const s = await load();
  await save({ ...s, proposed: s.proposed + 1 });
}

export async function bumpProposedBy(n: number) {
  if (!Number.isFinite(n) || n <= 0) return;
  const s = await load();
  await save({ ...s, proposed: s.proposed + Math.round(n) });
}

export async function bumpAccepted() {
  const s = await load();
  await save({ ...s, accepted: s.accepted + 1 });
}

export async function bumpRefused() {
  const s = await load();
  await save({ ...s, refused: s.refused + 1 });
}

export async function resetStats() {
  await save({ ...empty });
}

export function acceptanceRate(s: RideStats): number {
  if (!s.proposed) return 0;
  return Math.round((s.accepted / s.proposed) * 100);
}

export function subscribeStats(fn: (s: RideStats) => void): () => void {
  listeners.push(fn);
  // initialise the listener with current value
  load().then((s) => { try { fn(s); } catch {} });
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}
