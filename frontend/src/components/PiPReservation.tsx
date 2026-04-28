import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRides } from '../ridesContext';
import { colors, radius, spacing } from '../theme';

// ──────────────────────────────────────────────────────────────────────────────
// Picture-in-Picture (PiP) reservation preview
// ──────────────────────────────────────────────────────────────────────────────
// • Renders a floating compact card in the bottom-right corner whenever a new
//   marketplace ride is detected (ridesContext.newRidesCount > 0).
// • States: expanded (default at appearance) ↔ minimized (small pill with badge).
// • Actions: close, minimize/expand, open full mission/marketplace.
// • Does not block navigation: pointerEvents="box-none" and tab bar reserved.
// • Responsive: width clamped to 360 on tablets/desktop, full-width-minus-32 on
//   small phones.
// • Discrete entrance animation (translate + fade + scale) and pulsing accent
//   when the count grows above 1.
// ──────────────────────────────────────────────────────────────────────────────

const MIN_WIDTH = 64;
const EXPAND_MAX_WIDTH = 360;
const TAB_BAR_OFFSET = 96; // keep clear of the floating tab bar

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
    item?.pickup_time ||
    item?.created_at
  );
}
function pickService(item: any) {
  return (
    item?.booking?.vehicle_category_label ||
    item?.vehicle_category_label ||
    item?.booking?.vehicle_category ||
    item?.vehicle_category ||
    item?.service ||
    'Course standard'
  );
}
function pickStatus(item: any) {
  const s = String(item?.status || 'open').toLowerCase();
  if (s === 'open' || s === 'available') return { label: 'NOUVELLE', color: colors.primary };
  if (s === 'assigned') return { label: 'ASSIGNÉE', color: colors.warning };
  if (s === 'in_progress') return { label: 'EN COURS', color: colors.info };
  if (s === 'completed') return { label: 'TERMINÉE', color: colors.success };
  return { label: s.toUpperCase(), color: colors.textSecondary };
}
function pickAmount(item: any) {
  const v = item?.amount ?? item?.pricing?.final ?? item?.price ?? item?.fare ?? item?.total;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function pickId(item: any) {
  return String(item?.id ?? item?._id ?? '');
}
function fmtDt(s?: string) {
  if (!s) return '';
  try {
    return new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return s;
  }
}

export default function PiPReservation() {
  const router = useRouter();
  const pathname = usePathname() || '';
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const { latest, newRidesCount, hasNew, acknowledge } = useRides();

  const [minimized, setMinimized] = useState(false);
  const [closed, setClosed] = useState(false);
  const lastSeenIdRef = useRef<string | null>(null);

  // Animation values
  const enter = useRef(new Animated.Value(0)).current; // 0..1 entrance
  const pulse = useRef(new Animated.Value(0)).current; // pulsing on multi-arrival

  // Determine the visible item: the most recent unseen ride
  const item = latest && latest.length > 0 ? latest[0] : null;
  const id = item ? pickId(item) : null;
  const visible =
    !closed &&
    hasNew &&
    !!item &&
    !pathname.includes('login') &&
    !pathname.startsWith('/mission/');

  // Reset when a new ride id appears
  useEffect(() => {
    if (!id) return;
    if (lastSeenIdRef.current !== id) {
      lastSeenIdRef.current = id;
      setClosed(false);
      setMinimized(false);
    }
  }, [id]);

  // Entrance animation
  useEffect(() => {
    if (!visible) {
      enter.setValue(0);
      return;
    }
    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.back(1.2)),
      useNativeDriver: true,
    }).start();
  }, [visible, enter]);

  // Pulsing indicator when multiple rides arrive
  useEffect(() => {
    if (newRidesCount > 1 && visible) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(0);
  }, [newRidesCount, visible, pulse]);

  if (!visible || !item) return null;

  // Responsive width
  const cardWidth = Math.min(EXPAND_MAX_WIDTH, screenW - 32);
  const right = 16;
  const bottom = TAB_BAR_OFFSET + Math.max(insets.bottom, 8);

  const status = pickStatus(item);
  const amount = pickAmount(item);

  const handleOpen = () => {
    acknowledge();
    if (item.status === 'assigned' || item.status === 'in_progress' || item.status === 'en_route' || item.status === 'arrived') {
      router.push(`/mission/${id}`);
    } else {
      router.push('/(tabs)/missions');
    }
  };

  const handleClose = () => {
    acknowledge();
    setClosed(true);
  };

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });
  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const opacity = enter;
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.05] });

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { right, bottom }]}
      testID="pip-reservation"
    >
      <Animated.View
        style={[
          { transform: [{ translateY }, { scale }], opacity },
        ]}
      >
        {minimized ? (
          // ─── Minimized pill ──────────────────────────────────────────────
          <View>
            {newRidesCount > 1 ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.pulseRing,
                  {
                    transform: [{ scale: pulseScale }],
                    opacity: pulseOpacity,
                  },
                ]}
              />
            ) : null}
            <Pressable
              onPress={() => setMinimized(false)}
              style={styles.minBubble}
              testID="pip-minimized"
            >
              <Ionicons name="flash" size={22} color={colors.bg} />
              {newRidesCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {newRidesCount > 9 ? '9+' : newRidesCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        ) : (
          // ─── Expanded card ───────────────────────────────────────────────
          <View style={[styles.card, { width: cardWidth }]} testID="pip-expanded">
            <View style={styles.head}>
              <View style={[styles.statusPill, { borderColor: status.color, backgroundColor: status.color + '22' }]}>
                <View style={[styles.statusDot, { backgroundColor: status.color }]} />
                <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
              </View>

              {newRidesCount > 1 ? (
                <View style={styles.multiBadge} testID="pip-multi-indicator">
                  <Ionicons name="layers" size={11} color={colors.bg} />
                  <Text style={styles.multiBadgeText}>+{newRidesCount - 1}</Text>
                </View>
              ) : null}

              <View style={{ flex: 1 }} />

              <TouchableOpacity
                onPress={() => setMinimized(true)}
                hitSlop={8}
                style={styles.iconBtn}
                testID="pip-minimize"
              >
                <Ionicons name="contract" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleClose}
                hitSlop={8}
                style={styles.iconBtn}
                testID="pip-close"
              >
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.body}>
              <View style={styles.rowGap}>
                <Ionicons name="person" size={14} color={colors.textMuted} />
                <Text style={styles.client} numberOfLines={1}>{pickName(item)}</Text>
              </View>
              <View style={styles.rowGap}>
                <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                <Text style={styles.meta} numberOfLines={1}>{fmtDt(pickWhen(item))}</Text>
              </View>
              <View style={styles.rowGap}>
                <Ionicons name="car-outline" size={14} color={colors.textMuted} />
                <Text style={styles.meta} numberOfLines={1}>{pickService(item)}</Text>
              </View>
              {amount != null ? (
                <View style={styles.amountBox}>
                  <Text style={styles.amountLbl}>MONTANT</Text>
                  <Text style={styles.amountVal}>{amount.toFixed(2)} €</Text>
                </View>
              ) : null}
            </View>

            <TouchableOpacity
              style={styles.openBtn}
              onPress={handleOpen}
              testID="pip-open"
            >
              <Ionicons name="arrow-forward-circle" size={18} color={colors.bg} />
              <Text style={styles.openBtnText}>OUVRIR LA RÉSERVATION</Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    zIndex: 9000,
    elevation: 24,
  },
  // Minimized pill
  minBubble: {
    width: MIN_WIDTH, height: MIN_WIDTH, borderRadius: MIN_WIDTH / 2,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primary, shadowOpacity: 0.5,
    shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
    borderWidth: 2, borderColor: colors.bg,
  },
  pulseRing: {
    position: 'absolute', top: 0, left: 0,
    width: MIN_WIDTH, height: MIN_WIDTH, borderRadius: MIN_WIDTH / 2,
    backgroundColor: colors.primary,
  },
  badge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: 11,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.bg,
  },
  badgeText: { color: '#fff', fontWeight: '900', fontSize: 11 },

  // Expanded card
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999, borderWidth: 1,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  multiBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
  },
  multiBadgeText: { color: colors.bg, fontWeight: '900', fontSize: 10, letterSpacing: 0.5 },
  iconBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  body: { gap: 8 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  client: { color: colors.text, fontSize: 15, fontWeight: '800', flex: 1 },
  meta: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', flex: 1 },
  amountBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.bg, borderRadius: radius.md,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.border,
    marginTop: 2,
  },
  amountLbl: { color: colors.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  amountVal: { color: colors.primary, fontSize: 16, fontWeight: '900', letterSpacing: -0.5 },
  openBtn: {
    height: 40, borderRadius: radius.full, backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 4,
  },
  openBtnText: { color: colors.bg, fontWeight: '900', fontSize: 11, letterSpacing: 1.2 },
});
