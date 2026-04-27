import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import { useAuth } from '../../src/auth';
import { getDriverProfile } from '../../src/api';

function initials(first?: string, last?: string) {
  return `${(first?.[0] || '').toUpperCase()}${(last?.[0] || '').toUpperCase()}` || 'D';
}

export default function Profile() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await getDriverProfile();
      setProfile(p);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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

  const firstName = profile?.first_name || user?.first_name || '';
  const lastName = profile?.last_name || user?.last_name || '';
  const email = profile?.email || user?.email || '';
  const phone = profile?.phone || profile?.phone_number || '';
  const rating = profile?.rating ?? profile?.avg_rating;
  const vehicle = profile?.vehicle || profile?.car || {};

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 120, gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
      >
        <View style={styles.heroCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>{initials(firstName, lastName)}</Text>
          </View>
          <Text style={styles.name} testID="profile-name">
            {firstName || lastName ? `${firstName} ${lastName}`.trim() : 'Driver'}
          </Text>
          <Text style={styles.email} testID="profile-email">{email}</Text>
          {rating != null ? (
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={14} color={colors.primary} />
              <Text style={styles.ratingTxt}>{Number(rating).toFixed(2)}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Contact</Text>
        <View style={styles.card}>
          <Row icon="call-outline" label="Téléphone" value={phone || '—'} />
          <Row icon="mail-outline" label="Email" value={email || '—'} />
        </View>

        <Text style={styles.sectionTitle}>Véhicule</Text>
        <View style={styles.card}>
          <Row icon="car-outline" label="Modèle" value={
            vehicle?.model || vehicle?.make || profile?.vehicle_model || '—'
          } />
          <Row icon="pricetag-outline" label="Plaque" value={
            vehicle?.plate || vehicle?.license_plate || profile?.license_plate || '—'
          } />
          <Row icon="color-palette-outline" label="Couleur" value={vehicle?.color || '—'} />
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout} testID="logout-button">
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={styles.logoutTxt}>DÉCONNEXION</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>SharedRide Driver · v1.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={16} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  heroCard: {
    alignItems: 'center', gap: 8,
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.xl, padding: spacing.lg,
  },
  avatar: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 0 },
  },
  avatarTxt: { color: colors.bg, fontSize: 30, fontWeight: '900' },
  name: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 4 },
  email: { color: colors.textSecondary, fontSize: 13 },
  ratingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.bg, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.full, marginTop: 6, borderWidth: 1, borderColor: colors.border,
  },
  ratingTxt: { color: colors.text, fontSize: 12, fontWeight: '800' },
  sectionTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  card: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: spacing.md, paddingVertical: 14,
    borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  rowValue: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 2 },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: colors.danger + '1A', borderColor: colors.danger, borderWidth: 1,
    borderRadius: radius.full, height: 52, marginTop: spacing.sm,
  },
  logoutTxt: { color: colors.danger, fontWeight: '900', letterSpacing: 1.2 },
  footer: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: spacing.md },
});
