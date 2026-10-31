import React, { useCallback, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import ProHeader from '../../src/components/ProHeader';
import { useProNotifications, ProNotif, getKindIcon } from '../../src/proNotifications';

function fmtAgo(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'à l’instant';
  const m = Math.floor(diff / 60000);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { notifications, unreadCount, markRead, markAllRead, clear, refreshNow } = useProNotifications();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshNow();
    setRefreshing(false);
  }, [refreshNow]);

  const onClear = () => {
    Alert.alert(
      'Effacer toutes les notifications',
      'Cette action est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Effacer', style: 'destructive', onPress: clear },
      ],
    );
  };

  const onTap = (n: ProNotif) => {
    markRead(n.id);
    if (n.link) {
      try { router.push(n.link as any); } catch {}
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ProHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} non lue${unreadCount > 1 ? 's' : ''}` : 'Tout est à jour'}
      />
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actBtn, unreadCount === 0 && { opacity: 0.4 }]}
          disabled={unreadCount === 0}
          onPress={markAllRead}
        >
          <Ionicons name="checkmark-done" size={14} color={colors.primary} />
          <Text style={styles.actBtnTxt}>Tout marquer lu</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actBtn, notifications.length === 0 && { opacity: 0.4 }]}
          disabled={notifications.length === 0}
          onPress={onClear}
        >
          <Ionicons name="trash-outline" size={14} color={colors.danger} />
          <Text style={[styles.actBtnTxt, { color: colors.danger }]}>Effacer tout</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={notifications}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 100, gap: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={42} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Aucune notification</Text>
            <Text style={styles.emptySub}>
              Les changements de statut de courses et l’activité des chauffeurs
              s’afficheront ici en temps réel.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, !item.read && styles.cardUnread]}
            onPress={() => onTap(item)}
            activeOpacity={0.8}
          >
            <View style={styles.emojiCircle}>
              <Text style={styles.emoji}>{getKindIcon(item.kind)}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={styles.titleRow}>
                <Text style={[styles.title, !item.read && { fontWeight: '900' }]}>{item.title}</Text>
                {!item.read ? <View style={styles.unreadDot} /> : null}
              </View>
              {item.body ? <Text style={styles.body} numberOfLines={2}>{item.body}</Text> : null}
              <Text style={styles.ts}>{fmtAgo(item.ts)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  actionRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  actBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 8, backgroundColor: colors.surface,
    borderColor: colors.border, borderWidth: 1, borderRadius: radius.full,
  },
  actBtnTxt: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  emptySub: { color: colors.textSecondary, fontSize: 12, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, padding: spacing.md,
  },
  cardUnread: { backgroundColor: colors.primary + '12', borderColor: colors.primary + '55' },
  emojiCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  emoji: { fontSize: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: colors.text, fontSize: 13, fontWeight: '800', flex: 1 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  body: { color: colors.textSecondary, fontSize: 12 },
  ts: { color: colors.textMuted, fontSize: 11, marginTop: 2, fontWeight: '600' },
});
