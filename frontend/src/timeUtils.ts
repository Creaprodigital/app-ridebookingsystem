import React from 'react';

// Shared design tokens used by countdownStyle below. We import these lazily
// (via require to avoid circular-import noise with the theme module).
type ColorToken = {
  danger: string;
  success: string;
  warning: string;
  primary: string;
  bg: string;
  border: string;
  textSecondary: string;
};
function _getColors(): ColorToken {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { colors } = require('./theme');
  return colors;
}

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

/**
 * Per-kind style pair (chip background/border + foreground text colour) to
 * keep the countdown rendering consistent across screens.
 */
export function countdownStyle(kind: CountdownInfo['kind']) {
  const c = _getColors();
  switch (kind) {
    case 'overdue':
      return {
        chip: { backgroundColor: c.danger + '22', borderColor: c.danger + '88' },
        fg: c.danger,
      };
    case 'now':
      return {
        chip: { backgroundColor: c.success + '22', borderColor: c.success + '88' },
        fg: c.success,
      };
    case 'soon':
      return {
        chip: { backgroundColor: c.warning + '22', borderColor: c.warning + '88' },
        fg: c.warning,
      };
    case 'today':
      return {
        chip: { backgroundColor: c.primary + '22', borderColor: c.primary + '66' },
        fg: c.primary,
      };
    case 'later':
    default:
      return {
        chip: { backgroundColor: c.bg, borderColor: c.border },
        fg: c.textSecondary,
      };
  }
}
