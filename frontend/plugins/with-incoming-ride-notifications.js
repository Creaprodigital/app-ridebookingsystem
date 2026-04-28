/**
 * Expo Config Plugin — with-incoming-ride-notifications
 * --------------------------------------------------------------------------
 * Prepares the native projects for "incoming-call style" ride request
 * notifications:
 *
 *   ANDROID
 *   ------
 *   • Adds the permissions required for full-screen-intent + screen wake-up:
 *       - android.permission.USE_FULL_SCREEN_INTENT
 *       - android.permission.WAKE_LOCK
 *       - android.permission.DISABLE_KEYGUARD
 *       - android.permission.SCHEDULE_EXACT_ALARM
 *       - android.permission.POST_NOTIFICATIONS
 *       - android.permission.RECEIVE_BOOT_COMPLETED
 *       - android.permission.FOREGROUND_SERVICE
 *       - android.permission.FOREGROUND_SERVICE_LOCATION
 *   • Sets the MainActivity flags so that when a notification taps wakes
 *     the app, it appears OVER the lock screen and turns the display on:
 *       - android:showWhenLocked = "true"
 *       - android:turnScreenOn   = "true"
 *       - android:launchMode     = "singleTask"
 *
 *   iOS
 *   ---
 *   • Declares Time-Sensitive notifications support in Info.plist so the
 *     server can post `interruptionLevel: "time-sensitive"` notifications
 *     that appear above the lock-screen banners and bypass focus modes.
 *
 * The plugin only prepares the manifest/Info.plist. Actual posting of a
 * full-screen-intent notification from JS would still require a native
 * module that calls NotificationCompat.Builder#setFullScreenIntent on
 * Android (or CallKit on iOS). Once that module is added (in an EAS dev
 * build) the manifest is already correct.
 */

const { withAndroidManifest, withInfoPlist, AndroidConfig } = require('@expo/config-plugins');

const REQUIRED_PERMISSIONS = [
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.WAKE_LOCK',
  'android.permission.DISABLE_KEYGUARD',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.VIBRATE',
];

function ensurePermission(manifest, name) {
  if (!Array.isArray(manifest['uses-permission'])) manifest['uses-permission'] = [];
  const exists = manifest['uses-permission'].some(
    (p) => p && p.$ && p.$['android:name'] === name
  );
  if (!exists) {
    manifest['uses-permission'].push({ $: { 'android:name': name } });
  }
}

function withIncomingRideNotificationsAndroid(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // 1. Permissions
    REQUIRED_PERMISSIONS.forEach((p) => ensurePermission(manifest, p));

    // 2. MainActivity flags for over-lock-screen wake-up
    try {
      const mainApp = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
      const mainActivity = (mainApp.activity || []).find(
        (a) => a.$ && (a.$['android:name'] === '.MainActivity' || /MainActivity$/.test(a.$['android:name']))
      );
      if (mainActivity) {
        mainActivity.$['android:showWhenLocked'] = 'true';
        mainActivity.$['android:turnScreenOn'] = 'true';
        mainActivity.$['android:launchMode'] = 'singleTask';
        mainActivity.$['android:excludeFromRecents'] = 'false';
      }
    } catch {
      /* main application not yet generated — it will be on prebuild */
    }
    return cfg;
  });
}

function withIncomingRideNotificationsIos(config) {
  return withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;
    // Allow time-sensitive notifications (iOS 15+).
    plist.NSUserActivityTypes = plist.NSUserActivityTypes || [];
    // Background modes: remote-notification + audio so the alert tone keeps
    // playing while the system surfaces the banner.
    if (!Array.isArray(plist.UIBackgroundModes)) plist.UIBackgroundModes = [];
    ['remote-notification', 'audio', 'fetch'].forEach((mode) => {
      if (!plist.UIBackgroundModes.includes(mode)) plist.UIBackgroundModes.push(mode);
    });
    // Helpful description shown when the OS prompts for time-sensitive access
    if (!plist.NSUserNotificationsUsageDescription) {
      plist.NSUserNotificationsUsageDescription =
        'Recevez les nouvelles courses immédiatement, même écran verrouillé';
    }
    return cfg;
  });
}

module.exports = (config) => {
  config = withIncomingRideNotificationsAndroid(config);
  config = withIncomingRideNotificationsIos(config);
  return config;
};
