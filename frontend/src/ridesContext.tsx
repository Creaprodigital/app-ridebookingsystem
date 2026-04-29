import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState, Platform } from 'react-native';
import { getMarketplace, getDriverMissions, getDriverProfile, claimMarketplace } from './api';
import { haptic, playSound, notifyNewRide } from './feedback';
import { NOTIF_SOUNDS, getNotifSoundId, prefGet, prefSet, getImmediateEnabled } from './prefs';
import { useAuth } from './auth';
import { scheduleMissionReminders } from './reminderService';
import { addNotification } from './notificationsHistory';
import { isImmediateRide } from './rideTypes';

const FOREGROUND_POLL_MS = 1500; // sub-2s feel
const BACKGROUND_POLL_MS = 15000;
// After a refuse / no-answer, wait 60 s before re-prompting the same driver.
// Combined with the marketplace polling, this creates a re-broadcast loop:
// the modal will pop up again every 60 s as long as the ride is still in
// the marketplace (i.e. nobody else has accepted it).
const DISMISS_TTL_MS = 60 * 1000;

type RidesCtx = {
  // pending queue (head = currently displayed request)
  currentRequest: any | null;
  pendingCount: number;
  queue: any[];
  // marketplace + assigned (for screens)
  latest: any[];
  hasNew: boolean;
  newRidesCount: number;
  // shift status (global)
  onShift: boolean;
  // actions
  acceptCurrent: () => Promise<{ ok: boolean; error?: string }>;
  dismissCurrent: () => void;
  acknowledge: () => void;
  refreshShift: () => Promise<void>;
  /** Force an immediate marketplace fetch (called when a push arrives). */
  forceRefresh: () => Promise<void>;
  /** Toggle whether immediate rides should pop up the Uber-style modal. */
  setImmediateModeEnabled: (enabled: boolean) => Promise<void>;
};

const Ctx = createContext<RidesCtx | null>(null);

const DISMISSED_KEY = 'rides_dismissed_v1';
async function loadDismissed(): Promise<Record<string, number>> {
  try { const raw = await prefGet(DISMISSED_KEY, ''); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
async function saveDismissed(map: Record<string, number>) {
  try { await prefSet(DISMISSED_KEY, JSON.stringify(map)); } catch {}
}

export function RidesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [latest, setLatest] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [newRidesCount, setNewRidesCount] = useState<number>(0);
  const [onShift, setOnShift] = useState<boolean>(false);

  const knownIds = useRef<Set<string>>(new Set());
  const dismissedRef = useRef<Record<string, number>>({});
  const firstLoad = useRef<boolean>(true);
  const soundIdRef = useRef<string>('classic');
  const timer = useRef<any>(null);
  const reminderTimer = useRef<any>(null);
  const inForeground = useRef<boolean>(true);
  const immediateEnabledRef = useRef<boolean>(true);

  useEffect(() => {
    (async () => {
      soundIdRef.current = await getNotifSoundId();
      dismissedRef.current = await loadDismissed();
      immediateEnabledRef.current = await getImmediateEnabled();
    })();
  }, []);

  const refreshShift = useCallback(async () => {
    try {
      const p: any = await getDriverProfile();
      const flag = p?.user?.on_shift ?? p?.on_shift ?? p?.is_on_shift ?? p?.shift_active;
      setOnShift(Boolean(flag));
    } catch {}
  }, []);

  const isDismissed = useCallback((id: string) => {
    const t = dismissedRef.current[id];
    if (!t) return false;
    if (Date.now() - t > DISMISS_TTL_MS) {
      // expire
      delete dismissedRef.current[id];
      return false;
    }
    return true;
  }, []);

  const tick = useCallback(async () => {
    try {
      const v: any = await getMarketplace();
      const list = Array.isArray(v) ? v : v?.items ?? v?.listings ?? [];
      setLatest(list);
      const ids = new Set<string>(list.map((it: any) => String(it.id ?? it._id)));

      if (!firstLoad.current) {
        const newOnes = list.filter((it: any) => {
          const id = String(it.id ?? it._id);
          return !knownIds.current.has(id) && !isDismissed(id);
        });
        // Only IMMEDIATE rides should pop the Uber-style modal. Scheduled
        // rides remain in the marketplace ("Disponibles") tab for manual
        // claim. If the driver disabled "Course immédiate" in settings,
        // skip the modal queue entirely.
        const immediateNew = immediateEnabledRef.current
          ? newOnes.filter(isImmediateRide)
          : [];

        if (immediateNew.length > 0) {
          // append to queue (no duplicates)
          setQueue((prev) => {
            const seen = new Set(prev.map((p) => String(p.id ?? p._id)));
            const append = immediateNew.filter((n: any) => !seen.has(String(n.id ?? n._id)));
            return [...prev, ...append];
          });
          setNewRidesCount((c) => c + immediateNew.length);

          // High-priority feedback for immediate rides
          haptic('success');
          try {
            const sound = NOTIF_SOUNDS.find((s) => s.id === soundIdRef.current) ?? NOTIF_SOUNDS[0];
            playSound(sound.url);
          } catch {}
          const first = immediateNew[0];
          const amt = first?.amount ?? first?.pricing?.final ?? first?.price;
          const fromAddr = pickPickup(first);
          const toAddr = pickDropoff(first);
          // Build notification body: "depart → arrivée · 12,50 €"
          const parts: string[] = [];
          if (fromAddr) parts.push(fromAddr);
          if (toAddr) parts.push(toAddr);
          let body = parts.join(' → ');
          if (amt != null) {
            const price = `${Number(amt).toFixed(2)} €`;
            body = body ? `${body}\n${price}` : price;
          }
          if (!body) body = 'Tap pour voir';
          notifyNewRide({
            title: `🚗 ${immediateNew.length > 1 ? immediateNew.length + ' courses immédiates' : 'Course immédiate'}`,
            body,
            data: { route: '/(tabs)/missions' },
          });
        }

        // History entries for ALL new rides (immediate + scheduled),
        // even when the modal is suppressed.
        newOnes.forEach((n: any) => {
          addNotification({
            id: `ride-${n.id ?? n._id}-${Date.now()}`,
            type: 'new_ride',
            title: isImmediateRide(n) ? 'Course immédiate' : 'Réservation planifiée',
            body: pickPickup(n),
            amount: pickAmount(n),
            ride_id: String(n.id ?? n._id),
            created_at: new Date().toISOString(),
          });
        });

        // Remove queued items that are no longer in marketplace (claimed by someone else / expired)
        setQueue((prev) => prev.filter((p) => ids.has(String(p.id ?? p._id))));
      }
      firstLoad.current = false;
      knownIds.current = ids;
    } catch {}
  }, [isDismissed]);

  const refreshReminders = useCallback(async () => {
    try {
      const m: any = await getDriverMissions();
      const list = Array.isArray(m) ? m : (m?.current ?? m?.items ?? []);
      await scheduleMissionReminders(list);
    } catch {}
  }, []);

  // Polling lifecycle
  useEffect(() => {
    if (!user) {
      if (timer.current) clearInterval(timer.current);
      if (reminderTimer.current) clearInterval(reminderTimer.current);
      knownIds.current = new Set();
      firstLoad.current = true;
      setLatest([]);
      setQueue([]);
      setNewRidesCount(0);
      setOnShift(false);
      return;
    }
    refreshShift();
    tick();
    refreshReminders();

    const startTimer = () => {
      if (timer.current) clearInterval(timer.current);
      const interval = inForeground.current ? FOREGROUND_POLL_MS : BACKGROUND_POLL_MS;
      timer.current = setInterval(() => { tick(); refreshShift(); }, interval);
    };
    startTimer();

    if (reminderTimer.current) clearInterval(reminderTimer.current);
    reminderTimer.current = setInterval(refreshReminders, 5 * 60 * 1000);

    const sub = AppState.addEventListener('change', (state) => {
      const wasFg = inForeground.current;
      inForeground.current = state === 'active';
      if (wasFg !== inForeground.current) {
        startTimer();
      }
      if (state === 'active') {
        tick();
        refreshShift();
        refreshReminders();
      }
    });

    return () => {
      if (timer.current) clearInterval(timer.current);
      if (reminderTimer.current) clearInterval(reminderTimer.current);
      sub.remove();
    };
  }, [user, tick, refreshReminders, refreshShift]);

  // Actions
  const acceptCurrent = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    const head = queue[0];
    if (!head) return { ok: false, error: 'Aucune course à accepter' };
    const id = String(head.id ?? head._id);
    try {
      await claimMarketplace(id);
      // remove from queue
      setQueue((prev) => prev.filter((p) => String(p.id ?? p._id) !== id));
      // mark as known so we don't re-prompt
      knownIds.current.add(id);
      return { ok: true };
    } catch (e: any) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.message ||
        e?.message ||
        'Impossible d’accepter la course';
      return { ok: false, error: String(msg) };
    }
  }, [queue]);

  const dismissCurrent = useCallback(() => {
    const head = queue[0];
    if (!head) return;
    const id = String(head.id ?? head._id);
    dismissedRef.current[id] = Date.now();
    saveDismissed(dismissedRef.current);
    // Important: also remove from knownIds so that once the dismiss-TTL
    // expires, the ride is detected as "new" again on the next poll.
    // This creates a client-side re-broadcast loop: every DISMISS_TTL_MS,
    // any unaccepted ride still present in the marketplace pops back up.
    knownIds.current.delete(id);
    setQueue((prev) => prev.slice(1));
  }, [queue]);

  const acknowledge = useCallback(() => {
    setNewRidesCount(0);
  }, []);

  const value: RidesCtx = {
    currentRequest: queue[0] || null,
    pendingCount: queue.length,
    queue,
    latest,
    hasNew: newRidesCount > 0,
    newRidesCount,
    onShift,
    acceptCurrent,
    dismissCurrent,
    acknowledge,
    refreshShift,
    forceRefresh: async () => { await tick(); await refreshShift(); },
    setImmediateModeEnabled: async (enabled: boolean) => {
      immediateEnabledRef.current = enabled;
      try { await prefSet('immediate_enabled', enabled ? '1' : '0'); } catch {}
      if (!enabled) {
        // immediately empty the queue so any open modal closes
        setQueue([]);
        setNewRidesCount(0);
      }
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRides(): RidesCtx {
  const c = useContext(Ctx);
  if (!c) {
    return {
      currentRequest: null,
      pendingCount: 0,
      queue: [],
      latest: [],
      hasNew: false,
      newRidesCount: 0,
      onShift: false,
      acceptCurrent: async () => ({ ok: false }),
      dismissCurrent: () => {},
      acknowledge: () => {},
      refreshShift: async () => {},
      forceRefresh: async () => {},
      setImmediateModeEnabled: async () => {},
    };
  }
  return c;
}

// helpers shared with notification persistence
function pickPickup(item: any) {
  return item?.booking?.pickup_address || item?.pickup_address || '';
}
function pickDropoff(item: any) {
  return item?.booking?.dropoff_address || item?.dropoff_address || '';
}
function pickAmount(item: any) {
  const v = item?.amount ?? item?.pricing?.final ?? item?.price ?? item?.fare;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
