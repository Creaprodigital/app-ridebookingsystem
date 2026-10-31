import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, Alert, Animated } from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter, useFocusEffect } from 'expo-router';
import MapView from '../../src/components/MapView';
import { colors, radius, spacing, shadow } from '../../src/theme';
import Chip from '../../src/ui/Chip';
import RouteStops from '../../src/ui/RouteStops';
import { pickAddress, pickAmount, pickDt, fmtPrice, fmtEuro, fmtTime, fmtDay } from '../../src/rideFormat';
import { formatPickupCountdown, useTicker } from '../../src/timeUtils';
import {
  getDriverProfile,
  getDriverMissions,
  getMarketplace,
  getDriverWallet,
  setShift,
  pushLocation,
  apiError,
} from '../../src/api';
import { haptic } from '../../src/feedback';
import { useRides } from '../../src/ridesContext';
import { getNotifications, subscribe } from '../../src/notificationsHistory';
import { setLastCoords } from '../../src/locationStore';
import { startBackgroundLocation, stopBackgroundLocation } from '../../src/backgroundLocation';
import { useDriverSubscription } from '../../src/driverSubscription';

type Coords = { lat: number; lng: number; heading?: number | null; speed?: number | null };

export default function HomeMap() {
  const router = useRouter();
  const { refreshShift, latest, pendingCount } = useRides();
  const { needsPayment: subNeedsPayment, state: subState } = useDriverSubscription();
  const [coords, setCoords] = useState<Coords | null>(null);
  const [unreadNotif, setUnreadNotif] = useState(0);
  const counterAnim = useRef(new Animated.Value(0)).current;
  const lastCount = useRef(0);

  // Live counter animation when number of available rides increases
  useEffect(() => {
    const count = latest?.length ?? 0;
    if (count > lastCount.current) {
      Animated.sequence([
        Animated.timing(counterAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.timing(counterAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
    }
    lastCount.current = count;
  }, [latest, counterAnim]);

  // Unread notifications counter
  useEffect(() => {
    let mounted = true;
    getNotifications().then((items) => {
      if (mounted) setUnreadNotif(items.filter((e) => !e.read).length);
    });
    const unsub = subscribe((items) => {
      if (mounted) setUnreadNotif(items.filter((e) => !e.read).length);
    });
    return () => { mounted = false; unsub(); };
  }, []);

  const counterScale = counterAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });
  const [onShift, setOnShift] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [counts, setCounts] = useState({ assigned: 0, available: 0 });
  const [nextMission, setNextMission] = useState<any>(null);
  useTicker(30_000);
  const [todayEarn, setTodayEarn] = useState({ total: 0, count: 0 });
  const [locError, setLocError] = useState<string | null>(null);
  const watchSub = useRef<Location.LocationSubscription | null>(null);
  const pushTimer = useRef<any>(null);
  const lastSentAt = useRef(0);

  const loadOverview = useCallback(async () => {
    try {
      const [p, missions, market, wal] = await Promise.all([
        getDriverProfile().catch(() => null),
        getDriverMissions().catch(() => []),
        getMarketplace().catch(() => []),
        getDriverWallet().catch(() => null),
      ]);
      if (p) {
        setProfile(p);
        const shiftFlag = p?.user?.on_shift ?? p?.on_shift ?? p?.is_on_shift ?? p?.shift_active;
        setOnShift(Boolean(shiftFlag));
      }
      const assignedList = Array.isArray(missions) ? missions : missions?.current ?? missions?.items ?? [];
      const marketList = Array.isArray(market) ? market : market?.items ?? [];
      setCounts({ assigned: assignedList.length, available: marketList.length });
      // Next ride = the open mission with the earliest pickup time.
      const open = assignedList
        .filter((m: any) => !['completed', 'cancelled', 'canceled'].includes(String(m?.status || '')))
        .sort((a: any, b: any) => new Date(pickDt(a) || 0).getTime() - new Date(pickDt(b) || 0).getTime());
      setNextMission(open[0] ?? null);

      // Compute today's earnings from wallet transactions (commissions count as gains for the driver's day)
      if (wal) {
        const txs: any[] = (wal as any).transactions || (wal as any).movements || (wal as any).history || [];
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        let total = 0;
        let count = 0;
        txs.forEach((t: any) => {
          const dt = new Date(t.created_at || t.date || t.at);
          const type = String(t.type || '');
          const isRideCommission =
            type === 'commission_internal' || type === 'commission_external';
          if (dt >= todayStart && isRideCommission) {
            total += Math.abs((t.amount_cents ?? 0) / 100);
            count += 1;
          }
        });
        setTodayEarn({ total, count });
      }
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadOverview();
    }, [loadOverview])
  );

  const startTracking = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocError('Permission de localisation refusée');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const initial: Coords = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        heading: pos.coords.heading,
        speed: pos.coords.speed,
      };
      setCoords(initial);
      setLastCoords({ lat: initial.lat, lng: initial.lng });

      watchSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
        (p) => {
          const c: Coords = {
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            heading: p.coords.heading,
            speed: p.coords.speed,
          };
          setCoords(c);
          setLastCoords({ lat: c.lat, lng: c.lng });
        }
      );
    } catch (e) {
      setLocError('Impossible de récupérer la position');
    }
  }, []);

  useEffect(() => {
    startTracking();
    return () => {
      watchSub.current?.remove();
      if (pushTimer.current) clearInterval(pushTimer.current);
    };
  }, [startTracking]);

  // Push location to backend while on shift + start/stop background tracker
  useEffect(() => {
    if (!onShift || !coords) {
      // shift OFF → stop background tracker (idempotent)
      void stopBackgroundLocation();
      return;
    }
    // shift ON → ensure background tracker is running. Web is a no-op.
    void startBackgroundLocation();
    const send = async () => {
      const now = Date.now();
      if (now - lastSentAt.current < 8000) return;
      lastSentAt.current = now;
      try {
        await pushLocation(coords);
      } catch {}
    };
    send();
    pushTimer.current = setInterval(send, 10000);
    return () => {
      if (pushTimer.current) clearInterval(pushTimer.current);
    };
  }, [onShift, coords]);

  const toggleShift = async () => {
    // Frontend-only gate: refuse to go on shift when the driver hasn't paid
    // their required subscription. Backend keeps accepting requests but the
    // UI never fires them until the payment is settled.
    if (subNeedsPayment && !onShift) {
      haptic('error');
      const msg =
        'Votre abonnement doit être réglé avant de passer en service.';
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Abonnement requis', msg, [
        { text: 'Plus tard', style: 'cancel' },
        { text: 'S’abonner', onPress: () => router.push('/subscription' as any) },
      ]);
      return;
    }
    haptic('medium');
    setToggling(true);
    const next = !onShift;
    try {
      const res: any = await setShift(next);
      const newShift = res?.user?.on_shift ?? res?.on_shift ?? next;
      setOnShift(Boolean(newShift));
      // Sync the global rides context so off-shift gating is instant across screens
      try { await refreshShift(); } catch {}
      haptic('success');
      if (newShift && coords) {
        try { await pushLocation(coords); } catch {}
      }
    } catch (e) {
      haptic('error');
      const msg = apiError(e);
      if (Platform.OS !== 'web') Alert.alert('Erreur', msg);
    } finally {
      setToggling(false);
    }
  };

  const locked = subNeedsPayment && !onShift;
  const nextId = nextMission?.id || nextMission?._id || nextMission?.mission_id;
  const nextDt = nextMission ? pickDt(nextMission) : null;
  const nextCountdown = nextDt ? formatPickupCountdown(nextDt) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.mapWrap}>
        <MapView
          lat={coords?.lat}
          lng={coords?.lng}
          heading={coords?.heading}
          style={StyleSheet.absoluteFill}
        />

        {/* Top: shift switch + notifications */}
        <View style={styles.topBar} pointerEvents="box-none">
          <TouchableOpacity
            onPress={toggleShift}
            activeOpacity={0.85}
            disabled={toggling}
            style={styles.shiftCard}
            testID="toggle-shift-button"
            accessibilityRole="switch"
            accessibilityState={{ checked: onShift }}
          >
            <View
              style={[
                styles.dot,
                { backgroundColor: onShift ? colors.success : locked ? colors.danger : colors.textMuted },
                onShift && styles.dotOn,
              ]}
            />
            <View style={{ flex: 1 }} testID="shift-pill">
              <Text style={styles.shiftTitle}>
                {locked ? 'Abonnement requis' : onShift ? 'En service' : 'Hors service'}
              </Text>
              <Text style={styles.shiftSub} numberOfLines={1}>
                {locked
                  ? 'Réglez-le pour recevoir des courses'
                  : onShift
                  ? 'Vous recevez les courses'
                  : 'Activez pour recevoir des courses'}
              </Text>
            </View>
            {toggling ? (
              <ActivityIndicator color={colors.primary} style={{ width: 50 }} />
            ) : locked ? (
              <View style={styles.lockBadge}>
                <Ionicons name="lock-closed" size={16} color={colors.danger} />
              </View>
            ) : (
              <View style={[styles.switch, onShift && styles.switchOn]}>
                <View style={[styles.knob, onShift && styles.knobOn]} />
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.roundBtn}
            onPress={() => router.push('/notifications' as any)}
            testID="bell-btn"
            accessibilityLabel="Notifications"
          >
            <Ionicons name="notifications-outline" size={21} color={colors.text} />
            {unreadNotif > 0 ? (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unreadNotif > 9 ? '9+' : unreadNotif}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        {/* Live counter of rides waiting in the marketplace */}
        {(latest?.length ?? 0) > 0 ? (
          <Animated.View style={[styles.liveWrap, { transform: [{ scale: counterScale }] }]}>
            <TouchableOpacity
              style={styles.liveCounter}
              onPress={() => router.push('/(tabs)/missions')}
              testID="live-counter"
            >
              <View style={styles.liveDot} />
              <Text style={styles.liveCounterText}>
                {latest.length} course{latest.length > 1 ? 's' : ''} disponible{latest.length > 1 ? 's' : ''}
              </Text>
              <Ionicons name="chevron-forward" size={14} color="#fff" />
            </TouchableOpacity>
          </Animated.View>
        ) : null}

        {locError ? (
          <View style={styles.banner}>
            <Ionicons name="warning-outline" size={16} color={colors.warning} />
            <Text style={styles.bannerText}>{locError}</Text>
          </View>
        ) : null}

        {/* Bottom: next ride + key figures */}
        <View style={styles.bottom}>
          {subNeedsPayment ? (
            <TouchableOpacity
              onPress={() => { haptic('light'); router.push('/subscription' as any); }}
              activeOpacity={0.85}
              style={styles.subBanner}
              testID="subscription-banner"
            >
              <Ionicons name="alert-circle" size={20} color={colors.danger} />
              <View style={{ flex: 1 }}>
                <Text style={styles.subBannerTitle}>Abonnement requis</Text>
                <Text style={styles.subBannerSub} numberOfLines={1}>
                  Réglez votre abonnement pour recevoir des courses
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.danger} />
            </TouchableOpacity>
          ) : null}

          <View style={styles.nextCard} testID="next-mission-card">
            {nextMission ? (
              <>
                <View style={styles.nextHead}>
                  <Text style={styles.nextLabel}>Prochaine course</Text>
                  {nextCountdown?.label ? (
                    <Chip
                      icon="time-outline"
                      label={nextCountdown.label}
                      tone={nextCountdown.kind === 'overdue' ? 'danger' : nextCountdown.kind === 'soon' || nextCountdown.kind === 'now' ? 'warning' : 'primary'}
                    />
                  ) : null}
                </View>
                <View style={styles.nextTimeRow}>
                  <Text style={styles.nextTime}>
                    {fmtTime(nextDt || undefined)}
                    <Text style={styles.nextDay}>  ·  {fmtDay(nextDt || undefined)}</Text>
                  </Text>
                  <Text style={styles.nextPrice}>{fmtPrice(pickAmount(nextMission))}</Text>
                </View>
                <RouteStops
                  pickup={pickAddress(nextMission, 'pickup')}
                  dropoff={pickAddress(nextMission, 'dropoff')}
                />
                <TouchableOpacity
                  style={styles.primaryBtn}
                  activeOpacity={0.85}
                  onPress={() => nextId && router.push(`/mission/${nextId}` as any)}
                  testID="next-mission-open"
                >
                  <Text style={styles.primaryBtnText}>Voir la course</Text>
                  <Ionicons name="arrow-forward" size={18} color={colors.onPrimary} />
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.emptyNext}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="car-outline" size={22} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.emptyTitle}>Aucune course prévue</Text>
                  <Text style={styles.emptySub}>
                    {onShift ? 'Les nouvelles courses apparaîtront ici.' : 'Passez en service pour recevoir des courses.'}
                  </Text>
                </View>
              </View>
            )}
          </View>

          <View style={styles.statsRow}>
            <TouchableOpacity style={styles.statCard} onPress={() => router.push('/(tabs)/earnings')} testID="today-earnings">
              <Text style={styles.statLabel}>{"Aujourd'hui"}</Text>
              <Text style={styles.statValue} numberOfLines={1}>{fmtEuro(todayEarn.total, 0)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.statCard} onPress={() => router.push('/(tabs)/missions')} testID="stat-assigned">
              <Text style={styles.statLabel}>Mes courses</Text>
              <Text style={styles.statValue}>{counts.assigned}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.statCard} onPress={() => router.push('/(tabs)/missions')} testID="stat-available">
              <Text style={styles.statLabel}>Disponibles</Text>
              <Text style={[styles.statValue, { color: colors.primary }]}>{counts.available}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  mapWrap: { flex: 1, position: 'relative' },
  topBar: {
    position: 'absolute', top: 10, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 5,
  },
  shiftCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: 999,
    borderWidth: 1, borderColor: colors.border,
    paddingLeft: 16, paddingRight: 8, paddingVertical: 8,
    ...shadow,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOn: { shadowColor: colors.success, shadowOpacity: 0.8, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  shiftTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  shiftSub: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
  switch: {
    width: 50, height: 30, borderRadius: 15, padding: 3,
    backgroundColor: colors.elevated, justifyContent: 'center',
  },
  switchOn: { backgroundColor: colors.success },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', ...shadow },
  knobOn: { alignSelf: 'flex-end' },
  lockBadge: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.dangerSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  roundBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, ...shadow,
  },
  bellBadge: {
    position: 'absolute', top: 4, right: 4,
    minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.surface,
  },
  bellBadgeText: { color: '#fff', fontWeight: '800', fontSize: 9 },
  liveWrap: { position: 'absolute', top: 74, alignSelf: 'center', zIndex: 5 },
  liveCounter: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    ...shadow,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  liveCounterText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  banner: {
    position: 'absolute', top: 74, left: 12, right: 12,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.warning,
    borderRadius: radius.md, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 4,
  },
  bannerText: { color: colors.warning, fontSize: 13, fontWeight: '600', flex: 1 },
  bottom: { position: 'absolute', bottom: 10, left: 12, right: 12, gap: 8 },
  nextCard: {
    backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md + 2,
    borderWidth: 1, borderColor: colors.border, gap: 12, ...shadow,
  },
  nextHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nextLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  nextTimeRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  nextTime: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  nextDay: { color: colors.textSecondary, fontSize: 14, fontWeight: '600', letterSpacing: 0 },
  nextPrice: { color: colors.text, fontSize: 22, fontWeight: '800' },
  primaryBtn: {
    height: 50, borderRadius: radius.lg, backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 2,
  },
  primaryBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
  emptyNext: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emptyIcon: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  emptySub: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: {
    flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 10, ...shadow,
  },
  statLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  statValue: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 2 },
  subBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderColor: colors.danger, borderWidth: 1,
    borderRadius: radius.lg, padding: 12, ...shadow,
  },
  subBannerTitle: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  subBannerSub: { color: colors.textSecondary, fontSize: 12, fontWeight: '500', marginTop: 1 },
});
