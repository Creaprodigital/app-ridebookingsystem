import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, RefreshControl, Modal, Platform, Alert, Share } from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import { fmtEuro } from '../../src/rideFormat';
import { getDriverHistory, getMarketplaceConfig } from '../../src/api';
import { haptic } from '../../src/feedback';

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers (no React imports inside)
// ─────────────────────────────────────────────────────────────────────────

type PeriodMode = 'today' | 'week' | 'month';

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}
function startOfWeek(d: Date): Date {
  // Monday-based weeks
  const out = new Date(d);
  const day = out.getDay(); // 0 (Sun) … 6 (Sat)
  const diff = (day === 0 ? -6 : 1 - day);
  out.setDate(out.getDate() + diff);
  out.setHours(0, 0, 0, 0);
  return out;
}
function endOfWeek(d: Date): Date {
  const start = startOfWeek(d);
  const out = new Date(start);
  out.setDate(start.getDate() + 6);
  out.setHours(23, 59, 59, 999);
  return out;
}
function startOfMonth(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), 1);
  out.setHours(0, 0, 0, 0);
  return out;
}
function endOfMonth(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  out.setHours(23, 59, 59, 999);
  return out;
}
function startOfPeriod(d: Date, period: PeriodMode): Date {
  if (period === 'today') return startOfDay(d);
  if (period === 'month') return startOfMonth(d);
  return startOfWeek(d);
}
function endOfPeriod(d: Date, period: PeriodMode): Date {
  if (period === 'today') return endOfDay(d);
  if (period === 'month') return endOfMonth(d);
  return endOfWeek(d);
}
function shiftPeriod(d: Date, period: PeriodMode, n: number): Date {
  const out = new Date(d);
  if (period === 'today') {
    out.setDate(out.getDate() + n);
  } else if (period === 'week') {
    out.setDate(out.getDate() + n * 7);
  } else {
    out.setMonth(out.getMonth() + n);
  }
  return out;
}
function fmtRange(from: Date, to: Date, period: PeriodMode): string {
  if (period === 'today') {
    return from
      .toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      .replace(/\./g, '');
  }
  if (period === 'month') {
    return from
      .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
      .replace(/\./g, '');
  }
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const f = from.toLocaleDateString('fr-FR', opts).replace('.', '');
  const t = to.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' }).replace('.', '');
  return `${f} – ${t}`;
}
function periodLabel(p: PeriodMode): string {
  return p === 'today' ? 'Aujourd’hui' : p === 'month' ? 'Ce mois' : 'Cette semaine';
}
function fmtDate(d: string | Date | undefined): string {
  if (!d) return '';
  try {
    const dt = typeof d === 'string' ? new Date(d) : d;
    return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
}
function fmtTime(d: string | Date | undefined): string {
  if (!d) return '';
  try {
    const dt = typeof d === 'string' ? new Date(d) : d;
    return dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

// Same logic as missions.tsx / RideRequestModal.tsx
function pickAmount(m: any): number | null {
  const v = m?.amount ?? m?.pricing?.final ?? m?.price ?? m?.fare ?? m?.total ?? m?.booking?.price;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function pickCommission(m: any, configPct?: number): number | null {
  const direct =
    m?.commission_eur ?? m?.commission_amount ?? m?.commission ??
    m?.platform_commission ?? m?.platform_fee ??
    m?.fleet_commission ?? m?.tenant_commission ??
    m?.pricing?.commission ?? m?.pricing?.commission_eur ?? m?.pricing?.fee;
  if (direct != null) { const n = Number(direct); if (Number.isFinite(n)) return n; }
  const pct = m?.commission_pct ?? m?.commission_percent ?? m?.commission_percentage ?? m?.pricing?.commission_pct ?? configPct;
  const total = pickAmount(m);
  if (total != null && pct != null) {
    const p = Number(pct);
    if (Number.isFinite(p)) {
      const ratio = p > 1 ? p / 100 : p;
      return Number((total * ratio).toFixed(2));
    }
  }
  return null;
}
function pickDriverNet(m: any, configPct?: number): number | null {
  const total = pickAmount(m);
  const com = pickCommission(m, configPct);
  if (total != null && com != null) return Number((total - com).toFixed(2));
  return null;
}
function pickAddr(m: any, t: 'pickup' | 'dropoff'): string {
  return (
    m?.booking?.[`${t}_address`] ||
    m?.[`${t}_address`] ||
    m?.[t]?.address ||
    m?.[t] ||
    '—'
  );
}
function pickCompletedAt(m: any): string | undefined {
  return (
    m?.completed_at ||
    m?.ended_at ||
    m?.finished_at ||
    m?.booking?.pickup_at ||
    m?.pickup_at ||
    m?.updated_at ||
    m?.created_at
  );
}
function pickPaymentLabel(m: any): { label: string; icon: 'card' | 'cash' } {
  const status = String(m?.payment_status || m?.booking?.payment_status || '').toLowerCase();
  const method = String(m?.payment_method || m?.booking?.payment_method || '').toLowerCase();
  const paidOnline = status.includes('paid') || method.includes('card') || method.includes('stripe') || method.includes('online');
  return paidOnline
    ? { label: 'Carte', icon: 'card' }
    : { label: 'Espèces', icon: 'cash' };
}
function pickStatusLabel(m: any): { label: string; color: string } {
  const s = String(m?.status || '').toLowerCase();
  if (s === 'completed' || s === 'finished') return { label: 'Terminée', color: colors.success };
  if (s === 'cancelled' || s === 'canceled') return { label: 'Annulée', color: colors.danger };
  return { label: 'Terminée', color: colors.success };
}

// ─────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<PeriodMode>('week');
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Marketplace commission percentage — used to compute Net chauffeur when
  // missions don't carry their own commission field.
  const [configPct, setConfigPct] = useState<number | undefined>(undefined);
  useEffect(() => {
    (async () => {
      try {
        const raw: any = await getMarketplaceConfig();
        const cfg = raw?.config ?? raw;
        const pct =
          cfg?.commission_pct ??
          cfg?.commission_percent ??
          cfg?.commission_percentage;
        if (pct != null && Number.isFinite(Number(pct))) {
          setConfigPct(Number(pct));
        }
      } catch {}
    })();
  }, []);

  const fromDate = useMemo(() => startOfPeriod(anchor, period), [anchor, period]);
  const toDate = useMemo(() => endOfPeriod(anchor, period), [anchor, period]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getDriverHistory(fromDate.toISOString(), toDate.toISOString());
      // Client-side safety filter — the backend may not honour from/to.
      const filtered = list.filter((m: any) => {
        const t = pickCompletedAt(m);
        if (!t) return true;
        const ts = Date.parse(t);
        if (!Number.isFinite(ts)) return true;
        return ts >= fromDate.getTime() && ts <= toDate.getTime();
      });
      setItems(filtered);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Stats computed on the visible filtered list
  const stats = useMemo(() => {
    let count = 0;
    let revenue = 0;
    let net = 0;
    items.forEach((m) => {
      const amount = pickAmount(m);
      const n = pickDriverNet(m, configPct);
      if (amount != null) revenue += amount;
      if (n != null) net += n;
      count += 1;
    });
    return {
      count,
      revenue: Number(revenue.toFixed(2)),
      net: Number(net.toFixed(2)),
    };
  }, [items, configPct]);

  // Sorted list — always by most recent first
  const sorted = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      const ta = Date.parse(pickCompletedAt(a) || '') || 0;
      const tb = Date.parse(pickCompletedAt(b) || '') || 0;
      return tb - ta;
    });
    return arr;
  }, [items]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const prev = () => { haptic('light'); setAnchor((d) => shiftPeriod(d, period, -1)); };
  const next = () => { haptic('light'); setAnchor((d) => shiftPeriod(d, period, 1)); };
  const reset = () => { haptic('light'); setAnchor(new Date()); };

  const cyclePeriod = () => {
    haptic('light');
    setPeriod((cur) => {
      const nxt: PeriodMode = cur === 'today' ? 'week' : cur === 'week' ? 'month' : 'today';
      setAnchor(new Date());
      return nxt;
    });
  };

  const onExport = async () => {
    haptic('light');
    if (!items.length) {
      Alert.alert('Aucune donnée', 'Il n’y a aucune course à exporter pour cette période.');
      return;
    }
    // Build a simple CSV
    const rows = [
      ['Date', 'Heure', 'Statut', 'Départ', 'Arrivée', 'Prix (€)', 'Commission (€)', 'Net (€)', 'Paiement'],
      ...sorted.map((m) => [
        fmtDate(pickCompletedAt(m)),
        fmtTime(pickCompletedAt(m)),
        pickStatusLabel(m).label,
        String(pickAddr(m, 'pickup')).replace(/,/g, ';'),
        String(pickAddr(m, 'dropoff')).replace(/,/g, ';'),
        (pickAmount(m) ?? 0).toFixed(2),
        (pickCommission(m, configPct) ?? 0).toFixed(2),
        (pickDriverNet(m, configPct) ?? 0).toFixed(2),
        pickPaymentLabel(m).label,
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    try {
      await Share.share({
        title: `historique-${fmtRange(fromDate, toDate, period)}.csv`,
        message: csv,
      });
    } catch {
      // user cancelled — silent
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Historique</Text>
          <Text style={styles.subtitle}>Vos courses effectuées</Text>
        </View>
        <TouchableOpacity style={styles.iconBtn} onPress={onExport} testID="export-btn">
          <Ionicons name="download-outline" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(it, idx) => String(it?.id ?? it?._id ?? idx)}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 80, gap: spacing.sm }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
            {/* Date range + filters */}
            <View style={styles.toolbar}>
              <TouchableOpacity
                style={styles.dateChip}
                onPress={prev}
                onLongPress={reset}
                testID="prev-period"
              >
                <Ionicons name="calendar-outline" size={16} color={colors.text} />
                <Text style={styles.dateChipTxt} numberOfLines={1}>{fmtRange(fromDate, toDate, period)}</Text>
                <View style={styles.dateChipNav}>
                  <TouchableOpacity onPress={prev} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} testID="prev-period-btn">
                    <Ionicons name="chevron-back" size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={next} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} testID="next-period-btn">
                    <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.filtersChip}
                onPress={() => setFiltersOpen(true)}
                testID="filters-btn"
              >
                <Ionicons name="options-outline" size={16} color={colors.text} />
                <Text style={styles.filtersChipTxt}>Filtres</Text>
                <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Stats card */}
            <View style={styles.statsCard} testID="history-stats">
              <View style={styles.statCol}>
                <View style={[styles.statIcon, { backgroundColor: colors.success + '22' }]}>
                  <Ionicons name="car" size={18} color={colors.success} />
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.statLabel}>Courses</Text>
                  <Text style={styles.statValue} testID="stat-count">{stats.count}</Text>
                  <Text style={styles.statSub}>course{stats.count > 1 ? 's' : ''}</Text>
                </View>
              </View>
              <View style={styles.statSep} />
              <View style={styles.statCol}>
                <View style={[styles.statIcon, { backgroundColor: colors.primary + '22' }]}>
                  <Ionicons name="wallet" size={18} color={colors.primary} />
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.statLabel}>Chiffre d’affaires</Text>
                  <Text style={styles.statValue} testID="stat-revenue">{fmtEuro(stats.revenue)}</Text>
                </View>
              </View>
              <View style={styles.statSep} />
              <View style={styles.statCol}>
                <View style={[styles.statIcon, { backgroundColor: colors.success + '22' }]}>
                  <Ionicons name="cash" size={18} color={colors.success} />
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.statLabel}>Net chauffeur</Text>
                  <Text style={[styles.statValue, { color: colors.success }]} testID="stat-net">
                    {fmtEuro(stats.net)}
                  </Text>
                </View>
              </View>
            </View>

            {/* List header */}
            <View style={styles.listHeadRow}>
              <Text style={styles.listHeadTitle}>Liste des courses</Text>
              <TouchableOpacity
                style={styles.sortChip}
                onPress={cyclePeriod}
                testID="period-chip"
              >
                <Ionicons name="calendar-outline" size={12} color={colors.text} />
                <Text style={styles.sortChipTxt}>{periodLabel(period)}</Text>
                <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="time-outline" size={42} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Aucune course pour cette période</Text>
              <Text style={styles.emptySub}>Changez de période pour consulter d’autres courses terminées.</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const status = pickStatusLabel(item);
          const amount = pickAmount(item);
          const net = pickDriverNet(item, configPct);
          const pay = pickPaymentLabel(item);
          const t = pickCompletedAt(item);
          return (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.row}
              onPress={() => {
                const id = String(item?.id ?? item?._id ?? '');
                if (id) router.push(`/mission/${id}`);
              }}
              testID={`history-row-${item?.id ?? item?._id}`}
            >
              {/* Left: status + route line */}
              <View style={styles.rowLeft}>
                <View style={styles.checkCircle}>
                  <Ionicons name="checkmark" size={16} color={colors.success} />
                </View>
                <View style={styles.routeStripe}>
                  <View style={[styles.routeDotSm, { backgroundColor: colors.textMuted }]} />
                  <View style={styles.routeBar} />
                  <View style={[styles.routeDotSm, { backgroundColor: colors.danger }]} />
                </View>
              </View>
              {/* Middle: dates + addresses */}
              <View style={{ flex: 1, gap: 4 }}>
                <View style={styles.rowMetaTop}>
                  <Text style={styles.rowDate}>
                    {fmtDate(t)} • {fmtTime(t)}
                  </Text>
                  <View style={[styles.statusPill, { borderColor: status.color + '88', backgroundColor: status.color + '22' }]}>
                    <Text style={[styles.statusPillTxt, { color: status.color }]}>{status.label}</Text>
                  </View>
                </View>
                <Text style={styles.rowPickup} numberOfLines={1}>{pickAddr(item, 'pickup')}</Text>
                <Text style={styles.rowDropoff} numberOfLines={1}>{pickAddr(item, 'dropoff')}</Text>
              </View>
              {/* Right: price + net + pay chip */}
              <View style={styles.rowRight}>
                <Text style={styles.rowAmount}>{amount != null ? fmtEuro(amount) : '—'}</Text>
                {net != null ? (
                  <Text style={styles.rowNet} testID={`history-net-${item?.id ?? item?._id}`}>
                    Net {fmtEuro(net)}
                  </Text>
                ) : null}
                <View style={styles.payChip}>
                  <Ionicons name={pay.icon === 'card' ? 'card-outline' : 'cash-outline'} size={11} color={colors.textSecondary} />
                  <Text style={styles.payChipTxt}>{pay.label}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          );
        }}
      />

      {/* Filters bottom-sheet */}
      <Modal visible={filtersOpen} transparent animationType="fade" onRequestClose={() => setFiltersOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setFiltersOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.modalSheet} onPress={() => {}} testID="filters-sheet">
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Filtres</Text>
            <Text style={styles.modalSub}>Choisissez la période d’affichage.</Text>

            <Text style={styles.modalSection}>Période</Text>
            <View style={styles.periodRow}>
              <TouchableOpacity
                style={[styles.periodChip, period === 'today' && styles.periodChipActive]}
                onPress={() => { setPeriod('today'); setAnchor(new Date()); setFiltersOpen(false); }}
                testID="period-today"
              >
                <Text style={[styles.periodChipTxt, period === 'today' && { color: colors.onPrimary }]}>Aujourd’hui</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.periodChip, period === 'week' && styles.periodChipActive]}
                onPress={() => { setPeriod('week'); setAnchor(new Date()); setFiltersOpen(false); }}
                testID="period-this-week"
              >
                <Text style={[styles.periodChipTxt, period === 'week' && { color: colors.onPrimary }]}>Cette semaine</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.periodChip, period === 'month' && styles.periodChipActive]}
                onPress={() => { setPeriod('month'); setAnchor(new Date()); setFiltersOpen(false); }}
                testID="period-this-month"
              >
                <Text style={[styles.periodChipTxt, period === 'month' && { color: colors.onPrimary }]}>Ce mois</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.closeBtn} onPress={() => setFiltersOpen(false)} testID="filters-close">
              <Text style={styles.closeBtnTxt}>Fermer</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  headRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm,
  },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -1 },
  subtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  iconBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
  },

  toolbar: { flexDirection: 'row', gap: 8 },
  dateChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.surface,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.full,
    flex: 1.4,
  },
  dateChipTxt: { color: colors.text, fontWeight: '800', fontSize: 13, flex: 1 },
  dateChipNav: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filtersChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: colors.surface,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.full,
    flex: 1,
    justifyContent: 'center',
  },
  filtersChipTxt: { color: colors.text, fontWeight: '700', fontSize: 13 },

  statsCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.xl, padding: spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  statCol: { flex: 1, alignItems: 'center', gap: 6 },
  statIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  statLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.2 },
  statValue: { color: colors.text, fontSize: 16, fontWeight: '800', letterSpacing: -0.4, marginTop: 2 },
  statSub: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  statSep: { width: 1, height: 56, backgroundColor: colors.border, marginHorizontal: 4 },

  listHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listHeadTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sortChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.full,
  },
  sortChipTxt: { color: colors.text, fontWeight: '700', fontSize: 12 },

  row: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.xl, padding: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  rowLeft: { alignItems: 'center', gap: 4, alignSelf: 'stretch', paddingVertical: 2 },
  checkCircle: {
    width: 30, height: 30, borderRadius: 15,
    borderColor: colors.success, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  routeStripe: { alignItems: 'center', flex: 1, paddingVertical: 2 },
  routeDotSm: { width: 6, height: 6, borderRadius: 3 },
  routeBar: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 2 },

  rowMetaTop: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rowDate: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  statusPill: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 999, borderWidth: 1,
  },
  statusPillTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  rowPickup: { color: colors.text, fontSize: 14, fontWeight: '800' },
  rowDropoff: { color: colors.textSecondary, fontSize: 12 },

  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowAmount: { color: colors.text, fontSize: 16, fontWeight: '800' },
  rowNet: { color: colors.success, fontSize: 11, fontWeight: '800' },
  payChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    borderRadius: 999, marginTop: 2,
  },
  payChipTxt: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },

  empty: { alignItems: 'center', gap: 8, paddingTop: 60, paddingHorizontal: 30 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  emptySub: { color: colors.textSecondary, fontSize: 12, textAlign: 'center' },

  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.md, gap: 10, paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    borderTopColor: colors.border, borderTopWidth: 1,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center', marginBottom: 8,
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  modalSub: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', marginBottom: 4 },
  modalSection: { color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 0.2, marginTop: 6 },
  periodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  periodChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    borderRadius: 999,
  },
  periodChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  periodChipTxt: { color: colors.textSecondary, fontWeight: '800', fontSize: 12 },
  closeBtn: {
    height: 48, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    marginTop: 8,
  },
  closeBtnTxt: { color: colors.textSecondary, fontWeight: '800', letterSpacing: 0.2 },
});
