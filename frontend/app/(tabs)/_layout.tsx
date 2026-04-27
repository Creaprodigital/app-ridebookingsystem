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
      <Tabs.Screen name="earnings" options={{ title: 'Gains' }} />
      <Tabs.Screen name="menu" options={{ title: 'Menu' }} />
    </Tabs>
  );
}
