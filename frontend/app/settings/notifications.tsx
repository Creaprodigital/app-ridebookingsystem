import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Switch, ActivityIndicator, Alert, Platform } from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import {
  isPushEnabled,
  setPushEnabled,
  setupPushNotifications,
  disablePushNotifications,
  getStoredPushToken,
} from '../../src/pushService';
import { ensureNotifPermission, notifyNewRide, haptic } from '../../src/feedback';
import { useAuth } from '../../src/auth';

export default function NotificationsSettings() {
  const router = useRouter();
  const { isPro } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<boolean>(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState<boolean>(false);
  const [errorReason, setErrorReason] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const en = await isPushEnabled();
    setEnabled(en);
    const tk = await getStoredPushToken();
    setToken(tk);
    if (en && Platform.OS !== 'web') {
      try {
        const Notifications = require('expo-notifications');
        const cur = await Notifications.getPermissionsAsync();
        setPermission(cur.status === 'granted');
      } catch {
        setPermission(false);
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onToggle = async (next: boolean) => {
    haptic('light');
    setBusy(true);
    try {
      if (next) {
        await setPushEnabled(true);
        const r = await setupPushNotifications({ role: isPro ? 'pro' : 'driver' });
        setEnabled(r.enabled);
        setPermission(r.permission);
        setToken(r.token);
        setRegistered(r.registered);
        setErrorReason(r.error ?? null);
        if (!r.permission) {
          Alert.alert(
            'Permission refusée',
            'Activez les notifications dans les réglages système pour recevoir des alertes de courses.'
          );
        }
      } else {
        await disablePushNotifications();
        setEnabled(false);
        setToken(null);
        setRegistered(false);
        setErrorReason(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    haptic('success');
    const ok = await ensureNotifPermission();
    if (!ok) {
      Alert.alert('Permission requise', 'Autorisez les notifications pour tester.');
      return;
    }
    await notifyNewRide({
      title: 'Test — Nouvelle course',
      body: 'Ceci est une notification de test Ridebookingsystem.',
      data: { route: '/(tabs)/missions', test: true },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Notifications</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        <Text style={styles.subtitle}>
          Recevez une alerte instantanée dès qu’une nouvelle course apparaît dans le marketplace.
        </Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="notifications" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Notifications push</Text>
              <Text style={styles.rowSub}>
                {enabled
                  ? permission
                    ? 'Activées · Vous recevrez les nouvelles courses'
                    : 'Activées mais permission système refusée'
                  : 'Désactivées'}
              </Text>
            </View>
            {busy ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Switch
                value={enabled}
                onValueChange={onToggle}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor={enabled ? '#fff' : colors.textMuted}
                testID="push-toggle"
              />
            )}
          </View>
        </View>

        {enabled && permission ? (
          <View style={styles.card}>
            <TouchableOpacity
              onPress={sendTest}
              activeOpacity={0.7}
              style={styles.row}
              testID="send-test-notif"
            >
              <View style={styles.rowIcon}>
                <Ionicons name="paper-plane-outline" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Envoyer une notification test</Text>
                <Text style={styles.rowSub}>
                  Vérifie que tout fonctionne sur votre appareil
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={[styles.row, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
            <View style={styles.rowIcon}>
              <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Comment ça marche</Text>
              <Text style={styles.rowSub}>
                Une notification est envoyée par votre flotte dès qu’une course est publiée dans le marketplace,
                ainsi qu’à chaque mise à jour de mission.
              </Text>
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="hardware-chip-outline" size={18} color={colors.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Identifiant de l’appareil</Text>
              <Text style={[styles.rowSub, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 10 }]}
                numberOfLines={2}
                selectable
              >
                {token ? token : 'Aucun token enregistré · activez d’abord les notifications.'}
              </Text>
              {token ? (
                <Text style={[styles.rowSub, { color: registered ? colors.success : colors.warning }]}>
                  {registered ? '✓ Enregistré côté serveur' : '⚠ Enregistrement serveur en attente'}
                </Text>
              ) : null}
              {!token && errorReason ? (
                <Text style={[styles.rowSub, { color: colors.danger, marginTop: 4 }]}>
                  ⚠ {errorReason}
                </Text>
              ) : null}
            </View>
          </View>
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
  rowIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
});
