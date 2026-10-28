import React, { useCallback, useEffect, useState } from 'react';
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
  Modal,
  BackHandler,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import MapView from '../../src/components/MapView';
import SlideButton from '../../src/components/SlideButton';
import EndOfRidePayment from '../../src/components/EndOfRidePayment';
import { colors, radius, spacing } from '../../src/theme';
import { fontScale, getPad, getGap } from '../../src/responsive';
import { getDriverMissions, updateMissionStatus, apiError, getMarketplaceConfig } from '../../src/api';
import { getNavProvider, setNavProvider, buildNavUrl, type NavProvider } from '../../src/prefs';
import { useRides } from '../../src/ridesContext';
import { isImmediateRide } from '../../src/rideTypes';
import { haptic } from '../../src/feedback';
import {
  fetchRoute,
  fmtDistanceKm,
  fmtDurationMin,
  type DirectionsResult,
  type LatLng,
} from '../../src/directions';
import { getLastCoords, subscribeCoords } from '../../src/locationStore';
import { formatPickupCountdown, countdownStyle } from '../../src/timeUtils';

const NEXT: Record<string, { next: string; label: string; subLabel: string; color: string }> = {
  assigned:    { next: 'en_route',    label: 'JE DÉMARRE',         subLabel: 'Glissez pour démarrer la course',     color: colors.primary },
  en_route:    { next: 'arrived',     label: 'JE SUIS ARRIVÉ',     subLabel: 'Glissez pour confirmer votre arrivée', color: colors.success },
  arrived:     { next: 'in_progress', label: 'CLIENT À BORD',      subLabel: 'Glissez pour démarrer le trajet',     color: colors.primary },
  in_progress: { next: 'completed',   label: 'TERMINER LA COURSE', subLabel: 'Glissez pour terminer la course',    color: colors.success },
};

function pickAddr(m: any, t: 'pickup' | 'dropoff') {
  return m?.booking?.[`${t}_address`] || m?.[`${t}_address`] || m?.[t]?.address || m?.[t] || '—';
}
function pickDt(m: any) {
  return (
    m?.booking?.pickup_at ||
    m?.pickup_at ||
    m?.scheduled_at ||
    m?.pickup_time ||
    m?.created_at
  );
}
function pickLatLng(m: any, t: 'pickup' | 'dropoff'): { lat: number; lng: number } | null {
  const lat =
    m?.booking?.[`${t}_lat`] ??
    m?.[`${t}_lat`] ??
    m?.[t]?.lat ??
    m?.[`${t}_location`]?.lat;
  const lng =
    m?.booking?.[`${t}_lng`] ??
    m?.[`${t}_lng`] ??
    m?.[t]?.lng ??
    m?.[`${t}_location`]?.lng;
  if (lat != null && lng != null) return { lat: Number(lat), lng: Number(lng) };
  return null;
}

function pickPrice(m: any) {
  return (
    m?.pricing?.final ??
    m?.price ??
    m?.fare ??
    m?.amount ??
    m?.total ??
    m?.booking?.price ??
    m?.booking?.total
  );
}

/**
 * Same matching logic as the missions screen: try direct fields first,
 * then fall back to a percentage applied to the trip total.
 */
function pickCommissionEur(m: any, configPct?: number): number | null {
  const direct =
    m?.commission_eur ??
    m?.commission_amount ??
    m?.commission ??
    m?.platform_commission ??
    m?.platform_fee ??
    m?.fleet_commission ??
    m?.tenant_commission ??
    m?.pricing?.commission ??
    m?.pricing?.commission_eur ??
    m?.pricing?.fee;
  if (direct != null) {
    const n = Number(direct);
    if (Number.isFinite(n)) return n;
  }
  const pct =
    m?.commission_pct ??
    m?.commission_percent ??
    m?.commission_percentage ??
    m?.pricing?.commission_pct ??
    configPct;
  const total = Number(pickPrice(m));
  if (Number.isFinite(total) && pct != null) {
    const p = Number(pct);
    if (Number.isFinite(p)) {
      const ratio = p > 1 ? p / 100 : p;
      return Number((total * ratio).toFixed(2));
    }
  }
  return null;
}

function pickDriverNetEur(m: any, configPct?: number): number | null {
  // Strict rule (per business): Net chauffeur = Prix de la course − Commission.
  const total = Number(pickPrice(m));
  const com = Number(pickCommissionEur(m, configPct));
  if (Number.isFinite(total) && Number.isFinite(com)) {
    return Number((total - com).toFixed(2));
  }
  return null;
}

export default function MissionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Safe-area bottom padding for the floating footer. We always add a small
  // visual breathing room (12 px) on top of the device's bottom inset, so the
  // CTA never sticks to the system navigation bar on Android nor the home
  // indicator on iPhone.
  const footerBottomPad = Math.max(insets.bottom + 12, Platform.OS === 'ios' ? 28 : 20);
  const { onShift, clearActiveMission } = useRides();
  const [mission, setMission] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // Payment gate shown when the driver slides "TERMINER LA COURSE".
  const [paymentGate, setPaymentGate] = useState(false);

  // Live driver position (from background+foreground location store) so the
  // leg-1 polyline (driver→pickup) refreshes naturally.
  const [driverPos, setDriverPos] = useState<LatLng | null>(() => {
    const c = getLastCoords();
    return c ? { lat: c.lat, lng: c.lng } : null;
  });
  useEffect(() => {
    const unsub = subscribeCoords((c) => {
      if (c) setDriverPos({ lat: c.lat, lng: c.lng });
      else setDriverPos(null);
    });
    return () => unsub();
  }, []);

  // Directions for the two legs
  const [pickupRoute, setPickupRoute] = useState<DirectionsResult | null>(null);
  const [tripRoute, setTripRoute] = useState<DirectionsResult | null>(null);
  // Throttle leg-1 re-fetches: only re-query Directions when the driver has
  // moved significantly (>= 300 m) so we don't burn API quota.
  const lastDriverFetchRef = React.useRef<LatLng | null>(null);

  // ── Navigation provider preference (Google Maps / Waze / Apple Plans) ───
  const [navProvider, setNavProviderState] = useState<NavProvider>('google');
  const [navSheetVisible, setNavSheetVisible] = useState(false);
  useEffect(() => {
    (async () => {
      try { setNavProviderState(await getNavProvider()); } catch {}
    })();
  }, []);

  // ── Marketplace config (used to fallback on commission % when the
  // mission object doesn't carry a direct commission_eur field) ──
  const [configPct, setConfigPct] = useState<number | undefined>(undefined);
  useEffect(() => {
    (async () => {
      try {
        const cfgRaw: any = await getMarketplaceConfig();
        const cfg = cfgRaw?.config ?? cfgRaw;
        const pct =
          cfg?.commission_pct ??
          cfg?.commission_percent ??
          cfg?.commission_percentage;
        if (pct != null && Number.isFinite(Number(pct))) {
          setConfigPct(Number(pct));
        }
      } catch {}
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    // Robust lookup: the mission may take a few seconds to appear in
    // `/api/driver/missions` right after a marketplace claim, and the ID
    // returned by the claim endpoint doesn't always match the mission ID
    // the missions endpoint exposes. We retry up to 6 times (~10 s total)
    // and also match on several alternative identifiers.
    const strId = String(id ?? '');
    const idMatches = (x: any) => {
      if (!x) return false;
      const candidates = [
        x.id, x._id,
        x.mission_id,
        x.booking?.id, x.booking?._id,
        x.marketplace_listing_id,
        x.marketplace?.id, x.marketplace?._id,
      ]
        .filter((v) => v != null)
        .map((v) => String(v));
      return candidates.includes(strId);
    };

    const fetchOnce = async (): Promise<any | null> => {
      try {
        const list: any = await getDriverMissions();
        const arr = Array.isArray(list) ? list : (list?.current ?? list?.items ?? []);
        const all = [...arr, ...(list?.history ?? [])];
        const exact = all.find(idMatches);
        if (exact) return exact;
        // Fallback: if no exact match and there's a single active mission in
        // the current list, assume it's ours (most common case right after a
        // fresh claim — only one assigned mission at a time).
        const ACTIVE = new Set(['assigned', 'en_route', 'arrived', 'in_progress']);
        const actives = arr.filter((m: any) => ACTIVE.has(String(m?.status || '').toLowerCase()));
        if (actives.length === 1) return actives[0];
        return null;
      } catch {
        return null;
      }
    };

    let found: any = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
      found = await fetchOnce();
      if (found) break;
    }
    setMission(found || null);
    setLoading(false);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Resolve trip endpoints once we have a mission ────────────────────
  const pickupLatLng = mission ? pickLatLng(mission, 'pickup') : null;
  const dropoffLatLng = mission ? pickLatLng(mission, 'dropoff') : null;

  // Status-driven flags: which leg should be highlighted on the map.
  const status = String(mission?.status || '').toLowerCase();
  // While the driver is on the way to pickup OR has just been assigned, the
  // important leg is driver→pickup. After "arrived" / "in_progress", we only
  // care about pickup→dropoff (the client is in the car).
  const showLegToPickup = ['assigned', 'en_route'].includes(status);
  const showLegOfTrip = true; // always useful to show the full trip

  // ── Fetch the two route polylines ─────────────────────────────────────
  // Leg 1: Driver → pickup (only when showLegToPickup AND we have a fix).
  useEffect(() => {
    if (!showLegToPickup || !driverPos || !pickupLatLng) {
      setPickupRoute(null);
      lastDriverFetchRef.current = null;
      return;
    }
    // Throttle by movement distance (≥ 300 m delta to refetch).
    const last = lastDriverFetchRef.current;
    if (last) {
      const km = (() => {
        const R = 6371;
        const toRad = (x: number) => (x * Math.PI) / 180;
        const dLat = toRad(driverPos.lat - last.lat);
        const dLng = toRad(driverPos.lng - last.lng);
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(last.lat)) * Math.cos(toRad(driverPos.lat)) *
          Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      })();
      if (km < 0.3 && pickupRoute) return; // < 300 m, skip
    }
    let cancelled = false;
    (async () => {
      const r = await fetchRoute(driverPos, pickupLatLng);
      if (cancelled) return;
      setPickupRoute(r);
      lastDriverFetchRef.current = driverPos;
    })();
    return () => { cancelled = true; };
  }, [showLegToPickup, driverPos, pickupLatLng, pickupRoute]);

  // Leg 2: Pickup → Dropoff (cached, fetched once per mission).
  useEffect(() => {
    if (!showLegOfTrip || !pickupLatLng || !dropoffLatLng) {
      setTripRoute(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const r = await fetchRoute(pickupLatLng, dropoffLatLng);
      if (cancelled) return;
      setTripRoute(r);
    })();
    return () => { cancelled = true; };
  }, [
    showLegOfTrip,
    pickupLatLng?.lat, pickupLatLng?.lng,
    dropoffLatLng?.lat, dropoffLatLng?.lng,
  ]);

  // Lock the screen while the mission is in progress: the driver cannot
  // navigate back until they reach the "completed" step.
  // Locking rules (aligned with ridesContext):
  //   • EXECUTING (en_route, arrived, in_progress) → ALWAYS locked
  //   • assigned + immediate ride → locked (driver just accepted, must start)
  //   • assigned + scheduled ride (planifiée) → NOT locked, driver can browse
  //     other screens while waiting for the pickup time
  const isExecuting = ['en_route', 'arrived', 'in_progress'].includes(status);
  const isAssignedImmediate = status === 'assigned' && !!mission && isImmediateRide(mission);
  const isLocked = !!mission && (isExecuting || isAssignedImmediate);

  // Block hardware back button on Android while locked
  useEffect(() => {
    if (!isLocked) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // Show a friendly explanation rather than allowing back
      Alert.alert(
        'Course en cours',
        'Vous devez terminer la course avant de quitter cet écran.',
        [{ text: 'OK' }]
      );
      return true; // consume the event
    });
    return () => sub.remove();
  }, [isLocked]);

  /**
   * Launches the on-device turn-by-turn navigator. If `forced` is undefined,
   * uses the saved preference (`navProvider`). Pass an explicit provider when
   * the driver picks one from the bottom sheet.
   * If `setAsDefault` is true, the provider is also persisted as default.
   */
  const launchNav = async (forced?: NavProvider, setAsDefault?: boolean) => {
    if (!mission) return;
    const p = pickLatLng(mission, 'pickup');
    const d = pickLatLng(mission, 'dropoff');
    // While the driver is heading to pickup, navigate to pickup;
    // once on board (in_progress), navigate to dropoff.
    const target = mission.status === 'in_progress' ? d : p;
    const provider = forced ?? navProvider;
    if (setAsDefault) {
      try { await setNavProvider(provider); } catch {}
      setNavProviderState(provider);
    }
    haptic('light');
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

  // Legacy single-tap nav: respects saved preference, no chooser.
  const openNav = () => launchNav();
  // Long-press OR chooser tap: opens the bottom sheet.
  const openNavSheet = () => {
    haptic('light');
    setNavSheetVisible(true);
  };

  const advance = async () => {
    if (!mission) return;
    if (!onShift) {
      haptic('warning');
      const msg = 'Vous êtes hors ligne. Veuillez passer en ligne depuis l’onglet Carte pour démarrer ou poursuivre la course.';
      if (Platform.OS !== 'web') Alert.alert('Hors ligne', msg);
      else if (typeof window !== 'undefined') window.alert(msg);
      return;
    }
    const t = NEXT[mission.status];
    if (!t) return;
    // Ending the ride always goes through the payment gate: the ride is only
    // set to "completed" from there, and never marks the payment as paid.
    if (t.next === 'completed') {
      haptic('medium');
      setPaymentGate(true);
      return;
    }
    try {
      await updateMissionStatus(String(mission.id ?? mission._id), t.next);
      haptic('medium');
      await load();
    } catch (e) {
      haptic('error');
      const msg = apiError(e);
      if (Platform.OS !== 'web') Alert.alert('Erreur', msg);
    }
  };

  const completeRide = async () => {
    if (!mission) return;
    await updateMissionStatus(String(mission.id ?? mission._id), 'completed');
    setMission((prev: any) => (prev ? { ...prev, status: 'completed' } : prev));
    clearActiveMission();
  };

  const afterRideCompleted = () => {
    setPaymentGate(false);
    // Use replace to avoid coming back to the now-completed mission screen
    try { router.replace('/(tabs)/missions' as any); }
    catch { router.back(); }
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
          <Ionicons name="hourglass" size={40} color={colors.primary} />
          <Text style={styles.missingTxt}>Synchronisation en cours…</Text>
          <Text style={styles.missingSub}>
            Votre course vient d’être acceptée. Elle devrait apparaître d’ici quelques
            secondes dans l’onglet « Mes missions ».
          </Text>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.replace('/(tabs)/missions' as any)}
            testID="go-missions-btn"
          >
            <Text style={styles.backTxt}>OUVRIR MES MISSIONS</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: 8 }]}
            onPress={() => load()}
            testID="retry-load-btn"
          >
            <Text style={[styles.backTxt, { color: colors.text }]}>RÉESSAYER</Text>
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
  // Center the map on the driver if we know where they are; otherwise pick A.
  const centerLat = driverPos?.lat ?? pickup?.lat ?? dropoff?.lat;
  const centerLng = driverPos?.lng ?? pickup?.lng ?? dropoff?.lng;

  // Build the polyline list for MapView. Two legs are drawn with different
  // styles so the driver can immediately tell them apart:
  //   • Leg 1 (driver→pickup) — yellow + dashed (only while heading there)
  //   • Leg 2 (pickup→dropoff) — green + solid (always visible)
  const polylines: any[] = [];
  if (pickupRoute && showLegToPickup) {
    polylines.push({
      encoded: pickupRoute.encoded,
      color: colors.primary, // yellow
      dashed: true,
      weight: 5,
    });
  }
  if (tripRoute) {
    polylines.push({
      encoded: tripRoute.encoded,
      color: colors.success, // green
      dashed: false,
      weight: 6,
      animated: true,
    });
  }

  const price = pickPrice(mission);
  const passenger =
    mission.passenger_name ||
    mission.customer_name ||
    mission.client_name ||
    mission.passenger?.name ||
    mission.booking?.passenger_name;
  const phone =
    mission.passenger_phone ||
    mission.customer_phone ||
    mission.client_phone ||
    mission.passenger?.phone ||
    mission.booking?.passenger_phone;

  const cta = NEXT[mission.status];
  const blocked = !onShift;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        {isLocked ? (
          <View style={[styles.iconBtn, styles.lockedIconBtn]} testID="back-btn-locked">
            <Ionicons name="lock-closed" size={18} color={colors.warning} />
          </View>
        ) : (
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
        )}
        <Text style={styles.topTitle}>Détail de la mission</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 260 + footerBottomPad, gap: spacing.md, paddingHorizontal: spacing.md }}>
        {/* ── HEADER INFO CARD (Type · Countdown · Warning · Financials) ── */}
        {(() => {
          const immediate = isImmediateRide(mission);
          const price = pickPrice(mission);
          const com = pickCommissionEur(mission, configPct);
          const net = pickDriverNetEur(mission, configPct);
          const cd = !immediate && pickDt(mission) ? formatPickupCountdown(pickDt(mission)) : null;
          const cs = cd ? countdownStyle(cd.kind) : null;
          const warningTxt = immediate
            ? "Cette course est à départ immédiat. Démarrez dès que possible. Si vous annulez, vous pourriez ne plus recevoir de nouvelles demandes immédiates à l'avenir."
            : "Si vous annulez une course planifiée déjà acceptée, vous pourriez ne plus recevoir de nouvelles demandes de courses planifiées à l'avenir.";
          return (
            <View
              style={[
                styles.infoCard,
                { borderColor: immediate ? colors.danger : colors.primary },
              ]}
              testID="mission-info-card"
            >
              <View style={styles.infoHeader}>
                <View style={[
                  styles.infoIconWrap,
                  { backgroundColor: (immediate ? colors.danger : colors.primary) + '22' },
                ]}>
                  <Ionicons
                    name={immediate ? 'flash' : 'calendar'}
                    size={22}
                    color={immediate ? colors.danger : colors.primary}
                  />
                </View>
                <Text
                  style={[
                    styles.infoTitle,
                    { color: immediate ? colors.danger : colors.primary },
                  ]}
                  numberOfLines={1}
                >
                  {immediate ? 'COURSE IMMÉDIATE' : 'RÉSERVATION'}
                </Text>
                {cd && cs ? (
                  <View style={[styles.infoCd, cs.chip]} testID="info-cd">
                    <Ionicons name="time-outline" size={13} color={cs.fg} />
                    <Text style={[styles.infoCdTxt, { color: cs.fg }]}>{cd.label}</Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.infoWarning} numberOfLines={4}>
                {warningTxt}
              </Text>

              <View style={styles.priceRowGrid}>
                <View style={[styles.priceCell, styles.priceCellLeft]}>
                  <Text style={styles.priceCellLbl}>Net chauffeur</Text>
                  <Text style={[styles.priceCellVal, { color: colors.success }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} testID="info-net">
                    {net != null ? `${Number(net).toFixed(2)} €` : '—'}
                  </Text>
                </View>
                <View style={[styles.priceCell, styles.priceCellCenter]}>
                  <Text style={styles.priceCellLbl}>Prix client</Text>
                  <Text style={[styles.priceCellVal, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} testID="info-price">
                    {price != null ? `${Number(price).toFixed(2)} €` : '—'}
                  </Text>
                </View>
                <View style={[styles.priceCell, styles.priceCellRight]}>
                  <Text style={styles.priceCellLbl}>Commission</Text>
                  <Text style={[styles.priceCellVal, { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} testID="info-commission">
                    {com != null ? `−${Number(com).toFixed(2)} €` : '—'}
                  </Text>
                </View>
              </View>
            </View>
          );
        })()}

        <View style={styles.mapBox}>
          <MapView
            lat={centerLat}
            lng={centerLng}
            extraMarkers={markers}
            polylines={polylines}
            fitBounds
            style={StyleSheet.absoluteFill}
          />
        </View>

        {/* ── ROUTE BLOCK : Prise en charge & Destination ─────────────── */}
        <View style={styles.routeCard}>
          <View style={styles.route}>
            <View style={styles.routeLine}>
              <View style={styles.routeDotPickup} />
              <View style={styles.routeVert} />
              <View style={styles.routeDotDrop} />
            </View>
            <View style={{ flex: 1, gap: spacing.md }}>
              {/* PRISE EN CHARGE */}
              <View style={styles.routeItem}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.routeLabel, { color: colors.primary }]}>PRISE EN CHARGE</Text>
                  <Text style={styles.addr}>{pickAddr(mission, 'pickup')}</Text>
                </View>
                {pickupRoute && showLegToPickup ? (
                  <View style={styles.legChipGrey} testID="leg1-chip">
                    <Ionicons name="car" size={13} color={colors.textSecondary} />
                    <Text style={styles.legChipTxt}>
                      {fmtDistanceKm(pickupRoute.distanceMeters)}{'\n'}{fmtDurationMin(pickupRoute.durationSec)}
                    </Text>
                  </View>
                ) : null}
              </View>
              {/* DESTINATION */}
              <View style={styles.routeItem}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.routeLabel, { color: colors.danger }]}>DESTINATION</Text>
                  <Text style={styles.addr}>{pickAddr(mission, 'dropoff')}</Text>
                </View>
                {tripRoute ? (
                  <View style={styles.legChipGrey} testID="leg2-chip">
                    <Ionicons name="car" size={13} color={colors.textSecondary} />
                    <Text style={styles.legChipTxt}>
                      {fmtDistanceKm(tripRoute.distanceMeters)}{'\n'}{fmtDurationMin(tripRoute.durationSec)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          {/* ── 3 MINI STATS : Date · Pax · Total distance ──────────── */}
          {(() => {
            const dt = pickDt(mission);
            let dateLine = '—';
            let timeLine = '';
            if (dt) {
              try {
                const d = new Date(dt);
                dateLine = d.toLocaleDateString('fr-FR');
                timeLine = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
              } catch {}
            }
            const pax =
              mission?.booking?.pax ??
              mission?.pax ??
              mission?.passengers ??
              mission?.passenger_count;
            const leg1Dist = pickupRoute && showLegToPickup ? pickupRoute.distanceMeters : 0;
            const leg2Dist = tripRoute ? tripRoute.distanceMeters : 0;
            const totalDist = leg1Dist + leg2Dist;
            return (
              <View style={styles.miniStatsRow}>
                <View style={styles.miniStat}>
                  <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
                  <View>
                    <Text style={styles.miniStatVal}>{dateLine}</Text>
                    {timeLine ? <Text style={styles.miniStatSub}>{timeLine}</Text> : null}
                  </View>
                </View>
                <View style={styles.miniStat}>
                  <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
                  <Text style={styles.miniStatVal}>{pax ? `${pax} pax` : '—'}</Text>
                </View>
                <View style={styles.miniStat}>
                  <Ionicons name="navigate-outline" size={14} color={colors.textSecondary} />
                  <Text style={styles.miniStatVal} testID="mini-total-dist">
                    {totalDist > 0 ? fmtDistanceKm(totalDist) : '—'}
                  </Text>
                </View>
              </View>
            );
          })()}
        </View>

        {(passenger || phone) ? (
          <View style={styles.passengerCard}>
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
      </ScrollView>

      {/* Navigation provider chooser bottom-sheet */}
      <Modal
        visible={navSheetVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setNavSheetVisible(false)}
      >
        <TouchableOpacity
          style={styles.navSheetBackdrop}
          activeOpacity={1}
          onPress={() => setNavSheetVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.navSheet} onPress={() => {}} testID="nav-sheet">
            <View style={styles.navSheetHandle} />
            <Text style={styles.navSheetTitle}>Ouvrir la navigation avec…</Text>
            <Text style={styles.navSheetSub}>
              Choisissez une application et appuyez à nouveau pour la définir
              comme votre application par défaut.
            </Text>

            <TouchableOpacity
              style={[styles.navOption, navProvider === 'google' && styles.navOptionActive]}
              onPress={() => {
                setNavSheetVisible(false);
                launchNav('google', navProvider !== 'google');
              }}
              testID="nav-option-google"
            >
              <View style={[styles.navOptionIcon, { backgroundColor: '#1A73E8' }]}>
                <Ionicons name="navigate" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.navOptionTitle}>
                  {Platform.OS === 'ios' ? 'Google Maps / Plans' : 'Google Maps'}
                </Text>
                <Text style={styles.navOptionSub}>Itinéraire en voiture vers le point</Text>
              </View>
              {navProvider === 'google' ? (
                <View style={styles.navOptionDefault}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                  <Text style={styles.navOptionDefaultTxt}>Par défaut</Text>
                </View>
              ) : null}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.navOption, navProvider === 'waze' && styles.navOptionActive]}
              onPress={() => {
                setNavSheetVisible(false);
                launchNav('waze', navProvider !== 'waze');
              }}
              testID="nav-option-waze"
            >
              <View style={[styles.navOptionIcon, { backgroundColor: '#33CCFF' }]}>
                <Ionicons name="car-sport" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.navOptionTitle}>Waze</Text>
                <Text style={styles.navOptionSub}>Trafic en temps réel et alertes communauté</Text>
              </View>
              {navProvider === 'waze' ? (
                <View style={styles.navOptionDefault}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                  <Text style={styles.navOptionDefaultTxt}>Par défaut</Text>
                </View>
              ) : null}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.navSheetCancel}
              onPress={() => setNavSheetVisible(false)}
              testID="nav-sheet-cancel"
            >
              <Text style={styles.navSheetCancelTxt}>Annuler</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {blocked && cta ? (
        <View style={[styles.footer, { paddingBottom: footerBottomPad }]}>
          <View style={styles.lockBanner} testID="off-shift-mission-banner">
            <Ionicons name="lock-closed" size={18} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.lockTitle}>Hors ligne</Text>
              <Text style={styles.lockSub}>
                Veuillez passer en ligne depuis l’onglet Carte pour continuer la course.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.lockBtn}
              onPress={() => router.push('/(tabs)')}
              testID="off-shift-mission-cta"
            >
              <Text style={styles.lockBtnText}>EN LIGNE</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : cta ? (
        <View style={[styles.footer, { paddingBottom: footerBottomPad }]}>
          {/* CTA Naviguer en jaune (vers prise en charge ou vers client) */}
          <TouchableOpacity
            style={styles.navCtaBtn}
            onPress={openNav}
            onLongPress={openNavSheet}
            activeOpacity={0.85}
            testID="nav-cta-btn"
          >
            <Ionicons name="navigate" size={18} color={colors.bg} />
            <Text style={styles.navCtaTxt}>
              {mission.status === 'in_progress'
                ? 'NAVIGUER VERS LE CLIENT'
                : 'NAVIGUER VERS LA PRISE EN CHARGE'}
            </Text>
            <TouchableOpacity
              style={styles.navCtaChange}
              onPress={openNavSheet}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              testID="nav-cta-change"
            >
              <Ionicons name="chevron-down" size={14} color={colors.bg} />
            </TouchableOpacity>
          </TouchableOpacity>

          {/* Slide button (couleur selon l'étape) */}
          <SlideButton
            label={cta.label}
            subLabel={cta.subLabel}
            color={cta.color}
            onConfirm={advance}
            testID={`slide-${mission.status}`}
          />
        </View>
      ) : (
        <View style={[styles.footer, { paddingBottom: footerBottomPad }]}>
          <View style={styles.doneBanner}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.doneTxt}>Mission terminée</Text>
          </View>
        </View>
      )}

      {/* End-of-ride payment gate (server-verified green / orange / red) */}
      {paymentGate ? (
        <EndOfRidePayment
          visible={paymentGate}
          missionId={String(mission.id ?? mission._id)}
          onCompleteRide={completeRide}
          onDone={afterRideCompleted}
          onCancel={() => setPaymentGate(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  missingTxt: { color: colors.text, fontWeight: '700', fontSize: 16 },
  missingSub: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', paddingHorizontal: 40, marginTop: 4, marginBottom: 8 },
  backBtn: { marginTop: 8, paddingHorizontal: 24, height: 44, backgroundColor: colors.primary, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  backTxt: { color: colors.bg, fontWeight: '800' },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  lockedIconBtn: { backgroundColor: colors.warning + '22', borderWidth: 1, borderColor: colors.warning },
  topTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 16, fontWeight: '800' },
  mapBox: { height: 220, borderRadius: radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, position: 'relative' },

  // ── New info card (top) — Type · Countdown · Warning · 3 financials ──
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    padding: getPad(spacing.md),
    gap: getGap(12),
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  infoIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  infoTitle: {
    flex: 1,
    fontSize: fontScale(18),
    fontWeight: '900',
    letterSpacing: 1,
    minWidth: 140,
  },
  infoCd: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1,
  },
  infoCdTxt: { fontSize: 12, fontWeight: '900' },
  infoWarning: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  priceRowGrid: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  priceCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    gap: 4,
  },
  priceCellLeft: { borderRightWidth: 1, borderRightColor: colors.border },
  priceCellCenter: { borderRightWidth: 1, borderRightColor: colors.border },
  priceCellRight: {},
  priceCellLbl: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  priceCellVal: {
    fontSize: fontScale(18),
    fontWeight: '900',
    letterSpacing: -0.5,
  },

  // ── New route card (PRISE EN CHARGE / DESTINATION) ──
  routeCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.md,
  },
  routeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  routeDotPickup: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 3,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  routeDotDrop: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.danger,
  },
  legChipGrey: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.lg,
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 80,
  },
  legChipTxt: { color: colors.text, fontSize: 11, fontWeight: '800', lineHeight: 14 },

  // ── Mini stats (date · pax · total km) ──
  miniStatsRow: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  miniStat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  miniStatVal: { color: colors.text, fontSize: 12, fontWeight: '700' },
  miniStatSub: { color: colors.textSecondary, fontSize: 10, fontWeight: '600' },

  // ── Navigation CTA (Yellow primary in footer) ──
  navCtaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    height: 56,
    borderRadius: radius.full,
    shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  navCtaTxt: {
    flex: 1,
    color: colors.bg,
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 1,
    textAlign: 'center',
  },
  navCtaChange: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#00000022',
  },

  // ── Passenger card (kept simple — appears below map block) ──
  passengerCard: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm,
  },

  // Ride-kind banner (IMMÉDIATE / PLANIFIÉE)
  kindBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: radius.xl, borderWidth: 1,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  kindBannerImmediate: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
    shadowColor: colors.danger, shadowOpacity: 0.35, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  kindBannerPlanned: {
    backgroundColor: colors.surface,
    borderColor: colors.primary + '55',
  },
  kindBannerIcon: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  kindBannerTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  kindBannerSub: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  kindBannerCd: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999, borderWidth: 1,
  },
  kindBannerCdTxt: { fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },
  mapLegend: {
    position: 'absolute', left: 8, bottom: 8,
    backgroundColor: colors.bg + 'E6',
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8,
    gap: 4,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDash: { width: 16, height: 2, borderRadius: 1, opacity: 0.85 },
  legendSolid: { width: 16, height: 3, borderRadius: 2 },
  legendTxt: { color: colors.text, fontSize: 10, fontWeight: '700' },
  card: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.xl, padding: spacing.md, gap: spacing.md,
  },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priceLbl: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  priceVal: { color: colors.primary, fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  priceBreakdown: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: 10, gap: 6,
    borderWidth: 1, borderColor: colors.border,
  },
  breakdownLbl: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  breakdownLblTxt: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  breakdownVal: { fontSize: 14, fontWeight: '900', letterSpacing: -0.3 },
  divider: { height: 1, backgroundColor: colors.border },
  route: { flexDirection: 'row', gap: 12 },
  routeLine: { alignItems: 'center', paddingTop: 6, paddingBottom: 6, width: 14 },
  routeDot: { width: 12, height: 12, borderRadius: 6 },
  routeVert: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  routeLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  routeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  legBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 999, borderWidth: 1,
  },
  legBadgeTxt: { fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },
  addr: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 2 },

  // Total trip block — sum of leg 1 + leg 2 (distance & duration)
  totalBlock: {
    marginTop: spacing.sm,
    backgroundColor: colors.bg,
    borderColor: colors.primary + '55',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
    gap: 10,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  totalLblWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  totalLbl: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  totalValWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  totalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  totalChipTxt: {
    color: colors.text,
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.3,
  },
  totalBreakdown: {
    gap: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legDot: { width: 8, height: 8, borderRadius: 4 },
  totalBreakdownLbl: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  totalBreakdownVal: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
  },
  sectionTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  paxName: { color: colors.text, fontSize: 18, fontWeight: '800' },
  callBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, height: 48, borderRadius: radius.full,
  },
  callTxt: { color: colors.bg, fontWeight: '900', letterSpacing: 0.5 },
  navBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.primary, borderRadius: radius.xl,
    paddingHorizontal: 16, paddingVertical: 14,
    shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  navTxt: { color: colors.bg, fontWeight: '900', letterSpacing: 1.1, fontSize: 13 },
  navSub: { color: colors.bg + 'CC', fontWeight: '700', fontSize: 11, marginTop: 2 },
  navChange: {
    backgroundColor: '#00000022', paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999,
  },
  navChangeTxt: { color: colors.bg, fontWeight: '800', fontSize: 11, letterSpacing: 0.8 },

  // Floating nav FAB on the map
  navFab: {
    position: 'absolute', top: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary,
    paddingLeft: 12, paddingRight: 4, paddingVertical: 8,
    borderRadius: 999,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },
  navFabTxt: { color: colors.bg, fontWeight: '900', fontSize: 11, letterSpacing: 1, marginLeft: 2 },
  navFabSwitch: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#00000022', alignItems: 'center', justifyContent: 'center',
    marginLeft: 4,
  },

  // Bottom-sheet provider chooser
  navSheetBackdrop: {
    flex: 1, backgroundColor: '#000000C0', justifyContent: 'flex-end',
  },
  navSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.md, paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    gap: 10,
    borderTopColor: colors.border, borderTopWidth: 1,
  },
  navSheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center', marginBottom: 8,
  },
  navSheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  navSheetSub: {
    color: colors.textSecondary, fontSize: 12, textAlign: 'center',
    paddingHorizontal: 20, marginBottom: 10,
  },
  navOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, padding: 12,
  },
  navOptionActive: { borderColor: colors.success, borderWidth: 1.5 },
  navOptionIcon: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  navOptionTitle: { color: colors.text, fontWeight: '800', fontSize: 15 },
  navOptionSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  navOptionDefault: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  navOptionDefaultTxt: { color: colors.success, fontWeight: '900', fontSize: 11 },
  navSheetCancel: {
    height: 48, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bg, borderRadius: radius.lg,
    borderColor: colors.border, borderWidth: 1, marginTop: 4,
  },
  navSheetCancelTxt: { color: colors.textSecondary, fontWeight: '800', letterSpacing: 0.6 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    // bottom padding is applied dynamically with safe-area insets
    backgroundColor: colors.bg, borderTopColor: colors.border, borderTopWidth: 1,
    // visual separation between the yellow "Naviguer" CTA and the slide button
    gap: 14,
  },
  doneBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.success + '1A', borderColor: colors.success, borderWidth: 1,
    height: 60, borderRadius: radius.full,
  },
  doneTxt: { color: colors.success, fontWeight: '900', letterSpacing: 1 },
  lockBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.warning + '15', borderColor: colors.warning, borderWidth: 1,
    borderRadius: radius.lg, padding: 12,
  },
  lockTitle: { color: colors.warning, fontWeight: '900', fontSize: 13 },
  lockSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  lockBtn: {
    backgroundColor: colors.warning, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.full,
  },
  lockBtnText: { color: '#000', fontWeight: '900', fontSize: 11, letterSpacing: 0.8 },
});
