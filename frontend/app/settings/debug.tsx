import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { colors, radius, spacing } from '../../src/theme';
import { getMarketplace, getDriverMissions, getDriverProfile } from '../../src/api';
import { isImmediateRide } from '../../src/rideTypes';
import { useRides } from '../../src/ridesContext';
import { haptic } from '../../src/feedback';

export default function DebugScreen() {
  const router = useRouter();
  const { onShift, hasActiveMission, pendingCount, latest } = useRides();
  const [loading, setLoading] = useState(false);
  const [marketplaceRaw, setMarketplaceRaw] = useState<any>(null);
  const [missionsRaw, setMissionsRaw] = useState<any>(null);
  const [profileRaw, setProfileRaw] = useState<any>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [mk, ms, pr] = await Promise.allSettled([
        getMarketplace(),
        getDriverMissions(),
        getDriverProfile(),
      ]);
      setMarketplaceRaw(mk.status === 'fulfilled' ? mk.value : { error: (mk.reason as any)?.message });
      setMissionsRaw(ms.status === 'fulfilled' ? ms.value : { error: (ms.reason as any)?.message });
      setProfileRaw(pr.status === 'fulfilled' ? pr.value : { error: (pr.reason as any)?.message });
      setFetchedAt(new Date().toLocaleString('fr-FR'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const copyAll = async () => {
    haptic('light');
    const payload = {
      fetchedAt,
      state: { onShift, hasActiveMission, pendingCount, latestCount: latest.length },
      marketplace: marketplaceRaw,
      missions: missionsRaw,
      profile: profileRaw,
    };
    try {
      await Clipboard.setStringAsync(JSON.stringify(payload, null, 2));
    } catch {}
  };

  const pretty = (obj: any) => {
    try { return JSON.stringify(obj, null, 2); }
    catch { return String(obj); }
  };

  const marketplaceList: any[] = Array.isArray(marketplaceRaw)
    ? marketplaceRaw
    : (marketplaceRaw?.items ?? marketplaceRaw?.listings ?? []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Diagnostic</Text>
        <TouchableOpacity onPress={copyAll} style={styles.iconBtn} testID="copy-btn">
          <Ionicons name="copy-outline" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 80, gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchAll} tintColor={colors.primary} />}
      >
        <View style={styles.card}>
          <Text style={styles.h}>État local</Text>
          <Text style={styles.kv}>onShift: <Text style={styles.v}>{String(onShift)}</Text></Text>
          <Text style={styles.kv}>hasActiveMission: <Text style={styles.v}>{String(hasActiveMission)}</Text></Text>
          <Text style={styles.kv}>pendingCount: <Text style={styles.v}>{pendingCount}</Text></Text>
          <Text style={styles.kv}>latest.length: <Text style={styles.v}>{latest.length}</Text></Text>
          <Text style={styles.kv}>fetched: <Text style={styles.v}>{fetchedAt || '—'}</Text></Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.h}>Marketplace ({marketplaceList.length} items)</Text>
          {marketplaceList.length === 0 ? (
            <Text style={styles.warn}>⚠ Aucune course reçue dans le marketplace.</Text>
          ) : (
            marketplaceList.map((item, i) => {
              const imm = isImmediateRide(item);
              const id = item?.id ?? item?._id ?? `item-${i}`;
              return (
                <View key={String(id)} style={[styles.rideCard, imm ? styles.rideImm : styles.rideSched]}>
                  <Text style={[styles.rideLbl, { color: imm ? colors.primary : colors.textSecondary }]}>
                    {imm ? '⚡ IMMÉDIATE' : '📅 PLANIFIÉE'}
                  </Text>
                  <Text style={styles.rideId}>#{String(id).slice(0, 12)}</Text>
                  <Text style={styles.rideJson} selectable>{pretty(item)}</Text>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.h}>Missions (raw)</Text>
          <Text style={styles.rideJson} selectable>{pretty(missionsRaw)}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.h}>Profile (raw)</Text>
          <Text style={styles.rideJson} selectable>{pretty(profileRaw)}</Text>
        </View>

        <TouchableOpacity style={styles.refreshBtn} onPress={fetchAll} disabled={loading} testID="refresh-btn">
          {loading ? <ActivityIndicator color={colors.onPrimary} /> : (
            <>
              <Ionicons name="refresh" size={18} color={colors.onPrimary} />
              <Text style={styles.refreshText}>RAFRAÎCHIR</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  topTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 16, fontWeight: '800' },
  card: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, padding: spacing.md, gap: 6,
  },
  h: { color: colors.text, fontSize: 13, fontWeight: '900', letterSpacing: 1, marginBottom: 4 },
  kv: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  v: { color: colors.text, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  warn: { color: colors.warning, fontSize: 13 },
  rideCard: { borderRadius: radius.md, padding: 10, borderWidth: 1, marginTop: 4 },
  rideImm: { backgroundColor: colors.primary + '15', borderColor: colors.primary },
  rideSched: { backgroundColor: colors.bg, borderColor: colors.border },
  rideLbl: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  rideId: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  rideJson: {
    fontSize: 10, color: colors.text, marginTop: 6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  refreshBtn: {
    height: 48, borderRadius: radius.full, backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  refreshText: { color: colors.onPrimary, fontWeight: '900', letterSpacing: 1 },
});
