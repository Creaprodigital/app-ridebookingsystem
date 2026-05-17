import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../src/auth';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { colors } from '../src/theme';
import { setupPushNotifications } from '../src/pushService';
import { RidesProvider, useRides } from '../src/ridesContext';
import RideRequestModal from '../src/components/RideRequestModal';
import VideoSplash from '../src/components/VideoSplash';
import { haptic } from '../src/feedback';
import { hydrateLastCoords } from '../src/locationStore';

// Hide the native (image) splash as soon as JS boots so our video splash
// takes over without any flicker. expo-splash-screen is a no-op on web.
let SplashScreen: any = null;
try { SplashScreen = require('expo-splash-screen'); } catch {}
try { SplashScreen?.preventAutoHideAsync?.(); } catch {}

function RouteGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, isPro } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const { refreshShift, forceRefresh, hasActiveMission, activeMissionId } = useRides();
  const lastNavigatedMissionRef = React.useRef<string | null>(null);

  // Hydrate persisted GPS coords once at startup so the immediate-ride
  // distance filter has a usable position before the foreground watcher
  // gets its first fix.
  React.useEffect(() => {
    void hydrateLastCoords();
  }, []);

  React.useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === 'login' || segments[0] === 'welcome';
    const inProGroup = segments[0] === '(pro)';
    const inTabsGroup = segments[0] === '(tabs)';
    if (!user && !inAuthGroup) {
      router.replace('/welcome');
    } else if (user && inAuthGroup) {
      router.replace(isPro ? '/(pro)' : '/(tabs)');
    } else if (user && isPro && inTabsGroup) {
      // Driver routes are off-limits for pro accounts
      router.replace('/(pro)');
    } else if (user && !isPro && inProGroup) {
      // Pro routes are off-limits for drivers
      router.replace('/(tabs)');
    }
  }, [user, loading, isPro, segments, router]);

  // Auto-redirect to the active mission whenever the driver opens the app
  // with an in-progress course (assigned/en_route/arrived/in_progress).
  // This guarantees that closing/reopening the app brings the driver
  // straight back to the ride they accepted, exactly like Uber Driver.
  // Pro accounts skip this entirely.
  React.useEffect(() => {
    if (!user || loading || isPro) return;
    if (!hasActiveMission || !activeMissionId) return;

    // Don't redirect if already on the mission detail screen
    const onMissionScreen =
      Array.isArray(segments) && segments[0] === 'mission';
    // Don't redirect from the login screen — RouteGuard will handle that first
    const onLoginScreen = segments[0] === 'login';

    if (onMissionScreen || onLoginScreen) {
      lastNavigatedMissionRef.current = activeMissionId;
      return;
    }
    // Avoid infinite redirects if user manually navigates back somehow
    if (lastNavigatedMissionRef.current === activeMissionId) return;
    lastNavigatedMissionRef.current = activeMissionId;
    try {
      router.replace(`/mission/${activeMissionId}` as any);
    } catch {}
  }, [user, loading, isPro, hasActiveMission, activeMissionId, segments, router]);

  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        await setupPushNotifications({
          role: isPro ? 'pro' : 'driver',
          onTap: (data: any) => {
            if (cancelled) return;
            // Bring the user to the most relevant screen on tap.
            // Pro tappable notifications carry a route in their data payload
            // (set by proNotifications.push when calling notifyLocal).
            const route = data?.route || (isPro ? '/(pro)/notifications' : '/(tabs)/missions');
            try { router.push(route); } catch {}
            haptic('light');
          },
          onIncoming: (_data: any) => {
            // Push received in foreground.
            // For drivers: force an immediate marketplace refresh so the
            // RideRequestModal opens within ~1 second.
            // For pros: the in-app polling already keeps UI fresh, so just
            // play the haptic feedback.
            haptic('heavy');
            if (!isPro) {
              try { forceRefresh(); } catch {}
            }
          },
        });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user, isPro, router, refreshShift, forceRefresh]);

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  const [splashDone, setSplashDone] = React.useState(false);

  // As soon as JS is up, hide the native (image) splash so the video can
  // immediately take over. Native splash is irrelevant on web.
  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    try { SplashScreen?.hideAsync?.(); } catch {}
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <AuthProvider>
          <RidesProvider>
            <RouteGuard>
              <StatusBar style="light" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bg },
                  animation: 'fade',
                }}
              >
                <Stack.Screen name="index" />
                <Stack.Screen name="welcome" />
                <Stack.Screen name="login" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="(pro)" />
                <Stack.Screen name="profile" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="notifications" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="settings/index" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="settings/sounds" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="settings/navigation" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="settings/notifications" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="settings/immediate" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="settings/permissions" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="settings/debug" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="mission/[id]" options={{ presentation: 'card', animation: 'slide_from_right' }} />
              </Stack>
              {/* Premium Uber-style ride request modal — globally available */}
              <RideRequestModal />
            </RouteGuard>
          </RidesProvider>
        </AuthProvider>
        {/* Video splash plays on every cold start: 250ms fade-in + 4500ms visible + 450ms fade-out. */}
        {!splashDone && (
          <VideoSplash durationMs={5200} onDone={() => setSplashDone(true)} />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
