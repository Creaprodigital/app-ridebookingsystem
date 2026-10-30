// Background GPS tracking using expo-location + expo-task-manager.
// Runs while the driver is on shift so:
//   • the global locationStore stays fresh even when the app is minimized,
//   • the haversine distance filter for incoming immediate rides remains
//     accurate when a push notification wakes the JS engine.
//
// Web is unsupported (the underlying TaskManager does not exist there).

import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { setLastCoords } from './locationStore';
import { pushLocation } from './api';

export const LOCATION_TASK_NAME = 'sharedride-driver-location-v1';

let definedTask = false;
let starting: Promise<void> | null = null;
let stopping: Promise<void> | null = null;
let lastBackendPush = 0;

// Define the TaskManager handler ONCE, at module load (must be top-level so
// it survives JS-engine-wakeups triggered by the OS).
function defineTaskOnce() {
  if (definedTask) return;
  definedTask = true;
  if (Platform.OS === 'web') return;
  try {
    TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: any) => {
      if (error) return;
      if (!data) return;
      const locs = (data as any).locations as Location.LocationObject[] | undefined;
      if (!locs || !locs.length) return;
      // Use the freshest fix
      const last = locs[locs.length - 1];
      const lat = last?.coords?.latitude;
      const lng = last?.coords?.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      // Update in-memory + persisted store
      setLastCoords({ lat: Number(lat), lng: Number(lng) });

      // Throttle backend push to ≤ 1 per 12 s to save bandwidth/battery
      const now = Date.now();
      if (now - lastBackendPush > 12_000) {
        lastBackendPush = now;
        try {
          await pushLocation({
            lat: Number(lat),
            lng: Number(lng),
            heading: last?.coords?.heading ?? null,
            speed: last?.coords?.speed ?? null,
          } as any);
        } catch {}
      }
    });
  } catch {}
}

// Eager init at import time
defineTaskOnce();

export async function isBackgroundLocationActive(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  } catch {
    return false;
  }
}

/**
 * Starts the foreground-service-backed location tracker. Idempotent.
 * Returns false silently if web or if the user denied background permission.
 */
export async function startBackgroundLocation(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (starting) {
    await starting;
    return true;
  }
  starting = (async () => {
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') return;

      // Background permission is optional but recommended on Android 10+.
      try { await Location.requestBackgroundPermissionsAsync(); } catch {}

      const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (already) return;

      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.High,
        timeInterval: 8_000,           // 8s sweet-spot
        distanceInterval: 25,          // 25m threshold
        deferredUpdatesInterval: 10_000,
        showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false,
        // Android: foreground service notification (mandatory on API 26+)
        foregroundService: Platform.OS === 'android' ? {
          notificationTitle: 'RideBookingSystem en service',
          notificationBody: 'Position partagée pendant votre shift',
          notificationColor: '#F5B72E',
        } : undefined,
      });
    } catch {}
  })();
  await starting;
  starting = null;
  return true;
}

/**
 * Stops the background tracker. Idempotent. Safe to call when not running.
 */
export async function stopBackgroundLocation(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (stopping) {
    await stopping;
    return;
  }
  stopping = (async () => {
    try {
      const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (already) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    } catch {}
  })();
  await stopping;
  stopping = null;
}
