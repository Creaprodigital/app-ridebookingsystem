import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import MapView from '../../src/components/MapView';
import SlideButton from '../../src/components/SlideButton';
import { colors, radius, spacing } from '../../src/theme';
import { getDriverMissions, updateMissionStatus, apiError } from '../../src/api';
import { getNavProvider, buildNavUrl } from '../../src/prefs';

const NEXT: Record<string, { next: string; label: string }> = {
  assigned: { next: 'en_route', label: 'GLISSER POUR DÉMARRER' },
  en_route: { next: 'arrived', label: 'GLISSER — JE SUIS ARRIVÉ' },
  arrived: { next: 'in_progress', label: 'GLISSER — CLIENT À BORD' },
  in_progress: { next: 'completed', label: 'GLISSER POUR TERMINER' },
};

function pickAddr(m: any, t: 'pickup' | 'dropoff') {
  return m?.[`${t}_address`] || m?.[t]?.address || m?.[t] || '—';
}
function pickLatLng(m: any, t: 'pickup' | 'dropoff'): { lat: number; lng: number } | null {
  const lat = m?.[`${t}_lat`] ?? m?.[t]?.lat ?? m?.[`${t}_location`]?.lat;
  const lng = m?.[`${t}_lng`] ?? m?.[t]?.lng ?? m?.[`${t}_location`]?.lng;
  if (lat != null && lng != null) return { lat: Number(lat), lng: Number(lng) };
  return null;
}

export default function MissionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [mission, setMission] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getDriverMissions();
      const arr = Array.isArray(list) ? list : list?.items ?? [];
      const m = arr.find((x: any) => String(x.id ?? x._id) === String(id));
      setMission(m || null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNav = async () => {
    if (!mission) return;
    const p = pickLatLng(mission, 'pickup');
    const d = pickLatLng(mission, 'dropoff');
    const target = mission.status === 'in_progress' ? d : p;
    const provider = await getNavProvider();
    if (!target) {
      const q = encodeURIComponent(pickAddr(mission, mission.status === 'in_progress' ? 'dropoff' : 'pickup'));
      const url = provider === 'waze'
        ? `https://waze.com/ul?q=${q}&navigate=yes`
        : (Platform.OS === 'ios'
            ? `http://maps.apple.com/?q=${q}`
            : `https://www.google.com/maps/search/?api=1&query=${q}`);
      Linking.openURL(url);
      return;
    }
    const url = buildNavUrl(provider, target.lat, target.lng);
    Linking.openURL(url);
  };

  const advance = async () => {
    if (!mission) return;
    const t = NEXT[mission.status];
    if (!t) return;
    try {
      await updateMissionStatus(String(mission.id ?? mission._id), t.next);
      await load();
      if (t.next === 'completed') {
        if (Platform.OS !== 'web') Alert.alert('Course terminée', 'Bravo ! Gains ajoutés à votre solde.');
        router.back();
      }
    } catch (e) {
      const msg = apiError(e);
      if (Platform.OS !== 'web') Alert.alert('Erreur', msg);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      </SafeAreaView>
    );
  }

  if (!mission) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="alert-circle" size={40} color={colors.textMuted} />
          <Text style={styles.missingTxt}>Mission introuvable</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backTxt}>Retour</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const pickup = pickLatLng(mission, 'pickup');
  const dropoff = pickLatLng(mission, 'dropoff');
  const markers = [] as any[];
  if (pickup) markers.push({ ...pickup, color: colors.primary, label: 'A' });
  if (dropoff) markers.push({ ...dropoff, color: colors.danger, label: 'B' });
  const centerLat = pickup?.lat ?? dropoff?.lat;
  const centerLng = pickup?.lng ?? dropoff?.lng;

  const price = mission.price ?? mission.fare ?? mission.amount ?? mission.total;
  const passenger = mission.passenger_name || mission.customer_name || mission.client_name || mission.passenger?.name;
  const phone = mission.passenger_phone || mission.customer_phone || mission.client_phone || mission.passenger?.phone;

  const cta = NEXT[mission.status];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Mission</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 200, gap: spacing.md, paddingHorizontal: spacing.md }}>
        <View style={styles.mapBox}>
          <MapView lat={centerLat} lng={centerLng} extraMarkers={markers} style={StyleSheet.absoluteFill} />
        </View>

        <View style={styles.card}>
          <View style={styles.priceRow}>
            <Text style={styles.priceLbl}>MONTANT COURSE</Text>
            <Text style={styles.priceVal}>
              {price != null ? `${Number(price).toFixed(2)} €` : '—'}
            </Text>
          </View>
          <View style={styles.divider} />

          <View style={styles.route}>
            <View style={styles.routeLine}>
              <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
              <View style={styles.routeVert} />
              <View style={[styles.routeDot, { backgroundColor: colors.danger }]} />
            </View>
            <View style={{ flex: 1, gap: spacing.md }}>
              <View>
                <Text style={styles.routeLabel}>DÉPART</Text>
                <Text style={styles.addr}>{pickAddr(mission, 'pickup')}</Text>
              </View>
              <View>
                <Text style={styles.routeLabel}>ARRIVÉE</Text>
                <Text style={styles.addr}>{pickAddr(mission, 'dropoff')}</Text>
              </View>
            </View>
          </View>
        </View>

        {(passenger || phone) ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Passager</Text>
            {passenger ? <Text style={styles.paxName}>{passenger}</Text> : null}
            {phone ? (
              <TouchableOpacity
                style={styles.callBtn}
                onPress={() => Linking.openURL(`tel:${phone}`)}
                testID="call-btn"
              >
                <Ionicons name="call" size={16} color={colors.bg} />
                <Text style={styles.callTxt}>APPELER {phone}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <TouchableOpacity style={styles.navBtn} onPress={openNav} testID="nav-btn">
          <Ionicons name="navigate" size={18} color={colors.text} />
          <Text style={styles.navTxt}>OUVRIR LA NAVIGATION</Text>
        </TouchableOpacity>
      </ScrollView>

      {cta ? (
        <View style={styles.footer}>
          <SlideButton
            label={cta.label}
            onConfirm={advance}
            testID={`slide-${mission.status}`}
          />
        </View>
      ) : (
        <View style={styles.footer}>
          <View style={styles.doneBanner}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.doneTxt}>Mission terminée</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  missingTxt: { color: colors.text, fontWeight: '700' },
  backBtn: { marginTop: 8, paddingHorizontal: 24, height: 44, backgroundColor: colors.primary, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  backTxt: { color: colors.bg, fontWeight: '800' },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  topTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 16, fontWeight: '800' },
  mapBox: { height: 220, borderRadius: radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  card: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.xl, padding: spacing.md, gap: spacing.md,
  },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priceLbl: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  priceVal: { color: colors.primary, fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  divider: { height: 1, backgroundColor: colors.border },
  route: { flexDirection: 'row', gap: 12 },
  routeLine: { alignItems: 'center', paddingTop: 6, paddingBottom: 6, width: 14 },
  routeDot: { width: 12, height: 12, borderRadius: 6 },
  routeVert: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  routeLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  addr: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 2 },
  sectionTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  paxName: { color: colors.text, fontSize: 18, fontWeight: '800' },
  callBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, height: 48, borderRadius: radius.full,
  },
  callTxt: { color: colors.bg, fontWeight: '900', letterSpacing: 0.5 },
  navBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    height: 52, borderRadius: radius.full,
  },
  navTxt: { color: colors.text, fontWeight: '800', letterSpacing: 1.2 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: spacing.md, paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    backgroundColor: colors.bg, borderTopColor: colors.border, borderTopWidth: 1,
  },
  doneBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.success + '1A', borderColor: colors.success, borderWidth: 1,
    height: 60, borderRadius: radius.full,
  },
  doneTxt: { color: colors.success, fontWeight: '900', letterSpacing: 1 },
});
