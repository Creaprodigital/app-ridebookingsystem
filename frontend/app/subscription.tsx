import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../src/theme';
import { useDriverSubscription, DriverSubscriptionStatus } from '../src/driverSubscription';
import { haptic } from '../src/feedback';

function fmtEuro(cents: number): string {
  const eur = (Number(cents) || 0) / 100;
  return eur.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch { return '—'; }
}

/** Human, colour-coded label for each backend status. */
function statusMeta(status: DriverSubscriptionStatus): { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap } {
  switch (status) {
    case 'active':
      return { label: 'Actif', color: colors.success, bg: '#22C55E22', icon: 'checkmark-circle' };
    case 'trialing':
      return { label: 'Période d’essai', color: colors.primary, bg: colors.primary + '22', icon: 'time' };
    case 'past_due':
    case 'unpaid':
      return { label: 'Paiement en retard', color: colors.danger, bg: '#EF444422', icon: 'alert-circle' };
    case 'canceled':
      return { label: 'Annulé', color: colors.textMuted, bg: '#71717A22', icon: 'close-circle' };
    case 'incomplete':
    case 'incomplete_expired':
      return { label: 'Paiement à finaliser', color: colors.danger, bg: '#EF444422', icon: 'alert-circle' };
    default:
      return { label: 'Aucun abonnement', color: colors.textMuted, bg: '#71717A22', icon: 'lock-closed' };
  }
}

export default function SubscriptionScreen() {
  const router = useRouter();
  const { state, loading, needsPayment, refresh, startCheckout } = useDriverSubscription();
  const [paying, setPaying] = useState(false);

  const onSubscribe = useCallback(async () => {
    haptic('medium');
    setPaying(true);
    const res = await startCheckout();
    setPaying(false);
    if (!res.ok) {
      haptic('error');
      const msg = res.error || 'Impossible d’initier le paiement.';
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Paiement indisponible', msg);
    }
  }, [startCheckout]);

  const meta = statusMeta(state.status);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={8} testID="sub-back">
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Mon abonnement</Text>
          <View style={{ width: 26 }} />
        </View>

        {/* Status card */}
        <View style={styles.card}>
          <View style={[styles.badge, { backgroundColor: meta.bg }]}>
            <Ionicons name={meta.icon} size={16} color={meta.color} />
            <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>

          <Text style={styles.priceRow}>
            <Text style={styles.priceValue}>{fmtEuro(state.monthlyAmountCents)}</Text>
            <Text style={styles.priceSuffix}>  / mois</Text>
          </Text>

          {!state.enabled ? (
            <Text style={styles.subtle}>
              Votre opérateur n’a pas activé l’abonnement pour votre compte.
            </Text>
          ) : (
            <>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Prochaine facturation</Text>
                <Text style={styles.metaValue}>{fmtDate(state.nextBillingAt)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Dernier paiement</Text>
                <Text style={styles.metaValue}>{fmtDate(state.lastPaidAt)}</Text>
              </View>
              {state.lastFailureReason ? (
                <View style={styles.failBox}>
                  <Ionicons name="warning" size={16} color={colors.danger} />
                  <Text style={styles.failText}>{state.lastFailureReason}</Text>
                </View>
              ) : null}
            </>
          )}
        </View>

        {/* Explanation when blocked */}
        {needsPayment ? (
          <View style={styles.warnCard} testID="sub-warn">
            <View style={styles.warnHeader}>
              <Ionicons name="lock-closed" size={20} color={colors.danger} />
              <Text style={styles.warnTitle}>Compte bloqué</Text>
            </View>
            <Text style={styles.warnBody}>
              Pour recevoir des courses et passer en ligne, vous devez régler votre
              abonnement. Le paiement est sécurisé via Stripe.
            </Text>
          </View>
        ) : state.status === 'active' ? (
          <View style={styles.okCard}>
            <Ionicons name="shield-checkmark" size={20} color={colors.success} />
            <Text style={styles.okText}>
              Abonnement à jour — vous pouvez recevoir des courses.
            </Text>
          </View>
        ) : null}

        {/* CTA */}
        {state.enabled && state.status !== 'active' ? (
          <TouchableOpacity
            style={[styles.cta, paying && { opacity: 0.7 }]}
            onPress={onSubscribe}
            disabled={paying}
            activeOpacity={0.85}
            testID="sub-cta"
          >
            {paying ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <>
                <Ionicons name="card" size={20} color={colors.bg} />
                <Text style={styles.ctaText}>S’ABONNER</Text>
                <Ionicons name="arrow-forward" size={20} color={colors.bg} />
              </>
            )}
          </TouchableOpacity>
        ) : null}

        <Text style={styles.legal}>
          Le paiement est traité par Stripe. Aucune donnée bancaire ne transite par
          l’application.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.lg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  card: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md,
  },
  badge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full,
  },
  badgeText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  priceRow: { alignItems: 'baseline' },
  priceValue: { color: colors.text, fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  priceSuffix: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  metaRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 6,
  },
  metaLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  metaValue: { color: colors.text, fontSize: 13, fontWeight: '700' },
  subtle: { color: colors.textMuted, fontSize: 13 },
  failBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: '#EF444420', borderRadius: radius.md, padding: spacing.sm,
  },
  failText: { color: colors.danger, fontSize: 12, fontWeight: '600', flex: 1 },
  warnCard: {
    backgroundColor: '#EF444414', borderColor: colors.danger, borderWidth: 1,
    borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm,
  },
  warnHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  warnTitle: { color: colors.danger, fontSize: 15, fontWeight: '900' },
  warnBody: { color: colors.text, fontSize: 13, lineHeight: 19 },
  okCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: '#22C55E14', borderColor: colors.success, borderWidth: 1,
    borderRadius: radius.xl, padding: spacing.md,
  },
  okText: { color: colors.success, fontSize: 13, fontWeight: '700', flex: 1 },
  cta: {
    height: 56, backgroundColor: colors.primary, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm,
  },
  ctaText: { color: colors.bg, fontWeight: '900', fontSize: 15, letterSpacing: 1.2 },
  legal: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },
});
