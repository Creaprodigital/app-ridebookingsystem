import React from 'react';
import { Animated, StyleSheet, Platform, Easing } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '../theme';

const VIDEO_SOURCE = require('../../assets/videos/intro.mp4');

const FADE_IN_MS = 250;
const FADE_OUT_MS = 450;

/**
 * Full-screen video splash with smooth fade-in / fade-out transitions.
 * Plays muted (autoplay-safe on iOS / web) and covers the whole screen.
 *
 * Timing breakdown for the default `durationMs = 3000` ms:
 *   0 ms        → mounted, opacity 0
 *   0–250 ms    → fade-in to opacity 1
 *   250–2550 ms → fully visible
 *   2550–3000 ms→ fade-out to opacity 0
 *   3000 ms     → onDone() fires, parent unmounts the splash
 */
export default function VideoSplash({
  durationMs = 3000,
  onDone,
}: {
  durationMs?: number;
  onDone: () => void;
}) {
  const opacity = React.useRef(new Animated.Value(0)).current;
  const finishedRef = React.useRef(false);

  const player = useVideoPlayer(VIDEO_SOURCE, (p) => {
    try {
      p.loop = false;
      p.muted = true;
      p.play();
    } catch {}
  });

  React.useEffect(() => {
    // 1) Fade in immediately
    Animated.timing(opacity, {
      toValue: 1,
      duration: FADE_IN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // 2) Schedule fade-out so it finishes exactly at durationMs
    const fadeOutStart = Math.max(0, durationMs - FADE_OUT_MS);
    const fadeOutTimer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_OUT_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }, fadeOutStart);

    // 3) Notify parent right when the fade-out completes
    const doneTimer = setTimeout(() => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      try { player?.pause?.(); } catch {}
      onDone();
    }, durationMs);

    return () => {
      clearTimeout(fadeOutTimer);
      clearTimeout(doneTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs]);

  return (
    <Animated.View style={[styles.root, { opacity }]} pointerEvents="none">
      <VideoView
        player={player}
        style={styles.video}
        contentFit="cover"
        nativeControls={false}
        allowsFullscreen={false}
        allowsPictureInPicture={false}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    zIndex: 9999,
    elevation: 9999,
    ...Platform.select({ web: { overflow: 'hidden' as any } }),
  },
  video: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
});
