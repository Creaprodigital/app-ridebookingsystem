import React, { useCallback, useState } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import ProHeader from '../../src/components/ProHeader';
import { getProDrivers, ProDriver } from '../../src/proApi';

function driverName(d: ProDriver) {
  return `${d.first_name || ''} ${d.last_name || ''}`.trim() || d.email || d.id.slice(0,6);
}
function driverState(d: ProDriver): { label: string; color: string } {
  if (!d.on_shift) return { label: 'Hors ligne', color: colors.textMuted };
  const s = (d.driver_status || '').toLowerCase();
  if (s === 'busy' || s === 'on_ride') return { label: 'Occupé', color: colors.warning };
  return { label: 'Disponible', color: colors.success };
}
function fmtAgo(iso?: string) {
  if (!iso) return '—';
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return '—';
  const m = Math.floor(diff / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h`;
}

export default function DriversScreen() {
  const [drivers, setDrivers] = useState<ProDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'on_shift' | 'offline'>('all');

  const load = useCallback(async () => {
    try {
      const d = await getProDrivers();
      setDrivers(d);
    } catch { setDrivers([]); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const filtered = drivers.filter((d) => {
    if (filter === 'all') return true;
    if (filter === 'on_shift') return !!d.on_shift;
    return !d.on_shift;
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ProHeader title="Chauffeurs" subtitle={`${drivers.length} au total`} />
      <View style={styles.tabsRow}>
        {([
          { k: 'all' as const, label: 'Tous' },
          { k: 'on_shift' as const, label: 'En service' },
          { k: 'offline' as const, label: 'Hors ligne' },
        ]).map((t) => (
          <TouchableOpacity key={t.k} style={[styles.tab, filter === t.k && styles.tabActive]} onPress={() => setFilter(t.k)}>
            <Text style={[styles.tabTxt, filter === t.k && styles.tabTxtActive]}>{t.label}</Text>
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
              <Ionicons name="people-outline" size={42} color={colors.textMuted} />
              <Text style={styles.emptyTxt}>Aucun chauffeur</Text>
            </View>
          }
          renderItem={({ item }) => {
            const st = driverState(item);
            return (
              <View style={styles.card}>
                <View style={styles.avatar}><Text style={styles.avatarTxt}>{(item.first_name?.[0] || '').toUpperCase() + (item.last_name?.[0] || '').toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{driverName(item)}</Text>
                  <Text style={styles.subline}>{item.phone || '—'} • {item.email || '—'}</Text>
                  <View style={styles.statusRow}>
                    <View style={[styles.dot, { backgroundColor: st.color }]} />
                    <Text style={[styles.statusTxt, { color: st.color }]}>{st.label}</Text>
                    <Text style={styles.metaSub}>• GPS {fmtAgo(item.last_location?.updated_at)}</Text>
                  </View>
                </View>
                <TouchableOpacity style={styles.callBtn} onPress={() => { /* phone call could be wired here */ }}>
                  <Ionicons name="call-outline" size={18} color={colors.primary} />
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
  tabTxtActive: { color: colors.onPrimary },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTxt: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary + '33', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: colors.primary, fontWeight: '900', fontSize: 14 },
  name: { color: colors.text, fontSize: 14, fontWeight: '900' },
  subline: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusTxt: { fontSize: 11, fontWeight: '900', letterSpacing: 0.3 },
  metaSub: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  callBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center' },
});
