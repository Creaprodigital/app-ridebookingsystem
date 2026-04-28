import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../src/auth';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { colors } from '../src/theme';
import { setupPushNotifications } from '../src/pushService';
import { RidesProvider } from '../src/ridesContext';
import RideRequestModal from '../src/components/RideRequestModal';

function RouteGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  React.useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === 'login';
    if (!user && !inAuthGroup) {
      router.replace('/login');
    } else if (user && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [user, loading, segments, router]);

  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        await setupPushNotifications({
          onTap: (data: any) => {
            if (cancelled) return;
            const route = data?.route || '/(tabs)/missions';
            try { router.push(route); } catch {}
          },
        });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user, router]);

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
                <Stack.Screen name="login" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="profile" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="notifications" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="settings/index" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="settings/sounds" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="settings/navigation" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="settings/notifications" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="settings/permissions" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="mission/[id]" options={{ presentation: 'card', animation: 'slide_from_right' }} />
              </Stack>
              {/* Premium Uber-style ride request modal — globally available */}
              <RideRequestModal />
            </RouteGuard>
          </RidesProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
