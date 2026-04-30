import React, { useCallback, useEffect, useState } from 'react';
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
  BackHandler,
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
import { isImmediateRide } from '../../src/rideTypes';
import { haptic } from '../../src/feedback';
import {
  fetchRoute,
  fmtDistanceKm,
  fmtDurationMin,
  type DirectionsResult,
  type LatLng,
} from '../../src/directions';
import { getLastCoords, subscribeCoords } from '../../src/locationStore';

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
  const { onShift, clearActiveMission } = useRides();
  const [mission, setMission] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [completion, setCompletion] = useState<{
    visible: boolean;
    price: number | null;
    payment: PaymentInfo | null;
  }>({ visible: false, price: null, payment: null });

  // Live driver position (from background+foreground location store) so the
  // leg-1 polyline (driver→pickup) refreshes naturally.
  const [driverPos, setDriverPos] = useState<LatLng | null>(() => {
    const c = getLastCoords();
    return c ? { lat: c.lat, lng: c.lng } : null;
  });
  useEffect(() => {
    const unsub = subscribeCoords((c) => {
      if (c) setDriverPos({ lat: c.lat, lng: c.lng });
      else setDriverPos(null);
    });
    return () => unsub();
  }, []);

  // Directions for the two legs
  const [pickupRoute, setPickupRoute] = useState<DirectionsResult | null>(null);
  const [tripRoute, setTripRoute] = useState<DirectionsResult | null>(null);
  // Throttle leg-1 re-fetches: only re-query Directions when the driver has
  // moved significantly (>= 300 m) so we don't burn API quota.
  const lastDriverFetchRef = React.useRef<LatLng | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Robust lookup: the mission may take a few seconds to appear in
    // `/api/driver/missions` right after a marketplace claim, and the ID
    // returned by the claim endpoint doesn't always match the mission ID
    // the missions endpoint exposes. We retry up to 6 times (~10 s total)
    // and also match on several alternative identifiers.
    const strId = String(id ?? '');
    const idMatches = (x: any) => {
      if (!x) return false;
      const candidates = [
        x.id, x._id,
        x.mission_id,
        x.booking?.id, x.booking?._id,
        x.marketplace_listing_id,
        x.marketplace?.id, x.marketplace?._id,
      ]
        .filter((v) => v != null)
        .map((v) => String(v));
      return candidates.includes(strId);
    };

    const fetchOnce = async (): Promise<any | null> => {
      try {
        const list: any = await getDriverMissions();
        const arr = Array.isArray(list) ? list : (list?.current ?? list?.items ?? []);
        const all = [...arr, ...(list?.history ?? [])];
        const exact = all.find(idMatches);
        if (exact) return exact;
        // Fallback: if no exact match and there's a single active mission in
        // the current list, assume it's ours (most common case right after a
        // fresh claim — only one assigned mission at a time).
        const ACTIVE = new Set(['assigned', 'en_route', 'arrived', 'in_progress']);
        const actives = arr.filter((m: any) => ACTIVE.has(String(m?.status || '').toLowerCase()));
        if (actives.length === 1) return actives[0];
        return null;
      } catch {
        return null;
      }
    };

    let found: any = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
      found = await fetchOnce();
      if (found) break;
    }
    setMission(found || null);
    setLoading(false);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Resolve trip endpoints once we have a mission ────────────────────
  const pickupLatLng = mission ? pickLatLng(mission, 'pickup') : null;
  const dropoffLatLng = mission ? pickLatLng(mission, 'dropoff') : null;

  // Status-driven flags: which leg should be highlighted on the map.
  const status = String(mission?.status || '').toLowerCase();
  // While the driver is on the way to pickup OR has just been assigned, the
  // important leg is driver→pickup. After "arrived" / "in_progress", we only
  // care about pickup→dropoff (the client is in the car).
  const showLegToPickup = ['assigned', 'en_route'].includes(status);
  const showLegOfTrip = true; // always useful to show the full trip

  // ── Fetch the two route polylines ─────────────────────────────────────
  // Leg 1: Driver → pickup (only when showLegToPickup AND we have a fix).
  useEffect(() => {
    if (!showLegToPickup || !driverPos || !pickupLatLng) {
      setPickupRoute(null);
      lastDriverFetchRef.current = null;
      return;
    }
    // Throttle by movement distance (≥ 300 m delta to refetch).
    const last = lastDriverFetchRef.current;
    if (last) {
      const km = (() => {
        const R = 6371;
        const toRad = (x: number) => (x * Math.PI) / 180;
        const dLat = toRad(driverPos.lat - last.lat);
        const dLng = toRad(driverPos.lng - last.lng);
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(last.lat)) * Math.cos(toRad(driverPos.lat)) *
          Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      })();
      if (km < 0.3 && pickupRoute) return; // < 300 m, skip
    }
    let cancelled = false;
    (async () => {
      const r = await fetchRoute(driverPos, pickupLatLng);
      if (cancelled) return;
      setPickupRoute(r);
      lastDriverFetchRef.current = driverPos;
    })();
    return () => { cancelled = true; };
  }, [showLegToPickup, driverPos, pickupLatLng, pickupRoute]);

  // Leg 2: Pickup → Dropoff (cached, fetched once per mission).
  useEffect(() => {
    if (!showLegOfTrip || !pickupLatLng || !dropoffLatLng) {
      setTripRoute(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const r = await fetchRoute(pickupLatLng, dropoffLatLng);
      if (cancelled) return;
      setTripRoute(r);
    })();
    return () => { cancelled = true; };
  }, [
    showLegOfTrip,
    pickupLatLng?.lat, pickupLatLng?.lng,
    dropoffLatLng?.lat, dropoffLatLng?.lng,
  ]);

  // Lock the screen while the mission is in progress: the driver cannot
  // navigate back until they reach the "completed" step.
  // Locking rules (aligned with ridesContext):
  //   • EXECUTING (en_route, arrived, in_progress) → ALWAYS locked
  //   • assigned + immediate ride → locked (driver just accepted, must start)
  //   • assigned + scheduled ride (planifiée) → NOT locked, driver can browse
  //     other screens while waiting for the pickup time
  const isExecuting = ['en_route', 'arrived', 'in_progress'].includes(status);
  const isAssignedImmediate = status === 'assigned' && !!mission && isImmediateRide(mission);
  const isLocked = !!mission && (isExecuting || isAssignedImmediate);

  // Block hardware back button on Android while locked
  useEffect(() => {
    if (!isLocked) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // Show a friendly explanation rather than allowing back
      Alert.alert(
        'Course en cours',
        'Vous devez terminer la course avant de quitter cet écran.',
        [{ text: 'OK' }]
      );
      return true; // consume the event
    });
    return () => sub.remove();
  }, [isLocked]);

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
      const msg = 'Vous êtes hors ligne. Veuillez passer en ligne depuis l’onglet Carte pour démarrer ou poursuivre la course.';
      if (Platform.OS !== 'web') Alert.alert('Hors ligne', msg);
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
        // Immediately mark the mission as completed locally so the screen
        // unlocks and the global active-mission flag clears (prevents the
        // _layout auto-redirect from sending the driver back here).
        setMission((prev: any) => prev ? { ...prev, status: 'completed' } : prev);
        clearActiveMission();
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
    // Use replace to avoid coming back to the now-completed mission screen
    try { router.replace('/(tabs)/missions' as any); }
    catch { router.back(); }
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
          <Ionicons name="hourglass" size={40} color={colors.primary} />
          <Text style={styles.missingTxt}>Synchronisation en cours…</Text>
          <Text style={styles.missingSub}>
            Votre course vient d’être acceptée. Elle devrait apparaître d’ici quelques
            secondes dans l’onglet « Mes missions ».
          </Text>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.replace('/(tabs)/missions' as any)}
            testID="go-missions-btn"
          >
            <Text style={styles.backTxt}>OUVRIR MES MISSIONS</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: 8 }]}
            onPress={() => load()}
            testID="retry-load-btn"
          >
            <Text style={[styles.backTxt, { color: colors.text }]}>RÉESSAYER</Text>
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
  // Center the map on the driver if we know where they are; otherwise pick A.
  const centerLat = driverPos?.lat ?? pickup?.lat ?? dropoff?.lat;
  const centerLng = driverPos?.lng ?? pickup?.lng ?? dropoff?.lng;

  // Build the polyline list for MapView. Two legs are drawn with different
  // styles so the driver can immediately tell them apart:
  //   • Leg 1 (driver→pickup) — yellow + dashed (only while heading there)
  //   • Leg 2 (pickup→dropoff) — green + solid (always visible)
  const polylines: any[] = [];
  if (pickupRoute && showLegToPickup) {
    polylines.push({
      encoded: pickupRoute.encoded,
      color: colors.primary, // yellow
      dashed: true,
      weight: 5,
    });
  }
  if (tripRoute) {
    polylines.push({
      encoded: tripRoute.encoded,
      color: colors.success, // green
      dashed: false,
      weight: 6,
    });
  }

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
        {isLocked ? (
          <View style={[styles.iconBtn, styles.lockedIconBtn]} testID="back-btn-locked">
            <Ionicons name="lock-closed" size={18} color={colors.warning} />
          </View>
        ) : (
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
        )}
        <Text style={styles.topTitle}>{isLocked ? 'Course en cours' : 'Mission'}</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 200, gap: spacing.md, paddingHorizontal: spacing.md }}>
        <View style={styles.mapBox}>
          <MapView
            lat={centerLat}
            lng={centerLng}
            extraMarkers={markers}
            polylines={polylines}
            fitBounds
            style={StyleSheet.absoluteFill}
          />
          {/* Legend overlay */}
          {(pickupRoute || tripRoute) ? (
            <View style={styles.mapLegend} testID="map-legend">
              {pickupRoute && showLegToPickup ? (
                <View style={styles.legendRow}>
                  <View style={[styles.legendDash, { backgroundColor: colors.primary }]} />
                  <Text style={styles.legendTxt}>Vers prise en charge</Text>
                </View>
              ) : null}
              {tripRoute ? (
                <View style={styles.legendRow}>
                  <View style={[styles.legendSolid, { backgroundColor: colors.success }]} />
                  <Text style={styles.legendTxt}>Trajet client</Text>
                </View>
              ) : null}
            </View>
          ) : null}
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
                <View style={styles.routeHead}>
                  <Text style={styles.routeLabel}>DÉPART</Text>
                  {pickupRoute && showLegToPickup ? (
                    <View style={[styles.legBadge, { backgroundColor: colors.primary + '22', borderColor: colors.primary + '55' }]}>
                      <Ionicons name="navigate" size={10} color={colors.primary} />
                      <Text style={[styles.legBadgeTxt, { color: colors.primary }]}>
                        {fmtDistanceKm(pickupRoute.distanceMeters)} · {fmtDurationMin(pickupRoute.durationSec)}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.addr}>{pickAddr(mission, 'pickup')}</Text>
              </View>
              <View>
                <View style={styles.routeHead}>
                  <Text style={styles.routeLabel}>ARRIVÉE</Text>
                  {tripRoute ? (
                    <View style={[styles.legBadge, { backgroundColor: colors.success + '22', borderColor: colors.success + '55' }]}>
                      <Ionicons name="car" size={10} color={colors.success} />
                      <Text style={[styles.legBadgeTxt, { color: colors.success }]}>
                        {fmtDistanceKm(tripRoute.distanceMeters)} · {fmtDurationMin(tripRoute.durationSec)}
                      </Text>
                    </View>
                  ) : null}
                </View>
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
              <Text style={styles.lockTitle}>Hors ligne</Text>
              <Text style={styles.lockSub}>
                Veuillez passer en ligne depuis l’onglet Carte pour continuer la course.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.lockBtn}
              onPress={() => router.push('/(tabs)')}
              testID="off-shift-mission-cta"
            >
              <Text style={styles.lockBtnText}>EN LIGNE</Text>
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
  missingTxt: { color: colors.text, fontWeight: '700', fontSize: 16 },
  missingSub: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', paddingHorizontal: 40, marginTop: 4, marginBottom: 8 },
  backBtn: { marginTop: 8, paddingHorizontal: 24, height: 44, backgroundColor: colors.primary, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  backTxt: { color: colors.bg, fontWeight: '800' },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  lockedIconBtn: { backgroundColor: colors.warning + '22', borderWidth: 1, borderColor: colors.warning },
  topTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 16, fontWeight: '800' },
  mapBox: { height: 220, borderRadius: radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, position: 'relative' },
  mapLegend: {
    position: 'absolute', left: 8, bottom: 8,
    backgroundColor: colors.bg + 'E6',
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8,
    gap: 4,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDash: { width: 16, height: 2, borderRadius: 1, opacity: 0.85 },
  legendSolid: { width: 16, height: 3, borderRadius: 2 },
  legendTxt: { color: colors.text, fontSize: 10, fontWeight: '700' },
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
  routeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  legBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 999, borderWidth: 1,
  },
  legBadgeTxt: { fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },
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
