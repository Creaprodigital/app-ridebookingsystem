import { AppState, AppStateStatus, Platform, Linking, NativeEventSubscription } from 'react-native';

// ──────────────────────────────────────────────────────────────────────────────
// Android-only service that simulates a system "floating bubble" using a
// high-priority sticky notification while the app is backgrounded.
//
// True overlay-over-other-apps (Messenger-style chathead) requires a custom
// native module + SYSTEM_ALERT_WINDOW permission and is incompatible with the
// Expo managed workflow. The permission is declared in app.json and a helper
// is provided so a future EAS dev build with a native overlay module can use
// it without any other code change.
// ──────────────────────────────────────────────────────────────────────────────

let Notifications: any = null;
try { Notifications = require('expo-notifications'); } catch {}

export type RideSummary = {
  count: number;
  latest: any[];
};

type Provider = () => RideSummary;
type Listener = () => void;

let provider: Provider = () => ({ count: 0, latest: [] });
let appStateSub: NativeEventSubscription | null = null;
let stickyNotifId: string | null = null;
let started = false;
let listeners: Listener[] = [];

function emit() {
  for (const l of listeners) {
    try { l(); } catch {}
  }
}

function pickAmount(item: any): number | null {
  const v = item?.amount ?? item?.pricing?.final ?? item?.price ?? item?.fare;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickPickup(item: any): string {
  return (
    item?.booking?.pickup_address ||
    item?.pickup_address ||
    item?.pickup?.address ||
    'Course disponible'
  );
}

async function ensureChannel() {
  if (Platform.OS !== 'android' || !Notifications) return;
  try {
    await Notifications.setNotificationChannelAsync('floating_bubble', {
      name: 'Bulle de courses (arrière-plan)',
      importance: Notifications.AndroidImportance?.HIGH ?? 4,
      vibrationPattern: [0, 200, 100, 200],
      lightColor: '#F5B72E',
      enableVibrate: true,
      showBadge: true,
      sound: 'default',
      lockscreenVisibility:
        Notifications.AndroidNotificationVisibility?.PUBLIC ?? 1,
    });
  } catch {}
}

async function showBubble() {
  if (Platform.OS !== 'android' || !Notifications) return;
  const { count, latest } = provider();
  if (!count || count <= 0) {
    await hideBubble();
    return;
  }

  // Dismiss any previous instance to avoid stacking
  await hideBubble();

  try {
    const first = latest[0];
    const amount = pickAmount(first);
    const pickup = pickPickup(first);

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `${count} nouvelle${count > 1 ? 's' : ''} course${count > 1 ? 's' : ''} disponible${count > 1 ? 's' : ''}`,
        body: amount != null
          ? `${pickup} · ${amount.toFixed(2)} €`
          : pickup,
        sound: 'default',
        // Sticky / ongoing notification — behaves like a floating bubble:
        //   • cannot be swiped away
        //   • appears above lockscreen
        //   • taps deep-link into the missions screen
        sticky: true,
        autoDismiss: false,
        priority: 'max',
        data: { route: '/(tabs)/missions', kind: 'floating_bubble' },
        color: '#F5B72E',
      },
      trigger: { channelId: 'floating_bubble' } as any,
    });
    stickyNotifId = id;
    emit();
  } catch {}
}

async function hideBubble() {
  if (Platform.OS !== 'android' || !Notifications) return;
  const id = stickyNotifId;
  stickyNotifId = null;
  try {
    if (id) await Notifications.dismissNotificationAsync(id);
    // Also dismiss anything still attached to our channel — defensive cleanup
    await Notifications.dismissAllNotificationsAsync?.();
  } catch {}
  emit();
}

function handleAppStateChange(state: AppStateStatus) {
  if (Platform.OS !== 'android') return;
  if (state === 'background' || state === 'inactive') {
    showBubble();
  } else if (state === 'active') {
    hideBubble();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export function setBubbleDataProvider(fn: Provider) {
  provider = fn;
  // If app is currently backgrounded and data just changed, refresh the bubble
  if (Platform.OS === 'android' && AppState.currentState !== 'active') {
    showBubble();
  }
}

export function isBubbleVisible() {
  return stickyNotifId != null;
}

export function subscribeBubble(listener: Listener) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export async function startFloatingBubble() {
  if (Platform.OS !== 'android') return; // iPhone: never
  if (started) return;
  started = true;
  await ensureChannel();

  appStateSub = AppState.addEventListener('change', handleAppStateChange);

  // If we somehow start while already in background, surface immediately
  if (AppState.currentState === 'background' || AppState.currentState === 'inactive') {
    showBubble();
  }
}

export async function stopFloatingBubble() {
  if (!started) return;
  started = false;
  try { appStateSub?.remove?.(); } catch {}
  appStateSub = null;
  await hideBubble();
}

/**
 * Open the Android "Display over other apps" settings page so the user can
 * grant SYSTEM_ALERT_WINDOW permission. This permission is reserved for a
 * future native overlay module (EAS dev build). Today's implementation uses
 * sticky notifications and does NOT require it.
 */
export async function requestOverlayPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    // sendIntent is Android-only and lets us deep-link into the exact settings page
    if ((Linking as any).sendIntent) {
      await (Linking as any).sendIntent('android.settings.action.MANAGE_OVERLAY_PERMISSION');
      return true;
    }
    await Linking.openSettings();
    return true;
  } catch {
    try { await Linking.openSettings(); return true; } catch { return false; }
  }
}
