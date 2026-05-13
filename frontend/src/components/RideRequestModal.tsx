import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Svg, { Circle } from 'react-native-svg';
import { useRides } from '../ridesContext';
import { colors, radius, spacing } from '../theme';
import { haptic } from '../feedback';
import { getLastCoords } from '../locationStore';
import { pickPickupCoords, haversineKm, estimateEtaMin } from '../rideTypes';

const TIMER_SECONDS = 15;
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
function pickCommission(item: any): number | null {
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
    item?.pricing?.commission_pct;
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
function pickDriverNet(item: any): number | null {
  const direct =
    item?.driver_amount ??
    item?.driver_net ??
    item?.net_eur ??
    item?.payout ??
    item?.payout_eur ??
    item?.pricing?.driver_amount ??
    item?.pricing?.net;
  if (direct != null) {
    const n = Number(direct);
    if (Number.isFinite(n)) return n;
  }
  const total = pickAmount(item);
  const com = pickCommission(item);
  if (total != null && com != null) return Number((total - com).toFixed(2));
  return null;
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
  const distance = pickDistance(item);
  const amount = pickAmount(item);
  const commissionEur = pickCommission(item);
  const driverNet = pickDriverNet(item);

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

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={() => {}} testID="ride-request-backdrop">
        <Animated.View
          style={[styles.cardWrap, { transform: [{ translateY }, { scale }], opacity }]}
          {...panResponder.panHandlers}
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
              <Ionicons name="flash" size={12} color="#fff" />
              <Text style={styles.urgentTxt}>COURSE IMMÉDIATE · DÉPART MAINTENANT</Text>
            </View>
            {/* Header: timer ring + amount */}
            <View style={styles.header}>
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
                  <Text style={[styles.timerText, secondsLeft <= 5 && { color: colors.danger }]}>
                    {secondsLeft}
                  </Text>
                  <Text style={styles.timerSub}>sec</Text>
                </View>
              </View>

              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                {amount != null ? (
                  <>
                    <Text style={styles.amountLabel}>PRIX DE LA COURSE</Text>
                    <Text style={styles.amount}>{amount.toFixed(2)} €</Text>
                    {commissionEur != null && commissionEur > 0 ? (
                      <Text style={styles.amountCommission} testID="modal-commission">
                        Société : −{commissionEur.toFixed(2)} €
                      </Text>
                    ) : null}
                    {driverNet != null ? (
                      <Text style={styles.amountNet} testID="modal-driver-net">
                        Net : {driverNet.toFixed(2)} €
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.amount}>—</Text>
                )}
                <View style={styles.payPill}>
                  <Ionicons
                    name={pickPaymentLabel(item).includes('ligne') ? 'card' : 'cash'}
                    size={11}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.payText}>{pickPaymentLabel(item)}</Text>
                </View>
              </View>
            </View>

            {/* Client */}
            <View style={styles.client}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={20} color={colors.bg} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.clientName} numberOfLines={1}>{pickName(item)}</Text>
                <Text style={styles.clientMeta} numberOfLines={1}>
                  {fmtDt(pickWhen(item))}
                  {distance != null ? ` · ${distance.toFixed(1)} km` : ''}
                </Text>
              </View>
            </View>

            {/* Route */}
            <View style={styles.route}>
              <View style={styles.routeColumn}>
                <View style={[styles.routeDot, { backgroundColor: colors.success }]} />
                <View style={styles.routeLine} />
                <View style={[styles.routeDot, { backgroundColor: colors.danger }]} />
              </View>
              <View style={{ flex: 1, gap: 14 }}>
                <View>
                  <View style={styles.routeHead}>
                    <Text style={styles.routeLabel}>DÉPART</Text>
                    {pickupKm != null && pickupEta != null ? (
                      <View style={styles.etaBadge} testID="pickup-eta">
                        <Ionicons name="navigate" size={10} color={colors.success} />
                        <Text style={styles.etaText}>
                          À {pickupKm < 10 ? pickupKm.toFixed(1) : Math.round(pickupKm)} km · {pickupEta} min
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.routeAddr} numberOfLines={2}>{pickPickup(item)}</Text>
                </View>
                <View>
                  <Text style={styles.routeLabel}>DESTINATION</Text>
                  <Text style={styles.routeAddr} numberOfLines={2}>{pickDropoff(item)}</Text>
                </View>
              </View>
            </View>

            {/* Error */}
            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={14} color={colors.danger} />
                <Text style={styles.errorText} numberOfLines={2}>{error}</Text>
              </View>
            ) : null}

            {/* Actions */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.refuseBtn}
                onPress={handleRefuse}
                testID="ride-refuse"
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={20} color={colors.text} />
                <Text style={styles.refuseText}>REFUSER</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.acceptBtn}
                onPress={handleAccept}
                disabled={accepting}
                testID="ride-accept"
                activeOpacity={0.85}
              >
                {accepting ? (
                  <ActivityIndicator color={'#fff'} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={22} color={'#fff'} />
                    <Text style={styles.acceptText}>ACCEPTER</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={handleDetails} style={styles.detailsLink} testID="ride-details">
              <Text style={styles.detailsLinkText}>Voir les détails de la course</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.primary} />
            </TouchableOpacity>

            <Text style={styles.swipeHint}>↑ glissez pour accepter   ↓ glissez pour refuser</Text>
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000000DD',
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
    shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
  },
  queueDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#000' },
  queueText: { color: '#000', fontWeight: '900', fontSize: 11, letterSpacing: 0.6 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
    elevation: 30,
  },
  urgentRibbon: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.danger, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 6,
    alignSelf: 'flex-start',
    shadowColor: colors.danger, shadowOpacity: 0.55,
    shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  urgentDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff',
    opacity: 0.9,
  },
  urgentTxt: { color: '#fff', fontWeight: '900', fontSize: 10, letterSpacing: 0.8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  timerWrap: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  timerCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  timerText: { color: colors.text, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  timerSub: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  amountLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  amount: { color: colors.primary, fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  amountCommission: { color: colors.danger, fontSize: 11, fontWeight: '700', marginTop: 4 },
  amountNet: { color: colors.success, fontSize: 11, fontWeight: '900', marginTop: 2 },
  amount: { color: colors.primary, fontSize: 30, fontWeight: '900', letterSpacing: -1 },
  payPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, marginTop: 4,
  },
  payText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },

  client: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4 },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  clientName: { color: colors.text, fontSize: 16, fontWeight: '800' },
  clientMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },

  route: { flexDirection: 'row', gap: 12, paddingVertical: 4 },
  routeColumn: { alignItems: 'center', paddingTop: 4, paddingBottom: 4, width: 14 },
  routeDot: { width: 12, height: 12, borderRadius: 6 },
  routeLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 4 },
  routeLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  routeAddr: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 2 },
  routeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  etaBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.success + '22',
    borderWidth: 1, borderColor: colors.success + '55',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999,
  },
  etaText: { color: colors.success, fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.danger + '22', borderColor: colors.danger, borderWidth: 1,
    borderRadius: radius.md, padding: 8,
  },
  errorText: { color: colors.danger, fontSize: 12, fontWeight: '700', flex: 1 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  refuseBtn: {
    width: 100, height: 60, borderRadius: 30,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  refuseText: { color: colors.text, fontWeight: '900', letterSpacing: 0.8, fontSize: 12 },
  acceptBtn: {
    flex: 1, height: 60, borderRadius: 30, backgroundColor: colors.success,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: colors.success, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 0 },
  },
  acceptText: { color: '#fff', fontWeight: '900', letterSpacing: 1.2, fontSize: 15 },

  detailsLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 4,
  },
  detailsLinkText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  swipeHint: {
    color: colors.textMuted, fontSize: 10, textAlign: 'center', letterSpacing: 0.5,
  },
});
