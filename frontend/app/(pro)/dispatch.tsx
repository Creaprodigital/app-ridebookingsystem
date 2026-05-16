import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, TouchableOpacity, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import ProHeader from '../../src/components/ProHeader';
import { getProDispatch, assignBookingToDriver, ProBooking, ProDriver } from '../../src/proApi';
import { haptic } from '../../src/feedback';

function fmt(d?: string) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
}
function statusColor(s?: string) {
  const v = (s || '').toLowerCase();
  if (v === 'completed') return colors.success;
  if (v === 'pending') return colors.warning;
  if (v === 'assigned') return colors.info;
  if (v === 'in_progress') return colors.primary;
  if (v === 'cancelled' || v === 'canceled') return colors.danger;
  return colors.textMuted;
}
function statusLabel(s?: string) {
  const v = (s || '').toLowerCase();
  if (v === 'completed') return 'Terminée';
  if (v === 'pending') return 'En attente';
  if (v === 'assigned') return 'Assignée';
  if (v === 'in_progress') return 'En cours';
  if (v === 'cancelled' || v === 'canceled') return 'Annulée';
  return s || '—';
}
function driverName(d?: ProDriver) {
  if (!d) return '—';
  return `${d.first_name || ''} ${d.last_name || ''}`.trim() || d.email || d.id.slice(0, 6);
}

type Filter = 'pending' | 'assigned' | 'in_progress' | 'all';

export default function DispatchScreen() {
  const [bookings, setBookings] = useState<ProBooking[]>([]);
  const [drivers, setDrivers] = useState<ProDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('pending');
  const [assignTarget, setAssignTarget] = useState<ProBooking | null>(null);
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getProDispatch();
      setBookings(d.bookings || []);
      setDrivers(d.drivers || []);
    } catch {
      setBookings([]); setDrivers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const filtered = useMemo(() => {
    const arr = filter === 'all' ? bookings : bookings.filter((b) => (b.status || '').toLowerCase() === filter);
    arr.sort((a, b) => Date.parse(b.created_at || '0') - Date.parse(a.created_at || '0'));
    return arr;
  }, [bookings, filter]);

  const counts = useMemo(() => ({
    pending: bookings.filter((b) => (b.status || '').toLowerCase() === 'pending').length,
    assigned: bookings.filter((b) => (b.status || '').toLowerCase() === 'assigned').length,
    in_progress: bookings.filter((b) => (b.status || '').toLowerCase() === 'in_progress').length,
    all: bookings.length,
  }), [bookings]);

  const onAssign = async (driver: ProDriver) => {
    if (!assignTarget) return;
    setAssigning(true);
    try {
      await assignBookingToDriver(assignTarget.id, driver.id);
      haptic('success');
      setAssignTarget(null);
      await load();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Impossible d’attribuer la course.');
    } finally {
      setAssigning(false);
    }
  };

  const driverById = useMemo(() => {
    const m = new Map<string, ProDriver>();
    drivers.forEach((d) => m.set(d.id, d));
    return m;
  }, [drivers]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ProHeader title="Dispatch" subtitle="Gérez les courses en cours et en attente" />

      <View style={styles.tabsRow}>
        {([
          { k: 'pending' as Filter, label: 'En attente', c: counts.pending },
          { k: 'assigned' as Filter, label: 'Assignées', c: counts.assigned },
          { k: 'in_progress' as Filter, label: 'En cours', c: counts.in_progress },
          { k: 'all' as Filter, label: 'Toutes', c: counts.all },
        ]).map((t) => (
          <TouchableOpacity
            key={t.k}
            style={[styles.tab, filter === t.k && styles.tabActive]}
            onPress={() => { haptic('light'); setFilter(t.k); }}
          >
            <Text style={[styles.tabTxt, filter === t.k && styles.tabTxtActive]}>{t.label}</Text>
            <View style={[styles.badge, filter === t.k && { backgroundColor: colors.bg }]}>
              <Text style={[styles.badgeTxt, filter === t.k && { color: colors.primary }]}>{t.c}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 100, gap: spacing.sm }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-outline" size={42} color={colors.textMuted} />
              <Text style={styles.emptyTxt}>Aucune course dans cette catégorie</Text>
            </View>
          }
          renderItem={({ item }) => {
            const assigned = item.driver_id ? driverById.get(item.driver_id) : null;
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.statusPill, { backgroundColor: statusColor(item.status) + '22', borderColor: statusColor(item.status) }]}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor(item.status) }]} />
                    <Text style={[styles.statusPillTxt, { color: statusColor(item.status) }]}>{statusLabel(item.status)}</Text>
                  </View>
                  <Text style={styles.cardPrice}>{(item?.pricing?.final ?? item?.pricing?.total ?? 0).toFixed(2)} €</Text>
                </View>

                <View style={styles.route}>
                  <View style={styles.routeCol}>
                    <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
                    <View style={styles.routeLine} />
                    <View style={[styles.routeDot, { backgroundColor: colors.danger }]} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.addr} numberOfLines={1}>{item.pickup_address || '—'}</Text>
                    <Text style={styles.addr} numberOfLines={1}>{item.dropoff_address || '—'}</Text>
                  </View>
                </View>

                <View style={styles.meta}>
                  <View style={styles.metaItem}>
                    <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                    <Text style={styles.metaTxt}>{fmt(item.pickup_at)}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
                    <Text style={styles.metaTxt}>{item.pax ?? 1} pax</Text>
                  </View>
                  {item.guest_contact?.first_name ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="person-outline" size={14} color={colors.textSecondary} />
                      <Text style={styles.metaTxt} numberOfLines={1}>{item.guest_contact?.first_name} {item.guest_contact?.last_name}</Text>
                    </View>
                  ) : null}
                </View>

                {assigned ? (
                  <View style={styles.assignedRow}>
                    <Ionicons name="car" size={14} color={colors.info} />
                    <Text style={styles.assignedTxt}>Attribué à {driverName(assigned)}</Text>
                  </View>
                ) : null}

                {(item.status || '').toLowerCase() === 'pending' ? (
                  <TouchableOpacity style={styles.assignBtn} onPress={() => setAssignTarget(item)}>
                    <Ionicons name="person-add-outline" size={16} color={colors.bg} />
                    <Text style={styles.assignBtnTxt}>Attribuer un chauffeur</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          }}
        />
      )}

      {/* Assignment modal */}
      <Modal visible={!!assignTarget} transparent animationType="slide" onRequestClose={() => setAssignTarget(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Choisissez un chauffeur</Text>
            <Text style={styles.sheetSub}>Cette course sera attribuée manuellement.</Text>
            {drivers.length === 0 ? (
              <View style={styles.empty}><Text style={styles.emptyTxt}>Aucun chauffeur disponible</Text></View>
            ) : (
              drivers.map((d) => (
                <TouchableOpacity key={d.id} style={styles.driverRow} onPress={() => onAssign(d)} disabled={assigning}>
                  <View style={[styles.driverDot, { backgroundColor: d.on_shift ? colors.success : colors.textMuted }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.driverName}>{driverName(d)}</Text>
                    <Text style={styles.driverSub}>{d.on_shift ? 'En service' : 'Hors ligne'} • {d.phone || '—'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              ))
            )}
            <TouchableOpacity style={styles.closeBtn} onPress={() => setAssignTarget(null)} disabled={assigning}>
              <Text style={styles.closeBtnTxt}>{assigning ? 'Attribution…' : 'Annuler'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  tabTxtActive: { color: colors.bg },
  badge: { backgroundColor: colors.bg, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  badgeTxt: { color: colors.textSecondary, fontSize: 10, fontWeight: '900' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTxt: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  card: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusPillTxt: { fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },
  cardPrice: { color: colors.text, fontSize: 16, fontWeight: '900' },
  route: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  routeCol: { alignItems: 'center', paddingVertical: 4 },
  routeDot: { width: 8, height: 8, borderRadius: 4 },
  routeLine: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 2 },
  addr: { color: colors.text, fontSize: 13, fontWeight: '700' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaTxt: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  assignedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  assignedTxt: { color: colors.info, fontSize: 12, fontWeight: '800' },
  assignBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 10,
  },
  assignBtnTxt: { color: colors.bg, fontWeight: '900', fontSize: 13, letterSpacing: 0.4 },
  backdrop: { flex: 1, backgroundColor: '#000C', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 8 },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  sheetSub: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', marginBottom: 6 },
  driverRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, padding: spacing.md,
  },
  driverDot: { width: 10, height: 10, borderRadius: 5 },
  driverName: { color: colors.text, fontSize: 14, fontWeight: '800' },
  driverSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  closeBtn: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  closeBtnTxt: { color: colors.textSecondary, fontWeight: '800', letterSpacing: 0.5 },
});
