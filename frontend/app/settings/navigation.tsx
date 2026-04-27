import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import { getNavProvider, setNavProvider, NavProvider } from '../../src/prefs';

type Option = {
  id: NavProvider;
  name: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
};

const OPTIONS: Option[] = [
  {
    id: 'google',
    name: 'Google Maps',
    sub: 'Itinéraires, trafic en temps réel, transports en commun',
    icon: 'map',
    color: '#4285F4',
  },
  {
    id: 'waze',
    name: 'Waze',
    sub: 'Alertes communautaires, radars, incidents routiers',
    icon: 'navigate',
    color: '#33CCFF',
  },
];

export default function NavigationScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<NavProvider>('google');

  useEffect(() => {
    (async () => {
      setSelected(await getNavProvider());
    })();
  }, []);

  const choose = async (id: NavProvider) => {
    setSelected(id);
    await setNavProvider(id);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Navigation</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        <View>
          <Text style={styles.h1}>GPS par défaut</Text>
          <Text style={styles.h2}>
            L’application utilisera ce GPS lorsque vous lancez la navigation depuis une mission.
          </Text>
        </View>

        <View style={{ gap: spacing.sm }}>
          {OPTIONS.map((o) => {
            const isSelected = selected === o.id;
            return (
              <TouchableOpacity
                key={o.id}
                activeOpacity={0.85}
                onPress={() => choose(o.id)}
                style={[styles.optCard, isSelected && styles.optCardActive]}
                testID={`nav-${o.id}`}
              >
                <View style={[styles.optIcon, { backgroundColor: o.color + '22' }]}>
                  <Ionicons name={o.icon} size={24} color={o.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optName}>{o.name}</Text>
                  <Text style={styles.optSub}>{o.sub}</Text>
                </View>
                <View
                  style={[
                    styles.radio,
                    isSelected && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}
                >
                  {isSelected ? <Ionicons name="checkmark" size={14} color={colors.bg} /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.hint}>
          Waze doit être installé sur votre téléphone pour être utilisé. Sinon, l’application ouvre Google Maps automatiquement.
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
  h2: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  optCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, padding: spacing.md,
  },
  optCardActive: { borderColor: colors.primary, backgroundColor: colors.primary + '10' },
  optIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  optName: { color: colors.text, fontSize: 17, fontWeight: '800' },
  optSub: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  hint: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: spacing.sm },
});
