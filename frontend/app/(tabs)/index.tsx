import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Alert,
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

type Coords = { lat: number; lng: number; heading?: number | null; speed?: number | null };

export default function HomeMap() {
  const router = useRouter();
  const [coords, setCoords] = useState<Coords | null>(null);
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

      // Compute today's earnings from wallet transactions
      if (wal) {
        const txs: any[] = (wal as any).transactions || (wal as any).movements || (wal as any).history || [];
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        let total = 0;
        let count = 0;
        txs.forEach((t: any) => {
          const dt = new Date(t.created_at || t.date || t.at);
          if (dt >= todayStart && (t.type === 'commission_internal' || t.type === 'commission_external' || (t.direction === 'credit' && (t.amount_cents ?? 0) > 0))) {
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

  // Push location to backend while on shift
  useEffect(() => {
    if (!onShift || !coords) return;
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
    haptic('medium');
    setToggling(true);
    const next = !onShift;
    try {
      const res: any = await setShift(next);
      const newShift = res?.user?.on_shift ?? res?.on_shift ?? next;
      setOnShift(Boolean(newShift));
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
            <Text style={styles.pillText}>{onShift ? 'EN SERVICE' : 'HORS SERVICE'}</Text>
          </View>

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
            style={[styles.shiftBtn, onShift ? styles.shiftBtnOn : styles.shiftBtnOff]}
            testID="toggle-shift-button"
          >
            {toggling ? (
              <ActivityIndicator color={onShift ? colors.text : colors.bg} />
            ) : (
              <>
                <Ionicons
                  name={onShift ? 'pause' : 'play'}
                  size={22}
                  color={onShift ? colors.text : colors.bg}
                />
                <Text style={[styles.shiftText, { color: onShift ? colors.text : colors.bg }]}>
                  {onShift ? 'TERMINER LA SESSION' : 'DÉMARRER LA SESSION'}
                </Text>
              </>
            )}
          </TouchableOpacity>

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
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 5,
  },
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
  shiftText: { fontWeight: '900', fontSize: 14, letterSpacing: 1.5 },
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
