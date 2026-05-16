import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import ProHeader from '../../src/components/ProHeader';
import { useAuth } from '../../src/auth';
import { useProNotifications } from '../../src/proNotifications';

type Item = { icon: keyof typeof Ionicons.glyphMap; label: string; sub?: string; onPress: () => void; badge?: string };

export default function ProMenu() {
  const router = useRouter();
  const { user, tenant, signOut } = useAuth();
  const { unreadCount } = useProNotifications();

  const mocked = (title: string) => () => Alert.alert(title, 'Cette fonctionnalité sera disponible prochainement (MOCKÉE pour la Phase 1).');

  const items: Item[] = [
    { icon: 'list-outline', label: 'Historique des courses', sub: 'Toutes les courses terminées', onPress: mocked('Historique') },
    {
      icon: 'notifications-outline',
      label: 'Notifications',
      sub: unreadCount > 0 ? `${unreadCount} non lue${unreadCount > 1 ? 's' : ''}` : 'Centre de notifications',
      badge: unreadCount > 0 ? String(unreadCount) : undefined,
      onPress: () => router.push('/(pro)/notifications' as any),
    },
    { icon: 'chatbubbles-outline', label: 'Chat interne', sub: 'Dispatcher ↔ chauffeurs', badge: 'MOCK', onPress: mocked('Chat interne') },
    { icon: 'settings-outline', label: 'Paramètres pro', sub: 'Tarification, widget, marketplace', onPress: mocked('Paramètres pro') },
    { icon: 'shield-checkmark-outline', label: 'Rôles & permissions', sub: 'Admin / Dispatcher / Superviseur', badge: 'MOCK', onPress: mocked('Rôles') },
    { icon: 'help-circle-outline', label: 'Support', onPress: mocked('Support') },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ProHeader title="Menu" subtitle={tenant?.company_name || 'Espace pro'} />
      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 100 }}>
        {/* Profile card */}
        <View style={styles.profile}>
          <View style={styles.avatar}><Text style={styles.avatarTxt}>{(user?.first_name?.[0] || 'P').toUpperCase()}{(user?.last_name?.[0] || '').toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.first_name} {user?.last_name}</Text>
            <Text style={styles.email}>{user?.email}</Text>
            <View style={styles.rolePill}><Text style={styles.rolePillTxt}>Compte professionnel</Text></View>
          </View>
        </View>

        {/* Menu items */}
        <View style={styles.list}>
          {items.map((it) => (
            <TouchableOpacity key={it.label} style={styles.row} onPress={it.onPress}>
              <View style={styles.icon}><Ionicons name={it.icon} size={20} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{it.label}</Text>
                {it.sub ? <Text style={styles.rowSub}>{it.sub}</Text> : null}
              </View>
              {it.badge ? <View style={styles.badge}><Text style={styles.badgeTxt}>{it.badge}</Text></View> : null}
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logout} onPress={async () => { await signOut(); router.replace('/login'); }}>
          <Ionicons name="log-out-outline" size={20} color={colors.danger} />
          <Text style={styles.logoutTxt}>Déconnexion</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>HOPPLA Pro • Phase 1 MVP</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: colors.bg, fontSize: 18, fontWeight: '900' },
  name: { color: colors.text, fontSize: 16, fontWeight: '900' },
  email: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  rolePill: { alignSelf: 'flex-start', backgroundColor: colors.primary + '22', borderColor: colors.primary, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, marginTop: 6 },
  rolePillTxt: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },
  list: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  icon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center' },
  rowLabel: { color: colors.text, fontSize: 14, fontWeight: '800' },
  rowSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  badge: { backgroundColor: colors.warning + '22', borderColor: colors.warning, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  badgeTxt: { color: colors.warning, fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: colors.danger + '15', borderColor: colors.danger, borderWidth: 1, borderRadius: radius.full },
  logoutTxt: { color: colors.danger, fontSize: 14, fontWeight: '900', letterSpacing: 0.6 },
  footer: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: spacing.md },
});
