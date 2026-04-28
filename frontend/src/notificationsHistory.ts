import { prefGet, prefSet } from './prefs';

export type NotifType = 'new_ride' | 'ride_assigned' | 'ride_completed' | 'reminder' | 'system';

export type NotifEntry = {
  id: string;
  type: NotifType;
  title: string;
  body?: string;
  amount?: number | null;
  ride_id?: string;
  created_at: string;
  read?: boolean;
};

const KEY = 'notif_history_v1';
const MAX_ENTRIES = 100;
const listeners: Array<(entries: NotifEntry[]) => void> = [];
let cache: NotifEntry[] | null = null;

async function load(): Promise<NotifEntry[]> {
  if (cache) return cache;
  try {
    const raw = await prefGet(KEY, '');
    cache = raw ? (JSON.parse(raw) as NotifEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache!;
}

async function save(entries: NotifEntry[]) {
  cache = entries;
  try {
    await prefSet(KEY, JSON.stringify(entries));
  } catch {}
  listeners.forEach((l) => {
    try { l(entries); } catch {}
  });
}

export async function getNotifications(): Promise<NotifEntry[]> {
  return await load();
}

export async function addNotification(entry: NotifEntry) {
  const list = await load();
  // Skip duplicates within 5 sec by ride_id
  if (entry.ride_id) {
    const recent = list.find(
      (e) => e.ride_id === entry.ride_id && Date.now() - new Date(e.created_at).getTime() < 5000
    );
    if (recent) return;
  }
  const next = [entry, ...list].slice(0, MAX_ENTRIES);
  await save(next);
}

export async function markAllRead() {
  const list = await load();
  await save(list.map((e) => ({ ...e, read: true })));
}

export async function markRead(id: string) {
  const list = await load();
  await save(list.map((e) => (e.id === id ? { ...e, read: true } : e)));
}

export async function clearAll() {
  await save([]);
}

export async function unreadCount(): Promise<number> {
  const list = await load();
  return list.filter((e) => !e.read).length;
}

export function subscribe(fn: (entries: NotifEntry[]) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}
