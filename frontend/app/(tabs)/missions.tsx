import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  getMarketplaceConfig,
  claimMarketplace,
  getDriverProfile,
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
  const b = m?.booking || {};
  return (
    b[`${type}_address`] ||
    m?.[`${type}_address`] ||
    m?.[type]?.address ||
    m?.[`${type}`] ||
    m?.[`${type}_location`]?.address ||
    (type === 'dropoff' ? 'À disposition' : '—')
  );
}

function pickDt(m: any) {
  return (
    m?.booking?.pickup_at ||
    m?.pickup_at ||
    m?.scheduled_at ||
    m?.pickup_time ||
    m?.created_at
  );
}

function pickPax(m: any) {
  return m?.booking?.pax ?? m?.pax ?? m?.passengers ?? m?.passenger_count;
}

function pickVehicleCategory(m: any) {
  return (
    m?.booking?.vehicle_category_label ||
    m?.vehicle_category_label ||
    m?.booking?.vehicle_category ||
    m?.vehicle_category
  );
}

function pickAmount(m: any) {
  return m?.amount ?? m?.price ?? m?.fare ?? m?.total ?? m?.booking?.price;
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
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<any>(null);
  const [onShift, setOnShift] = useState<boolean | null>(null);
  const [debug, setDebug] = useState<string>('');
  const pollRef = useRef<any>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [a, av, cfg, prof] = await Promise.allSettled([
        getDriverMissions(),
        getMarketplace(),
        getMarketplaceConfig(),
        getDriverProfile(),
      ]);

      if (a.status === 'fulfilled') {
        const v = a.value;
        setAssigned(Array.isArray(v) ? v : v?.items ?? []);
      } else {
        setAssigned([]);
      }

      if (av.status === 'fulfilled') {
        const v = av.value;
        const list = Array.isArray(v) ? v : v?.items ?? v?.listings ?? [];
        setAvailable(list);
        // Detailed diagnostic
        const driverInfo: any = prof.status === 'fulfilled' ? prof.value : {};
        const u = driverInfo?.user || {};
        const tenantInfo = driverInfo?.tenant || {};
        const dbg: string[] = [];
        if (Array.isArray(v)) {
          dbg.push(`✓ Marketplace OK: ${list.length} course(s)`);
        } else if (v && typeof v === 'object') {
          const keys = Object.keys(v);
          dbg.push(keys.length === 0
            ? `Réponse vide {} → marketplace désactivée pour votre tenant`
            : `Marketplace: ${list.length} course(s) · Wrapper keys: ${keys.join(',')}`
          );
        }
        // Inspect first listing to find correct field names
        if (list.length > 0) {
          const first = list[0];
          const topKeys = Object.keys(first || {}).slice(0, 12).join(',');
          dbg.push(`Item keys: ${topKeys}`);
          if (first?.booking) {
            const bk = Object.keys(first.booking).slice(0, 12).join(',');
            dbg.push(`booking keys: ${bk}`);
          }
        }
        if (u.email) dbg.push(`Driver: ${u.email}`);
        if (u.tenant_id || tenantInfo.id) dbg.push(`Tenant: ${u.tenant_id || tenantInfo.id}`);
        if (cfg.status === 'fulfilled' && cfg.value) {
          const c: any = cfg.value;
          if (c.enabled !== undefined) dbg.push(`Config enabled: ${c.enabled}`);
        }
        setDebug(dbg.join('\n'));
      } else {
        setAvailable([]);
        const msg = apiError(av.reason);
        setError(msg);
        setDebug(`Erreur marketplace: ${msg}`);
      }

      if (cfg.status === 'fulfilled') {
        setConfig(cfg.value);
      }

      if (prof.status === 'fulfilled') {
        const p: any = prof.value;
        const shiftFlag = p?.user?.on_shift ?? p?.on_shift ?? p?.is_on_shift ?? p?.shift_active;
        setOnShift(Boolean(shiftFlag));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      // Auto refresh marketplace every 20s while focused
      pollRef.current = setInterval(() => load(true), 20000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
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
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 120, gap: spacing.md }}
        ListHeaderComponent={
          tab === 'available' ? (
            <View style={{ gap: 8 }}>
              {/* Marketplace status banners */}
              {config && config.enabled === false ? (
                <View style={styles.warnBanner} testID="market-disabled">
                  <Ionicons name="lock-closed" size={16} color={colors.warning} />
                  <Text style={styles.warnText}>
                    Le marketplace est désactivé pour votre flotte. Demandez à votre opérateur de l’activer.
                  </Text>
                </View>
              ) : null}

              {onShift === false ? (
                <View style={styles.warnBanner} testID="not-on-shift">
                  <Ionicons name="information-circle" size={16} color={colors.warning} />
                  <Text style={styles.warnText}>
                    Vous êtes hors service. Passez en service depuis l’onglet Carte pour voir et accepter les courses.
                  </Text>
                </View>
              ) : null}

              {error ? (
                <View style={styles.errorBanner} testID="market-error">
                  <Ionicons name="alert-circle" size={16} color={colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                  <TouchableOpacity onPress={() => load()} style={styles.retryBtn} testID="retry-btn">
                    <Ionicons name="refresh" size={14} color={colors.primary} />
                    <Text style={styles.retryText}>Réessayer</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {available.length > 0 ? (
                <View style={styles.liveRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>EN DIRECT — Mises à jour automatiques</Text>
                </View>
              ) : null}

              {debug ? (
                <Text style={styles.debugTxt} testID="market-debug">{debug}</Text>
              ) : null}
            </View>
          ) : null
        }
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
                  : 'Aucune course dans le marketplace pour le moment. Cette page se rafraîchit automatiquement toutes les 20 secondes.'}
              </Text>
              {tab === 'available' ? (
                <TouchableOpacity onPress={() => load()} style={styles.retryBtn} testID="empty-refresh-btn">
                  <Ionicons name="refresh" size={14} color={colors.primary} />
                  <Text style={styles.retryText}>Rafraîchir maintenant</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )
        }
        renderItem={({ item }) => {
          const status = item.status || (tab === 'available' ? 'open' : 'assigned');
          const meta = STATUS_META[status] ?? { label: status, color: colors.textSecondary };
          const price = pickAmount(item);
          const pax = pickPax(item);
          const vehicleCat = pickVehicleCategory(item);
          const isMarketplace = tab === 'available';
          return (
            <TouchableOpacity
              activeOpacity={tab === 'assigned' ? 0.8 : 1}
              onPress={() => tab === 'assigned' && router.push(`/mission/${item.id ?? item._id}`)}
              style={styles.card}
              testID={`mission-card-${item.id ?? item._id}`}
            >
              <View style={styles.cardHead}>
                {isMarketplace ? (
                  <View style={[styles.badge, { backgroundColor: colors.primary + '22', borderColor: colors.primary }]}>
                    <Text style={[styles.badgeText, { color: colors.primary }]}>
                      {item.auto_posted ? 'AUTO-PUBLIÉE' : 'PUBLIÉE PAR LA COMPAGNIE'}
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
                    <Text style={styles.statusText}>{meta.label.toUpperCase()}</Text>
                  </>
                )}
                <View style={{ flex: 1 }} />
                <View style={{ alignItems: 'flex-end' }}>
                  {isMarketplace ? (
                    <Text style={styles.priceLbl}>COMMISSION</Text>
                  ) : null}
                  <Text style={styles.price}>{fmtMoney(price)}</Text>
                </View>
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
                {vehicleCat ? (
                  <View style={styles.metaChip} testID={`vehicle-cat-${item.id ?? item._id}`}>
                    <Ionicons name="car-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.metaText}>{vehicleCat}</Text>
                  </View>
                ) : null}
                {pax ? (
                  <View style={styles.metaChip} testID={`pax-${item.id ?? item._id}`}>
                    <Ionicons name="people-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.metaText}>{pax} pax</Text>
                  </View>
                ) : null}
                {item.distance_km || item.distance || item.booking?.distance_km ? (
                  <View style={styles.metaChip}>
                    <Ionicons name="navigate-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.metaText}>
                      {Number(item.distance_km ?? item.distance ?? item.booking?.distance_km).toFixed(1)} km
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
  liveRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    backgroundColor: colors.success + '15', borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.success + '40', alignSelf: 'flex-start',
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  liveText: { color: colors.success, fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.danger + '20', borderColor: colors.danger,
    borderWidth: 1, borderRadius: radius.lg, padding: 10,
  },
  errorText: { color: colors.danger, fontSize: 12, fontWeight: '600', flex: 1 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full,
    backgroundColor: colors.primary + '22', borderWidth: 1, borderColor: colors.primary,
    marginTop: 8,
  },
  retryText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  warnBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.warning + '15', borderColor: colors.warning,
    borderWidth: 1, borderRadius: radius.lg, padding: 10,
  },
  warnText: { color: colors.warning, fontSize: 12, fontWeight: '600', flex: 1 },
  debugTxt: {
    color: colors.textMuted, fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: colors.surface, padding: 6, borderRadius: 6,
  },
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
