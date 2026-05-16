import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import { useAuth } from '../../src/auth';

type Row = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  onPress: () => void;
  testID?: string;
  danger?: boolean;
};

export default function MenuScreen() {
  const router = useRouter();
  const { signOut, user } = useAuth();

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

  const account: Row[] = [
    {
      icon: 'person-circle-outline',
      label: 'Mon profil',
      sub: 'Infos personnelles, véhicule, notation',
      onPress: () => router.push('/profile'),
      testID: 'menu-profile',
    },
    {
      icon: 'notifications-outline',
      label: 'Notifications',
      sub: 'Historique des courses & alertes',
      onPress: () => router.push('/notifications' as any),
      testID: 'menu-notifications',
    },
  ];

  const app: Row[] = [
    {
      icon: 'settings-outline',
      label: 'Paramètres de l’application',
      sub: 'Sons, navigation, autorisations',
      onPress: () => router.push('/settings'),
      testID: 'menu-settings',
    },
  ];

  const session: Row[] = [
    {
      icon: 'log-out-outline',
      label: 'Déconnexion',
      onPress: confirmLogout,
      testID: 'menu-logout',
      danger: true,
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 120, gap: spacing.md }}>
        <View>
          <Text style={styles.h1}>Menu</Text>
          <Text style={styles.h2}>
            {user?.first_name ? `Bonjour, ${user.first_name}` : 'Vos options et réglages'}
          </Text>
        </View>

        <Section title="Compte" rows={account} />
        <Section title="Application" rows={app} />
        <Section title="Session" rows={session} />

        <Text style={styles.footer}>Ridebookingsystem V1.0</Text>
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
            <View
              style={[
                styles.rowIcon,
                { backgroundColor: (r.danger ? colors.danger : colors.primary) + '22' },
              ]}
            >
              <Ionicons name={r.icon} size={18} color={r.danger ? colors.danger : colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, r.danger && { color: colors.danger }]}>{r.label}</Text>
              {r.sub ? <Text style={styles.rowSub}>{r.sub}</Text> : null}
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={r.danger ? colors.danger : colors.textMuted}
            />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  h1: { color: colors.text, fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  h2: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  sectionTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  card: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  rowBorder: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  footer: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: spacing.md },
});
