import React from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

const LOGO = require('../../assets/images/logo-horizontal-dark.png');
// Same navy as the native splash (app.json) so the hand-off is seamless.
const SPLASH_BG = '#071731';

const FADE_OUT_MS = 350;

/**
 * Short branded intro shown on cold start: the RideBookingSystem logo
 * fades/scales in on the navy splash colour, then the whole layer fades out.
 */
export default function BrandSplash({
  durationMs = 1600,
  onDone,
}: {
  durationMs?: number;
  onDone: () => void;
}) {
  const opacity = React.useRef(new Animated.Value(1)).current;
  const logo = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(logo, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const fadeOut = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_OUT_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }, Math.max(0, durationMs - FADE_OUT_MS));
    const done = setTimeout(onDone, durationMs);
    return () => {
      clearTimeout(fadeOut);
      clearTimeout(done);
    };
  }, [durationMs]);

  const scale = logo.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });

  return (
    <Animated.View style={[styles.root, { opacity }]} pointerEvents="none">
      <Animated.Image
        source={LOGO}
        style={[styles.logo, { opacity: logo, transform: [{ scale }] }]}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SPLASH_BG,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  logo: { width: 260, height: 35 },
});
