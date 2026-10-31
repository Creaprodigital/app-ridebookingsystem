import React, { useCallback, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Platform, Alert } from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { colors, radius, spacing, shadow } from '../../src/theme';
import { useAuth } from '../../src/auth';
import { useDriverSubscription } from '../../src/driverSubscription';
import { getDriverProfile } from '../../src/api';
import { getNotifications, subscribe } from '../../src/notificationsHistory';
import { fmtEuro } from '../../src/rideFormat';

type Row = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  onPress: () => void;
  testID?: string;
};

function initials(first?: string, last?: string, email?: string) {
  const s = `${(first || '').trim()[0] || ''}${(last || '').trim()[0] || ''}`;
  return (s || (email || '?')[0] || '?').toUpperCase();
}

export default function AccountScreen() {
  const router = useRouter();
  const { signOut, user } = useAuth();
  const { state: subState, needsPayment: subNeedsPayment } = useDriverSubscription();
  const [profile, setProfile] = useState<any>(null);
  const [unread, setUnread] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getDriverProfile().then((p) => alive && setProfile(p)).catch(() => {});
      getNotifications().then((items) => alive && setUnread(items.filter((e) => !e.read).length));
      const unsub = subscribe((items) => alive && setUnread(items.filter((e) => !e.read).length));
      return () => { alive = false; unsub(); };
    }, []),
  );

  const confirmLogout = () => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Se déconnecter ?')) signOut();
    } else {
      Alert.alert('Déconnexion', 'Souhaitez-vous vraiment vous déconnecter ?', [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Déconnexion', style: 'destructive', onPress: signOut },
      ]);
    }
  };

  const p = profile?.user ?? profile ?? {};
  const first = p.first_name || user?.first_name;
  const last = p.last_name || user?.last_name;
  const name = [first, last].filter(Boolean).join(' ') || user?.email || 'Mon compte';
  const vehicle = p.vehicle || p.car || {};
  const vehicleLine = [
    vehicle.model || vehicle.make || p.vehicle_model,
    vehicle.plate || vehicle.license_plate || p.license_plate,
  ].filter(Boolean).join(' · ');
  const rating = p.rating ?? p.avg_rating;

  const nextBilling = subState.nextBillingAt
    ? new Date(subState.nextBillingAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
    : null;
  const subActive = subState.status === 'active' || subState.status === 'trialing';
  const subLine = subNeedsPayment
    ? 'Paiement requis pour recevoir des courses'
    : subActive
      ? [
          subState.monthlyAmountCents ? `${fmtEuro(subState.monthlyAmountCents / 100, 0)}/mois` : null,
          nextBilling ? `prochain prélèvement le ${nextBilling}` : null,
        ].filter(Boolean).join(' · ') || 'Abonnement actif'
      : 'Gérer mon abonnement';

  const activity: Row[] = [
    {
      icon: 'notifications-outline',
      label: 'Notifications',
      sub: unread > 0 ? `${unread} nouvelle${unread > 1 ? 's' : ''}` : 'Courses et alertes reçues',
      onPress: () => router.push('/notifications' as any),
      testID: 'menu-notifications',
    },
    {
      icon: 'time-outline',
      label: 'Historique des courses',
      sub: 'Courses terminées et chiffre d’affaires',
      onPress: () => router.push('/(tabs)/history' as any),
      testID: 'menu-history',
    },
  ];

  const settings: Row[] = [
    {
      icon: 'flash-outline',
      label: 'Courses immédiates',
      sub: 'Réception en plein écran, rayon',
      onPress: () => router.push('/settings/immediate' as any),
      testID: 'menu-immediate',
    },
    {
      icon: 'navigate-outline',
      label: 'Navigation',
      sub: 'Google Maps ou Waze',
      onPress: () => router.push('/settings/navigation' as any),
      testID: 'menu-navigation',
    },
    {
      icon: 'musical-notes-outline',
      label: 'Sons',
      sub: 'Sonnerie des nouvelles courses',
      onPress: () => router.push('/settings/sounds' as any),
      testID: 'menu-sounds',
    },
    {
      icon: 'notifications-circle-outline',
      label: 'Notifications push',
      sub: 'Alertes quand l’app est fermée',
      onPress: () => router.push('/settings/notifications' as any),
      testID: 'menu-push',
    },
    {
      icon: 'shield-checkmark-outline',
      label: 'Autorisations',
      sub: 'Position, notifications, caméra…',
      onPress: () => router.push('/settings/permissions' as any),
      testID: 'menu-permissions',
    },
    {
      icon: 'settings-outline',
      label: 'Tous les paramètres',
      onPress: () => router.push('/settings'),
      testID: 'menu-settings',
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h1}>Compte</Text>

        <TouchableOpacity
          style={styles.profileCard}
          activeOpacity={0.8}
          onPress={() => router.push('/profile')}
          testID="menu-profile"
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>{initials(first, last, user?.email)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            <Text style={styles.profileSub} numberOfLines={1}>
              {vehicleLine || 'Voir mon profil'}
            </Text>
          </View>
          {rating != null ? (
            <View style={styles.rating}>
              <Ionicons name="star" size={12} color={colors.warning} />
              <Text style={styles.ratingTxt}>{Number(rating).toFixed(1).replace('.', ',')}</Text>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {subState.enabled ? (
          <TouchableOpacity
            style={[styles.subCard, subNeedsPayment && styles.subCardAlert]}
            activeOpacity={0.8}
            onPress={() => router.push('/subscription' as any)}
            testID="menu-subscription"
          >
            <View
              style={[
                styles.iconBox,
                { backgroundColor: subNeedsPayment ? colors.dangerSoft : subActive ? colors.successSoft : colors.surface2 },
              ]}
            >
              <Ionicons
                name={subNeedsPayment ? 'alert-circle' : subActive ? 'checkmark-circle' : 'card-outline'}
                size={20}
                color={subNeedsPayment ? colors.danger : subActive ? colors.success : colors.textSecondary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, subNeedsPayment && { color: colors.danger }]}>
                {subNeedsPayment ? 'Abonnement requis' : subActive ? 'Abonnement actif' : 'Mon abonnement'}
              </Text>
              <Text style={styles.rowSub}>{subLine}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}

        <Section title="Activité" rows={activity} />
        <Section title="Réglages" rows={settings} />

        <TouchableOpacity style={styles.logout} onPress={confirmLogout} testID="menu-logout">
          <Ionicons name="log-out-outline" size={20} color={colors.danger} />
          <Text style={styles.logoutTxt}>Se déconnecter</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>
          RideBookingSystem · version {Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>
        {rows.map((r, i) => (
          <TouchableOpacity
            key={r.label}
            onPress={r.onPress}
            activeOpacity={0.7}
            style={[styles.row, i < rows.length - 1 && styles.rowBorder]}
            testID={r.testID}
          >
            <View style={styles.iconBox}>
              <Ionicons name={r.icon} size={19} color={colors.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{r.label}</Text>
              {r.sub ? <Text style={styles.rowSub} numberOfLines={1}>{r.sub}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40, gap: 12 },
  h1: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5, marginBottom: 4 },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, ...shadow,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarTxt: { color: colors.onPrimary, fontSize: 20, fontWeight: '800' },
  name: { color: colors.text, fontSize: 18, fontWeight: '700' },
  profileSub: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  rating: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.warningSoft, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999,
  },
  ratingTxt: { color: colors.warning, fontSize: 12.5, fontWeight: '800' },
  subCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, ...shadow,
  },
  subCardAlert: { borderColor: colors.danger },
  sectionTitle: { color: colors.textMuted, fontSize: 13, fontWeight: '700', marginTop: 8, marginLeft: 4 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden', ...shadow,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: spacing.md, paddingVertical: 13 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBox: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: colors.textSecondary, fontSize: 12.5, marginTop: 1 },
  logout: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, marginTop: 4,
  },
  logoutTxt: { color: colors.danger, fontSize: 15, fontWeight: '700' },
  footer: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
});
