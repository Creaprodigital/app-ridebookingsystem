import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View, StyleSheet } from 'react-native';
import { colors } from '../../src/theme';

export default function ProLayout() {
  return (
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
          height: Platform.OS === 'ios' ? 84 : 64,
          paddingTop: 6,
          paddingBottom: Platform.OS === 'ios' ? 24 : 6,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
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
          tabBarIcon: ({ color }) => (
            <View style={styles.fabIcon}>
              <Ionicons name="add" size={26} color={colors.bg} />
            </View>
          ),
          tabBarLabelStyle: { fontSize: 10, fontWeight: '900', letterSpacing: 0.3, color: colors.primary },
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
      <Tabs.Screen
        name="menu"
        options={{
          href: null, // hidden from tab bar, accessed from headers
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  fabIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginTop: -8,
    shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
