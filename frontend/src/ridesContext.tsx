import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { fmtEuro } from './rideFormat';
import { AppState, Platform } from 'react-native';
import { getMarketplace, getDriverMissions, getDriverProfile, claimMarketplace } from './api';
import { haptic, playSound, notifyNewRide } from './feedback';
import { NOTIF_SOUNDS, getNotifSoundId, prefGet, prefSet, getImmediateEnabled, getMaxDistanceKm } from './prefs';
import { useAuth } from './auth';
import { scheduleMissionReminders } from './reminderService';
import { addNotification } from './notificationsHistory';
import { isImmediateRide, pickPickupCoords, haversineKm } from './rideTypes';
import { getLastCoords } from './locationStore';
import { bumpProposedBy, bumpAccepted, bumpRefused } from './rideStats';

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
  /** True if the driver currently has an active (non-completed) mission. */
  hasActiveMission: boolean;
  /** Id of the active mission (assigned/en_route/arrived/in_progress) — null otherwise. */
  activeMissionId: string | null;
  // actions
  acceptCurrent: () => Promise<{ ok: boolean; error?: string; missionId?: string }>;
  dismissCurrent: () => void;
  /** Dismiss a specific ride id (used by the Missions → Immédiates tab so the
   *  driver can refuse a ride without waiting for it to pop in the modal). */
  dismissById: (id: string) => void;
  acknowledge: () => void;
  refreshShift: () => Promise<void>;
  /** Force an immediate marketplace fetch (called when a push arrives). */
  forceRefresh: () => Promise<void>;
  /** Toggle whether immediate rides should pop up the Uber-style modal. */
  setImmediateModeEnabled: (enabled: boolean) => Promise<void>;
  /** Mark the active mission as completed locally — clears hasActiveMission /
   *  activeMissionId immediately so the screen-lock and auto-redirect release
   *  without waiting for the next polling cycle. */
  clearActiveMission: () => void;
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
  const [hasActiveMission, setHasActiveMission] = useState<boolean>(false);
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);

  const knownIds = useRef<Set<string>>(new Set());
  const dismissedRef = useRef<Record<string, number>>({});
  const firstLoad = useRef<boolean>(true);
  const soundIdRef = useRef<string>('classic');
  const timer = useRef<any>(null);
  const reminderTimer = useRef<any>(null);
  const inForeground = useRef<boolean>(true);
  const immediateEnabledRef = useRef<boolean>(true);
  const maxDistanceKmRef = useRef<number>(0);
  const hasActiveMissionRef = useRef<boolean>(false);

  useEffect(() => {
    (async () => {
      soundIdRef.current = await getNotifSoundId();
      dismissedRef.current = await loadDismissed();
      immediateEnabledRef.current = await getImmediateEnabled();
      maxDistanceKmRef.current = await getMaxDistanceKm();
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
        // OR is already on an active mission, skip the modal queue.
        let immediateNew = (immediateEnabledRef.current && !hasActiveMissionRef.current)
          ? newOnes.filter(isImmediateRide)
          : [];

        // Filter out rides that are too far from the driver's current GPS
        // position. The driver-side max distance preference is applied
        // greedily — only rides within the radius pop the modal.
        const maxKm = maxDistanceKmRef.current;
        if (maxKm > 0 && immediateNew.length > 0) {
          const me = getLastCoords();
          if (me && Number.isFinite(me.lat) && Number.isFinite(me.lng)) {
            immediateNew = immediateNew.filter((it: any) => {
              const c = pickPickupCoords(it);
              if (!c) return true; // unknown coords → always show
              const km = haversineKm(me, c);
              return km <= maxKm;
            });
          }
        }

        // Bump stats: every ride that effectively pops the modal counts as
        // proposed. Use a single batched update to avoid race conditions.
        if (immediateNew.length > 0) {
          bumpProposedBy(immediateNew.length);
        }

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
            const price = fmtEuro(amt);
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

      // Detect if the driver is currently EXECUTING a ride (en route, arrived,
      // or in progress) — only these states block new immediate rides and
      // trigger the auto-redirect to the mission screen.
      // A mission that is only `assigned` is considered:
      //   • BUSY if it's an immediate ride just accepted (driver is about to
      //     start, must stay focused) — blocks new immediate rides.
      //   • FREE if it's a scheduled ride waiting for its pickup time —
      //     driver can still receive immediate rides in the meantime.
      const EXECUTING = new Set(['en_route', 'arrived', 'in_progress']);
      const isExecuting = (m: any) => EXECUTING.has(String(m?.status || '').toLowerCase());
      const isAssignedImmediate = (m: any) => {
        const s = String(m?.status || '').toLowerCase();
        return s === 'assigned' && isImmediateRide(m);
      };
      const activeMission = list.find((m: any) => isExecuting(m) || isAssignedImmediate(m));
      const active = !!activeMission;
      hasActiveMissionRef.current = active;
      setHasActiveMission(active);
      if (active && activeMission) {
        const mid = String(
          activeMission?.id ??
          activeMission?._id ??
          activeMission?.mission_id ??
          activeMission?.booking?.id ??
          ''
        );
        setActiveMissionId(mid || null);
      } else {
        setActiveMissionId(null);
      }
      if (active) {
        // Drop any immediate ride requests still waiting in the queue
        setQueue([]);
        setNewRidesCount(0);
      }
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
    // Run reminders + active-mission detection every 10s so that the
    // immediate-ride blocking flag is updated quickly after accept/complete.
    reminderTimer.current = setInterval(refreshReminders, 10 * 1000);

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
  const acceptCurrent = useCallback(async (): Promise<{ ok: boolean; error?: string; missionId?: string }> => {
    const head = queue[0];
    if (!head) return { ok: false, error: 'Aucune course à accepter' };
    const id = String(head.id ?? head._id);
    try {
      const data: any = await claimMarketplace(id);
      // Clear ALL queued immediate rides — driver is now committed
      setQueue([]);
      setNewRidesCount(0);
      // Mark active mission immediately so any in-flight tick won't re-queue
      hasActiveMissionRef.current = true;
      setHasActiveMission(true);
      // Mark as known so polling won't re-add it
      knownIds.current.add(id);
      // Try to pull the mission ID from the claim response, else fall back
      // to the marketplace listing ID.
      const missionId =
        data?.mission_id ||
        data?.mission?.id ||
        data?.mission?._id ||
        data?.assigned_mission?.id ||
        data?.id ||
        data?._id ||
        id;
      // Track acceptance for stats
      bumpAccepted();
      // Trigger a missions refresh in background to keep status in sync
      setTimeout(() => { refreshReminders(); }, 500);
      return { ok: true, missionId: String(missionId) };
    } catch (e: any) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.message ||
        e?.message ||
        'Impossible d’accepter la course';
      return { ok: false, error: String(msg) };
    }
  }, [queue, refreshReminders]);

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
    // Track refuse for stats (covers REFUSE button + 30-s timeout auto-refuse).
    bumpRefused();
    setQueue((prev) => prev.slice(1));
  }, [queue]);

  /**
   * Refuse a specific ride id from outside the modal (e.g. the Missions →
   * Immédiates tab). Same persistence rules as dismissCurrent:
   *   • marked as dismissed in SecureStore (so it doesn't re-pop for ~60 s)
   *   • removed from the modal queue if it happened to be in there
   *   • removed from knownIds so the dismiss-TTL re-broadcast loop still works
   */
  const dismissById = useCallback((rideId: string) => {
    if (!rideId) return;
    const id = String(rideId);
    dismissedRef.current[id] = Date.now();
    saveDismissed(dismissedRef.current);
    knownIds.current.delete(id);
    bumpRefused();
    setQueue((prev) => prev.filter((r) => String(r.id ?? r._id) !== id));
    // Also drop it from the latest marketplace snapshot so the row
    // disappears immediately from the Immédiates tab.
    setLatest((prev) => prev.filter((r) => String(r.id ?? r._id) !== id));
  }, []);

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
    hasActiveMission,
    activeMissionId,
    acceptCurrent,
    dismissCurrent,
    dismissById,
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
    clearActiveMission: () => {
      hasActiveMissionRef.current = false;
      setHasActiveMission(false);
      setActiveMissionId(null);
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
      hasActiveMission: false,
      activeMissionId: null,
      acceptCurrent: async () => ({ ok: false }),
      dismissCurrent: () => {},
      dismissById: () => {},
      acknowledge: () => {},
      refreshShift: async () => {},
      forceRefresh: async () => {},
      setImmediateModeEnabled: async () => {},
      clearActiveMission: () => {},
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
