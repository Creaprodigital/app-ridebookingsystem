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

export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'web' || !Notifications) return null;
  try {
    if (Device && Device.isDevice === false) {
      // Simulator doesn't yield real push tokens
      return null;
    }
    const granted = await ensureNotifPermission();
    if (!granted) return null;
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ||
      Constants?.easConfig?.projectId ||
      undefined;
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return tokenData?.data ?? null;
  } catch {
    return null;
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
