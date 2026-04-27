import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import { getDriverWallet } from '../../src/api';

function fmtMoney(v: any, currency = 'EUR') {
  const n = Number(v ?? 0);
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(n);
  } catch {
    return `${n.toFixed(2)} €`;
  }
}

function fmtDt(s?: string) {
  if (!s) return '';
  try {
    return new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return s;
  }
}

export default function Earnings() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const w = await getDriverWallet();
      setData(w);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const balance = data?.balance ?? data?.available ?? 0;
  const pending = data?.pending ?? data?.pending_balance ?? 0;
  const earnedToday = data?.today ?? data?.earned_today ?? data?.today_earnings ?? 0;
  const earnedWeek = data?.week ?? data?.earned_week ?? data?.week_earnings ?? 0;
  const currency = data?.currency || 'EUR';
  const txs: any[] =
    data?.transactions || data?.history || data?.items || data?.entries || [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={txs}
        keyExtractor={(item, i) => String(item.id ?? item._id ?? i)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListHeaderComponent={
          <View style={{ padding: spacing.md, gap: spacing.md }}>
            <View>
              <Text style={styles.h1}>Mes gains</Text>
              <Text style={styles.h2}>Transparent. Direct. À portée de main.</Text>
            </View>

            <View style={styles.heroCard} testID="wallet-balance">
              <Text style={styles.heroLabel}>SOLDE DISPONIBLE</Text>
              <Text style={styles.heroValue}>{fmtMoney(balance, currency)}</Text>
              {Number(pending) > 0 ? (
                <Text style={styles.heroPending}>+ {fmtMoney(pending, currency)} en attente</Text>
              ) : null}
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Ionicons name="today-outline" size={18} color={colors.primary} />
                <Text style={styles.statLbl}>AUJOURD&rsquo;HUI</Text>
                <Text style={styles.statVal}>{fmtMoney(earnedToday, currency)}</Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                <Text style={styles.statLbl}>7 JOURS</Text>
                <Text style={styles.statVal}>{fmtMoney(earnedWeek, currency)}</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Historique</Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyWrap}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <View style={styles.emptyWrap}>
              <Ionicons name="receipt-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Aucune transaction</Text>
              <Text style={styles.emptySub}>Vos gains apparaîtront ici dès votre première course.</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const amount = Number(item.amount ?? item.value ?? 0);
          const isPositive = amount >= 0;
          return (
            <View style={styles.txRow} testID={`tx-${item.id ?? item._id}`}>
              <View style={[styles.txIcon, { backgroundColor: isPositive ? colors.success + '22' : colors.danger + '22' }]}>
                <Ionicons
                  name={isPositive ? 'trending-up' : 'trending-down'}
                  size={18}
                  color={isPositive ? colors.success : colors.danger}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.txTitle}>{item.label || item.description || item.type || 'Course'}</Text>
                <Text style={styles.txDate}>{fmtDt(item.created_at || item.date || item.at)}</Text>
              </View>
              <Text style={[styles.txAmt, { color: isPositive ? colors.success : colors.danger }]}>
                {isPositive ? '+' : ''}{fmtMoney(amount, currency)}
              </Text>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  h1: { color: colors.text, fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  h2: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  heroCard: {
    backgroundColor: colors.primary, borderRadius: radius.xl, padding: spacing.lg,
    shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: 0 },
  },
  heroLabel: { color: colors.bg + 'CC', fontSize: 11, fontWeight: '800', letterSpacing: 1.8 },
  heroValue: { color: colors.bg, fontSize: 44, fontWeight: '900', letterSpacing: -2, marginTop: 8 },
  heroPending: { color: colors.bg + 'CC', fontSize: 13, fontWeight: '700', marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: {
    flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, padding: spacing.md, gap: 6,
  },
  statLbl: { color: colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.3, marginTop: 4 },
  statVal: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: spacing.sm },
  emptyWrap: { alignItems: 'center', paddingTop: 40, gap: 8 },
  emptyTitle: { color: colors.text, fontWeight: '800', marginTop: 6 },
  emptySub: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', paddingHorizontal: 40 },
  txRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
    borderBottomColor: colors.border, borderBottomWidth: 1,
  },
  txIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  txTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  txDate: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  txAmt: { fontSize: 16, fontWeight: '900' },
});
