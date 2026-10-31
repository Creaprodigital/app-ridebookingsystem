import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors } from '../theme';
import { splitAddress } from '../rideFormat';

/**
 * Pickup → destination with the vertical rail used across the app.
 * Each stop shows an optional small label ("Prise en charge · 20:49"), the
 * place name and, when `detailed`, the rest of the address underneath.
 */
export default function RouteStops({
  pickup,
  dropoff,
  pickupLabel,
  dropoffLabel,
  detailed = true,
  size = 'md',
}: {
  pickup: string;
  dropoff: string;
  pickupLabel?: string;
  dropoffLabel?: string;
  detailed?: boolean;
  size?: 'md' | 'lg';
}) {
  const p = splitAddress(pickup);
  const d = splitAddress(dropoff);
  const titleStyle = size === 'lg' ? styles.titleLg : styles.title;
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View style={styles.dotStart} />
        <View style={styles.line} />
        <View style={styles.dotEnd} />
      </View>
      <View style={styles.stops}>
        <View>
          {pickupLabel ? <Text style={styles.label}>{pickupLabel}</Text> : null}
          <Text style={titleStyle} numberOfLines={2}>{p.title}</Text>
          {detailed && p.detail ? <Text style={styles.detail} numberOfLines={1}>{p.detail}</Text> : null}
        </View>
        <View>
          {dropoffLabel ? <Text style={styles.label}>{dropoffLabel}</Text> : null}
          <Text style={titleStyle} numberOfLines={2}>{d.title}</Text>
          {detailed && d.detail ? <Text style={styles.detail} numberOfLines={1}>{d.detail}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  rail: { alignItems: 'center', paddingTop: 6, paddingBottom: 6 },
  dotStart: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  line: { width: 2, flex: 1, minHeight: 18, backgroundColor: colors.border, marginVertical: 4 },
  dotEnd: { width: 10, height: 10, borderRadius: 3, backgroundColor: colors.text },
  stops: { flex: 1, gap: 12 },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 2 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  titleLg: { color: colors.text, fontSize: 16, fontWeight: '700', lineHeight: 21 },
  detail: { color: colors.textMuted, fontSize: 12.5, fontWeight: '500', marginTop: 1 },
});
