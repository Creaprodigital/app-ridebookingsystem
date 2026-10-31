import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Modal, PanResponder, Platform, Pressable, StyleSheet, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { Text } from '../ui/Text';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Svg, { Circle } from 'react-native-svg';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useRides } from '../ridesContext';
import { colors, radius, spacing } from '../theme';
import { fmtPrice } from '../rideFormat';
import { haptic } from '../feedback';
import { getLastCoords } from '../locationStore';
import { pickPickupCoords, haversineKm, estimateEtaMin } from '../rideTypes';
import { getMarketplaceConfig } from '../api';
import SlideButton from './SlideButton';

const TIMER_SECONDS = 30;
const RING_SIZE = 80;
const RING_STROKE = 8;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ── Field pickers ──────────────────────────────────────────────────────────
function pickName(item: any) {
  return (
    item?.passenger_name ||
    item?.customer_name ||
    item?.client_name ||
    item?.passenger?.name ||
    item?.booking?.passenger_name ||
    item?.booking?.customer_name ||
    'Client'
  );
}
function pickWhen(item: any) {
  return (
    item?.booking?.pickup_at ||
    item?.pickup_at ||
    item?.scheduled_at ||
    item?.pickup_time
  );
}
function pickPickup(item: any) {
  return (
    item?.booking?.pickup_address ||
    item?.pickup_address ||
    item?.pickup?.address ||
    'Adresse non communiquée'
  );
}
function pickDropoff(item: any) {
  return (
    item?.booking?.dropoff_address ||
    item?.dropoff_address ||
    item?.dropoff?.address ||
    'Destination non communiquée'
  );
}
function pickDistance(item: any) {
  const v =
    item?.booking?.distance_km ??
    item?.distance_km ??
    item?.estimated_distance_km;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Number of passengers on this booking. Defaults to 1 if absent.
 */
function pickPaxCount(item: any): number {
  const v =
    item?.passengers ??
    item?.pax ??
    item?.nb_passengers ??
    item?.passenger_count ??
    item?.booking?.passengers ??
    item?.booking?.pax;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Whether the client requested luggage. Returns true if any of the common
 * boolean / numeric flags is truthy.
 */
function pickHasLuggage(item: any): boolean {
  const v =
    item?.has_luggage ??
    item?.luggage ??
    item?.booking?.has_luggage ??
    item?.booking?.luggage ??
    item?.bags ??
    item?.booking?.bags;
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 0;
  return !!v;
}
function pickAmount(item: any) {
  const v =
    item?.amount ??
    item?.pricing?.final ??
    item?.price ??
    item?.fare ??
    item?.total;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function pickCommission(item: any, configPct?: number): number | null {
  const direct =
    item?.commission_eur ??
    item?.commission_amount ??
    item?.commission ??
    item?.platform_commission ??
    item?.platform_fee ??
    item?.fleet_commission ??
    item?.tenant_commission ??
    item?.pricing?.commission ??
    item?.pricing?.commission_eur ??
    item?.pricing?.fee;
  if (direct != null) {
    const n = Number(direct);
    if (Number.isFinite(n)) return n;
  }
  const pct =
    item?.commission_pct ??
    item?.commission_percent ??
    item?.commission_percentage ??
    item?.pricing?.commission_pct ??
    configPct;
  const total = pickAmount(item);
  if (total != null && pct != null) {
    const p = Number(pct);
    if (Number.isFinite(p)) {
      const ratio = p > 1 ? p / 100 : p;
      return Number((total * ratio).toFixed(2));
    }
  }
  return null;
}
function pickDriverNet(item: any, configPct?: number): number | null {
  // Strict rule (per business): Net chauffeur = Prix de la course − Commission.
  // We do not use any backend direct field — always recompute from the
  // displayed total and commission so the math is consistent across screens.
  // If commission is unknown we treat it as 0 so the driver always sees a
  // meaningful net amount (= the full price).
  const total = pickAmount(item);
  if (total == null) return null;
  const com = pickCommission(item, configPct) ?? 0;
  return Number((total - com).toFixed(2));
}
function pickPaymentLabel(item: any) {
  const raw = String(
    item?.payment_method ||
      item?.booking?.payment_method ||
      item?.payment?.method ||
      ''
  ).toLowerCase();
  if (!raw) return 'Paiement à bord';
  if (/cash|onboard|bord|esp/.test(raw)) return 'Espèces · à bord';
  if (/card|stripe|online|app|prepaid|wallet/.test(raw)) return 'En ligne · prépayé';
  return raw.replace(/_/g, ' ');
}
function fmtDt(s?: string) {
  if (!s) return 'Maintenant';
  try { return new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return s; }
}

export default function RideRequestModal() {
  const { currentRequest, pendingCount, acceptCurrent, dismissCurrent } = useRides();
  const router = useRouter();

  const [visible, setVisible] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(TIMER_SECONDS);
  const [error, setError] = useState<string | null>(null);
  // Marketplace commission percentage — used as fallback when the listing
  // doesn't carry a direct commission_eur field (which is the typical case
  // for immediate ride requests). Without this, the Net chauffeur would
  // wrongly equal the full client price.
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

  const enter = useRef(new Animated.Value(0)).current;
  const swipeY = useRef(new Animated.Value(0)).current;
  const ringProgress = useRef(new Animated.Value(0)).current; // 0..1
  const timerInterval = useRef<any>(null);
  const lastIdRef = useRef<string | null>(null);

  // Open / close based on currentRequest
  useEffect(() => {
    if (currentRequest) {
      const id = String(currentRequest.id ?? currentRequest._id);
      if (lastIdRef.current !== id) {
        lastIdRef.current = id;
        openSequence();
      }
    } else if (visible) {
      closeSequence();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRequest]);

  const openSequence = () => {
    setVisible(true);
    setError(null);
    setAccepting(false);
    setSecondsLeft(TIMER_SECONDS);
    swipeY.setValue(0);
    enter.setValue(0);
    ringProgress.setValue(0);

    Animated.parallel([
      Animated.timing(enter, {
        toValue: 1,
        duration: 380,
        easing: Easing.out(Easing.back(1.4)),
        useNativeDriver: true,
      }),
      Animated.timing(ringProgress, {
        toValue: 1,
        duration: TIMER_SECONDS * 1000,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    ]).start();

    // Strong haptic burst (Uber-style)
    haptic('heavy');
    setTimeout(() => haptic('medium'), 220);
    setTimeout(() => haptic('success'), 440);

    // Countdown
    if (timerInterval.current) clearInterval(timerInterval.current);
    timerInterval.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          // auto-refuse
          if (timerInterval.current) clearInterval(timerInterval.current);
          handleRefuse();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const closeSequence = () => {
    if (timerInterval.current) clearInterval(timerInterval.current);
    Animated.timing(enter, {
      toValue: 0,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setVisible(false);
    });
  };

  // ── Actions ────────────────────────────────────────────────────────────
  const handleAccept = async () => {
    if (accepting) return;
    haptic('success');
    setAccepting(true);
    if (timerInterval.current) clearInterval(timerInterval.current);
    const r = await acceptCurrent();
    if (r.ok) {
      closeSequence();
      // Navigate directly to the mission detail screen so the driver can
      // start the ride immediately. The mission detail screen will lock
      // navigation until the mission is completed.
      const targetId = r.missionId;
      setTimeout(() => {
        if (targetId) {
          try { router.replace(`/mission/${targetId}` as any); }
          catch { router.replace('/(tabs)/missions' as any); }
        } else {
          router.replace('/(tabs)/missions' as any);
        }
      }, 220);
    } else {
      setError(r.error || 'Échec de l’acceptation');
      setAccepting(false);
      // Restart timer for retry, give 8 more seconds
      setSecondsLeft(8);
      ringProgress.setValue(0);
      Animated.timing(ringProgress, {
        toValue: 1,
        duration: 8000,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
      if (timerInterval.current) clearInterval(timerInterval.current);
      timerInterval.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            if (timerInterval.current) clearInterval(timerInterval.current);
            handleRefuse();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    }
  };

  const handleRefuse = () => {
    haptic('warning');
    if (timerInterval.current) clearInterval(timerInterval.current);
    dismissCurrent();
    closeSequence();
  };

  const handleDetails = () => {
    haptic('light');
    if (timerInterval.current) clearInterval(timerInterval.current);
    // Keep request on top of queue, close modal, route to missions
    closeSequence();
    setTimeout(() => router.push('/(tabs)/missions'), 220);
  };

  // Swipe gestures: swipe up to accept, down to refuse
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8,
      onPanResponderMove: (_, g) => {
        swipeY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy < -120) {
          // swipe up = accept
          Animated.timing(swipeY, {
            toValue: -Dimensions.get('window').height,
            duration: 220,
            useNativeDriver: true,
          }).start(handleAccept);
        } else if (g.dy > 120) {
          // swipe down = refuse
          Animated.timing(swipeY, {
            toValue: Dimensions.get('window').height,
            duration: 220,
            useNativeDriver: true,
          }).start(handleRefuse);
        } else {
          Animated.spring(swipeY, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        }
      },
    })
  ).current;

  if (!visible || !currentRequest) return null;

  // Animations
  const translateY = Animated.add(
    enter.interpolate({ inputRange: [0, 1], outputRange: [-80, 0] }),
    swipeY
  );
  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  const opacity = enter;

  // Ring stroke offset
  const strokeDashoffset = ringProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, RING_CIRC],
  });

  const item = currentRequest;
  const tripDistanceKm = pickDistance(item);
  const amount = pickAmount(item);
  const commissionEur = pickCommission(item, configPct);
  const driverNet = pickDriverNet(item, configPct);
  const paxCount = pickPaxCount(item);
  const hasLuggage = pickHasLuggage(item);

  // ── Distance & ETA from driver to pickup point (live GPS based) ──────
  const me = getLastCoords();
  const pickupCoords = pickPickupCoords(item);
  let pickupKm: number | null = null;
  let pickupEta: number | null = null;
  if (me && pickupCoords) {
    const km = haversineKm(me, pickupCoords);
    if (Number.isFinite(km)) {
      pickupKm = km;
      pickupEta = estimateEtaMin(km);
    }
  }
  // Leg 2 — client trip distance + ETA. Distance comes from booking, ETA
  // is estimated at the same 30 km/h urban average used elsewhere.
  const tripEta = tripDistanceKm != null ? estimateEtaMin(tripDistanceKm) : null;
  // Totals shown in the stats row.
  const totalDistanceKm =
    pickupKm != null || tripDistanceKm != null
      ? Number(((pickupKm ?? 0) + (tripDistanceKm ?? 0)).toFixed(1))
      : null;
  const totalEtaMin =
    pickupEta != null || tripEta != null
      ? (pickupEta ?? 0) + (tripEta ?? 0)
      : null;

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      {/* GestureHandlerRootView is REQUIRED inside the Modal otherwise the
       *  SlideButton's pan gesture is swallowed by RN's Modal and the driver
       *  cannot drag the knob. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={() => {}} testID="ride-request-backdrop">
        <Animated.View
          style={[styles.cardWrap, { transform: [{ translateY }, { scale }], opacity }]}
          testID="ride-request-modal"
        >
          {/* Pending count badge */}
          {pendingCount > 1 ? (
            <View style={styles.queueBadge} testID="queue-badge">
              <View style={styles.queueDot} />
              <Text style={styles.queueText}>+{pendingCount - 1} en attente</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            {/* URGENT ribbon — makes it crystal-clear this is an immediate ride */}
            <View style={styles.urgentRibbon} testID="urgent-ribbon">
              <View style={styles.urgentDot} />
              <Ionicons name="flash" size={13} color={colors.danger} />
              <Text style={styles.urgentTxt}>Course immédiate · départ maintenant</Text>
            </View>
            {/* Header: timer ring (green) · GAIN NET · PRIX CLIENT */}
            <View style={styles.header}>
              {/* Timer (green) */}
              <View style={styles.timerWrap}>
                <Svg width={RING_SIZE} height={RING_SIZE}>
                  <Circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    stroke={colors.border}
                    strokeWidth={RING_STROKE}
                    fill="none"
                  />
                  <AnimatedCircle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    stroke={secondsLeft <= 5 ? colors.danger : colors.success}
                    strokeWidth={RING_STROKE}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={`${RING_CIRC},${RING_CIRC}`}
                    strokeDashoffset={strokeDashoffset as any}
                    transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
                  />
                </Svg>
                <View style={styles.timerCenter}>
                  <Text
                    style={[
                      styles.timerText,
                      { color: secondsLeft <= 5 ? colors.danger : colors.success },
                    ]}
                  >
                    {secondsLeft}
                  </Text>
                  <Text style={styles.timerSub}>sec</Text>
                </View>
              </View>

              {/* Gain net (green) */}
              <View style={styles.headerCol}>
                <Text style={styles.gainLabel} numberOfLines={1}>Votre gain net</Text>
                <Text
                  style={styles.gainAmount}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  testID="modal-driver-net"
                >
                  {driverNet != null ? fmtPrice(driverNet) : '—'}
                </Text>
              </View>

              {/* Vertical separator */}
              <View style={styles.headerSep} />

              {/* Prix client (yellow) */}
              <View style={styles.headerCol}>
                <Text style={styles.priceClientLabel} numberOfLines={1}>Prix client</Text>
                <Text
                  style={styles.priceClientAmount}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  testID="modal-price"
                >
                  {amount != null ? fmtPrice(amount) : '—'}
                </Text>
                <View style={styles.payPill}>
                  <Ionicons
                    name={pickPaymentLabel(item).toLowerCase().includes('ligne') ? 'card-outline' : 'cash-outline'}
                    size={11}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.payText} numberOfLines={1}>
                    {pickPaymentLabel(item)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Route */}
            <View style={styles.route}>
              <View style={styles.routeColumn}>
                <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
                <View style={styles.routeLine} />
                <View style={[styles.routeDot, { backgroundColor: colors.text, borderRadius: 3 }]} />
              </View>
              <View style={{ flex: 1, gap: 14 }}>
                {/* DÉPART */}
                <View style={styles.routeRow}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.routeLabel}>Prise en charge</Text>
                    <Text style={styles.routeAddr} numberOfLines={2}>{pickPickup(item)}</Text>
                  </View>
                  {pickupKm != null && pickupEta != null ? (
                    <View style={{ alignItems: 'flex-end' }}>
                      <View style={[styles.legPill, styles.legPillGreen]} testID="pickup-eta">
                        <Ionicons name="navigate" size={11} color={colors.primary} />
                        <Text style={[styles.legPillTxt, { color: colors.primary }]}>
                          {pickupKm < 10 ? pickupKm.toFixed(1).replace('.', ',') : Math.round(pickupKm)} km · {pickupEta} min
                        </Text>
                      </View>
                      <Text style={styles.legSubLabel}>Approche</Text>
                    </View>
                  ) : null}
                </View>

                {/* DESTINATION */}
                <View style={styles.routeRow}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.routeLabel}>Destination</Text>
                    <Text style={styles.routeAddr} numberOfLines={2}>{pickDropoff(item)}</Text>
                  </View>
                  {tripDistanceKm != null && tripEta != null ? (
                    <View style={{ alignItems: 'flex-end' }}>
                      <View style={[styles.legPill, styles.legPillNeutral]} testID="trip-eta">
                        <Ionicons name="car" size={11} color={colors.textSecondary} />
                        <Text style={[styles.legPillTxt, { color: colors.textSecondary }]}>
                          {tripDistanceKm < 10 ? tripDistanceKm.toFixed(1).replace('.', ',') : Math.round(tripDistanceKm)} km · {tripEta} min
                        </Text>
                      </View>
                      <Text style={styles.legSubLabel}>Trajet client</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>

            {/* Stats row: Temps total · Distance totale · Passagers */}
            <View style={styles.statsRow} testID="ride-stats-row">
              <View style={styles.statCol}>
                <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.statLabel}>Durée totale</Text>
                <Text style={styles.statValue}>
                  {totalEtaMin != null ? `${totalEtaMin} min` : '—'}
                </Text>
                <Text style={styles.statHint}>Estimation</Text>
              </View>
              <View style={styles.statSep} />
              <View style={styles.statCol}>
                <Ionicons name="map-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.statLabel}>Distance totale</Text>
                <Text style={styles.statValue}>
                  {totalDistanceKm != null ? `${String(totalDistanceKm).replace('.', ',')} km` : '—'}
                </Text>
                <Text style={styles.statHint}>Estimation</Text>
              </View>
              <View style={styles.statSep} />
              <View style={styles.statCol}>
                <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.statLabel}>Passagers</Text>
                <Text style={styles.statValue}>
                  {paxCount} passager{paxCount > 1 ? 's' : ''}
                </Text>
                <Text style={styles.statHint}>{hasLuggage ? '+ Bagages' : 'Sans bagages'}</Text>
              </View>
            </View>

            {/* Engagement warning */}
            <View style={styles.warnCard} testID="ride-engagement-warning">
              <Ionicons name="information-circle-outline" size={17} color={colors.textSecondary} />
              <Text style={styles.warnTxt}>
                En acceptant cette course, vous vous engagez à vous y rendre.
                Les annulations répétées peuvent limiter l’accès aux courses.
              </Text>
            </View>

            {/* Error */}
            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={14} color={colors.danger} />
                <Text style={styles.errorText} numberOfLines={2}>{error}</Text>
              </View>
            ) : null}

            {/* Actions: tap-refuse + swipe-to-accept */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.refuseBtn}
                onPress={handleRefuse}
                testID="ride-refuse"
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={20} color={colors.danger} />
                <Text style={styles.refuseTxt}>Refuser</Text>
              </TouchableOpacity>

              <View style={{ flex: 2 }}>
                <SlideButton
                  label="Accepter"
                  color={colors.success}
                  onConfirm={handleAccept}
                  disabled={accepting}
                  testID="ride-accept-slide"
                />
              </View>
            </View>
          </View>
        </Animated.View>
      </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-start',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 12,
  },
  cardWrap: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  queueBadge: {
    alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    marginBottom: 8,
  },
  queueDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  queueText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 28,
    padding: spacing.lg - 4,
    gap: 14,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
    elevation: 30,
  },
  urgentRibbon: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.dangerSoft, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 6,
    alignSelf: 'center',
  },
  urgentDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger },
  urgentTxt: { color: colors.danger, fontWeight: '700', fontSize: 12.5 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  timerWrap: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  timerCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  timerText: { color: colors.success, fontSize: 26, fontWeight: '800' },
  timerSub: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  headerCol: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  headerSep: { width: 1, height: 56, backgroundColor: colors.border, marginHorizontal: 2 },

  gainLabel: { color: colors.textSecondary, fontSize: 12.5, fontWeight: '600', textAlign: 'center' },
  gainAmount: { color: colors.success, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  priceClientLabel: { color: colors.textSecondary, fontSize: 12.5, fontWeight: '600', textAlign: 'center' },
  priceClientAmount: { color: colors.text, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  payPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surface2,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, marginTop: 4,
    maxWidth: 140,
  },
  payText: { color: colors.textSecondary, fontSize: 11.5, fontWeight: '600' },

  route: {
    flexDirection: 'row', gap: 12, padding: 14,
    backgroundColor: colors.surface2, borderRadius: radius.lg,
  },
  routeColumn: { alignItems: 'center', paddingTop: 22, paddingBottom: 22, width: 12 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  routeLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 4 },
  routeLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  routeAddr: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 2, lineHeight: 20 },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  legPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999,
  },
  legPillGreen: { backgroundColor: colors.primarySoft },
  legPillNeutral: { backgroundColor: colors.surface },
  legPillTxt: { fontSize: 12, fontWeight: '700' },
  legSubLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600', marginTop: 3 },

  statsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg,
    paddingVertical: 12, paddingHorizontal: 6,
  },
  statCol: { flex: 1, alignItems: 'center', gap: 2 },
  statLabel: { color: colors.textMuted, fontSize: 11.5, fontWeight: '600', marginTop: 2 },
  statValue: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 1 },
  statHint: { color: colors.textMuted, fontSize: 11, fontWeight: '500' },
  statSep: { width: 1, height: 36, backgroundColor: colors.border, marginHorizontal: 2 },

  warnCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 2 },
  warnTxt: { color: colors.textSecondary, fontSize: 12, fontWeight: '500', flex: 1, lineHeight: 17 },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: 10,
  },
  errorText: { color: colors.danger, fontSize: 13, fontWeight: '600', flex: 1 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 2, alignItems: 'center' },
  refuseBtn: {
    width: 104, height: 64, borderRadius: radius.lg + 4,
    backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  refuseTxt: { color: colors.danger, fontWeight: '700', fontSize: 15 },
});
