import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, shadow } from '../../src/theme';
import { ProNotificationsProvider } from '../../src/proNotifications';

function FabIcon() {
  return (
    <View style={styles.fabIcon}>
      <Ionicons name="add" size={26} color={colors.onPrimary} />
    </View>
  );
}

export default function ProLayout() {
  const insets = useSafeAreaInsets();
  // Add the safe-area bottom inset to the tab bar so the navigation gesture
  // area never hides the content on Android phones with gesture nav bar.
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'ios' ? 24 : 12);
  return (
    <ProNotificationsProvider>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 66 + bottomPad,
          paddingTop: 8,
          paddingBottom: bottomPad,
          ...shadow,
        },
        tabBarLabelStyle: { fontSize: 11.5, fontFamily: 'Manrope_700Bold' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="dispatch"
        options={{
          title: 'Dispatch',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="git-network-outline" size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Créer',
          tabBarIcon: () => <FabIcon />,
          tabBarLabelStyle: { fontSize: 11.5, fontFamily: 'Manrope_700Bold', color: colors.primary },
        }}
      />
      <Tabs.Screen
        name="drivers"
        options={{
          title: 'Chauffeurs',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Carte',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map-outline" size={size ?? 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="menu" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
    </Tabs>
    </ProNotificationsProvider>
  );
}

const styles = StyleSheet.create({
  fabIcon: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginTop: -10,
    shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
