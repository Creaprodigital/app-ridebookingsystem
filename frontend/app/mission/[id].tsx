import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import MapView from '../../src/components/MapView';
import SlideButton from '../../src/components/SlideButton';
import { colors, radius, spacing } from '../../src/theme';
import { getDriverMissions, updateMissionStatus, apiError } from '../../src/api';
import { getNavProvider, buildNavUrl } from '../../src/prefs';
import { useRides } from '../../src/ridesContext';
import { haptic } from '../../src/feedback';

const NEXT: Record<string, { next: string; label: string }> = {
  assigned: { next: 'en_route', label: 'GLISSER POUR DÉMARRER' },
  en_route: { next: 'arrived', label: 'GLISSER — JE SUIS ARRIVÉ' },
  arrived: { next: 'in_progress', label: 'GLISSER — CLIENT À BORD' },
  in_progress: { next: 'completed', label: 'GLISSER POUR TERMINER' },
};

function pickAddr(m: any, t: 'pickup' | 'dropoff') {
  return m?.booking?.[`${t}_address`] || m?.[`${t}_address`] || m?.[t]?.address || m?.[t] || '—';
}
function pickLatLng(m: any, t: 'pickup' | 'dropoff'): { lat: number; lng: number } | null {
  const lat =
    m?.booking?.[`${t}_lat`] ??
    m?.[`${t}_lat`] ??
    m?.[t]?.lat ??
    m?.[`${t}_location`]?.lat;
  const lng =
    m?.booking?.[`${t}_lng`] ??
    m?.[`${t}_lng`] ??
    m?.[t]?.lng ??
    m?.[`${t}_location`]?.lng;
  if (lat != null && lng != null) return { lat: Number(lat), lng: Number(lng) };
  return null;
}

function pickPrice(m: any) {
  return (
    m?.pricing?.final ??
    m?.price ??
    m?.fare ??
    m?.amount ??
    m?.total ??
    m?.booking?.price ??
    m?.booking?.total
  );
}

type PaymentInfo = {
  method: string;
  isOnline: boolean;
  label: string;
};

function pickPaymentInfo(m: any): PaymentInfo {
  const raw = String(
    m?.payment_method ||
      m?.payment?.method ||
      m?.booking?.payment_method ||
      m?.booking?.payment?.method ||
      ''
  ).toLowerCase();
  const status = String(
    m?.payment_status ||
      m?.payment?.status ||
      m?.booking?.payment_status ||
      ''
  ).toLowerCase();
  const paidOnline =
    Boolean(m?.paid_online) ||
    Boolean(m?.booking?.paid_online) ||
    Boolean(m?.payment?.paid_online) ||
    status === 'paid' ||
    status === 'captured' ||
    status === 'completed';

  // Treat any of these as ONLINE/PRE-PAID
  const onlineKeywords = ['card', 'online', 'stripe', 'app', 'apple_pay', 'google_pay', 'paypal', 'prepaid', 'wallet', 'en_ligne', 'ligne'];
  const cashKeywords = ['cash', 'onboard', 'on_board', 'bord', 'a_bord', 'à_bord', 'espece', 'espèces', 'especes'];

  let isOnline: boolean;
  if (onlineKeywords.some((k) => raw.includes(k))) isOnline = true;
  else if (cashKeywords.some((k) => raw.includes(k))) isOnline = false;
  else isOnline = paidOnline;

  let label: string;
  if (isOnline) label = 'PAIEMENT EN LIGNE';
  else label = 'PAIEMENT À BORD';

  return { method: raw || 'unknown', isOnline, label };
}

export default function MissionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { onShift } = useRides();
  const [mission, setMission] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [completion, setCompletion] = useState<{
    visible: boolean;
    price: number | null;
    payment: PaymentInfo | null;
  }>({ visible: false, price: null, payment: null });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list: any = await getDriverMissions();
      const arr = Array.isArray(list) ? list : (list?.current ?? list?.items ?? []);
      const all = [...arr, ...(list?.history ?? [])];
      const m = all.find((x: any) => String(x.id ?? x._id) === String(id));
      setMission(m || null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNav = async () => {
    if (!mission) return;
    const p = pickLatLng(mission, 'pickup');
    const d = pickLatLng(mission, 'dropoff');
    const target = mission.status === 'in_progress' ? d : p;
    const provider = await getNavProvider();
    if (!target) {
      const q = encodeURIComponent(pickAddr(mission, mission.status === 'in_progress' ? 'dropoff' : 'pickup'));
      const url = provider === 'waze'
        ? `https://waze.com/ul?q=${q}&navigate=yes`
        : (Platform.OS === 'ios'
            ? `http://maps.apple.com/?q=${q}`
            : `https://www.google.com/maps/search/?api=1&query=${q}`);
      Linking.openURL(url);
      return;
    }
    const url = buildNavUrl(provider, target.lat, target.lng);
    Linking.openURL(url);
  };

  const advance = async () => {
    if (!mission) return;
    if (!onShift) {
      haptic('warning');
      const msg = 'Vous êtes hors service. Veuillez passer en service depuis l’onglet Carte pour démarrer ou poursuivre la course.';
      if (Platform.OS !== 'web') Alert.alert('Hors service', msg);
      else if (typeof window !== 'undefined') window.alert(msg);
      return;
    }
    const t = NEXT[mission.status];
    if (!t) return;
    try {
      await updateMissionStatus(String(mission.id ?? mission._id), t.next);
      // For "completed", show payment summary modal BEFORE refreshing
      if (t.next === 'completed') {
        haptic('success');
        const price = Number(pickPrice(mission) ?? 0);
        const payment = pickPaymentInfo(mission);
        setCompletion({
          visible: true,
          price: Number.isFinite(price) ? price : null,
          payment,
        });
        return;
      }
      haptic('medium');
      await load();
    } catch (e) {
      haptic('error');
      const msg = apiError(e);
      if (Platform.OS !== 'web') Alert.alert('Erreur', msg);
    }
  };

  const closeCompletion = () => {
    setCompletion({ visible: false, price: null, payment: null });
    router.back();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      </SafeAreaView>
    );
  }

  if (!mission) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="alert-circle" size={40} color={colors.textMuted} />
          <Text style={styles.missingTxt}>Mission introuvable</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backTxt}>Retour</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const pickup = pickLatLng(mission, 'pickup');
  const dropoff = pickLatLng(mission, 'dropoff');
  const markers = [] as any[];
  if (pickup) markers.push({ ...pickup, color: colors.primary, label: 'A' });
  if (dropoff) markers.push({ ...dropoff, color: colors.danger, label: 'B' });
  const centerLat = pickup?.lat ?? dropoff?.lat;
  const centerLng = pickup?.lng ?? dropoff?.lng;

  const price = pickPrice(mission);
  const passenger =
    mission.passenger_name ||
    mission.customer_name ||
    mission.client_name ||
    mission.passenger?.name ||
    mission.booking?.passenger_name;
  const phone =
    mission.passenger_phone ||
    mission.customer_phone ||
    mission.client_phone ||
    mission.passenger?.phone ||
    mission.booking?.passenger_phone;

  const cta = NEXT[mission.status];
  const blocked = !onShift;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Mission</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 200, gap: spacing.md, paddingHorizontal: spacing.md }}>
        <View style={styles.mapBox}>
          <MapView lat={centerLat} lng={centerLng} extraMarkers={markers} style={StyleSheet.absoluteFill} />
        </View>

        <View style={styles.card}>
          <View style={styles.priceRow}>
            <Text style={styles.priceLbl}>MONTANT COURSE</Text>
            <Text style={styles.priceVal}>
              {price != null ? `${Number(price).toFixed(2)} €` : '—'}
            </Text>
          </View>
          <View style={styles.divider} />

          <View style={styles.route}>
            <View style={styles.routeLine}>
              <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
              <View style={styles.routeVert} />
              <View style={[styles.routeDot, { backgroundColor: colors.danger }]} />
            </View>
            <View style={{ flex: 1, gap: spacing.md }}>
              <View>
                <Text style={styles.routeLabel}>DÉPART</Text>
                <Text style={styles.addr}>{pickAddr(mission, 'pickup')}</Text>
              </View>
              <View>
                <Text style={styles.routeLabel}>ARRIVÉE</Text>
                <Text style={styles.addr}>{pickAddr(mission, 'dropoff')}</Text>
              </View>
            </View>
          </View>
        </View>

        {(passenger || phone) ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Passager</Text>
            {passenger ? <Text style={styles.paxName}>{passenger}</Text> : null}
            {phone ? (
              <TouchableOpacity
                style={styles.callBtn}
                onPress={() => Linking.openURL(`tel:${phone}`)}
                testID="call-btn"
              >
                <Ionicons name="call" size={16} color={colors.bg} />
                <Text style={styles.callTxt}>APPELER {phone}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <TouchableOpacity style={styles.navBtn} onPress={openNav} testID="nav-btn">
          <Ionicons name="navigate" size={18} color={colors.text} />
          <Text style={styles.navTxt}>OUVRIR LA NAVIGATION</Text>
        </TouchableOpacity>
      </ScrollView>

      {blocked && cta ? (
        <View style={styles.footer}>
          <View style={styles.lockBanner} testID="off-shift-mission-banner">
            <Ionicons name="lock-closed" size={18} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.lockTitle}>Hors service</Text>
              <Text style={styles.lockSub}>
                Veuillez passer en service depuis l’onglet Carte pour continuer la course.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.lockBtn}
              onPress={() => router.push('/(tabs)')}
              testID="off-shift-mission-cta"
            >
              <Text style={styles.lockBtnText}>EN SERVICE</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : cta ? (
        <View style={styles.footer}>
          <SlideButton
            label={cta.label}
            onConfirm={advance}
            testID={`slide-${mission.status}`}
          />
        </View>
      ) : (
        <View style={styles.footer}>
          <View style={styles.doneBanner}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.doneTxt}>Mission terminée</Text>
          </View>
        </View>
      )}

      {/* End-of-ride completion modal */}
      <Modal
        visible={completion.visible}
        animationType="fade"
        transparent
        onRequestClose={closeCompletion}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="completion-modal">
            <View style={[styles.modalIconWrap, { backgroundColor: colors.success + '22' }]}>
              <Ionicons name="checkmark-circle" size={42} color={colors.success} />
            </View>
            <Text style={styles.modalTitle}>Course terminée</Text>
            <Text style={styles.modalSub}>Bravo ! Voici le récapitulatif :</Text>

            <View style={styles.amountBox}>
              <Text style={styles.amountLbl}>MONTANT DE LA COURSE</Text>
              <Text style={styles.amountVal}>
                {completion.price != null ? `${completion.price.toFixed(2)} €` : '—'}
              </Text>
            </View>

            {completion.payment ? (
              <View
                style={[
                  styles.paymentBox,
                  completion.payment.isOnline ? styles.paymentBoxOnline : styles.paymentBoxCash,
                ]}
                testID="payment-info-box"
              >
                <View style={styles.paymentHeader}>
                  <Ionicons
                    name={completion.payment.isOnline ? 'card' : 'cash'}
                    size={22}
                    color={completion.payment.isOnline ? colors.primary : colors.warning}
                  />
                  <Text style={[styles.paymentLbl, { color: completion.payment.isOnline ? colors.primary : colors.warning }]}>
                    {completion.payment.label}
                  </Text>
                </View>
                {completion.payment.isOnline ? (
                  <View style={styles.paymentInstr}>
                    <Ionicons name="information-circle" size={16} color={colors.primary} />
                    <Text style={styles.paymentInstrText}>
                      <Text style={{ fontWeight: '900' }}>N’encaissez pas le client.</Text>{'\n'}
                      Le paiement a été effectué en ligne.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.paymentInstr}>
                    <Ionicons name="alert-circle" size={16} color={colors.warning} />
                    <Text style={styles.paymentInstrText}>
                      <Text style={{ fontWeight: '900' }}>Encaissez le client à bord.</Text>{'\n'}
                      Le paiement doit être effectué directement auprès de vous.
                    </Text>
                  </View>
                )}
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.modalPrimaryBtn}
              onPress={closeCompletion}
              testID="completion-ok-btn"
            >
              <Ionicons name="checkmark" size={18} color={colors.bg} />
              <Text style={styles.modalPrimaryText}>J’AI COMPRIS</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  missingTxt: { color: colors.text, fontWeight: '700' },
  backBtn: { marginTop: 8, paddingHorizontal: 24, height: 44, backgroundColor: colors.primary, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  backTxt: { color: colors.bg, fontWeight: '800' },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  topTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 16, fontWeight: '800' },
  mapBox: { height: 220, borderRadius: radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  card: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.xl, padding: spacing.md, gap: spacing.md,
  },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priceLbl: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  priceVal: { color: colors.primary, fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  divider: { height: 1, backgroundColor: colors.border },
  route: { flexDirection: 'row', gap: 12 },
  routeLine: { alignItems: 'center', paddingTop: 6, paddingBottom: 6, width: 14 },
  routeDot: { width: 12, height: 12, borderRadius: 6 },
  routeVert: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  routeLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  addr: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 2 },
  sectionTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  paxName: { color: colors.text, fontSize: 18, fontWeight: '800' },
  callBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, height: 48, borderRadius: radius.full,
  },
  callTxt: { color: colors.bg, fontWeight: '900', letterSpacing: 0.5 },
  navBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    height: 52, borderRadius: radius.full,
  },
  navTxt: { color: colors.text, fontWeight: '800', letterSpacing: 1.2 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: spacing.md, paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    backgroundColor: colors.bg, borderTopColor: colors.border, borderTopWidth: 1,
  },
  doneBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.success + '1A', borderColor: colors.success, borderWidth: 1,
    height: 60, borderRadius: radius.full,
  },
  doneTxt: { color: colors.success, fontWeight: '900', letterSpacing: 1 },
  lockBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.warning + '15', borderColor: colors.warning, borderWidth: 1,
    borderRadius: radius.lg, padding: 12,
  },
  lockTitle: { color: colors.warning, fontWeight: '900', fontSize: 13 },
  lockSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  lockBtn: {
    backgroundColor: colors.warning, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.full,
  },
  lockBtnText: { color: '#000', fontWeight: '900', fontSize: 11, letterSpacing: 0.8 },
  // Completion modal
  modalBackdrop: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#000000CC', padding: spacing.lg,
  },
  modalCard: {
    width: '100%', maxWidth: 420, backgroundColor: colors.surface,
    borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md, alignItems: 'center',
    borderColor: colors.border, borderWidth: 1,
  },
  modalIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  modalSub: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  amountBox: {
    alignSelf: 'stretch', backgroundColor: colors.bg, borderRadius: radius.lg,
    paddingVertical: 16, paddingHorizontal: 14, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  amountLbl: { color: colors.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  amountVal: { color: colors.primary, fontSize: 36, fontWeight: '900', letterSpacing: -1, marginTop: 4 },
  paymentBox: {
    alignSelf: 'stretch', borderRadius: radius.lg, padding: 14, gap: 10, borderWidth: 1,
  },
  paymentBoxOnline: { backgroundColor: colors.primary + '15', borderColor: colors.primary },
  paymentBoxCash: { backgroundColor: colors.warning + '15', borderColor: colors.warning },
  paymentHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  paymentLbl: { fontSize: 12, fontWeight: '900', letterSpacing: 1.3 },
  paymentInstr: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  paymentInstrText: { color: colors.text, fontSize: 13, lineHeight: 18, flex: 1 },
  modalPrimaryBtn: {
    alignSelf: 'stretch', height: 56, borderRadius: radius.full, backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 0 },
  },
  modalPrimaryText: { color: colors.bg, fontWeight: '900', fontSize: 14, letterSpacing: 1 },
});
