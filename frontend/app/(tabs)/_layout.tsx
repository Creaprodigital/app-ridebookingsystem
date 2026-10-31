import React from 'react';
import { Tabs } from 'expo-router';
import TabBar from '../../src/components/TabBar';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Accueil' }} />
      <Tabs.Screen name="missions" options={{ title: 'Courses' }} />
      <Tabs.Screen name="earnings" options={{ title: 'Gains' }} />
      <Tabs.Screen name="menu" options={{ title: 'Compte' }} />
      {/* Hidden from the bottom bar — opened from the Courses screen header. */}
      <Tabs.Screen name="history" options={{ title: 'Historique', href: null }} />
    </Tabs>
  );
}
