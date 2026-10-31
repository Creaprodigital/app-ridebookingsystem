import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, View, LayoutChangeEvent, ActivityIndicator } from 'react-native';
import { Text } from '../ui/Text';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';

type Props = {
  label: string;
  subLabel?: string;
  onConfirm: () => Promise<void> | void;
  color?: string;
  testID?: string;
  disabled?: boolean;
};

const KNOB = 56;

export default function SlideButton({ label, subLabel, onConfirm, color = colors.primary, testID, disabled }: Props) {
  const trackWidth = useRef(0);
  const [maxX, setMaxX] = useState(0);
  const [loading, setLoading] = useState(false);
  const offsetX = useSharedValue(0);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    trackWidth.current = e.nativeEvent.layout.width;
    setMaxX(Math.max(0, e.nativeEvent.layout.width - KNOB - 8));
  }, []);

  const triggerConfirm = useCallback(async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
      offsetX.value = withSpring(0);
    }
  }, [onConfirm, offsetX]);

  const pan = Gesture.Pan()
    .enabled(!disabled && !loading)
    .onUpdate((e) => {
      const nx = Math.min(Math.max(0, e.translationX), maxX);
      offsetX.value = nx;
    })
    .onEnd(() => {
      if (offsetX.value > maxX * 0.85) {
        offsetX.value = withSpring(maxX);
        runOnJS(triggerConfirm)();
      } else {
        offsetX.value = withSpring(0);
      }
    });

  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offsetX.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ width: offsetX.value + KNOB + 8 }));

  return (
    <View style={[styles.track, { backgroundColor: color }, disabled && { opacity: 0.5 }]} onLayout={handleLayout} testID={testID}>
      <Animated.View style={[styles.fill, fillStyle]} />
      <View style={styles.labelWrap} pointerEvents="none">
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        {subLabel ? (
          <Text style={styles.subLabel} numberOfLines={1}>{subLabel}</Text>
        ) : null}
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.knob, knobStyle]}>
          {loading ? (
            <ActivityIndicator color={color} />
          ) : (
            <Ionicons name="arrow-forward" size={24} color={color} />
          )}
        </Animated.View>
      </GestureDetector>
      {/* trailing chevrons hint */}
      <View style={styles.hintWrap} pointerEvents="none">
        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.55)" style={{ marginLeft: -10 }} />
        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.8)" style={{ marginLeft: -10 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 64,
    borderRadius: radius.lg + 4,
    justifyContent: 'center',
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.lg + 4,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  labelWrap: { alignItems: 'center', justifyContent: 'center' },
  label: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: '700',
    fontSize: 16,
  },
  subLabel: {
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    fontWeight: '600',
    fontSize: 11,
    marginTop: 2,
  },
  hintWrap: {
    position: 'absolute',
    right: 18,
    top: 0, bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  knob: {
    position: 'absolute',
    left: 4,
    width: KNOB,
    height: KNOB,
    borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
