import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';

type Row = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  onPress: () => void;
  testID?: string;
};

export default function SettingsIndex() {
  const router = useRouter();

  const rows: Row[] = [
    {
      icon: 'notifications-outline',
      label: 'Notifications push',
      sub: 'Recevez les nouvelles courses en temps réel',
      onPress: () => router.push('/settings/notifications'),
      testID: 'settings-notifications',
    },
    {
      icon: 'musical-notes-outline',
      label: 'Sons',
      sub: 'Choisissez votre sonnerie de notification',
      onPress: () => router.push('/settings/sounds'),
      testID: 'settings-sounds',
    },
    {
      icon: 'navigate-outline',
      label: 'Navigation',
      sub: 'GPS par défaut : Google Maps ou Waze',
      onPress: () => router.push('/settings/navigation'),
      testID: 'settings-navigation',
    },
    {
      icon: 'shield-checkmark-outline',
      label: 'Autorisations de l’application',
      sub: 'Caméra, position, notifications, contacts, micro, téléphone',
      onPress: () => router.push('/settings/permissions'),
      testID: 'settings-permissions',
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Paramètres</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        <Text style={styles.subtitle}>Personnalisez votre expérience</Text>

        <View style={styles.card}>
          {rows.map((r, i) => (
            <TouchableOpacity
              key={r.label}
              onPress={r.onPress}
              activeOpacity={0.7}
              style={[styles.row, i < rows.length - 1 && styles.rowBorder]}
              testID={r.testID}
            >
              <View style={styles.rowIcon}>
                <Ionicons name={r.icon} size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Text style={styles.rowSub}>{r.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  topTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 16, fontWeight: '800' },
  subtitle: { color: colors.textSecondary, fontSize: 13 },
  card: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  rowBorder: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  rowIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
});
