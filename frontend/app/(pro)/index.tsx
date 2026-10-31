import React, { useCallback, useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import ProHeader from '../../src/components/ProHeader';
import { getProDashboard, ProBooking, ProDashboardStats } from '../../src/proApi';
import { useAuth } from '../../src/auth';
import BookingDetailsSheet from '../../src/components/BookingDetailsSheet';
import { haptic } from '../../src/feedback';

function fmt(d?: string): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
}
function statusColor(s?: string) {
  const v = (s || '').toLowerCase();
  if (v === 'completed') return colors.success;
  if (v === 'pending') return colors.warning;
  if (v === 'assigned' || v === 'in_progress') return colors.info;
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

export default function ProDashboard() {
  const router = useRouter();
  const { tenant } = useAuth();
  const [stats, setStats] = useState<ProDashboardStats | null>(null);
  const [recent, setRecent] = useState<ProBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Booking shown in the full-details bottom sheet. */
  const [detailsTarget, setDetailsTarget] = useState<ProBooking | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getProDashboard();
      setStats(d.stats);
      setRecent(d.recent_bookings || []);
    } catch (e) {
      setStats(null); setRecent([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  const tiles = [
    { label: 'Courses', value: stats?.bookings ?? 0, icon: 'car-outline' as const, color: colors.info, onPress: () => router.push('/(pro)/dispatch' as any) },
    { label: 'En attente', value: stats?.pending ?? 0, icon: 'time-outline' as const, color: colors.warning, onPress: () => router.push('/(pro)/dispatch' as any) },
    { label: 'Chauffeurs', value: stats?.drivers ?? 0, icon: 'people-outline' as const, color: colors.primary, onPress: () => router.push('/(pro)/drivers' as any) },
    { label: 'Véhicules', value: stats?.vehicles ?? 0, icon: 'car-sport-outline' as const, color: colors.textSecondary, onPress: () => {} },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ProHeader
        title="Tableau de bord"
        subtitle={tenant?.company_name || 'Espace pro'}
      />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {/* Revenue card */}
          <View style={styles.revenueCard}>
            <Text style={styles.revenueLabel}>REVENUS</Text>
            <Text style={styles.revenueValue}>{(stats?.revenue ?? 0).toFixed(2)} €</Text>
            <Text style={styles.revenueSub}>{stats?.completed ?? 0} course{(stats?.completed ?? 0) > 1 ? 's' : ''} terminée{(stats?.completed ?? 0) > 1 ? 's' : ''}</Text>
          </View>

          {/* KPI tiles */}
          <View style={styles.tilesGrid}>
            {tiles.map((t) => (
              <TouchableOpacity key={t.label} style={styles.tile} onPress={t.onPress} activeOpacity={0.85}>
                <View style={[styles.tileIcon, { backgroundColor: t.color + '22' }]}>
                  <Ionicons name={t.icon} size={20} color={t.color} />
                </View>
                <Text style={styles.tileValue}>{t.value}</Text>
                <Text style={styles.tileLabel}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Quick actions */}
          <View style={styles.quickRow}>
            <TouchableOpacity style={styles.quickPrimary} onPress={() => router.push('/(pro)/create' as any)}>
              <Ionicons name="add-circle" size={20} color={colors.onPrimary} />
              <Text style={styles.quickPrimaryTxt}>Créer une course</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickSecondary} onPress={() => router.push('/(pro)/map' as any)}>
              <Ionicons name="map" size={18} color={colors.text} />
              <Text style={styles.quickSecondaryTxt}>Carte</Text>
            </TouchableOpacity>
          </View>

          {/* Recent bookings */}
          <View>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Courses récentes</Text>
              <TouchableOpacity onPress={() => router.push('/(pro)/dispatch' as any)}>
                <Text style={styles.sectionLink}>Tout voir</Text>
              </TouchableOpacity>
            </View>
            {recent.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="document-text-outline" size={28} color={colors.textMuted} />
                <Text style={styles.emptyTxt}>Aucune course récente</Text>
              </View>
            ) : (
              recent.slice(0, 5).map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={styles.bookingRow}
                  activeOpacity={0.75}
                  onPress={() => { haptic('light'); setDetailsTarget(b); }}
                  testID={`dashboard-booking-${b.id}`}
                >
                  <View style={[styles.statusDot, { backgroundColor: statusColor(b.status) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bookingFrom} numberOfLines={1}>{b.pickup_address || '—'}</Text>
                    <Text style={styles.bookingTo} numberOfLines={1}>{b.dropoff_address || '—'}</Text>
                    <Text style={styles.bookingMeta}>{fmt(b.pickup_at)} • {statusLabel(b.status)}</Text>
                  </View>
                  <Text style={styles.bookingPrice}>{(b?.pricing?.final ?? b?.pricing?.total ?? 0).toFixed(2)} €</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textMuted} style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              ))
            )}
          </View>
        </ScrollView>
      )}

      {/* Full-details sheet opened when a recent booking row is tapped */}
      <BookingDetailsSheet
        booking={detailsTarget}
        onClose={() => setDetailsTarget(null)}
        onAssign={() => {
          // From the dashboard the dispatcher only sees recent bookings;
          // route them to the full dispatch screen where the assignment
          // modal lives.
          setDetailsTarget(null);
          router.push('/(pro)/dispatch' as any);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  revenueCard: {
    backgroundColor: colors.primary, borderRadius: radius.xl, padding: spacing.lg,
  },
  revenueLabel: { color: colors.onPrimary, fontSize: 11, fontWeight: '900', letterSpacing: 1.5, opacity: 0.85 },
  revenueValue: { color: colors.onPrimary, fontSize: 36, fontWeight: '900', letterSpacing: -1, marginTop: 4 },
  revenueSub: { color: colors.onPrimary, fontSize: 12, fontWeight: '700', opacity: 0.85, marginTop: 4 },
  tilesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface,
    borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg,
    padding: spacing.md, gap: 6, alignItems: 'flex-start',
  },
  tileIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileValue: { color: colors.text, fontSize: 22, fontWeight: '900' },
  tileLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  quickRow: { flexDirection: 'row', gap: spacing.sm },
  quickPrimary: {
    flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14,
  },
  quickPrimaryTxt: { color: colors.onPrimary, fontWeight: '900', fontSize: 14, letterSpacing: 0.5 },
  quickSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.surface, borderRadius: radius.full, paddingVertical: 14,
    borderColor: colors.border, borderWidth: 1,
  },
  quickSecondaryTxt: { color: colors.text, fontWeight: '800', fontSize: 13 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  sectionLink: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  empty: { alignItems: 'center', padding: spacing.lg, gap: 6 },
  emptyTxt: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  bookingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, padding: spacing.md, marginBottom: 8,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  bookingFrom: { color: colors.text, fontSize: 13, fontWeight: '800' },
  bookingTo: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  bookingMeta: { color: colors.textMuted, fontSize: 11, fontWeight: '600', marginTop: 3 },
  bookingPrice: { color: colors.text, fontSize: 14, fontWeight: '900' },
});
