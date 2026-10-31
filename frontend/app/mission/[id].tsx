import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking, Platform, Alert, Modal, BackHandler } from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import MapView from '../../src/components/MapView';
import SlideButton from '../../src/components/SlideButton';
import EndOfRidePayment from '../../src/components/EndOfRidePayment';
import { colors, radius, spacing, shadow } from '../../src/theme';
import Chip, { type ChipTone } from '../../src/ui/Chip';
import RouteStops from '../../src/ui/RouteStops';
import { fmtEuro, fmtTime, fmtDay, pickVehicleCategory } from '../../src/rideFormat';
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
import { formatPickupCountdown } from '../../src/timeUtils';

const NEXT: Record<string, { next: string; label: string; subLabel: string; color: string }> = {
  assigned:    { next: 'en_route',    label: 'Je démarre',         subLabel: 'Glissez pour démarrer la course',     color: colors.primary },
  en_route:    { next: 'arrived',     label: 'Je suis arrivé',     subLabel: 'Glissez pour confirmer votre arrivée', color: colors.success },
  arrived:     { next: 'in_progress', label: 'Client à bord',      subLabel: 'Glissez pour démarrer le trajet',     color: colors.primary },
  in_progress: { next: 'completed',   label: 'Terminer la course', subLabel: 'Glissez pour terminer la course',    color: colors.success },
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
      const msg = 'Vous êtes hors service. Passez en service depuis l’Accueil pour démarrer ou poursuivre la course.';
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
            secondes dans l’onglet « Courses ».
          </Text>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.replace('/(tabs)/missions' as any)}
            testID="go-missions-btn"
          >
            <Text style={styles.backTxt}>Ouvrir mes courses</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: 8 }]}
            onPress={() => load()}
            testID="retry-load-btn"
          >
            <Text style={[styles.backTxt, { color: colors.text }]}>Réessayer</Text>
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
        <Text style={styles.topTitle}>Détail de la course</Text>
        <View style={[styles.iconBtn, { backgroundColor: 'transparent', borderWidth: 0 }]} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 200 + footerBottomPad, gap: 12, paddingHorizontal: spacing.md }}>
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

        {(() => {
          const immediate = isImmediateRide(mission);
          const com = pickCommissionEur(mission, configPct);
          const net = pickDriverNetEur(mission, configPct);
          const cd = !immediate && pickDt(mission) ? formatPickupCountdown(pickDt(mission)) : null;
          const cdTone: ChipTone =
            cd?.kind === 'overdue' ? 'danger' : cd?.kind === 'soon' || cd?.kind === 'now' ? 'warning' : 'primary';
          const payStatus = String(mission?.payment_status || mission?.booking?.payment_status || '').toLowerCase();
          const payMethod = String(mission?.payment_method || mission?.booking?.payment_method || '').toLowerCase();
          const paidOnline = payStatus.includes('paid') || payMethod.includes('card') || payMethod.includes('stripe') || payMethod.includes('online');
          return (
            <View style={styles.card} testID="mission-info-card">
              <View style={styles.chipsRow}>
                <Chip
                  icon={immediate ? 'flash' : 'calendar-outline'}
                  label={immediate ? 'Course immédiate' : 'Réservation'}
                  tone={immediate ? 'danger' : 'primary'}
                />
                {cd ? <Chip icon="time-outline" label={cd.label} tone={cdTone} testID="info-cd" /> : null}
                {payStatus || payMethod ? (
                  <Chip
                    icon={paidOnline ? 'card-outline' : 'cash-outline'}
                    label={paidOnline ? 'Payée par carte' : 'Paiement à bord'}
                    tone={paidOnline ? 'success' : 'warning'}
                  />
                ) : null}
              </View>
              <View style={styles.moneyRow}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.moneyLbl}>Prix client</Text>
                  <Text style={styles.priceBig} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} testID="info-price">
                    {fmtEuro(price)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.moneyLbl}>Votre gain net</Text>
                  <Text style={styles.netBig} numberOfLines={1} testID="info-net">
                    {net != null ? fmtEuro(net) : '—'}
                  </Text>
                </View>
              </View>
              {com != null && com > 0 ? (
                <Text style={styles.commissionTxt} testID="info-commission">
                  Commission −{fmtEuro(com)}
                </Text>
              ) : null}
            </View>
          );
        })()}

        {(() => {
          const dt = pickDt(mission);
          const pax =
            mission?.booking?.pax ??
            mission?.pax ??
            mission?.passengers ??
            mission?.passenger_count;
          const leg1Dist = pickupRoute && showLegToPickup ? pickupRoute.distanceMeters : 0;
          const leg2Dist = tripRoute ? tripRoute.distanceMeters : 0;
          const totalDist = leg1Dist + leg2Dist;
          const tripEnd =
            dt && tripRoute ? fmtTime(new Date(new Date(dt).getTime() + tripRoute.durationSec * 1000)) : '';
          return (
            <View style={styles.card}>
              <RouteStops
                size="lg"
                pickup={pickAddr(mission, 'pickup')}
                dropoff={pickAddr(mission, 'dropoff')}
                pickupLabel={dt ? `Prise en charge · ${fmtDay(dt)} ${fmtTime(dt)}` : 'Prise en charge'}
                dropoffLabel={tripEnd ? `Destination · arrivée vers ${tripEnd}` : 'Destination'}
              />
              <View style={styles.chipsRow}>
                {pickupRoute && showLegToPickup ? (
                  <Chip
                    icon="navigate-outline"
                    label={`Approche ${fmtDistanceKm(pickupRoute.distanceMeters)} · ${fmtDurationMin(pickupRoute.durationSec)}`}
                    tone="primary"
                    testID="leg1-chip"
                  />
                ) : null}
                {tripRoute ? (
                  <Chip
                    icon="car-outline"
                    label={`Trajet ${fmtDistanceKm(tripRoute.distanceMeters)} · ${fmtDurationMin(tripRoute.durationSec)}`}
                    tone="success"
                    testID="leg2-chip"
                  />
                ) : null}
                {pax ? <Chip icon="people-outline" label={`${pax} passager${Number(pax) > 1 ? 's' : ''}`} /> : null}
                {pickVehicleCategory(mission) ? <Chip icon="car-sport-outline" label={String(pickVehicleCategory(mission))} /> : null}
                {totalDist > 0 ? (
                  <Chip icon="git-commit-outline" label={`Total ${fmtDistanceKm(totalDist)}`} testID="mini-total-dist" />
                ) : null}
              </View>
            </View>
          );
        })()}

        {(passenger || phone) ? (
          <View style={[styles.card, styles.passengerRow]}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={20} color={colors.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.paxLbl}>Passager</Text>
              <Text style={styles.paxName} numberOfLines={1}>{passenger || phone}</Text>
            </View>
            {phone ? (
              <>
                <TouchableOpacity
                  style={[styles.roundBtn, { backgroundColor: colors.successSoft }]}
                  onPress={() => Linking.openURL(`tel:${phone}`)}
                  testID="call-btn"
                  accessibilityLabel={`Appeler ${phone}`}
                >
                  <Ionicons name="call" size={19} color={colors.success} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.roundBtn}
                  onPress={() => Linking.openURL(`sms:${phone}`)}
                  testID="sms-btn"
                  accessibilityLabel={`Envoyer un SMS à ${phone}`}
                >
                  <Ionicons name="chatbubble-outline" size={18} color={colors.text} />
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        ) : null}

        <View style={styles.noteCard}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.noteTxt}>
            {isImmediateRide(mission)
              ? "Course à départ immédiat : démarrez dès que possible. En cas d'annulation, vous pourriez ne plus recevoir de demandes immédiates."
              : "En cas d'annulation d'une course planifiée déjà acceptée, vous pourriez ne plus recevoir de nouvelles demandes planifiées."}
          </Text>
        </View>
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
              <Text style={styles.lockTitle}>Hors service</Text>
              <Text style={styles.lockSub}>
                Passez en service depuis l’Accueil pour continuer la course.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.lockBtn}
              onPress={() => router.push('/(tabs)')}
              testID="off-shift-mission-cta"
            >
              <Text style={styles.lockBtnText}>Activer</Text>
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
            <Ionicons name="navigate" size={18} color={colors.primary} />
            <Text style={styles.navCtaTxt}>
              {mission.status === 'in_progress'
                ? 'Naviguer vers la destination'
                : 'Naviguer vers la prise en charge'}
            </Text>
            <TouchableOpacity
              style={styles.navCtaChange}
              onPress={openNavSheet}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              testID="nav-cta-change"
            >
              <Ionicons name="chevron-down" size={16} color={colors.primary} />
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
            <Text style={styles.doneTxt}>Course terminée</Text>
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
  card: {
    backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, gap: 12, ...shadow,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  moneyRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  moneyLbl: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  priceBig: { color: colors.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  netBig: { color: colors.success, fontSize: 20, fontWeight: '800' },
  commissionTxt: { color: colors.textMuted, fontSize: 12.5, fontWeight: '600', marginTop: -6 },
  passengerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  paxLbl: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  paxName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  roundBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  noteCard: {
    flexDirection: 'row', gap: 10, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface2,
  },
  noteTxt: { flex: 1, color: colors.textSecondary, fontSize: 12.5, lineHeight: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  missingTxt: { color: colors.text, fontWeight: '700', fontSize: 16 },
  missingSub: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', paddingHorizontal: 40, marginTop: 4, marginBottom: 8 },
  backBtn: { marginTop: 8, paddingHorizontal: 24, height: 44, backgroundColor: colors.primary, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  backTxt: { color: colors.onPrimary, fontWeight: '700' },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  iconBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  lockedIconBtn: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  topTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 17, fontWeight: '700' },
  mapBox: {
    height: 230, borderRadius: radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface2, position: 'relative',
  },
  navCtaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.primarySoft, paddingHorizontal: 16, height: 50, borderRadius: radius.lg,
  },
  navCtaTxt: { flex: 1, color: colors.primary, fontWeight: '700', fontSize: 15 },
  navCtaChange: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  navSheetBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  navSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.md, paddingBottom: Platform.OS === 'ios' ? 34 : 24, gap: 10,
  },
  navSheetHandle: {
    width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 8,
  },
  navSheetTitle: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  navSheetSub: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', paddingHorizontal: 20, marginBottom: 10 },
  navOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, padding: 12,
  },
  navOptionActive: { borderColor: colors.primary, borderWidth: 1.5 },
  navOptionIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  navOptionTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  navOptionSub: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  navOptionDefault: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  navOptionDefaultTxt: { color: colors.success, fontWeight: '700', fontSize: 12 },
  navSheetCancel: {
    height: 50, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface2, borderRadius: radius.lg, marginTop: 4,
  },
  navSheetCancelTxt: { color: colors.textSecondary, fontWeight: '700', fontSize: 15 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.md, paddingTop: 12,
    // bottom padding is applied dynamically with safe-area insets
    backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1,
    gap: 10,
  },
  doneBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.successSoft, height: 56, borderRadius: radius.lg,
  },
  doneTxt: { color: colors.success, fontWeight: '700', fontSize: 15 },
  lockBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.warningSoft, borderRadius: radius.lg, padding: 12,
  },
  lockTitle: { color: colors.text, fontWeight: '700', fontSize: 14 },
  lockSub: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  lockBtn: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md },
  lockBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 13 },
});
