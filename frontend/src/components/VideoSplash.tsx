import React from 'react';
import { Animated, StyleSheet, Platform, Easing } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '../theme';

// Web Chromium / open-source Chromium builds do NOT ship the proprietary
// H.264 (avc1) codec — they raise "DEMUXER_ERROR_NO_SUPPORTED_STREAMS" when
// asked to play an MP4. We therefore embed a VP9/Opus WebM variant for web
// and keep the smaller MP4 for native (iOS/Android both ship H.264).
const VIDEO_SOURCE =
  Platform.OS === 'web'
    ? require('../../assets/videos/intro.webm')
    : require('../../assets/videos/intro.mp4');

const FADE_IN_MS = 250;
const FADE_OUT_MS = 450;

/**
 * Full-screen video splash with smooth fade-in / fade-out transitions.
 * Plays muted (autoplay-safe on iOS / web) and covers the whole screen.
 *
 * Default timing breakdown for `durationMs = 5200` ms:
 *   0–250 ms     → fade-in to opacity 1
 *   250–4750 ms  → fully visible (4500 ms)
 *   4750–5200 ms → fade-out to opacity 0
 *   5200 ms      → onDone() fires, parent unmounts the splash
 */
export default function VideoSplash({
  durationMs = 5200,
  onDone,
}: {
  durationMs?: number;
  onDone: () => void;
}) {
  const opacity = React.useRef(new Animated.Value(0)).current;
  const finishedRef = React.useRef(false);

  const player = useVideoPlayer(VIDEO_SOURCE, (p) => {
    try {
      // The clip is 3s but we keep it visible longer — loop so we never show
      // a frozen last frame during the visible window.
      p.loop = true;
      p.muted = true;
      // Some platforms ignore play() inside the setup callback because the
      // underlying surface isn't attached yet. We still trigger it here to
      // start buffering as soon as the player is created.
      p.play();
    } catch {}
  });

  // Force-start playback once the component is mounted and the VideoView
  // surface is attached. This is the reliable trigger on iOS/Android/web
  // when autoplay was suppressed during initial player creation.
  React.useEffect(() => {
    if (!player) return;
    const tryPlay = () => { try { player.play(); } catch {} };
    // Kick off right away…
    tryPlay();
    // …then retry shortly after to cover slow surface attachment.
    const t1 = setTimeout(tryPlay, 120);
    const t2 = setTimeout(tryPlay, 400);

    // Also retry whenever the player's status changes to a state where
    // playback is possible (e.g. switches from "loading" → "readyToPlay").
    let sub: any = null;
    try {
      sub = player.addListener?.('statusChange', (ev: any) => {
        const status = ev?.status ?? ev;
        if (status === 'readyToPlay' || status === 'idle' || status === 'ready') {
          tryPlay();
        }
      });
    } catch {}

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      try { sub?.remove?.(); } catch {}
    };
  }, [player]);

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
    <Animated.View style={[styles.root, { opacity }]}>
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
    pointerEvents: 'none',
    ...Platform.select({ web: { overflow: 'hidden' as any } }),
  },
  video: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
});
