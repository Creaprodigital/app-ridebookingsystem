import { Platform } from 'react-native';
import {
  configureNotificationHandler,
  ensureAndroidChannel,
  ensureNotifPermission,
  getExpoPushTokenDetailed,
} from './feedback';
import { registerPushToken, unregisterPushToken } from './api';
import { prefGet, prefSet } from './prefs';

let Notifications: any = null;
try { Notifications = require('expo-notifications'); } catch {}

const PUSH_ENABLED_KEY = 'push_enabled';
const PUSH_TOKEN_KEY = 'push_token_last';
const DEVICE_ID_KEY = 'push_device_id';

/**
 * Returns a stable per-install UUID. Generated once and persisted so the
 * backend can reliably upsert/dedupe push tokens per device.
 */
async function getOrCreateDeviceId(): Promise<string> {
  let id = (await prefGet(DEVICE_ID_KEY, '')) || '';
  if (!id) {
    id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await prefSet(DEVICE_ID_KEY, id);
  }
  return id;
}

export async function isPushEnabled(): Promise<boolean> {
  const v = await prefGet(PUSH_ENABLED_KEY, '1');
  return v !== '0';
}

export async function setPushEnabled(enabled: boolean) {
  await prefSet(PUSH_ENABLED_KEY, enabled ? '1' : '0');
}

export async function getStoredPushToken(): Promise<string | null> {
  const v = await prefGet(PUSH_TOKEN_KEY, '');
  return v || null;
}

let setupDone = false;
let receivedSub: any = null;
let responseSub: any = null;

export type PushSetupResult = {
  enabled: boolean;
  permission: boolean;
  token: string | null;
  registered: boolean;
  /** Diagnostic message when the token cannot be retrieved. */
  error?: string;
};

export type PushSetupOptions = {
  onTap?: (data: any) => void;
  /** Fired when an `incoming_ride` notification is received in foreground. */
  onIncoming?: (data: any) => void;
};

/**
 * Initialise push notifications:
 *   - configure handler & Android channel
 *   - request permissions
 *   - retrieve the Expo push token
 *   - register it with the backend
 * Idempotent — safe to call multiple times.
 */
export async function setupPushNotifications(opts?: PushSetupOptions): Promise<PushSetupResult> {
  const result: PushSetupResult = {
    enabled: false,
    permission: false,
    token: null,
    registered: false,
  };

  if (Platform.OS === 'web' || !Notifications) return result;

  configureNotificationHandler();
  await ensureAndroidChannel();

  result.enabled = await isPushEnabled();
  if (!result.enabled) return result;

  result.permission = await ensureNotifPermission();
  if (!result.permission) {
    result.error = 'Permission notifications refusée par le système.';
    return result;
  }

  const tk = await getExpoPushTokenDetailed();
  if (!tk.ok) {
    result.error = tk.reason;
    return result;
  }
  result.token = tk.token;

  await prefSet(PUSH_TOKEN_KEY, tk.token);
  const deviceId = await getOrCreateDeviceId();
  const reg = await registerPushToken(tk.token, Platform.OS, deviceId);
  result.registered = !!reg;

  // Set up listeners once
  if (!setupDone) {
    setupDone = true;
    try {
      // 1) Tap on banner / lockscreen → bring app forward, route to data.route
      responseSub = Notifications.addNotificationResponseReceivedListener((resp: any) => {
        try {
          const data = resp?.notification?.request?.content?.data ?? {};
          opts?.onTap?.(data);
        } catch {}
      });
      // 2) Notification received in foreground → trigger an immediate
      //    marketplace refresh so the RideRequestModal pops up <1s later.
      receivedSub = Notifications.addNotificationReceivedListener((notif: any) => {
        try {
          const data = notif?.request?.content?.data ?? {};
          if (data?.kind === 'incoming_ride') {
            opts?.onIncoming?.(data);
          }
        } catch {}
      });
    } catch {}
  }

  return result;
}

export async function disablePushNotifications() {
  await setPushEnabled(false);
  const last = await getStoredPushToken();
  if (last) {
    await unregisterPushToken(last);
    await prefSet(PUSH_TOKEN_KEY, '');
  }
}

export function teardownPushListeners() {
  try { receivedSub?.remove?.(); } catch {}
  try { responseSub?.remove?.(); } catch {}
  receivedSub = null;
  responseSub = null;
  setupDone = false;
}
