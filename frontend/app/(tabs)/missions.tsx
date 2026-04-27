import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import {
  getDriverMissions,
  getMarketplace,
  claimMarketplace,
  apiError,
} from '../../src/api';

type Tab = 'assigned' | 'available';

const STATUS_META: Record<string, { label: string; color: string }> = {
  assigned: { label: 'Assignée', color: colors.warning },
  en_route: { label: 'En route', color: colors.info },
  arrived: { label: 'Sur place', color: colors.info },
  in_progress: { label: 'À bord', color: colors.primary },
  completed: { label: 'Terminée', color: colors.success },
  cancelled: { label: 'Annulée', color: colors.danger },
};

function fmtMoney(v: any) {
  const n = Number(v);
  if (Number.isFinite(n)) return `${n.toFixed(2)} €`;
  return '—';
}

function pickAddress(m: any, type: 'pickup' | 'dropoff') {
  return (
    m?.[`${type}_address`] ||
    m?.[type]?.address ||
    m?.[`${type}`] ||
    m?.[`${type}_location`]?.address ||
    '—'
  );
}

function pickDt(m: any) {
  return m?.pickup_at || m?.scheduled_at || m?.pickup_time || m?.created_at;
}

function fmtDate(dt?: string) {
  if (!dt) return '';
  try {
    const d = new Date(dt);
    return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return dt;
  }
}

export default function MissionsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('assigned');
  const [assigned, setAssigned] = useState<any[]>([]);
  const [available, setAvailable] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, av] = await Promise.all([
        getDriverMissions().catch(() => []),
        getMarketplace().catch(() => []),
      ]);
      const aList = Array.isArray(a) ? a : a?.items ?? [];
      const avList = Array.isArray(av) ? av : av?.items ?? [];
      setAssigned(aList);
      setAvailable(avList);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const claim = async (id: string) => {
    setClaimingId(id);
    try {
      await claimMarketplace(id);
      await load();
      setTab('assigned');
    } catch (e) {
      const msg = apiError(e);
      if (Platform.OS !== 'web') Alert.alert('Erreur', msg);
    } finally {
      setClaimingId(null);
    }
  };

  const data = tab === 'assigned' ? assigned : available;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.h1}>Missions</Text>
        <Text style={styles.h2}>Gérez vos courses en temps réel</Text>
      </View>

      <View style={styles.tabsRow}>
        {(['assigned', 'available'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && styles.tabActive]}
            testID={`tab-${t}`}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'assigned' ? `Mes missions (${assigned.length})` : `Disponibles (${available.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={data}
        keyExtractor={(item, i) => String(item.id ?? item._id ?? i)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 120, gap: spacing.md }}
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name={tab === 'assigned' ? 'checkmark-done' : 'search'} size={44} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>
                {tab === 'assigned' ? 'Aucune mission assignée' : 'Aucune course disponible'}
              </Text>
              <Text style={styles.emptySub}>
                {tab === 'assigned'
                  ? 'Passez en service pour recevoir des courses.'
                  : 'Revenez bientôt, de nouvelles courses sont ajoutées régulièrement.'}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const status = item.status || 'assigned';
          const meta = STATUS_META[status] ?? { label: status, color: colors.textSecondary };
          const price = item.price ?? item.fare ?? item.amount ?? item.total;
          const pax = item.pax ?? item.passengers ?? item.passenger_count;
          return (
            <TouchableOpacity
              activeOpacity={tab === 'assigned' ? 0.8 : 1}
              onPress={() => tab === 'assigned' && router.push(`/mission/${item.id ?? item._id}`)}
              style={styles.card}
              testID={`mission-card-${item.id ?? item._id}`}
            >
              <View style={styles.cardHead}>
                <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
                <Text style={styles.statusText}>{meta.label.toUpperCase()}</Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.price}>{fmtMoney(price)}</Text>
              </View>

              <View style={styles.route}>
                <View style={styles.routeLine}>
                  <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
                  <View style={styles.routeVert} />
                  <View style={[styles.routeDot, { backgroundColor: colors.danger }]} />
                </View>
                <View style={{ flex: 1, gap: spacing.sm }}>
                  <View>
                    <Text style={styles.routeLabel}>DÉPART</Text>
                    <Text style={styles.addr} numberOfLines={2}>{pickAddress(item, 'pickup')}</Text>
                  </View>
                  <View>
                    <Text style={styles.routeLabel}>ARRIVÉE</Text>
                    <Text style={styles.addr} numberOfLines={2}>{pickAddress(item, 'dropoff')}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.cardFoot}>
                <View style={styles.metaChip}>
                  <Ionicons name="calendar-outline" size={13} color={colors.textSecondary} />
                  <Text style={styles.metaText}>{fmtDate(pickDt(item)) || '—'}</Text>
                </View>
                {pax ? (
                  <View style={styles.metaChip}>
                    <Ionicons name="people-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.metaText}>{pax}</Text>
                  </View>
                ) : null}
                {item.distance_km || item.distance ? (
                  <View style={styles.metaChip}>
                    <Ionicons name="navigate-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.metaText}>
                      {Number(item.distance_km ?? item.distance).toFixed(1)} km
                    </Text>
                  </View>
                ) : null}
              </View>

              {tab === 'available' ? (
                <TouchableOpacity
                  style={styles.claimBtn}
                  onPress={() => claim(item.id ?? item._id)}
                  disabled={claimingId === (item.id ?? item._id)}
                  testID={`claim-${item.id ?? item._id}`}
                >
                  {claimingId === (item.id ?? item._id) ? (
                    <ActivityIndicator color={colors.bg} />
                  ) : (
                    <>
                      <Ionicons name="flash" size={16} color={colors.bg} />
                      <Text style={styles.claimText}>ACCEPTER LA COURSE</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <View style={styles.openHint}>
                  <Text style={styles.openHintText}>Voir détails</Text>
                  <Ionicons name="arrow-forward" size={16} color={colors.primary} />
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  h1: { color: colors.text, fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  h2: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  tabsRow: { flexDirection: 'row', paddingHorizontal: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
  tab: {
    flex: 1, paddingVertical: 12, borderRadius: radius.full, alignItems: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textSecondary, fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
  tabTextActive: { color: colors.bg },
  empty: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 4 },
  emptySub: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', paddingHorizontal: 40 },
  card: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.xl, padding: spacing.md, gap: spacing.md,
  },
  cardHead: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderBottomColor: colors.border, borderBottomWidth: 1, paddingBottom: spacing.sm,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: colors.textSecondary, fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  price: { color: colors.primary, fontSize: 22, fontWeight: '900', letterSpacing: -0.8 },
  route: { flexDirection: 'row', gap: 12, alignItems: 'stretch' },
  routeLine: { alignItems: 'center', paddingTop: 6, paddingBottom: 6, width: 14 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  routeVert: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  routeLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  addr: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 2 },
  cardFoot: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.bg, borderRadius: radius.md,
    paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border,
  },
  metaText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  claimBtn: {
    height: 52, backgroundColor: colors.primary, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  claimText: { color: colors.bg, fontWeight: '900', fontSize: 13, letterSpacing: 1.2 },
  openHint: {
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6,
  },
  openHintText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
});
