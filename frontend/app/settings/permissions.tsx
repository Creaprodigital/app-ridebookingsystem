import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { colors, radius, spacing } from '../../src/theme';

// Lazy requires to avoid web crashes
let Camera: any = null;
let Notifications: any = null;
let Contacts: any = null;
let Audio: any = null;
try { Camera = require('expo-camera'); } catch {}
try { Notifications = require('expo-notifications'); } catch {}
try { Contacts = require('expo-contacts'); } catch {}
try { Audio = require('expo-audio'); } catch {}

type Status = 'granted' | 'denied' | 'undetermined' | 'unavailable';

type Perm = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  check: () => Promise<Status>;
  request: () => Promise<Status>;
  phoneOnly?: boolean;
};

async function safeStatus(fn: () => Promise<any>): Promise<Status> {
  try {
    const r = await fn();
    if (!r) return 'unavailable';
    if (r.granted) return 'granted';
    if (r.status === 'granted') return 'granted';
    if (r.status === 'denied') return 'denied';
    if (r.status === 'undetermined') return 'undetermined';
    return 'undetermined';
  } catch {
    return 'unavailable';
  }
}

const PERMS: Perm[] = [
  {
    id: 'camera',
    icon: 'camera-outline',
    label: 'Appareil photo',
    sub: 'Pour photographier documents et incidents',
    phoneOnly: true,
    check: () => safeStatus(async () => Camera?.getCameraPermissionsAsync?.()),
    request: () => safeStatus(async () => Camera?.requestCameraPermissionsAsync?.()),
  },
  {
    id: 'location',
    icon: 'location-outline',
    label: 'Position (GPS)',
    sub: 'Indispensable pour recevoir et effectuer les courses',
    check: () => safeStatus(async () => Location.getForegroundPermissionsAsync()),
    request: () => safeStatus(async () => Location.requestForegroundPermissionsAsync()),
  },
  {
    id: 'notifications',
    icon: 'notifications-outline',
    label: 'Notifications',
    sub: 'Pour être alerté des nouvelles courses',
    phoneOnly: true,
    check: () => safeStatus(async () => Notifications?.getPermissionsAsync?.()),
    request: () => safeStatus(async () => Notifications?.requestPermissionsAsync?.()),
  },
  {
    id: 'contacts',
    icon: 'people-outline',
    label: 'Contacts',
    sub: 'Associer rapidement un passager à un contact',
    phoneOnly: true,
    check: () => safeStatus(async () => Contacts?.getPermissionsAsync?.()),
    request: () => safeStatus(async () => Contacts?.requestPermissionsAsync?.()),
  },
  {
    id: 'microphone',
    icon: 'mic-outline',
    label: 'Microphone',
    sub: 'Assistance vocale et messages audio',
    phoneOnly: true,
    check: () => safeStatus(async () => Audio?.getRecordingPermissionsAsync?.()),
    request: () => safeStatus(async () => Audio?.requestRecordingPermissionsAsync?.()),
  },
  {
    id: 'phone',
    icon: 'call-outline',
    label: 'Téléphone',
    sub: 'Passer des appels aux passagers depuis l’app',
    phoneOnly: true,
    check: async () => 'granted', // handled by OS at call time
    request: async () => 'granted',
  },
];

const LABELS: Record<Status, { text: string; color: string }> = {
  granted: { text: 'Autorisé', color: colors.success },
  denied: { text: 'Refusé', color: colors.danger },
  undetermined: { text: 'Non défini', color: colors.warning },
  unavailable: { text: 'Non disponible', color: colors.textMuted },
};

export default function PermissionsScreen() {
  const router = useRouter();
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next: Record<string, Status> = {};
    for (const p of PERMS) {
      if (Platform.OS === 'web' && p.phoneOnly) {
        next[p.id] = 'unavailable';
        continue;
      }
      next[p.id] = await p.check();
    }
    setStatuses(next);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const handleRequest = async (p: Perm) => {
    if (Platform.OS === 'web' && p.phoneOnly) {
      Alert.alert?.('Non disponible', 'Cette autorisation n’est requise que sur mobile.');
      return;
    }
    setLoadingId(p.id);
    try {
      const s = await p.request();
      setStatuses((prev) => ({ ...prev, [p.id]: s }));
      if (s === 'denied') {
        if (Platform.OS === 'web') {
          window.alert('Autorisation refusée. Ouvrez les paramètres système pour l’activer.');
        } else {
          Alert.alert(
            'Autorisation refusée',
            'Pour activer cette fonctionnalité, ouvrez les paramètres du téléphone.',
            [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Ouvrir paramètres', onPress: () => Linking.openSettings() },
            ],
          );
        }
      }
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Autorisations</Text>
        <TouchableOpacity onPress={refresh} style={styles.iconBtn} testID="refresh-btn">
          <Ionicons name="refresh" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        <View>
          <Text style={styles.h1}>Autorisations de l’application</Text>
          <Text style={styles.h2}>Gérez ce à quoi l’app a accès sur votre appareil</Text>
        </View>

        <View style={styles.card}>
          {PERMS.map((p, i) => {
            const s = statuses[p.id] ?? 'undetermined';
            const lbl = LABELS[s];
            const canRequest = s === 'undetermined' || s === 'denied';
            const busy = loadingId === p.id;
            return (
              <View key={p.id} style={[styles.row, i < PERMS.length - 1 && styles.rowBorder]}>
                <View style={styles.rowIcon}>
                  <Ionicons name={p.icon} size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{p.label}</Text>
                  <Text style={styles.rowSub}>{p.sub}</Text>
                  <View style={[styles.badge, { backgroundColor: lbl.color + '22', borderColor: lbl.color }]}>
                    <View style={[styles.badgeDot, { backgroundColor: lbl.color }]} />
                    <Text style={[styles.badgeText, { color: lbl.color }]}>{lbl.text}</Text>
                  </View>
                </View>
                {s !== 'unavailable' ? (
                  <TouchableOpacity
                    onPress={() => handleRequest(p)}
                    disabled={busy}
                    style={[styles.actionBtn, !canRequest && styles.actionBtnDone]}
                    testID={`perm-${p.id}`}
                  >
                    {busy ? (
                      <ActivityIndicator color={canRequest ? colors.bg : colors.text} size="small" />
                    ) : (
                      <Text style={[styles.actionText, !canRequest && { color: colors.text }]}>
                        {canRequest ? 'Activer' : 'Gérer'}
                      </Text>
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </View>

        {Platform.OS !== 'web' ? (
          <TouchableOpacity style={styles.sysBtn} onPress={() => Linking.openSettings()} testID="open-system-settings">
            <Ionicons name="settings-outline" size={18} color={colors.text} />
            <Text style={styles.sysBtnText}>Ouvrir les paramètres système</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.hint}>
            Les permissions natives (caméra, notifications, contacts, micro) ne sont actives que sur mobile (Expo Go).
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  topTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 16, fontWeight: '800' },
  h1: { color: colors.text, fontSize: 22, fontWeight: '800' },
  h2: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: spacing.md, paddingVertical: 14 },
  rowBorder: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  rowIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  badge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, marginTop: 6,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  actionBtn: {
    backgroundColor: colors.primary, height: 36, paddingHorizontal: 14,
    borderRadius: 18, alignItems: 'center', justifyContent: 'center',
  },
  actionBtnDone: { backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border },
  actionText: { color: colors.bg, fontWeight: '800', fontSize: 12, letterSpacing: 0.8 },
  sysBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    height: 52, borderRadius: radius.full,
  },
  sysBtnText: { color: colors.text, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
});
