import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Alert,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter, useFocusEffect } from 'expo-router';
import MapView from '../../src/components/MapView';
import { colors, radius, spacing } from '../../src/theme';
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
        'Votre abonnement doit être réglé avant de passer en ligne.';
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.mapWrap}>
        <MapView
          lat={coords?.lat}
          lng={coords?.lng}
          heading={coords?.heading}
          style={StyleSheet.absoluteFill}
        />

        {/* Top status pill */}
        <View style={styles.topBar} pointerEvents="box-none">
          <View style={[styles.pill, onShift ? styles.pillOn : styles.pillOff]} testID="shift-pill">
            <View style={[styles.dot, { backgroundColor: onShift ? colors.success : colors.textMuted }]} />
            <Text style={styles.pillText}>{onShift ? 'EN LIGNE' : 'HORS LIGNE'}</Text>
          </View>

          {/* Live ride counter (animated when increasing) */}
          {(latest?.length ?? 0) > 0 ? (
            <Animated.View
              style={[styles.liveCounter, { transform: [{ scale: counterScale }] }]}
              testID="live-counter"
            >
              <View style={styles.liveDot} />
              <Text style={styles.liveCounterText}>
                {latest.length} dispo{latest.length > 1 ? 's' : ''}
              </Text>
            </Animated.View>
          ) : null}

          <View style={{ flex: 1 }} />

          {/* Notifications bell */}
          <TouchableOpacity
            style={styles.bellBtn}
            onPress={() => router.push('/notifications' as any)}
            testID="bell-btn"
          >
            <Ionicons name="notifications-outline" size={22} color={colors.text} />
            {unreadNotif > 0 ? (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>
                  {unreadNotif > 9 ? '9+' : unreadNotif}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.greetBtn}
            onPress={() => router.push('/(tabs)/menu')}
            testID="profile-header-btn"
          >
            <Ionicons name="person-circle" size={28} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Loc error */}
        {locError ? (
          <View style={styles.banner}>
            <Ionicons name="warning" size={14} color={colors.warning} />
            <Text style={styles.bannerText}>{locError}</Text>
          </View>
        ) : null}

        {/* Bottom overlay */}
        <View style={styles.bottomOverlay}>
          {todayEarn.total > 0 ? (
            <View style={styles.earnRow} testID="today-earnings">
              <View style={styles.earnIcon}>
                <Ionicons name="trending-up" size={16} color={colors.bg} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.earnLabel}>GAINS DU JOUR</Text>
                <Text style={styles.earnValue}>
                  {todayEarn.total.toFixed(2)} € · {todayEarn.count} course{todayEarn.count > 1 ? 's' : ''}
                </Text>
              </View>
            </View>
          ) : null}

          <View style={styles.statsRow}>
            <TouchableOpacity
              style={styles.statCard}
              onPress={() => router.push('/(tabs)/missions')}
              testID="stat-assigned"
            >
              <Text style={styles.statValue}>{counts.assigned}</Text>
              <Text style={styles.statLabel}>ASSIGNÉES</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.statCard}
              onPress={() => router.push('/(tabs)/missions')}
              testID="stat-available"
            >
              <Text style={[styles.statValue, { color: colors.primary }]}>{counts.available}</Text>
              <Text style={styles.statLabel}>DISPONIBLES</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={toggleShift}
            activeOpacity={0.85}
            disabled={toggling}
            style={[
              styles.shiftBtn,
              onShift ? styles.shiftBtnOn : styles.shiftBtnOff,
              subNeedsPayment && !onShift && styles.shiftBtnLocked,
            ]}
            testID="toggle-shift-button"
          >
            {toggling ? (
              <ActivityIndicator color={onShift ? colors.text : colors.bg} />
            ) : subNeedsPayment && !onShift ? (
              <>
                <Ionicons name="lock-closed" size={20} color={colors.bg} />
                <Text style={[styles.shiftText, { color: colors.bg }]}>
                  ABONNEMENT REQUIS
                </Text>
              </>
            ) : (
              <>
                <Ionicons
                  name={onShift ? 'pause' : 'play'}
                  size={22}
                  color={onShift ? colors.text : colors.bg}
                />
                <Text style={[styles.shiftText, { color: onShift ? colors.text : colors.bg }]}>
                  {onShift ? 'PASSEZ HORS LIGNE' : 'PASSEZ EN LIGNE'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {subNeedsPayment ? (
            <TouchableOpacity
              onPress={() => { haptic('light'); router.push('/subscription' as any); }}
              activeOpacity={0.85}
              style={styles.subBanner}
              testID="subscription-banner"
            >
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <View style={{ flex: 1 }}>
                <Text style={styles.subBannerTitle}>Abonnement requis</Text>
                <Text style={styles.subBannerSub} numberOfLines={1}>
                  Réglez votre abonnement pour recevoir des courses
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.danger} />
            </TouchableOpacity>
          ) : null}

          {profile ? (
            <Text style={styles.hello} testID="greeting">
              Bonjour, {profile.first_name || profile.name || 'Driver'}
            </Text>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  mapWrap: { flex: 1, position: 'relative' },
  topBar: {
    position: 'absolute', top: 12, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 5,
  },
  liveCounter: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.success,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    shadowColor: colors.success, shadowOpacity: 0.6, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveCounterText: { color: '#fff', fontWeight: '900', fontSize: 11, letterSpacing: 0.6 },
  bellBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.bg + 'E6', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  bellBadge: {
    position: 'absolute', top: -2, right: -2,
    minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.bg,
  },
  bellBadgeText: { color: '#fff', fontWeight: '900', fontSize: 9 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1,
  },
  pillOn: { backgroundColor: colors.bg + 'E6', borderColor: colors.success },
  pillOff: { backgroundColor: colors.bg + 'E6', borderColor: colors.border },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { color: colors.text, fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  greetBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.bg + 'E6', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  banner: {
    position: 'absolute', top: 64, left: 16, right: 16,
    backgroundColor: colors.bg + 'E6', borderWidth: 1, borderColor: colors.warning,
    borderRadius: radius.md, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 5,
  },
  bannerText: { color: colors.warning, fontSize: 12, fontWeight: '700' },
  bottomOverlay: {
    position: 'absolute', bottom: 16, left: 16, right: 16,
    backgroundColor: colors.surface + 'F2', borderRadius: radius.xl, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, gap: spacing.md,
  },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: {
    flex: 1, backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, padding: spacing.md, alignItems: 'center',
  },
  statValue: { color: colors.text, fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  statLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginTop: 2 },
  shiftBtn: {
    height: 60, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 10,
  },
  shiftBtnOff: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 0 },
  },
  shiftBtnOn: { backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border },
  shiftBtnLocked: {
    backgroundColor: colors.danger,
    shadowColor: colors.danger, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
  },
  shiftText: { fontWeight: '900', fontSize: 14, letterSpacing: 1.5 },
  subBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: '#EF444414', borderColor: colors.danger, borderWidth: 1,
    borderRadius: radius.lg, padding: spacing.sm,
  },
  subBannerTitle: { color: colors.danger, fontSize: 13, fontWeight: '900' },
  subBannerSub: { color: colors.text, fontSize: 11, fontWeight: '600', marginTop: 1 },
  hello: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', fontWeight: '600' },
  earnRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.primary, borderRadius: radius.lg,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  earnIcon: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.bg + '33',
    alignItems: 'center', justifyContent: 'center',
  },
  earnLabel: { color: colors.bg + 'CC', fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  earnValue: { color: colors.bg, fontSize: 16, fontWeight: '900' },
});
