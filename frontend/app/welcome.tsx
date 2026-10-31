import React from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Text } from '../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, spacing, shadow, isDark } from '../src/theme';

const LOGO = isDark
  ? require('../assets/images/logo-horizontal-dark.png')
  : require('../assets/images/logo-horizontal.png');
const MARK = require('../assets/images/logo-mark.png');

export default function Welcome() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <Image source={LOGO} style={styles.logo} resizeMode="contain" />

        <View style={styles.hero}>
          <View style={styles.markWrap}>
            <Image source={MARK} style={styles.mark} resizeMode="contain" />
          </View>
          <Text style={styles.title}>Bienvenue</Text>
          <Text style={styles.subtitle}>Choisissez votre espace pour vous connecter.</Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push('/login?role=driver' as any)}
            activeOpacity={0.85}
            testID="welcome-driver"
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.primary }]}>
              <Ionicons name="car" size={24} color={colors.onPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Je suis chauffeur</Text>
              <Text style={styles.cardSub}>Recevez et réalisez vos courses</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push('/login?role=pro' as any)}
            activeOpacity={0.85}
            testID="welcome-pro"
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="git-network-outline" size={24} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Je suis dispatcheur</Text>
              <Text style={styles.cardSub}>Gérez vos réservations et vos chauffeurs</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>© {new Date().getFullYear()} RideBookingSystem</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  logo: { width: 220, height: 30, marginTop: spacing.lg },
  hero: { flex: 1, justifyContent: 'center' },
  markWrap: {
    width: 76, height: 76, borderRadius: 22, backgroundColor: '#071731',
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
  },
  mark: { width: 46, height: 34 },
  title: { color: colors.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: colors.textSecondary, fontSize: 16, marginTop: 6, lineHeight: 22 },
  actions: { gap: 12, marginBottom: spacing.lg },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, ...shadow,
  },
  iconWrap: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: colors.text, fontSize: 16.5, fontWeight: '700' },
  cardSub: { color: colors.textSecondary, fontSize: 13.5, marginTop: 2 },
  footer: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
});
