import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../src/theme';
import ProHeader from '../../src/components/ProHeader';
import MapView from '../../src/components/MapView';
import { getProDrivers, ProDriver } from '../../src/proApi';

const POLL_MS = 10000;

function driverName(d: ProDriver) {
  return `${d.first_name || ''} ${d.last_name || ''}`.trim() || d.email || d.id.slice(0,6);
}

export default function ProMapScreen() {
  const [drivers, setDrivers] = useState<ProDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<any>(null);

  const load = async () => {
    try {
      const d = await getProDrivers();
      setDrivers(d);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const markers = useMemo(() => {
    return drivers
      .filter((d) => d.last_location && Number.isFinite(d.last_location.lat) && Number.isFinite(d.last_location.lng))
      .map((d) => ({
        lat: d.last_location!.lat,
        lng: d.last_location!.lng,
        color: d.on_shift ? colors.success : colors.textMuted,
        label: (d.first_name?.[0] || 'C').toUpperCase(),
      }));
  }, [drivers]);

  const center = markers[0] || { lat: 48.8566, lng: 2.3522 };
  const onShift = drivers.filter((d) => d.on_shift).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ProHeader title="Carte temps réel" subtitle={`${onShift}/${drivers.length} chauffeur${drivers.length > 1 ? 's' : ''} en service`} />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <View style={{ flex: 1 }}>
          <MapView lat={center.lat} lng={center.lng} extraMarkers={markers} fitBounds style={{ flex: 1 }} />
          {/* Floating legend */}
          <View style={styles.legend} pointerEvents="none">
            <View style={styles.legendRow}><View style={[styles.legendDot, { backgroundColor: colors.success }]} /><Text style={styles.legendTxt}>En service</Text></View>
            <View style={styles.legendRow}><View style={[styles.legendDot, { backgroundColor: colors.textMuted }]} /><Text style={styles.legendTxt}>Hors ligne</Text></View>
          </View>
          <TouchableOpacity style={styles.refresh} onPress={load} testID="map-refresh">
            <Ionicons name="refresh" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  legend: { position: 'absolute', top: spacing.md, left: spacing.md, backgroundColor: colors.surface + 'EE', borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: 8, gap: 4 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendTxt: { color: colors.text, fontSize: 11, fontWeight: '700' },
  refresh: { position: 'absolute', right: spacing.md, top: spacing.md, width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
