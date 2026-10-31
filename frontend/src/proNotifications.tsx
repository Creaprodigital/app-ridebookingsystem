/**
 * Pro notifications — derived in real-time from polling /pro/bookings and
 * /pro/drivers. Detects deltas (new bookings, status changes, driver
 * availability) and surfaces them as in-app notifications.
 *
 * Persisted in AsyncStorage so notifications survive app restarts.
 * Capped at 50 entries to avoid unbounded growth.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './auth';
import { getProBookings, getProDrivers, ProBooking, ProDriver } from './proApi';
import { notifyLocal } from './feedback';

export type NotifKind =
  | 'booking_pending'
  | 'booking_assigned'
  | 'booking_in_progress'
  | 'booking_completed'
  | 'booking_cancelled'
  | 'driver_online'
  | 'driver_offline';

export type ProNotif = {
  id: string;             // unique id
  kind: NotifKind;
  title: string;
  body?: string;
  link?: string;          // route to push on tap
  ts: number;             // creation timestamp (ms)
  read: boolean;
  refId?: string;         // booking_id or driver_id
};

const STORAGE_KEY = '@pro_notifications_v1';
const MAX_NOTIFS = 50;
const POLL_MS = 15000;

type Ctx = {
  notifications: ProNotif[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
  refreshNow: () => Promise<void>;
};

const C = createContext<Ctx | null>(null);

function statusToKind(status?: string): NotifKind | null {
  const s = (status || '').toLowerCase();
  if (s === 'pending') return 'booking_pending';
  if (s === 'assigned') return 'booking_assigned';
  if (s === 'in_progress') return 'booking_in_progress';
  if (s === 'completed' || s === 'finished') return 'booking_completed';
  if (s === 'cancelled' || s === 'canceled') return 'booking_cancelled';
  return null;
}
function kindLabel(k: NotifKind): { title: string; emoji: string } {
  switch (k) {
    case 'booking_pending': return { title: 'Nouvelle course à dispatcher', emoji: '🆕' };
    case 'booking_assigned': return { title: 'Course attribuée à un chauffeur', emoji: '👤' };
    case 'booking_in_progress': return { title: 'Course démarrée', emoji: '🚗' };
    case 'booking_completed': return { title: 'Course terminée', emoji: '🏁' };
    case 'booking_cancelled': return { title: 'Course annulée', emoji: '❌' };
    case 'driver_online': return { title: 'Chauffeur en service', emoji: '🟢' };
    case 'driver_offline': return { title: 'Chauffeur hors service', emoji: '⚪' };
  }
}

export function ProNotificationsProvider({ children }: { children: React.ReactNode }) {
  const { isPro } = useAuth();
  const [notifications, setNotifications] = useState<ProNotif[]>([]);
  // Last known state to compute diffs against. Initialized from first poll.
  const bookingStatusRef = useRef<Map<string, string>>(new Map());
  const driverOnlineRef = useRef<Map<string, boolean>>(new Map());
  const firstPollRef = useRef<boolean>(true);
  const pollTimerRef = useRef<any>(null);

  // ── Persistence ──
  const persist = useCallback(async (list: ProNotif[]) => {
    try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: ProNotif[] = JSON.parse(raw);
          if (Array.isArray(parsed)) setNotifications(parsed);
        }
      } catch {}
    })();
  }, []);

  // ── Pushing a new notification ──
  const push = useCallback((n: Omit<ProNotif, 'id' | 'ts' | 'read'>) => {
    setNotifications((prev) => {
      // Dedupe: identical kind+refId within last 30s is suppressed
      const dup = prev.find((x) => x.kind === n.kind && x.refId === n.refId && Date.now() - x.ts < 30000);
      if (dup) return prev;
      const next: ProNotif = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        read: false,
        ...n,
      };
      const out = [next, ...prev].slice(0, MAX_NOTIFS);
      void persist(out);
      // Fire a local OS notification so the user is notified on the lock
      // screen / notification tray even when they are not in the app.
      // Only the most operationally-important events trigger time-sensitive.
      const important =
        n.kind === 'booking_pending' ||
        n.kind === 'booking_cancelled';
      void notifyLocal({
        title: next.title,
        body: next.body,
        important,
        data: { route: n.link, refId: n.refId, kind: n.kind },
      });
      return out;
    });
  }, [persist]);

  // ── Booking & driver delta detection ──
  const detectBookingChanges = useCallback((list: ProBooking[]) => {
    const seenIds = new Set<string>();
    list.forEach((b) => {
      seenIds.add(b.id);
      const prev = bookingStatusRef.current.get(b.id);
      const curr = (b.status || '').toLowerCase();
      bookingStatusRef.current.set(b.id, curr);
      if (firstPollRef.current) return; // skip first poll — only seed state
      if (prev === curr) return;
      // New booking or status changed
      const kind = statusToKind(curr);
      if (!kind) return;
      const meta = kindLabel(kind);
      const passenger = `${b.guest_contact?.first_name || ''} ${b.guest_contact?.last_name || ''}`.trim();
      const route = `${b.pickup_address || '—'} → ${b.dropoff_address || '—'}`;
      push({
        kind,
        title: meta.title,
        body: `${passenger ? passenger + ' • ' : ''}${route}`,
        link: `/mission/${b.id}`,
        refId: b.id,
      });
    });
  }, [push]);

  const detectDriverChanges = useCallback((list: ProDriver[]) => {
    list.forEach((d) => {
      const prev = driverOnlineRef.current.get(d.id);
      const curr = !!d.on_shift;
      driverOnlineRef.current.set(d.id, curr);
      if (firstPollRef.current) return;
      if (prev === undefined || prev === curr) return;
      const name = `${d.first_name || ''} ${d.last_name || ''}`.trim() || d.email || d.id.slice(0, 6);
      const meta = kindLabel(curr ? 'driver_online' : 'driver_offline');
      push({
        kind: curr ? 'driver_online' : 'driver_offline',
        title: meta.title,
        body: name,
        refId: d.id,
      });
    });
  }, [push]);

  const refreshNow = useCallback(async () => {
    if (!isPro) return;
    try {
      const [bks, drs] = await Promise.all([
        getProBookings().catch(() => [] as ProBooking[]),
        getProDrivers().catch(() => [] as ProDriver[]),
      ]);
      detectBookingChanges(bks);
      detectDriverChanges(drs);
    } catch {} finally {
      firstPollRef.current = false;
    }
  }, [isPro, detectBookingChanges, detectDriverChanges]);

  // ── Polling loop ──
  useEffect(() => {
    if (!isPro) return;
    void refreshNow();
    pollTimerRef.current = setInterval(refreshNow, POLL_MS);
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); };
  }, [isPro, refreshNow]);

  // ── Actions ──
  const markRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const out = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
      void persist(out);
      return out;
    });
  }, [persist]);
  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const out = prev.map((n) => ({ ...n, read: true }));
      void persist(out);
      return out;
    });
  }, [persist]);
  const clear = useCallback(() => {
    setNotifications([]);
    void persist([]);
  }, [persist]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <C.Provider value={{ notifications, unreadCount, markRead, markAllRead, clear, refreshNow }}>
      {children}
    </C.Provider>
  );
}

export function useProNotifications(): Ctx {
  const ctx = useContext(C);
  if (!ctx) {
    // Safe fallback when used outside the provider (e.g., on driver routes).
    return {
      notifications: [],
      unreadCount: 0,
      markRead: () => {},
      markAllRead: () => {},
      clear: () => {},
      refreshNow: async () => {},
    };
  }
  return ctx;
}

export function getKindIcon(k: NotifKind): string {
  return kindLabel(k).emoji;
}
