import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth';
import { colors, radius, spacing } from '../theme';

type Props = {
  title: string;
  subtitle?: string;
  rightAction?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void };
};

export default function ProHeader({ title, subtitle, rightAction }: Props) {
  const router = useRouter();
  const { tenant } = useAuth();
  return (
    <View style={styles.row}>
      <View style={styles.logo}>
        <Text style={styles.logoTxt}>{(tenant?.company_name || 'PRO').slice(0, 2).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {rightAction ? (
        <TouchableOpacity style={styles.iconBtn} onPress={rightAction.onPress}>
          <Ionicons name={rightAction.icon} size={20} color={colors.text} />
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        style={styles.iconBtn}
        onPress={() => router.push('/(pro)/menu' as any)}
        testID="pro-menu-btn"
      >
        <Ionicons name="menu" size={22} color={colors.text} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  logo: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  logoTxt: { color: colors.bg, fontWeight: '900', fontSize: 14, letterSpacing: 0.5 },
  title: { color: colors.text, fontSize: 18, fontWeight: '900', letterSpacing: -0.3 },
  subtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
  },
});
