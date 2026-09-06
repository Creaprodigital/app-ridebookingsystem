import React from 'react';
import { Tabs } from 'expo-router';
import TabBar from '../../src/components/TabBar';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Carte' }} />
      <Tabs.Screen name="missions" options={{ title: 'Missions' }} />
      {/* Hidden from the bottom bar — accessible only from the Menu now.
          `href: null` tells expo-router to keep the route mounted for
          navigation but skip it when rendering the tab bar. */}
      <Tabs.Screen name="earnings" options={{ title: 'Portefeuille', href: null }} />
      <Tabs.Screen name="history" options={{ title: 'Historique' }} />
      <Tabs.Screen name="menu" options={{ title: 'Menu' }} />
    </Tabs>
  );
}
