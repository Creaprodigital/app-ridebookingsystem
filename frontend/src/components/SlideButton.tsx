import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View, LayoutChangeEvent, ActivityIndicator } from 'react-native';
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
  onConfirm: () => Promise<void> | void;
  color?: string;
  testID?: string;
  disabled?: boolean;
};

const KNOB = 56;

export default function SlideButton({ label, onConfirm, color = colors.primary, testID, disabled }: Props) {
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
    <View style={[styles.track, disabled && { opacity: 0.5 }]} onLayout={handleLayout} testID={testID}>
      <Animated.View style={[styles.fill, { backgroundColor: color + '40' }, fillStyle]} />
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.knob, { backgroundColor: color }, knobStyle]}>
          {loading ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Ionicons name="chevron-forward" size={24} color={colors.bg} />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 64,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.full,
    justifyContent: 'center',
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.full,
  },
  label: {
    color: colors.textSecondary,
    textAlign: 'center',
    fontWeight: '700',
    letterSpacing: 1.2,
    fontSize: 14,
    textTransform: 'uppercase',
  },
  knob: {
    position: 'absolute',
    left: 4,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
