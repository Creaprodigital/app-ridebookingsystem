import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ImageBackground } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../src/theme';

const WELCOME_BG = require('../assets/images/login-bg.png');

export default function Welcome() {
  const router = useRouter();
  return (
    <ImageBackground source={WELCOME_BG} resizeMode="cover" style={styles.bg}>
      <View style={styles.overlay} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.container}>
        <View style={styles.brandWrap}>
          <View style={styles.logo}>
            <Ionicons name="car-sport" size={42} color={colors.bg} />
          </View>
          <Text style={styles.title}>Ride Booking</Text>
          <Text style={styles.kicker}>SYSTEM</Text>
          <Text style={styles.subtitle}>Choisissez votre type de compte pour vous connecter</Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.cardPrimary}
            onPress={() => router.push('/login?role=pro' as any)}
            activeOpacity={0.85}
            testID="welcome-pro"
          >
            <View style={styles.cardIconWrap}>
              <Ionicons name="git-network-outline" size={26} color={colors.bg} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitlePrimary}>Connexion Dispatcheur</Text>
              <Text style={styles.cardSubPrimary}>Espace professionnel — gestion des courses</Text>
            </View>
            <Ionicons name="arrow-forward" size={22} color={colors.bg} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cardSecondary}
            onPress={() => router.push('/login?role=driver' as any)}
            activeOpacity={0.85}
            testID="welcome-driver"
          >
            <View style={[styles.cardIconWrap, { backgroundColor: colors.primary + '22' }]}>
              <Ionicons name="car-outline" size={26} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitleSecondary}>Connexion Chauffeur</Text>
              <Text style={styles.cardSubSecondary}>Application chauffeur — réceptionner des courses</Text>
            </View>
            <Ionicons name="arrow-forward" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>© {new Date().getFullYear()} Ride Booking System</Text>
      </View>
    </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, width: '100%', height: '100%', backgroundColor: colors.bg },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
  safe: { flex: 1, backgroundColor: 'transparent' },
  container: { flex: 1, padding: spacing.lg, justifyContent: 'space-between' },
  brandWrap: { alignItems: 'center', marginTop: spacing.xl, gap: 6 },
  logo: {
    width: 86, height: 86, borderRadius: 43, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: 36, fontWeight: '900', letterSpacing: -1 },
  kicker: { color: colors.primary, fontSize: 13, fontWeight: '900', letterSpacing: 5 },
  subtitle: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.lg },
  actions: { gap: spacing.md, marginBottom: spacing.lg },
  cardPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.primary, borderRadius: radius.xl, padding: spacing.lg,
  },
  cardIconWrap: {
    width: 50, height: 50, borderRadius: 16,
    backgroundColor: '#00000020', alignItems: 'center', justifyContent: 'center',
  },
  cardTitlePrimary: { color: colors.bg, fontSize: 16, fontWeight: '900' },
  cardSubPrimary: { color: colors.bg, fontSize: 12, fontWeight: '600', opacity: 0.8, marginTop: 2 },
  cardSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: 'rgba(20, 20, 20, 0.78)', borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.xl, padding: spacing.lg,
  },
  cardTitleSecondary: { color: colors.text, fontSize: 16, fontWeight: '900' },
  cardSubSecondary: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  footer: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },
});
