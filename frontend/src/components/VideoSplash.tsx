import React from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '../theme';

const VIDEO_SOURCE = require('../../assets/videos/intro.mp4');

/**
 * Full-screen video splash that auto-dismisses after a fixed duration.
 * Plays muted (autoplay-safe on iOS / web) and covers the whole screen.
 *
 * @param durationMs how long to keep the splash up before calling onDone
 * @param onDone     invoked once the timer elapses
 */
export default function VideoSplash({
  durationMs = 3000,
  onDone,
}: {
  durationMs?: number;
  onDone: () => void;
}) {
  const player = useVideoPlayer(VIDEO_SOURCE, (p) => {
    try {
      p.loop = false;
      p.muted = true;
      p.play();
    } catch {}
  });

  React.useEffect(() => {
    const t = setTimeout(() => {
      try { player?.pause?.(); } catch {}
      onDone();
    }, durationMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs]);

  return (
    <View style={styles.root}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="cover"
        nativeControls={false}
        allowsFullscreen={false}
        allowsPictureInPicture={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    zIndex: 9999,
    elevation: 9999,
    // Avoid any hairline artefacts on the very edges of the screen
    ...Platform.select({ web: { overflow: 'hidden' as any } }),
  },
  video: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
});
