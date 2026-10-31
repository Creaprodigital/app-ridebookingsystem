import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, Alert } from 'react-native';
import { Text } from '../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getNotifications,
  markAllRead,
  clearAll,
  subscribe,
  NotifEntry,
} from '../src/notificationsHistory';
import { colors, radius, spacing } from '../src/theme';

const ICONS: Record<string, any> = {
  new_ride: 'flash',
  ride_assigned: 'car',
  ride_completed: 'checkmark-circle',
  reminder: 'time',
  system: 'information-circle',
};

const COLORS_MAP: Record<string, string> = {
  new_ride: colors.primary,
  ride_assigned: colors.info,
  ride_completed: colors.success,
  reminder: colors.warning,
  system: colors.textSecondary,
};

function fmt(s?: string) {
  if (!s) return '';
  try {
    const d = new Date(s);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'à l’instant';
    if (diff < 3600000) return `il y a ${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return `il y a ${Math.floor(diff / 3600000)} h`;
    return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return s;
  }
}

export default function NotificationsHistoryScreen() {
  const router = useRouter();
  const [list, setList] = useState<NotifEntry[]>([]);

  const refresh = useCallback(async () => {
    const items = await getNotifications();
    setList(items);
  }, []);

  useFocusEffect(useCallback(() => {
    refresh();
    // mark as read once we visit
    markAllRead().then(refresh);
  }, [refresh]));

  useEffect(() => {
    const unsub = subscribe((items) => setList(items));
    return unsub;
  }, []);

  const onClear = () => {
    Alert.alert(
      'Effacer l’historique ?',
      'Toutes les notifications seront supprimées de cet appareil.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Tout effacer',
          style: 'destructive',
          onPress: async () => {
            await clearAll();
            refresh();
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Notifications</Text>
        <TouchableOpacity
          onPress={onClear}
          style={styles.iconBtn}
          testID="clear-history-btn"
        >
          <Ionicons name="trash-outline" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      {list.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="notifications-off-outline" size={36} color={colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>Aucune notification</Text>
          <Text style={styles.emptySub}>
            Vous verrez ici l’historique de toutes vos courses, rappels et alertes système.
          </Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: 60 }}
          renderItem={({ item }) => {
            const icon = ICONS[item.type] ?? 'notifications';
            const color = COLORS_MAP[item.type] ?? colors.primary;
            return (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  if (item.ride_id) router.push('/(tabs)/missions');
                }}
                style={[styles.row, !item.read && styles.rowUnread]}
                testID={`notif-${item.id}`}
              >
                <View style={[styles.rowIcon, { backgroundColor: color + '22' }]}>
                  <Ionicons name={icon} size={18} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowHead}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                    {!item.read ? <View style={styles.unreadDot} /> : null}
                  </View>
                  {item.body ? (
                    <Text style={styles.rowBody} numberOfLines={2}>{item.body}</Text>
                  ) : null}
                  <View style={styles.rowFoot}>
                    <Text style={styles.rowDate}>{fmt(item.created_at)}</Text>
                    {item.amount != null ? (
                      <Text style={[styles.rowAmount, { color }]}>+{item.amount.toFixed(2)} €</Text>
                    ) : null}
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  emptySub: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  row: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  rowUnread: { borderColor: colors.primary + '88' },
  rowIcon: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '800', flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  rowBody: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  rowFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  rowDate: { color: colors.textMuted, fontSize: 11 },
  rowAmount: { fontSize: 13, fontWeight: '800' },
});
