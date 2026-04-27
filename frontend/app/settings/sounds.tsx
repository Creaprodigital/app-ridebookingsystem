import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import { NOTIF_SOUNDS, getNotifSoundId, setNotifSoundId } from '../../src/prefs';

// Lazy-require expo-audio to avoid web crashes
let AudioModule: any = null;
try {
  // @ts-ignore
  AudioModule = require('expo-audio');
} catch {}

export default function SoundsScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<string>('classic');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playerRef = useRef<any>(null);
  const webAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    (async () => {
      const id = await getNotifSoundId();
      setSelected(id);
    })();
    return () => {
      try { playerRef.current?.remove?.(); } catch {}
      if (webAudioRef.current) {
        webAudioRef.current.pause();
        webAudioRef.current = null;
      }
    };
  }, []);

  const playPreview = useCallback(async (id: string, url: string) => {
    try {
      if (playingId === id) {
        // stop
        if (Platform.OS === 'web') webAudioRef.current?.pause();
        else playerRef.current?.pause?.();
        setPlayingId(null);
        return;
      }

      if (Platform.OS === 'web') {
        webAudioRef.current?.pause();
        const a = new Audio(url);
        webAudioRef.current = a;
        a.onended = () => setPlayingId(null);
        a.onerror = () => setPlayingId(null);
        await a.play();
        setPlayingId(id);
        return;
      }

      // native
      if (!AudioModule?.createAudioPlayer) return;
      try { playerRef.current?.remove?.(); } catch {}
      const p = AudioModule.createAudioPlayer({ uri: url });
      playerRef.current = p;
      p.addListener?.('playbackStatusUpdate', (s: any) => {
        if (s?.didJustFinish) setPlayingId(null);
      });
      p.play?.();
      setPlayingId(id);
    } catch {
      setPlayingId(null);
    }
  }, [playingId]);

  const choose = async (id: string, url: string) => {
    setSelected(id);
    await setNotifSoundId(id);
    playPreview(id, url);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Sons</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        <View>
          <Text style={styles.h1}>Son de notification</Text>
          <Text style={styles.h2}>Appuyez pour écouter un aperçu et sélectionner</Text>
        </View>

        <View style={styles.card}>
          {NOTIF_SOUNDS.map((s, i) => {
            const isSelected = selected === s.id;
            const isPlaying = playingId === s.id;
            return (
              <View key={s.id} style={[styles.row, i < NOTIF_SOUNDS.length - 1 && styles.rowBorder]}>
                <TouchableOpacity
                  onPress={() => playPreview(s.id, s.url)}
                  style={styles.playBtn}
                  testID={`sound-play-${s.id}`}
                >
                  {isPlaying ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : (
                    <Ionicons name="play" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.rowLabelWrap}
                  onPress={() => choose(s.id, s.url)}
                  testID={`sound-select-${s.id}`}
                >
                  <Text style={styles.rowLabel}>{s.name}</Text>
                  <Text style={styles.rowSub}>{isSelected ? 'Sélectionné' : 'Appuyer pour sélectionner'}</Text>
                </TouchableOpacity>

                <View
                  style={[
                    styles.radio,
                    isSelected && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}
                >
                  {isSelected ? <Ionicons name="checkmark" size={14} color={colors.bg} /> : null}
                </View>
              </View>
            );
          })}
        </View>

        <Text style={styles.hint}>
          Ce son sera joué lors de la réception d’une nouvelle course. Les notifications doivent être activées dans les autorisations.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  topTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 16, fontWeight: '800' },
  h1: { color: colors.text, fontSize: 22, fontWeight: '800' },
  h2: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.md, paddingVertical: 14 },
  rowBorder: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabelWrap: { flex: 1 },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  playBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center',
  },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  hint: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
});
