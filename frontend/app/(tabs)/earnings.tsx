import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import { api, apiError } from '../../src/api';
import {
  RideStats,
  acceptanceRate,
  getStatsSync,
  resetStats,
  subscribeStats,
} from '../../src/rideStats';
import { haptic } from '../../src/feedback';

const TYPE_LABELS: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  topup: { label: 'Recharge', icon: 'arrow-down-circle', color: colors.success },
  topup_pending: { label: 'Recharge en attente', icon: 'time-outline', color: colors.warning },
  topup_failed: { label: 'Recharge échouée', icon: 'close-circle', color: colors.danger },
  commission_internal: { label: 'Commission — Marketplace interne', icon: 'git-network-outline', color: colors.danger },
  commission_external: { label: 'Commission — Marketplace externe', icon: 'globe-outline', color: colors.danger },
  payout: { label: 'Retrait', icon: 'arrow-up-circle', color: colors.danger },
  refund: { label: 'Remboursement', icon: 'refresh-circle-outline', color: colors.success },
};

function fmtEur(n: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
}

function fmtDt(s?: string) {
  if (!s) return '';
  try {
    return new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return s;
  }
}

export default function Wallet() {
  const [wallet, setWallet] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [amount, setAmount] = useState('50');
  const [submitting, setSubmitting] = useState(false);
  const [stats, setStats] = useState<RideStats>(getStatsSync());

  // Live subscribe to ride acceptance stats
  React.useEffect(() => {
    const unsub = subscribeStats((s) => setStats(s));
    return () => { unsub(); };
  }, []);

  const onResetStats = () => {
    haptic('warning');
    if (Platform.OS === 'web') {
      const ok = (typeof window !== 'undefined') && window.confirm('Réinitialiser vos statistiques de courses immédiates ?');
      if (ok) resetStats();
      return;
    }
    Alert.alert(
      'Réinitialiser les statistiques',
      'Cette action effacera vos compteurs locaux (proposées, acceptées, refusées). Continuer ?',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Réinitialiser', style: 'destructive', onPress: () => resetStats() },
      ]
    );
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/driver/wallet');
      setWallet(data);
    } catch {
      setWallet(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const startTopup = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0 || amt > 10000) {
      if (Platform.OS === 'web') window.alert('Montant invalide (1€ – 10 000€)');
      else Alert.alert('Erreur', 'Montant invalide (1€ – 10 000€)');
      return;
    }
    setSubmitting(true);
    try {
      // For payment redirects, prefer window.location.origin on web; on native, use API base.
      const origin =
        Platform.OS === 'web' && typeof window !== 'undefined'
          ? window.location.origin
          : (process.env.EXPO_PUBLIC_API_BASE as string);
      const { data } = await api.post('/driver/wallet/topup', { amount: amt, origin_url: origin });
      if (data?.url) {
        if (Platform.OS === 'web') window.location.href = data.url;
        else Linking.openURL(data.url);
        setTopupOpen(false);
      }
    } catch (e) {
      const msg = apiError(e);
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Erreur de paiement', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const balance = Number(wallet?.balance_eur ?? 0);
  const allTxs: any[] = wallet?.transactions || wallet?.movements || wallet?.history || [];
  // Hide pending top-ups — only show confirmed transactions in the list.
  // We treat "pending" as: type=='topup_pending' OR status starts with pending/incomplete/await
  const txs: any[] = allTxs.filter((t: any) => {
    const type = String(t?.type || '').toLowerCase();
    const status = String(t?.status || '').toLowerCase();
    if (type === 'topup_pending') return false;
    if (status === 'pending' || status === 'incomplete' || status === 'awaiting' || status === 'requires_payment_method' || status === 'processing') return false;
    return true;
  });

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
              <Text style={styles.h1}>Portefeuille chauffeur</Text>
              <Text style={styles.h2}>Suivi en temps réel de votre solde</Text>
            </View>

            <View style={styles.heroCard} testID="wallet-balance">
              <Text style={styles.heroLabel}>SOLDE DU PORTEFEUILLE</Text>
              <Text style={styles.heroValue}>{fmtEur(balance)}</Text>
              <Text style={styles.heroSub}>disponibles</Text>

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => setTopupOpen(true)}
                  testID="topup-btn"
                >
                  <Ionicons name="add-circle" size={18} color={colors.bg} />
                  <Text style={styles.primaryBtnText}>RECHARGER</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.ghostBtn}
                  onPress={load}
                  testID="refresh-btn"
                >
                  <Ionicons name="refresh" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            {balance < 0 ? (
              <View style={styles.warnBanner}>
                <Ionicons name="warning" size={16} color={colors.danger} />
                <Text style={styles.warnText}>
                  Portefeuille sous le seuil requis. Rechargez pour continuer à recevoir des courses.
                </Text>
              </View>
            ) : null}

            {/* Statistiques courses immédiates */}
            <View style={styles.statsCard} testID="immediate-stats-card">
              <View style={styles.statsHead}>
                <View style={styles.statsHeadLeft}>
                  <View style={styles.statsHeadIcon}>
                    <Ionicons name="flash" size={16} color={colors.primary} />
                  </View>
                  <View>
                    <Text style={styles.statsTitle}>Courses immédiates</Text>
                    <Text style={styles.statsSub}>Vos statistiques locales</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={onResetStats} style={styles.resetBtn} testID="stats-reset-btn">
                  <Ionicons name="refresh-outline" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={styles.rateBlock}>
                <Text style={styles.rateValue} testID="acceptance-rate">
                  {acceptanceRate(stats)}
                  <Text style={styles.ratePct}> %</Text>
                </Text>
                <Text style={styles.rateLabel}>TAUX D’ACCEPTATION</Text>
                <View style={styles.rateBarOuter}>
                  <View
                    style={[
                      styles.rateBarInner,
                      { width: `${Math.min(100, Math.max(0, acceptanceRate(stats)))}%` },
                    ]}
                  />
                </View>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statBoxValue} testID="stats-proposed">{stats.proposed}</Text>
                  <Text style={styles.statBoxLabel}>Proposées</Text>
                </View>
                <View style={[styles.statBox, styles.statBoxAccent]}>
                  <Text style={[styles.statBoxValue, { color: colors.success }]} testID="stats-accepted">
                    {stats.accepted}
                  </Text>
                  <Text style={styles.statBoxLabel}>Acceptées</Text>
                </View>
                <View style={[styles.statBox, styles.statBoxAccent]}>
                  <Text style={[styles.statBoxValue, { color: colors.danger }]} testID="stats-refused">
                    {stats.refused}
                  </Text>
                  <Text style={styles.statBoxLabel}>Refusées</Text>
                </View>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Mouvements de portefeuille</Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyWrap}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <View style={styles.emptyWrap}>
              <Ionicons name="receipt-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Aucun mouvement</Text>
              <Text style={styles.emptySub}>
                Vos recharges, commissions et retraits apparaîtront ici.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const meta = TYPE_LABELS[item.type] ?? { label: item.type ?? 'Mouvement', icon: 'cash-outline', color: colors.textSecondary };
          const rawAmount = (item.amount_cents ?? 0) / 100;
          const type = String(item.type || '');
          // Debit types — money leaving the wallet — must always render as negative
          const isDebitType =
            type.startsWith('commission_') ||
            type === 'payout' ||
            type === 'fee' ||
            type === 'chargeback';
          const isCreditType =
            type === 'topup' ||
            type === 'refund' ||
            type === 'adjustment_credit' ||
            type === 'bonus';
          let isCredit: boolean;
          if (isDebitType) isCredit = false;
          else if (isCreditType) isCredit = true;
          else if (item.direction === 'credit') isCredit = true;
          else if (item.direction === 'debit') isCredit = false;
          else isCredit = rawAmount > 0;
          const displayAmount = isCredit ? Math.abs(rawAmount) : -Math.abs(rawAmount);
          return (
            <View style={styles.txRow} testID={`tx-${item.id ?? item._id}`}>
              <View style={[styles.txIcon, { backgroundColor: meta.color + '22' }]}>
                <Ionicons name={meta.icon} size={18} color={meta.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.txTitle} numberOfLines={1}>{meta.label}</Text>
                <Text style={styles.txDate}>{fmtDt(item.created_at || item.date || item.at)}</Text>
              </View>
              <Text style={[styles.txAmt, { color: isCredit ? colors.success : colors.danger }]}>
                {isCredit ? '+' : ''}{fmtEur(displayAmount)}
              </Text>
            </View>
          );
        }}
      />

      {/* Topup modal */}
      <Modal visible={topupOpen} animationType="slide" transparent onRequestClose={() => setTopupOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard} testID="topup-modal">
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Recharger mon portefeuille</Text>
              <TouchableOpacity onPress={() => setTopupOpen(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>Montant en euros (entre 1€ et 10 000€)</Text>

            <View style={styles.amountRow}>
              <Text style={styles.amountSign}>€</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
                style={styles.amountInput}
                placeholder="50"
                placeholderTextColor={colors.textMuted}
                testID="topup-amount"
              />
            </View>

            <View style={styles.quickRow}>
              {[20, 50, 100, 200].map((v) => (
                <TouchableOpacity
                  key={v}
                  style={styles.quickBtn}
                  onPress={() => setAmount(String(v))}
                  testID={`quick-${v}`}
                >
                  <Text style={styles.quickText}>{v} €</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.payBtn, submitting && { opacity: 0.6 }]}
              disabled={submitting}
              onPress={startTopup}
              testID="topup-confirm"
            >
              {submitting ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <>
                  <Ionicons name="card" size={18} color={colors.bg} />
                  <Text style={styles.payText}>PAYER PAR CARTE</Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.payHint}>
              Paiement sécurisé via Stripe. Vous serez redirigé pour finaliser.
            </Text>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  heroLabel: { color: colors.bg + 'CC', fontSize: 11, fontWeight: '800', letterSpacing: 1.6 },
  heroValue: { color: colors.bg, fontSize: 44, fontWeight: '900', letterSpacing: -2, marginTop: 8 },
  heroSub: { color: colors.bg + 'AA', fontSize: 12, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: spacing.md },
  primaryBtn: {
    flex: 1, height: 48, backgroundColor: colors.bg, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  primaryBtnText: { color: colors.text, fontWeight: '900', letterSpacing: 1 },
  ghostBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.bg + '33', alignItems: 'center', justifyContent: 'center',
  },
  warnBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.danger + '20', borderColor: colors.danger,
    borderWidth: 1, borderRadius: radius.lg, padding: 12,
  },
  warnText: { color: colors.danger, fontSize: 12, fontWeight: '700', flex: 1 },

  // Stats card (immediate rides)
  statsCard: {
    backgroundColor: colors.surface, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, gap: 14,
  },
  statsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statsHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  statsHeadIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center',
  },
  statsTitle: { color: colors.text, fontWeight: '800', fontSize: 14 },
  statsSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  resetBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  rateBlock: {
    backgroundColor: colors.bg, borderRadius: radius.lg,
    paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', gap: 6,
  },
  rateValue: { color: colors.primary, fontSize: 36, fontWeight: '900', letterSpacing: -1 },
  ratePct: { color: colors.primary, fontSize: 18, fontWeight: '900' },
  rateLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  rateBarOuter: {
    width: '100%', height: 6, borderRadius: 3,
    backgroundColor: colors.border, marginTop: 8, overflow: 'hidden',
  },
  rateBarInner: { height: '100%', backgroundColor: colors.primary, borderRadius: 3 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statBox: {
    flex: 1, backgroundColor: colors.bg, borderRadius: radius.md,
    paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  statBoxAccent: { backgroundColor: colors.bg },
  statBoxValue: { color: colors.text, fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  statBoxLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', marginTop: 2 },

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
  pendingTag: {
    color: colors.warning, fontSize: 10, fontWeight: '900', letterSpacing: 1,
    marginTop: 4,
  },
  txAmt: { fontSize: 16, fontWeight: '900' },

  // Modal
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000099' },
  modalCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.lg, gap: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? 40 : spacing.lg,
  },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  modalSub: { color: colors.textSecondary, fontSize: 13, marginTop: -8 },
  amountRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, paddingHorizontal: spacing.md, height: 60,
  },
  amountSign: { color: colors.primary, fontSize: 28, fontWeight: '900' },
  amountInput: { flex: 1, color: colors.text, fontSize: 26, fontWeight: '800' },
  quickRow: { flexDirection: 'row', gap: 8 },
  quickBtn: {
    flex: 1, paddingVertical: 12, borderRadius: radius.full,
    backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  quickText: { color: colors.text, fontWeight: '700' },
  payBtn: {
    height: 56, backgroundColor: colors.primary, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  payText: { color: colors.bg, fontWeight: '900', letterSpacing: 1.2 },
  payHint: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
});
