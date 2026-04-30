import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const webStorage = {
  get: (k: string) => {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage.getItem(k);
    return null;
  },
  set: (k: string, v: string) => {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(k, v);
  },
};

export async function prefGet(key: string, fallback = ''): Promise<string> {
  try {
    if (Platform.OS === 'web') return webStorage.get(`pref_${key}`) ?? fallback;
    const v = await SecureStore.getItemAsync(`pref_${key}`);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export async function prefSet(key: string, value: string) {
  try {
    if (Platform.OS === 'web') webStorage.set(`pref_${key}`, value);
    else await SecureStore.setItemAsync(`pref_${key}`, value);
  } catch {}
}

// ---------- Navigation provider ----------
export type NavProvider = 'google' | 'waze';

export async function getNavProvider(): Promise<NavProvider> {
  const v = await prefGet('nav_provider', 'google');
  return v === 'waze' ? 'waze' : 'google';
}
export async function setNavProvider(v: NavProvider) {
  await prefSet('nav_provider', v);
}

export function buildNavUrl(provider: NavProvider, lat: number, lng: number, address?: string) {
  if (provider === 'waze') {
    return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  }
  return Platform.OS === 'ios'
    ? `http://maps.apple.com/?daddr=${lat},${lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

// ---------- Notification sound ----------
export type SoundOption = {
  id: string;
  name: string;
  url: string;
};

export const NOTIF_SOUNDS: SoundOption[] = [
  {
    id: 'classic',
    name: 'Classique',
    url: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',
  },
  {
    id: 'bell',
    name: 'Cloche',
    url: 'https://assets.mixkit.co/active_storage/sfx/2870/2870-preview.mp3',
  },
  {
    id: 'digital',
    name: 'Digital',
    url: 'https://assets.mixkit.co/active_storage/sfx/2356/2356-preview.mp3',
  },
  {
    id: 'chime',
    name: 'Carillon',
    url: 'https://assets.mixkit.co/active_storage/sfx/2357/2357-preview.mp3',
  },
  {
    id: 'marimba',
    name: 'Marimba',
    url: 'https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3',
  },
];

export async function getNotifSoundId(): Promise<string> {
  return (await prefGet('notif_sound', 'classic')) || 'classic';
}
export async function setNotifSoundId(id: string) {
  await prefSet('notif_sound', id);
}

// ─── Course immédiate (auto-popup ride request modal) ────────────────────
export async function getImmediateEnabled(): Promise<boolean> {
  const v = await prefGet('immediate_enabled', '1');
  return v !== '0';
}
export async function setImmediateEnabled(enabled: boolean) {
  await prefSet('immediate_enabled', enabled ? '1' : '0');
}

// ─── Max distance for immediate ride proposals (km, 0 = unlimited) ───────
export async function getMaxDistanceKm(): Promise<number> {
  const v = await prefGet('max_distance_km', '0');
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
export async function setMaxDistanceKm(km: number) {
  const safe = Math.max(0, Math.round(km));
  await prefSet('max_distance_km', String(safe));
}

