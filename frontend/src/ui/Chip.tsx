import React from 'react';
import { View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors } from '../theme';

export type ChipTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

const TONES: Record<ChipTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.surface2, fg: colors.textSecondary },
  primary: { bg: colors.primarySoft, fg: colors.primary },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
};

/** Small rounded label: status, vehicle, passengers, payment… */
export default function Chip({
  label,
  icon,
  tone = 'neutral',
  style,
  testID,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: ChipTone;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }, style]} testID={testID}>
      {icon ? <Ionicons name={icon} size={13} color={t.fg} /> : null}
      <Text style={[styles.label, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  label: { fontSize: 12, fontWeight: '700' },
});
