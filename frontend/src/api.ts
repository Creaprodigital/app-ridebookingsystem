import axios, { AxiosError, AxiosInstance } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Backend endpoint — read from build-time env.
//   • `EXPO_PUBLIC_BACKEND_URL` is the Emergent-standard env var and is the
//     one rewritten at `Publish` time to the production backend URL.
//   • `EXPO_PUBLIC_API_BASE` is kept as a legacy fallback for existing dev
//     environments that already define it.
// We intentionally do NOT hard-code any fallback host: a missing env must
// surface loudly at network time rather than silently ship a wrong backend.
const API_BASE =
  (process.env.EXPO_PUBLIC_BACKEND_URL as string | undefined) ||
  (process.env.EXPO_PUBLIC_API_BASE as string | undefined) ||
  '';
const TOKEN_KEY = 'sr_driver_token';

const webStorage = {
  async getItemAsync(key: string) {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
    return null;
  },
  async setItemAsync(key: string, value: string) {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  },
  async deleteItemAsync(key: string) {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  },
};

const storage = Platform.OS === 'web' ? webStorage : SecureStore;

export const tokenStore = {
  get: () => storage.getItemAsync(TOKEN_KEY),
  set: (v: string) => storage.setItemAsync(TOKEN_KEY, v),
  clear: () => storage.deleteItemAsync(TOKEN_KEY),
};

export const api: AxiosInstance = axios.create({
  baseURL: `${API_BASE}/api`,
  timeout: 20000,
});

api.interceptors.request.use(async (config) => {
  const token = await tokenStore.get();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

export function apiError(e: unknown): string {
  const err = e as AxiosError<any>;
  const data = err?.response?.data;
  if (data?.detail) {
    if (typeof data.detail === 'string') return data.detail;
    if (Array.isArray(data.detail) && data.detail[0]?.msg) return data.detail[0].msg;
  }
  return err?.message ?? 'Une erreur est survenue';
}

// ---------- Auth ----------
export async function login(email: string, password: string) {
  const { data } = await api.post('/auth/login', { email, password });
  return data as { token: string; user?: any; tenant?: any };
}

export async function forgotPassword(email: string) {
  const { data } = await api.post('/public/auth/forgot-password', { email });
  return data as { ok?: boolean; message?: string };
}

export async function checkEmail(email: string) {
  const { data } = await api.post('/public/auth/email-check', { email });
  return data as { exists: boolean; role?: string };
}

export async function getMe() {
  const { data } = await api.get('/auth/me');
  // Backend returns { user: {...}, tenant: {...} } — keep both (auth.tsx reads them).
  return data as any;
}

/**
 * Tenant (professional) Google Maps key for the logged-in pro or a driver
 * linked to that pro. Returns null if the backend route is not deployed yet
 * or the tenant has no key — the app then keeps the bundled fallback key.
 */
export async function getMapsClientKey(): Promise<string | null> {
  try {
    const { data } = await api.get('/maps/client-key', { timeout: 8000 });
    const k = data?.google_maps_api_key;
    return typeof k === 'string' && k.trim() ? k.trim() : null;
  } catch {
    return null;
  }
}


// ---------- Driver ----------
export async function getDriverProfile() {
  const { data } = await api.get('/driver/profile');
  return data;
}

export async function getDriverMissions() {
  const { data } = await api.get('/driver/missions');
  return data;
}

/**
 * Returns completed missions (history). Tries a dedicated endpoint first
 * (driver/missions/history with optional from/to ISO dates), and falls
 * back to filtering /driver/missions for status === 'completed' so the
 * client still works against older backend versions.
 */
export async function getDriverHistory(from?: string, to?: string) {
  const params: Record<string, string> = {};
  if (from) params.from = from;
  if (to) params.to = to;
  try {
    const { data } = await api.get('/driver/missions/history', { params });
    // Backends may return either {items: [...]} or a raw array.
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.history)) return data.history;
    if (Array.isArray(data?.missions)) return data.missions;
    return [];
  } catch {
    try {
      const { data } = await api.get('/driver/missions');
      // Backend may return either an array, {items: [...]}, {missions: [...]}
      // or {current: [...], history: [...]}. We accept all of these.
      let list: any[] = [];
      if (Array.isArray(data)) {
        list = data;
      } else if (Array.isArray(data?.history)) {
        // Preferred when present — it already excludes in-progress missions.
        list = data.history;
      } else if (Array.isArray(data?.items)) {
        list = data.items;
      } else if (Array.isArray(data?.missions)) {
        list = data.missions;
      } else if (Array.isArray(data?.current) || Array.isArray(data?.history)) {
        list = [...(data?.current ?? []), ...(data?.history ?? [])];
      }
      // Keep completed / cancelled / finished missions only — anything still
      // active belongs to the missions list, not the history list.
      return list.filter((m: any) => {
        const s = String(m?.status || '').toLowerCase();
        return s === 'completed' || s === 'finished' || s === 'cancelled' || s === 'canceled';
      });
    } catch {
      return [];
    }
  }
}

export async function updateMissionStatus(missionId: string, status: string) {
  const { data } = await api.patch(`/driver/missions/${missionId}/status`, { status });
  return data;
}

// ---------- End-of-ride payment (server is the single source of truth) ----------
export type DisplayCase = 'paid_online' | 'collect_cash' | 'collect_card' | 'unconfirmed';
export type MissionPayment = {
  booking_id: string;
  payment_method: string;
  payment_status: string;
  amount_total: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  display_case: DisplayCase;
  can_collect: boolean;
  collection: null | {
    driver_id?: string;
    driver_name?: string;
    amount: number;
    method: 'cash' | 'card';
    confirmation_mode?: string;
    collected_at?: string;
  };
  payment_issue_open: boolean;
  checked_at?: string;
};

export async function getMissionPayment(missionId: string): Promise<MissionPayment> {
  const { data } = await api.get(`/driver/missions/${missionId}/payment`);
  return data;
}

export async function collectMissionPayment(
  missionId: string,
  body: { method: 'cash' | 'card'; amount: number; idempotency_key: string },
): Promise<MissionPayment> {
  const { data } = await api.post(`/driver/missions/${missionId}/payment/collect`, {
    ...body,
    confirmation_mode: 'slide',
  });
  return data;
}

export async function reportPaymentIssue(missionId: string, reason: string, comment?: string) {
  const { data } = await api.post(`/driver/missions/${missionId}/payment/issue`, { reason, comment });
  return data;
}

export async function getDriverWallet() {
  const { data } = await api.get('/driver/wallet');
  return data;
}

export async function setShift(onShift: boolean) {
  const { data } = await api.patch('/driver/shift', { on_shift: onShift });
  return data;
}

export async function pushLocation(coords: {
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
}) {
  const { data } = await api.post('/driver/location', coords);
  return data;
}

export async function getMarketplace() {
  const { data } = await api.get('/driver/internal-marketplace');
  return data;
}

export async function getMarketplaceConfig() {
  const { data } = await api.get('/driver/internal-marketplace-config');
  return data;
}

export async function claimMarketplace(id: string) {
  const { data } = await api.post(`/driver/internal-marketplace/${id}/claim`, {});
  return data;
}

// ---------- Push notifications ----------
export async function registerPushToken(
  token: string,
  platform: string,
  deviceId?: string,
  role?: 'pro' | 'driver' | string,
) {
  // Try the most common shapes — the backend will accept the first one it understands.
  const payload = {
    token,
    expo_token: token,
    push_token: token,
    platform,
    device_type: platform,
    device_id: deviceId,
  };
  // Try the role-specific endpoint first to avoid noisy 403s in production
  // (e.g. a Pro user posting to /driver/push-token returns Forbidden).
  // Then fall back to the other variants so this stays robust if the
  // backend renames or adds endpoints later.
  const proFirst = ['/pro/push-token', '/driver/push-token', '/me/push-token', '/push-token'];
  const driverFirst = ['/driver/push-token', '/pro/push-token', '/me/push-token', '/push-token'];
  const candidates = role === 'pro' ? proFirst : driverFirst;
  for (const path of candidates) {
    try {
      const { data } = await api.post(path, payload);
      return data;
    } catch {
      // try next
    }
  }
  return null;
}

export async function unregisterPushToken(token?: string) {
  try {
    if (token) {
      const { data } = await api.delete('/driver/push-token', { data: { token } });
      return data;
    }
    const { data } = await api.delete('/driver/push-token');
    return data;
  } catch {
    return null;
  }
}
