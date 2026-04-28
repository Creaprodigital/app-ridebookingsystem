import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import { getImmediateEnabled } from '../../src/prefs';
import { useRides } from '../../src/ridesContext';
import { haptic } from '../../src/feedback';

export default function ImmediateRideSettings() {
  const router = useRouter();
  const { setImmediateModeEnabled } = useRides();
  const [enabled, setEnabled] = useState<boolean>(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const v = await getImmediateEnabled();
      setEnabled(v);
      setLoaded(true);
    })();
  }, []);

  const onToggle = async (next: boolean) => {
    haptic('light');
    setEnabled(next);
    await setImmediateModeEnabled(next);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Course immédiate</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        <Text style={styles.subtitle}>
          Choisissez si vous souhaitez recevoir les demandes de courses immédiates
          (départ maintenant) sous la forme d’un écran prioritaire style appel entrant.
        </Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="flash" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Recevoir les courses immédiates</Text>
              <Text style={styles.rowSub}>
                {enabled
                  ? 'Activé · Une carte plein écran s’affichera dès qu’une course immédiate arrive'
                  : 'Désactivé · Vous recevrez uniquement les réservations planifiées dans l’onglet Missions'}
              </Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={onToggle}
              disabled={!loaded}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor={enabled ? '#fff' : colors.textMuted}
              testID="immediate-toggle"
            />
          </View>
        </View>

        <View style={styles.card}>
          <View style={[styles.row, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
            <View style={styles.rowIcon}>
              <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Réservations planifiées</Text>
              <Text style={styles.rowSub}>
                Toujours visibles dans l’onglet « Missions → Planifiées ».
                Vous les acceptez manuellement.
              </Text>
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Bon à savoir</Text>
              <Text style={styles.rowSub}>
                Vous devez toujours <Text style={{ fontWeight: '900' }}>accepter ou refuser</Text> chaque
                course manuellement. Aucune assignation automatique n’est faite à votre place.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  topTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 16, fontWeight: '800' },
  subtitle: { color: colors.textSecondary, fontSize: 13 },
  card: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  rowIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
});
