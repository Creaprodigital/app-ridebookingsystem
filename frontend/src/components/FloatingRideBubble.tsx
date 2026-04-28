import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useRides } from '../ridesContext';
import {
  setBubbleDataProvider,
  startFloatingBubble,
  stopFloatingBubble,
} from '../androidOverlayService';

/**
 * FloatingRideBubble (Android only)
 *
 * Behaviour:
 *   • iOS / Web → renders nothing, no listeners (no-op).
 *   • Android   → starts the floating-bubble service when mounted. The service
 *                 hooks into AppState; when the app goes to background a
 *                 sticky high-priority notification is displayed (acts as a
 *                 system-level bubble). When the app returns to foreground
 *                 the notification is automatically dismissed.
 *
 * The component itself does NOT render anything on screen — all visible UI
 * lives in the system notification shade so it remains visible over other
 * apps while the driver is using GPS/messaging/etc.
 *
 * Note (production-ready upgrade path):
 *   For a true draggable chat-head overlay (Messenger style) you'll need a
 *   custom native module + the SYSTEM_ALERT_WINDOW permission (already
 *   declared in app.json) and an EAS dev build. The service exports
 *   `requestOverlayPermission()` to deep-link into the corresponding Android
 *   settings screen.
 */
export default function FloatingRideBubble() {
  const { latest, newRidesCount, hasNew } = useRides();
  const dataRef = useRef({ count: 0, latest: [] as any[] });

  // Keep the most recent ride summary available to the native service
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const count = hasNew ? Math.max(latest.length, newRidesCount) : latest.length;
    dataRef.current = { count, latest };
    setBubbleDataProvider(() => dataRef.current);
  }, [latest, newRidesCount, hasNew]);

  // Start / stop the AppState-driven service for the lifetime of this component
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    setBubbleDataProvider(() => dataRef.current);
    startFloatingBubble();
    return () => {
      stopFloatingBubble();
    };
  }, []);

  // Component renders nothing — UI is the system notification.
  return null;
}
