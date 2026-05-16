import { Platform } from 'react-native';

let Haptics: any = null;
let AudioModule: any = null;
let Notifications: any = null;
let Device: any = null;
let Constants: any = null;

try { Haptics = require('expo-haptics'); } catch {}
try { AudioModule = require('expo-audio'); } catch {}
try { Notifications = require('expo-notifications'); } catch {}
try { Device = require('expo-device'); } catch {}
try { Constants = require('expo-constants').default; } catch {}

export type FeedbackKind = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

export function haptic(kind: FeedbackKind = 'light') {
  if (Platform.OS === 'web' || !Haptics) return;
  try {
    if (kind === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else if (kind === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else if (kind === 'heavy') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    else if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else if (kind === 'error') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {}
}

let activePlayer: any = null;
let activeWebAudio: HTMLAudioElement | null = null;

export async function playSound(url: string) {
  try {
    if (Platform.OS === 'web') {
      try { activeWebAudio?.pause(); } catch {}
      const a = new Audio(url);
      activeWebAudio = a;
      a.volume = 0.9;
      await a.play();
      return;
    }
    if (!AudioModule?.createAudioPlayer) return;
    try { activePlayer?.remove?.(); } catch {}
    const p = AudioModule.createAudioPlayer({ uri: url });
    activePlayer = p;
    p.volume = 0.9;
    p.play?.();
  } catch {}
}

// ----- Notifications setup -----

let notifHandlerSet = false;
export function configureNotificationHandler() {
  if (notifHandlerSet || !Notifications) return;
  notifHandlerSet = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {}
}

export async function ensureAndroidChannel() {
  if (Platform.OS !== 'android' || !Notifications) return;
  try {
    // ──────────────────────────────────────────────────────────────────────
    // Highest-priority "incoming ride" channel
    //  • IMPORTANCE_MAX   → pop heads-up over current app even on lock-screen
    //  • bypassDnd        → ignore Do-Not-Disturb
    //  • lockscreen PUBLIC → show full content over lock-screen
    //  • aggressive vibration pattern (5 cycles) like an incoming call
    //  • lights flashing + default sound
    // ──────────────────────────────────────────────────────────────────────
    await Notifications.setNotificationChannelAsync('incoming_ride', {
      name: 'Nouvelles courses (priorité maximale)',
      description: 'Notifications urgentes pour les nouvelles réservations',
      importance: Notifications.AndroidImportance?.MAX ?? 5,
      vibrationPattern: [0, 600, 300, 600, 300, 600, 300, 600, 300, 600],
      lightColor: '#F5B72E',
      sound: 'default',
      bypassDnd: true,
      enableVibrate: true,
      enableLights: true,
      showBadge: true,
      lockscreenVisibility:
        Notifications.AndroidNotificationVisibility?.PUBLIC ?? 1,
    });
    // Keep the legacy 'marketplace' channel for less-urgent alerts (reminders)
    await Notifications.setNotificationChannelAsync('marketplace', {
      name: 'Rappels & alertes',
      importance: Notifications.AndroidImportance?.HIGH ?? 4,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#F5B72E',
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
    });
  } catch {}
}

export async function ensureNotifPermission(): Promise<boolean> {
  if (Platform.OS === 'web' || !Notifications) return false;
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.status === 'granted') return true;
    const r = await Notifications.requestPermissionsAsync();
    return r.status === 'granted';
  } catch {
    return false;
  }
}

export type PushTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: string };

export async function getExpoPushToken(): Promise<string | null> {
  const r = await getExpoPushTokenDetailed();
  return r.ok ? r.token : null;
}

export async function getExpoPushTokenDetailed(): Promise<PushTokenResult> {
  if (Platform.OS === 'web' || !Notifications) {
    return { ok: false, reason: 'Notifications non supportées sur cette plateforme.' };
  }
  try {
    if (Device && Device.isDevice === false) {
      return { ok: false, reason: 'Émulateur détecté · les push tokens nécessitent un appareil physique.' };
    }
    const granted = await ensureNotifPermission();
    if (!granted) {
      return { ok: false, reason: 'Permission refusée par le système.' };
    }
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ||
      Constants?.easConfig?.projectId ||
      (Constants as any)?.manifest?.extra?.eas?.projectId ||
      undefined;
    if (!projectId) {
      return {
        ok: false,
        reason: 'EAS projectId manquant dans app.json (extra.eas.projectId).',
      };
    }
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!tokenData?.data) {
      return { ok: false, reason: 'L’API Expo n’a renvoyé aucun token.' };
    }
    return { ok: true, token: tokenData.data };
  } catch (e: any) {
    return {
      ok: false,
      reason: String(e?.message || e || 'Erreur inconnue').slice(0, 200),
    };
  }
}

export async function notifyNewRide(opts: { title: string; body: string; data?: any }) {
  if (Platform.OS === 'web' || !Notifications) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: opts.title,
        body: opts.body,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority?.MAX ?? 'max',
        // iOS — Time-Sensitive: pop on lock screen and bypass focus modes
        interruptionLevel: 'time-sensitive',
        // Make iOS rank this above other notifications
        relevanceScore: 1.0,
        // Vibrate strongly on Android (pattern of an incoming-call style)
        vibrate: [0, 600, 300, 600, 300, 600, 300, 600],
        sticky: false,
        autoDismiss: false,
        data: { ...(opts.data ?? { route: '/(tabs)/missions' }), kind: 'incoming_ride' },
        color: '#F5B72E',
      },
      trigger: Platform.OS === 'android'
        ? ({ channelId: 'incoming_ride' } as any)
        : null,
    });
  } catch {}
}

/**
 * Generic local OS notification.
 * Used by the pro app to surface in-app notifications on the lock screen and
 * notification tray when delta polling detects a booking/driver change.
 */
export async function notifyLocal(opts: {
  title: string;
  body?: string;
  data?: any;
  /** When true, vibrates / shows on lock screen with high priority. */
  important?: boolean;
}) {
  if (Platform.OS === 'web' || !Notifications) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: opts.title,
        body: opts.body ?? '',
        sound: 'default',
        priority: opts.important
          ? (Notifications.AndroidNotificationPriority?.HIGH ?? 'high')
          : (Notifications.AndroidNotificationPriority?.DEFAULT ?? 'default'),
        interruptionLevel: opts.important ? 'time-sensitive' : 'active',
        data: { ...(opts.data ?? {}), kind: 'pro_notification' },
        color: '#F5B72E',
      },
      trigger: null, // fire immediately
    });
  } catch {}
}
