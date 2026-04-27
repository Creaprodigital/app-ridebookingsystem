import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet } from 'react-native';
import { colors } from '../../src/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: Platform.OS === 'ios' ? 84 : 64,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 24 : 10,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Carte',
          tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={color} />,
          tabBarTestID: 'tab-map',
        }}
      />
      <Tabs.Screen
        name="missions"
        options={{
          title: 'Missions',
          tabBarIcon: ({ color, size }) => <Ionicons name="list" size={size} color={color} />,
          tabBarTestID: 'tab-missions',
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Gains',
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet" size={size} color={color} />,
          tabBarTestID: 'tab-earnings',
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'Menu',
          tabBarIcon: ({ color, size }) => <Ionicons name="menu" size={size} color={color} />,
          tabBarTestID: 'tab-menu',
        }}
      />
    </Tabs>
  );
}
