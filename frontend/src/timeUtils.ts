import React from 'react';

/**
 * useTicker — re-renders the host component every `everyMs` milliseconds.
 * Used to keep countdowns / time-ago labels fresh.
 */
export function useTicker(everyMs = 30_000): number {
  const [t, setT] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setT(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return t;
}

/**
 * Formats a "time-until-pickup" countdown for the planned-missions list.
 *
 * Returns:
 *   • { kind: 'overdue', label: 'En retard' } if pickup already passed
 *   • { kind: 'now',     label: 'Maintenant' } if within 60 s
 *   • { kind: 'soon',    label: 'Dans 12 min' } if < 30 min
 *   • { kind: 'today',   label: 'Dans 2 h 14' } if today (< 12 h)
 *   • { kind: 'later',   label: 'Dans 3 j' } otherwise
 *   • null if `pickupAt` is empty / unparseable / > 30 d in the future
 */
export type CountdownInfo = {
  kind: 'overdue' | 'now' | 'soon' | 'today' | 'later';
  label: string;
  /** Unsigned number of minutes until pickup (negative if overdue). */
  diffMin: number;
};

export function formatPickupCountdown(pickupAt?: string | number | null): CountdownInfo | null {
  if (pickupAt == null || pickupAt === '') return null;
  const t = typeof pickupAt === 'string' ? Date.parse(pickupAt) : Number(pickupAt);
  if (!Number.isFinite(t)) return null;
  const now = Date.now();
  const diffSec = Math.round((t - now) / 1000);
  const diffMin = Math.round(diffSec / 60);

  if (diffSec <= -60) {
    // > 1 min late
    const m = Math.abs(diffMin);
    if (m < 60) return { kind: 'overdue', label: `En retard ${m} min`, diffMin };
    const h = Math.floor(m / 60);
    return { kind: 'overdue', label: `En retard ${h} h`, diffMin };
  }
  if (diffSec >= -60 && diffSec < 60) {
    return { kind: 'now', label: 'Maintenant', diffMin };
  }
  if (diffMin < 30) {
    return { kind: 'soon', label: `Dans ${diffMin} min`, diffMin };
  }
  if (diffMin < 12 * 60) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return {
      kind: 'today',
      label: m ? `Dans ${h} h ${String(m).padStart(2, '0')}` : `Dans ${h} h`,
      diffMin,
    };
  }
  const days = Math.round(diffMin / (60 * 24));
  if (days > 30) return null; // too far in the future, hide chip
  return { kind: 'later', label: days <= 1 ? 'Dans 1 j' : `Dans ${days} j`, diffMin };
}
