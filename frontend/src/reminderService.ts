import { Platform } from 'react-native';
import { prefGet, prefSet } from './prefs';
import { ensureNotifPermission } from './feedback';

let Notifications: any = null;
try { Notifications = require('expo-notifications'); } catch {}

const SCHEDULED_KEY = 'mission_reminders_v1';
const ONE_HOUR_MS = 60 * 60 * 1000;
export const REMINDER_BODY = 'Votre mission commence bientôt. Veuillez démarrer la course.';

type ScheduledMap = Record<string, { notifId: string; pickupAt: string }>;

async function readScheduled(): Promise<ScheduledMap> {
  try {
    const raw = await prefGet(SCHEDULED_KEY, '');
    if (!raw) return {};
    return JSON.parse(raw) as ScheduledMap;
  } catch {
    return {};
  }
}

async function writeScheduled(map: ScheduledMap) {
  try {
    await prefSet(SCHEDULED_KEY, JSON.stringify(map));
  } catch {}
}

function pickPickupAt(m: any): string | null {
  return (
    m?.booking?.pickup_at ||
    m?.pickup_at ||
    m?.scheduled_at ||
    m?.pickup_time ||
    null
  );
}

function pickMissionId(m: any): string | null {
  return m?.id ?? m?._id ?? m?.booking?.id ?? null;
}

function pickPickupAddress(m: any): string {
  return (
    m?.booking?.pickup_address ||
    m?.pickup_address ||
    m?.pickup?.address ||
    'Adresse non communiquée'
  );
}

export async function cancelAllMissionReminders() {
  if (!Notifications) return;
  const map = await readScheduled();
  for (const id of Object.values(map)) {
    try { await Notifications.cancelScheduledNotificationAsync(id.notifId); } catch {}
  }
  await writeScheduled({});
}

/**
 * Schedule a local notification 1 hour before each upcoming mission.
 * Idempotent: if a mission already has a reminder for the same pickup time, it is kept.
 */
export async function scheduleMissionReminders(missions: any[]): Promise<{
  scheduled: number;
  cancelled: number;
}> {
  if (Platform.OS === 'web' || !Notifications) {
    return { scheduled: 0, cancelled: 0 };
  }

  const granted = await ensureNotifPermission();
  if (!granted) return { scheduled: 0, cancelled: 0 };

  const existing = await readScheduled();
  const next: ScheduledMap = {};
  let scheduled = 0;
  let cancelled = 0;

  // Build the new schedule
  const seenIds = new Set<string>();
  for (const m of missions ?? []) {
    const id = pickMissionId(m);
    const pickupAt = pickPickupAt(m);
    if (!id || !pickupAt) continue;
    seenIds.add(id);

    const triggerMs = new Date(pickupAt).getTime() - ONE_HOUR_MS;
    // Only schedule if the trigger is at least 30 seconds in the future
    if (!Number.isFinite(triggerMs) || triggerMs - Date.now() < 30 * 1000) continue;

    const status = String(m?.status || '').toLowerCase();
    if (['cancelled', 'completed', 'in_progress', 'arrived', 'en_route'].includes(status)) continue;

    const prev = existing[id];
    if (prev && prev.pickupAt === pickupAt) {
      // already scheduled with the same pickup → keep it
      next[id] = prev;
      continue;
    }
    // Cancel any stale one
    if (prev) {
      try { await Notifications.cancelScheduledNotificationAsync(prev.notifId); } catch {}
      cancelled += 1;
    }

    try {
      const notifId = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Mission imminente',
          body: REMINDER_BODY,
          subtitle: pickPickupAddress(m),
          sound: true,
          data: { route: '/(tabs)/missions', missionId: id, kind: 'mission_reminder' },
        },
        trigger: {
          type: 'date',
          date: new Date(triggerMs),
          channelId: Platform.OS === 'android' ? 'marketplace' : undefined,
        } as any,
      });
      next[id] = { notifId, pickupAt };
      scheduled += 1;
    } catch {}
  }

  // Cancel reminders for missions that no longer exist or were marked done
  for (const [id, info] of Object.entries(existing)) {
    if (seenIds.has(id) && next[id]) continue;
    try { await Notifications.cancelScheduledNotificationAsync(info.notifId); } catch {}
    cancelled += 1;
  }

  await writeScheduled(next);
  return { scheduled, cancelled };
}

export async function getScheduledRemindersCount(): Promise<number> {
  const map = await readScheduled();
  return Object.keys(map).length;
}
