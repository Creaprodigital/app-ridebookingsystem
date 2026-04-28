import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState, Platform } from 'react-native';
import { getMarketplace, getDriverMissions, getDriverProfile } from './api';
import { haptic, playSound, notifyNewRide } from './feedback';
import { NOTIF_SOUNDS, getNotifSoundId } from './prefs';
import { useAuth } from './auth';
import { scheduleMissionReminders } from './reminderService';

const POLL_INTERVAL_MS = 20000;

type RidesCtx = {
  newRidesCount: number;
  latest: any[];
  hasNew: boolean;
  acknowledge: () => void;
  onShift: boolean;
  refreshShift: () => Promise<void>;
};

const Ctx = createContext<RidesCtx | null>(null);

export function RidesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [latest, setLatest] = useState<any[]>([]);
  const [newRidesCount, setNewRidesCount] = useState<number>(0);
  const [onShift, setOnShift] = useState<boolean>(false);
  const knownIds = useRef<Set<string>>(new Set());
  const firstLoad = useRef<boolean>(true);
  const soundIdRef = useRef<string>('classic');
  const timer = useRef<any>(null);
  const reminderTimer = useRef<any>(null);

  useEffect(() => {
    (async () => {
      soundIdRef.current = await getNotifSoundId();
    })();
  }, []);

  const refreshShift = useCallback(async () => {
    try {
      const p: any = await getDriverProfile();
      const shiftFlag = p?.user?.on_shift ?? p?.on_shift ?? p?.is_on_shift ?? p?.shift_active;
      setOnShift(Boolean(shiftFlag));
    } catch {}
  }, []);

  const tick = useCallback(async () => {
    try {
      const v: any = await getMarketplace();
      const list = Array.isArray(v) ? v : v?.items ?? v?.listings ?? [];
      setLatest(list);
      const ids = new Set<string>(list.map((it: any) => String(it.id ?? it._id)));
      if (!firstLoad.current) {
        const newOnes = list.filter((it: any) => !knownIds.current.has(String(it.id ?? it._id)));
        if (newOnes.length > 0) {
          setNewRidesCount((c) => c + newOnes.length);
          haptic('success');
          try {
            const sound = NOTIF_SOUNDS.find((s) => s.id === soundIdRef.current) ?? NOTIF_SOUNDS[0];
            playSound(sound.url);
          } catch {}
          // Schedule a local push so it shows even if the app is backgrounded
          const first = newOnes[0];
          const amt = first?.amount ?? first?.pricing?.final;
          notifyNewRide({
            title: `${newOnes.length} nouvelle${newOnes.length > 1 ? 's' : ''} course${newOnes.length > 1 ? 's' : ''} !`,
            body: amt ? `Commission: ${Number(amt).toFixed(2)} €` : 'Disponibles dans le marketplace',
            data: { route: '/(tabs)/missions' },
          });
        }
      }
      firstLoad.current = false;
      knownIds.current = ids;
    } catch {}
  }, []);

  // Background-friendly mission reminder scheduler
  const refreshReminders = useCallback(async () => {
    try {
      const m: any = await getDriverMissions();
      const list = Array.isArray(m) ? m : (m?.current ?? m?.items ?? []);
      await scheduleMissionReminders(list);
    } catch {}
  }, []);

  useEffect(() => {
    if (!user) {
      // cleanup on logout
      if (timer.current) clearInterval(timer.current);
      if (reminderTimer.current) clearInterval(reminderTimer.current);
      knownIds.current = new Set();
      firstLoad.current = true;
      setLatest([]);
      setNewRidesCount(0);
      setOnShift(false);
      return;
    }

    // Initial shift fetch
    refreshShift();

    // Marketplace polling
    tick();
    timer.current = setInterval(() => { tick(); refreshShift(); }, POLL_INTERVAL_MS);

    // Reminder scheduling — every 5 min
    refreshReminders();
    reminderTimer.current = setInterval(refreshReminders, 5 * 60 * 1000);

    // Refresh when app comes back to foreground
    const sub = AppState.addEventListener('change', (state) => {
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

  const acknowledge = useCallback(() => {
    setNewRidesCount(0);
  }, []);

  const value: RidesCtx = {
    newRidesCount,
    latest,
    hasNew: newRidesCount > 0,
    acknowledge,
    onShift,
    refreshShift,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRides() {
  const c = useContext(Ctx);
  if (!c) {
    return {
      newRidesCount: 0,
      latest: [],
      hasNew: false,
      acknowledge: () => {},
      onShift: false,
      refreshShift: async () => {},
    } as RidesCtx;
  }
  return c;
}
