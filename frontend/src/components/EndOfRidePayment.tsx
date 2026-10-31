import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text, TextInput } from '../ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import SlideButton from './SlideButton';
import { colors, radius, spacing } from '../theme';
import {
  apiError, collectMissionPayment, getMissionPayment, reportPaymentIssue, type MissionPayment,
} from '../api';
import { haptic } from '../feedback';

type Props = {
  visible: boolean;
  missionId: string;
  /** PATCH the ride to "completed". Must throw on failure. */
  onCompleteRide: () => Promise<void>;
  /** Ride completed → leave the screen. */
  onDone: () => void;
  /** Driver goes back to the ride (still in progress). */
  onCancel: () => void;
};

type Variant = 'collected' | 'paid' | 'cash' | 'card' | 'unconfirmed';

const eur = (n: number) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;

function newKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

function variantOf(p: MissionPayment): Variant {
  if (p.collection) return 'collected';
  if (p.display_case === 'paid_online' && Number(p.amount_due) === 0) return 'paid';
  if (p.display_case === 'collect_cash' && p.can_collect && p.amount_due > 0) return 'cash';
  if (p.display_case === 'collect_card' && p.can_collect && p.amount_due > 0) return 'card';
  return 'unconfirmed';
}

const REASONS = [
  { key: 'online_not_confirmed', label: 'Paiement en ligne non confirmé' },
  { key: 'client_refuses', label: 'Le client refuse de payer' },
  { key: 'amount_dispute', label: 'Désaccord sur le montant' },
  { key: 'other', label: 'Autre problème' },
];

const THEME: Record<Variant, { bg: string; fg: string; accent: string }> = {
  collected: { bg: colors.bg, fg: colors.text, accent: colors.paidAccent },
  paid: { bg: colors.bg, fg: colors.text, accent: colors.paidAccent },
  cash: { bg: colors.bg, fg: colors.text, accent: colors.cashAccent },
  card: { bg: colors.bg, fg: colors.text, accent: colors.cashAccent },
  unconfirmed: { bg: colors.bg, fg: colors.text, accent: colors.alertAccent },
};

export default function EndOfRidePayment({ visible, missionId, onCompleteRide, onDone, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const [payment, setPayment] = useState<MissionPayment | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [reporting, setReporting] = useState(false);
  // One idempotency key per payment screen: retries never create a 2nd collection.
  const keyRef = useRef(newKey());

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const p = await getMissionPayment(missionId);
      setPayment(p);
      setLoadError(null);
    } catch (e) {
      if (!silent) {
        setPayment(null);
        setLoadError(apiError(e));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [missionId]);

  useEffect(() => {
    if (!visible) return;
    keyRef.current = newKey();
    setActionError(null);
    setReportOpen(false);
    setReason(null);
    setComment('');
    load();
  }, [visible, load]);

  const variant = payment ? variantOf(payment) : null;

  // Red screen: keep re-checking so a dispatcher resolution shows up immediately.
  useEffect(() => {
    if (!visible || variant !== 'unconfirmed') return;
    const id = setInterval(() => load(true), 10000);
    return () => clearInterval(id);
  }, [visible, variant, load]);

  const finishRide = async () => {
    setActionError(null);
    try {
      await onCompleteRide();
      haptic('success');
      onDone();
    } catch (e) {
      haptic('error');
      setActionError(`La course n'a pas pu être terminée : ${apiError(e)}`);
    }
  };

  const confirmCollect = async () => {
    if (!payment || (variant !== 'cash' && variant !== 'card')) return;
    setActionError(null);
    try {
      const updated = await collectMissionPayment(missionId, {
        method: variant,
        amount: payment.amount_due,
        idempotency_key: keyRef.current,
      });
      setPayment(updated);
    } catch (e: any) {
      haptic('error');
      const st = e?.response?.status;
      if (st === 409) {
        // Already collected: show the server's truth, never ask again.
        await load(true);
        setActionError('Paiement déjà encaissé. Aucun nouvel encaissement possible.');
      } else {
        setActionError(`Encaissement NON enregistré : ${apiError(e)}. Réessayez.`);
        load(true);
      }
      return;
    }
    // Collection confirmed by the server → now end the ride.
    await finishRide();
  };

  const sendReport = async () => {
    if (!reason) return;
    setReporting(true);
    setActionError(null);
    try {
      await reportPaymentIssue(missionId, reason, comment.trim() || undefined);
      haptic('success');
      setReportOpen(false);
      await load(true);
      setPayment((p) => (p ? { ...p, payment_issue_open: true } : p));
    } catch (e) {
      haptic('error');
      setActionError(`Signalement non envoyé : ${apiError(e)}`);
    } finally {
      setReporting(false);
    }
  };

  const t = variant ? THEME[variant] : { bg: colors.bg, fg: colors.text, accent: colors.primary };
  const methodLabel = (p: MissionPayment) =>
    p.payment_method === 'cash_onboard' ? 'Espèces'
      : p.payment_method === 'card_onboard' ? 'Carte à bord'
        : 'En ligne';

  const Row = ({ label, value, big }: { label: string; value: string; big?: boolean }) => (
    <View style={[styles.row, { borderColor: t.fg + '22' }]}>
      <Text style={[styles.rowLbl, { color: t.fg }]}>{label}</Text>
      <Text style={[big ? styles.rowValBig : styles.rowVal, { color: t.fg }]}>{value}</Text>
    </View>
  );

  const renderReport = () => (
    <View style={[styles.reportBox, { borderColor: t.fg + '33' }]} testID="payment-report-box">
      <Text style={[styles.reportTitle, { color: t.fg }]}>Quel est le problème ?</Text>
      {REASONS.map((r) => (
        <TouchableOpacity
          key={r.key}
          style={[styles.reason, { borderColor: t.fg + '33' }, reason === r.key && { backgroundColor: t.accent, borderColor: t.accent }]}
          onPress={() => setReason(r.key)}
          testID={`payment-reason-${r.key}`}
        >
          <Ionicons name={reason === r.key ? 'radio-button-on' : 'radio-button-off'} size={18} color={reason === r.key ? colors.text : t.fg} />
          <Text style={[styles.reasonTxt, { color: reason === r.key ? colors.text : t.fg }]}>{r.label}</Text>
        </TouchableOpacity>
      ))}
      <TextInput
        style={[styles.comment, { color: t.fg, borderColor: t.fg + '33' }]}
        placeholder="Commentaire (facultatif)"
        placeholderTextColor={t.fg + '88'}
        value={comment}
        onChangeText={setComment}
        multiline
        testID="payment-report-comment"
      />
      <TouchableOpacity
        style={[styles.reportSend, { backgroundColor: t.accent }, (!reason || reporting) && { opacity: 0.5 }]}
        onPress={sendReport}
        disabled={!reason || reporting}
        testID="payment-report-send"
      >
        {reporting ? <ActivityIndicator color={colors.text} /> : (
          <>
            <Ionicons name="send" size={16} color={colors.text} />
            <Text style={styles.reportSendTxt}>Envoyer au dispatcheur</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  const reportButton = (p: MissionPayment) => (
    p.payment_issue_open ? (
      <View style={[styles.issueSent, { borderColor: t.accent }]} testID="payment-issue-sent">
        <Ionicons name="checkmark-done" size={18} color={t.accent} />
        <Text style={[styles.issueSentTxt, { color: t.accent }]}>Problème signalé au dispatcheur. Il va vérifier le paiement.</Text>
      </View>
    ) : reportOpen ? renderReport() : (
      <TouchableOpacity
        style={[styles.reportBtn, { borderColor: t.accent }]}
        onPress={() => setReportOpen(true)}
        testID="payment-report-btn"
      >
        <Ionicons name="flag" size={18} color={t.accent} />
        <Text style={[styles.reportBtnTxt, { color: t.accent }]}>Signaler un problème de paiement</Text>
      </TouchableOpacity>
    )
  );

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centerTxt}>Vérification du paiement auprès du serveur…</Text>
        </View>
      );
    }
    if (!payment || !variant) {
      // Network / server error: never show any payment confirmation.
      return (
        <View style={styles.center} testID="payment-load-error">
          <Ionicons name="cloud-offline" size={48} color={colors.danger} />
          <Text style={styles.errTitle}>Statut du paiement indisponible</Text>
          <Text style={styles.centerTxt}>
            Impossible de vérifier le paiement. N&apos;encaissez rien et ne considérez pas la course comme payée.
            {loadError ? `\n(${loadError})` : ''}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()} testID="payment-retry-btn">
            <Ionicons name="refresh" size={18} color={colors.onPrimary} />
            <Text style={styles.retryTxt}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const p = payment;
    if (variant === 'paid' || variant === 'collected') {
      const c = p.collection;
      return (
        <>
          <Ionicons name="checkmark-circle" size={64} color={t.accent} style={styles.bigIcon} />
          <Text style={[styles.title, { color: t.accent }]} testID="payment-title">
            {variant === 'paid' ? '✅ COURSE DÉJÀ PAYÉE' : '✅ ENCAISSEMENT ENREGISTRÉ'}
          </Text>
          <View style={[styles.banner, { backgroundColor: t.accent }]}>
            <Ionicons name="hand-left" size={20} color={colors.text} />
            <Text style={styles.bannerTxt}>
              {variant === 'paid' ? '⛔ NE PAS ENCAISSER LE CLIENT' : '⛔ NE PAS ENCAISSER À NOUVEAU'}
            </Text>
          </View>
          <Text style={[styles.message, { color: t.fg }]}>
            {variant === 'paid'
              ? 'Le client a déjà payé sa course en ligne. Vous ne devez demander aucun paiement supplémentaire.'
              : 'Le paiement de cette course a déjà été encaissé et enregistré. Ne demandez rien de plus au client.'}
          </Text>
          <View style={styles.rows}>
            <Row label="Montant payé" value={eur(p.amount_paid)} />
            <Row label="Mode de paiement" value={c ? (c.method === 'card' ? 'Carte à bord' : 'Espèces') : 'En ligne'} />
            <Row label="Statut" value="PAYÉ" />
            {c?.collected_at ? (
              <Row label="Encaissé le" value={new Date(c.collected_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} />
            ) : null}
            <Row label="Montant restant à encaisser" value={eur(0)} big />
          </View>
        </>
      );
    }

    if (variant === 'cash' || variant === 'card') {
      const isCard = variant === 'card';
      return (
        <>
          <Ionicons name={isCard ? 'card' : 'cash'} size={64} color={t.accent} style={styles.bigIcon} />
          <Text style={[styles.title, { color: t.accent }]} testID="payment-title">
            {isCard ? '💳 PAIEMENT PAR CARTE À BORD' : '💶 PAIEMENT EN ESPÈCES'}
          </Text>
          <View style={[styles.banner, { backgroundColor: t.accent }]}>
            <Ionicons name="warning" size={20} color={colors.text} />
            <Text style={styles.bannerTxt}>
              ⚠️ ENCAISSEZ {eur(p.amount_due)}{isCard ? ' PAR CARTE' : ''} AUPRÈS DU CLIENT
            </Text>
          </View>
          <Text style={[styles.message, { color: t.fg }]}>
            Cette course n&apos;a pas été réglée en ligne. Vous devez récupérer le montant indiqué auprès du client
            {isCard ? ' avec votre terminal de paiement.' : '.'}
          </Text>
          <View style={[styles.amountBox, { borderColor: t.accent }]}>
            <Text style={[styles.amountLbl, { color: colors.textSecondary }]}>Montant à encaisser</Text>
            <Text style={[styles.amountVal, { color: t.accent }]} testID="payment-amount-due">{eur(p.amount_due)}</Text>
            <View style={styles.lockRow}>
              <Ionicons name="lock-closed" size={12} color={t.fg} />
              <Text style={[styles.lockTxt, { color: t.fg }]}>Montant fixé par le serveur</Text>
            </View>
          </View>
          <View style={styles.rows}>
            {p.amount_paid > 0 ? <Row label="Déjà payé en ligne" value={eur(p.amount_paid)} /> : null}
            <Row label="Mode de paiement" value={isCard ? 'Carte à bord' : 'Espèces'} />
            <Row label="Statut" value="EN ATTENTE D'ENCAISSEMENT" />
          </View>
          {reportButton(p)}
        </>
      );
    }

    // unconfirmed
    return (
      <>
        <Ionicons name="alert-circle" size={64} color={t.accent} style={styles.bigIcon} />
        <Text style={[styles.title, { color: t.accent }]} testID="payment-title">Paiement non confirmé</Text>
        <View style={[styles.banner, { backgroundColor: t.accent }]}>
          <Ionicons name="call" size={20} color={colors.text} />
          <Text style={styles.bannerTxt}>Contactez le dispatcheur</Text>
        </View>
        <Text style={[styles.message, { color: t.fg }]}>
          Le paiement en ligne n&apos;a pas été confirmé. Ne considérez pas cette course comme payée.
        </Text>
        <View style={styles.rows}>
          <Row label="Montant de la course" value={eur(p.amount_total)} />
          <Row label="Mode de paiement" value={methodLabel(p)} />
          <Row label="Statut" value="NON CONFIRMÉ" />
          <Row label="Reste dû" value={eur(p.amount_due)} />
        </View>
        {reportButton(p)}
      </>
    );
  };

  const renderSlider = () => {
    if (!payment || !variant || loading) return null;
    if (variant === 'paid' || variant === 'collected') {
      return (
        <SlideButton
          label={variant === 'paid' ? "J'AI COMPRIS – TERMINER" : 'Terminer la course'}
          subLabel="Glissez jusqu'au bout pour terminer la course"
          color={t.accent}
          onConfirm={finishRide}
          testID="slide-payment-finish"
        />
      );
    }
    if (variant === 'cash' || variant === 'card') {
      return (
        <View style={{ gap: 10 }}>
          <SlideButton
            label={`J'AI ENCAISSÉ ${eur(payment.amount_due)}`}
            subLabel={variant === 'card' ? 'Glissez seulement après paiement accepté' : "Glissez seulement après avoir reçu l'argent"}
            color={t.accent}
            onConfirm={confirmCollect}
            testID="slide-payment-collect"
          />
          {payment.payment_issue_open ? (
            <SlideButton
              label="TERMINER SANS ENCAISSER"
              subLabel="Problème signalé – le paiement restera non confirmé"
              color={colors.alertAccent}
              onConfirm={finishRide}
              testID="slide-payment-finish-no-collect"
            />
          ) : null}
        </View>
      );
    }
    // Red: the ride may be ended (never as paid) once the dispatcher is informed.
    return (
      <SlideButton
        label="TERMINER SANS ENCAISSER"
        subLabel={payment.payment_issue_open ? 'Le paiement restera non confirmé' : "Signalez d'abord le problème"}
        color={t.accent}
        disabled={!payment.payment_issue_open}
        onConfirm={finishRide}
        testID="slide-payment-unconfirmed-finish"
      />
    );
  };

  const canGoBack = !payment?.collection;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={canGoBack ? onCancel : () => {}}>
      <GestureHandlerRootView style={styles.root}>
      <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top + spacing.sm }]} testID="end-of-ride-payment">
        <View style={styles.topBar}>
          {canGoBack ? (
            <TouchableOpacity onPress={onCancel} style={[styles.backBtn, { borderColor: t.fg + '44' }]} testID="payment-back-btn">
              <Ionicons name="chevron-back" size={18} color={t.fg} />
              <Text style={[styles.backTxt, { color: t.fg }]}>Retour à la course</Text>
            </TouchableOpacity>
          ) : <View />}
        </View>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {renderBody()}
          {actionError ? (
            <View style={styles.errBox} testID="payment-action-error">
              <Ionicons name="close-circle" size={18} color={colors.alertAccent} />
              <Text style={styles.errTxt}>{actionError}</Text>
            </View>
          ) : null}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + 12, 20) }]}>
          {renderSlider()}
        </View>
      </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { paddingHorizontal: spacing.md, minHeight: 44, justifyContent: 'center' },
  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    paddingHorizontal: 12, height: 40, borderRadius: radius.full, borderWidth: 1,
  },
  backTxt: { fontWeight: '700', fontSize: 13 },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl, alignItems: 'stretch' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 80, paddingHorizontal: spacing.md },
  centerTxt: { color: colors.textSecondary, textAlign: 'center', fontSize: 14, lineHeight: 20 },
  errTitle: { color: colors.text, fontWeight: '800', fontSize: 18, textAlign: 'center' },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8,
    backgroundColor: colors.primary, height: 48, paddingHorizontal: 24, borderRadius: radius.full,
  },
  retryTxt: { color: colors.onPrimary, fontWeight: '800', letterSpacing: 0.2 },
  bigIcon: { alignSelf: 'center', marginTop: spacing.sm },
  title: { fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: spacing.sm, letterSpacing: 0.2 },
  banner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: spacing.md, marginTop: spacing.md,
  },
  bannerTxt: { color: colors.text, fontWeight: '800', fontSize: 16, textAlign: 'center', flexShrink: 1 },
  message: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: spacing.md, fontWeight: '600' },
  amountBox: {
    marginTop: spacing.md, borderWidth: 3, borderRadius: radius.xl,
    paddingVertical: spacing.md, alignItems: 'center',
  },
  amountLbl: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  amountVal: { fontSize: 52, fontWeight: '800', marginTop: 4 },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, opacity: 0.8 },
  lockTxt: { fontSize: 11, fontWeight: '700' },
  rows: { marginTop: spacing.md },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, gap: 12,
  },
  rowLbl: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  rowVal: { fontSize: 15, fontWeight: '800', textAlign: 'right', flexShrink: 1 },
  rowValBig: { fontSize: 20, fontWeight: '800' },
  reportBtn: {
    marginTop: spacing.lg, borderWidth: 2, borderRadius: radius.full, height: 52,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  reportBtnTxt: { fontWeight: '800', fontSize: 15 },
  reportBox: { marginTop: spacing.lg, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: 8 },
  reportTitle: { fontWeight: '800', fontSize: 15, marginBottom: 4 },
  reason: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48,
    paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1,
  },
  reasonTxt: { fontWeight: '700', fontSize: 14, flexShrink: 1 },
  comment: { borderWidth: 1, borderRadius: radius.md, minHeight: 64, padding: 10, fontSize: 14, textAlignVertical: 'top' },
  reportSend: {
    height: 50, borderRadius: radius.full, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4,
  },
  reportSendTxt: { color: colors.text, fontWeight: '800', letterSpacing: 0.2 },
  issueSent: {
    marginTop: spacing.lg, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  issueSentTxt: { fontWeight: '700', fontSize: 14, flexShrink: 1 },
  errBox: {
    marginTop: spacing.md, backgroundColor: colors.alertAccent + '22', borderColor: colors.alertAccent, borderWidth: 1,
    borderRadius: radius.md, padding: 12, flexDirection: 'row', gap: 8, alignItems: 'center',
  },
  errTxt: { color: colors.text, fontWeight: '700', flexShrink: 1, fontSize: 13 },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
});
