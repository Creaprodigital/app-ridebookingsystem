import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Dimensions,
  Platform,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useRides } from '../ridesContext';
import { colors, radius } from '../theme';

const BUBBLE_SIZE = 64;
const EDGE_PADDING = 12;

export default function FloatingRideBubble() {
  const router = useRouter();
  const pathname = usePathname();
  const { newRidesCount, latest, hasNew, acknowledge } = useRides();
  const [expanded, setExpanded] = useState(false);

  // Hide on the login screen
  const visible = !!pathname && !pathname.includes('login');

  const screen = Dimensions.get('window');
  const initialX = screen.width - BUBBLE_SIZE - EDGE_PADDING;
  const initialY = Math.max(120, screen.height * 0.35);

  const pan = useRef(new Animated.ValueXY({ x: initialX, y: initialY })).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const draggingRef = useRef(false);

  // Pulse animation when new rides arrive
  useEffect(() => {
    if (hasNew) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.18, duration: 600, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(1);
  }, [hasNew, pulse]);

  // Auto expand briefly on new rides
  useEffect(() => {
    if (hasNew) {
      setExpanded(true);
      const t = setTimeout(() => setExpanded(false), 6000);
      return () => clearTimeout(t);
    }
  }, [hasNew]);

  // Snap to nearest edge
  const snapToEdge = (rawX: number, rawY: number) => {
    const w = screen.width;
    const h = screen.height;
    const targetX = rawX + BUBBLE_SIZE / 2 < w / 2 ? EDGE_PADDING : w - BUBBLE_SIZE - EDGE_PADDING;
    const targetY = Math.max(80, Math.min(h - BUBBLE_SIZE - 100, rawY));
    Animated.spring(pan, {
      toValue: { x: targetX, y: targetY },
      useNativeDriver: false,
      bounciness: 6,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        draggingRef.current = false;
        pan.extractOffset();
      },
      onPanResponderMove: (_, g) => {
        if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) draggingRef.current = true;
        Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false })(_, g);
      },
      onPanResponderRelease: (_, g) => {
        pan.flattenOffset();
        const x = (pan.x as any)._value;
        const y = (pan.y as any)._value;
        snapToEdge(x, y);
        // tiny delay to differentiate tap from drag
        setTimeout(() => { draggingRef.current = false; }, 50);
      },
    })
  ).current;

  const onTap = () => {
    if (draggingRef.current) return;
    if (latest.length > 0 || hasNew) {
      acknowledge();
      router.push('/(tabs)/missions');
    } else {
      setExpanded((v) => !v);
    }
  };

  if (!visible) return null;
  if (latest.length === 0 && !hasNew) return null;

  const count = latest.length;
  const previewItem = latest[0];
  const previewPickup =
    previewItem?.booking?.pickup_address ||
    previewItem?.pickup_address ||
    'Course disponible';
  const previewAmount =
    previewItem?.amount ?? previewItem?.pricing?.final ?? null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        { transform: [{ translateX: pan.x }, { translateY: pan.y }] },
      ]}
      testID="floating-ride-bubble"
    >
      {expanded ? (
        <Pressable
          onPress={onTap}
          style={styles.card}
          testID="floating-ride-card"
        >
          <View style={styles.cardHead}>
            <View style={styles.liveDot} />
            <Text style={styles.cardTitle}>
              {count} course{count > 1 ? 's' : ''} · LIVE
            </Text>
            <TouchableOpacity
              hitSlop={8}
              onPress={(e) => {
                e.stopPropagation?.();
                setExpanded(false);
              }}
              testID="floating-ride-close"
            >
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.cardAddress} numberOfLines={2}>
            {previewPickup}
          </Text>
          {previewAmount != null ? (
            <Text style={styles.cardAmount}>
              Commission: {Number(previewAmount).toFixed(2)} €
            </Text>
          ) : null}
          <View style={styles.cardCta}>
            <Text style={styles.cardCtaText}>VOIR LES COURSES</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.bg} />
          </View>
        </Pressable>
      ) : (
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.bubble,
            hasNew && styles.bubbleAlert,
            { transform: [{ scale: pulse }] },
          ]}
        >
          <Pressable
            onPress={onTap}
            style={styles.bubbleInner}
            testID="floating-ride-bubble-btn"
          >
            <Ionicons
              name="flash"
              size={26}
              color={hasNew ? colors.bg : colors.primary}
            />
            {count > 0 ? (
              <View style={styles.badge} testID="floating-ride-count">
                <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
              </View>
            ) : null}
          </Pressable>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 9999,
    elevation: 30,
  },
  bubble: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 16,
  },
  bubbleAlert: {
    backgroundColor: colors.primary,
    borderColor: '#fff',
    shadowColor: colors.primary,
    shadowOpacity: 0.7,
  },
  bubbleInner: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BUBBLE_SIZE / 2,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  badgeText: { color: '#fff', fontWeight: '900', fontSize: 11 },
  card: {
    width: 260,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: 14,
    gap: 6,
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 22,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success,
  },
  cardTitle: {
    color: colors.text, fontSize: 12, fontWeight: '900', letterSpacing: 1, flex: 1,
  },
  cardAddress: { color: colors.text, fontSize: 13, fontWeight: '700' },
  cardAmount: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  cardCta: {
    marginTop: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  cardCtaText: {
    color: colors.bg, fontWeight: '900', fontSize: 11, letterSpacing: 1,
  },
});
