/**
 * Carte « Mes courses » : heure de prise en charge + compte à rebours, prix,
 * statut, trajet départ → arrivée, puis les infos clés en étiquettes
 * (véhicule, passagers, distance, approche, net chauffeur). Toute la carte
 * ouvre le détail.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '../ui/Text';
import { colors, radius, spacing, shadow } from '../theme';
import {
  fetchRoute,
  fmtDistanceKm,
  fmtDurationMin,
  type DirectionsResult,
  type LatLng,
} from '../directions';
import { isImmediateRide } from '../rideTypes';
import { formatPickupCountdown } from '../timeUtils';
import Chip, { type ChipTone } from '../ui/Chip';
import RouteStops from '../ui/RouteStops';
import { pickAddress, pickDt, pickPax, pickAmount, pickVehicleCategory, pickDistance, fmtPrice, fmtEuro, fmtTime, fmtDay } from '../rideFormat';


function pickLatLng(m: any, t: 'pickup' | 'dropoff'): LatLng | null {
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






const STATUS_META: Record<string, { label: string; tone: ChipTone }> = {
  assigned: { label: 'Assignée', tone: 'primary' },
  accepted: { label: 'Acceptée', tone: 'primary' },
  en_route: { label: 'En route', tone: 'primary' },
  arrived: { label: 'Sur place', tone: 'warning' },
  in_progress: { label: 'À bord', tone: 'success' },
  completed: { label: 'Terminée', tone: 'success' },
  cancelled: { label: 'Annulée', tone: 'danger' },
};

type Props = {
  item: any;
  driverPos: LatLng | null;
  commissionEur: number | null;
  driverNet: number | null;
  onOpen: () => void;
  dimmed?: boolean;
};

export default function AssignedMissionCard({
  item,
  driverPos,
  commissionEur,
  driverNet,
  onOpen,
  dimmed,
}: Props) {
  const immediate = isImmediateRide(item);
  const status = String(item?.status || 'assigned').toLowerCase();
  const meta = STATUS_META[status] ?? { label: status, tone: 'neutral' as ChipTone };

  const pickup = useMemo(() => pickLatLng(item, 'pickup'), [item]);
  const dropoff = useMemo(() => pickLatLng(item, 'dropoff'), [item]);

  // ── Leg 1 : Driver → Pickup (jaune) ─────────────────────────────────
  const [leg1, setLeg1] = useState<DirectionsResult | null>(null);
  // ── Leg 2 : Pickup → Dropoff (vert) ─────────────────────────────────
  const [leg2, setLeg2] = useState<DirectionsResult | null>(null);

  useEffect(() => {
    let alive = true;
    if (!driverPos || !pickup) {
      setLeg1(null);
      return;
    }
    (async () => {
      const r = await fetchRoute(driverPos, pickup);
      if (alive) setLeg1(r);
    })();
    return () => { alive = false; };
  }, [driverPos?.lat, driverPos?.lng, pickup?.lat, pickup?.lng]);

  useEffect(() => {
    let alive = true;
    if (!pickup || !dropoff) {
      setLeg2(null);
      return;
    }
    (async () => {
      const r = await fetchRoute(pickup, dropoff);
      if (alive) setLeg2(r);
    })();
    return () => { alive = false; };
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  const totalDist = (leg1?.distanceMeters ?? 0) + (leg2?.distanceMeters ?? 0);
  const bookingKm = Number(pickDistance(item));

  const dt = pickDt(item);
  const cd = formatPickupCountdown(dt);
  const cdTone: ChipTone =
    cd?.kind === 'overdue' ? 'danger' : cd?.kind === 'soon' || cd?.kind === 'now' ? 'warning' : 'primary';

  const price = pickAmount(item);
  const pax = pickPax(item);
  const vehicle = pickVehicleCategory(item);
  const id = item.id ?? item._id;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onOpen}
      style={[styles.card, dimmed && styles.cardDimmed]}
      testID={`assigned-card-${id}`}
    >
      <View style={styles.headerRow}>
        <View style={styles.timeWrap}>
          <Text style={styles.time}>{fmtTime(dt) || '—'}</Text>
          <Text style={styles.day}>{fmtDay(dt)}</Text>
        </View>
        <Text style={styles.price} numberOfLines={1} testID={`assigned-price-${id}`}>
          {fmtPrice(price)}
        </Text>
      </View>

      <View style={styles.chipsRow}>
        {immediate ? <Chip icon="flash" label="Immédiate" tone="danger" /> : null}
        <Chip label={meta.label} tone={meta.tone} />
        {cd ? (
          <Chip
            icon={cd.kind === 'overdue' ? 'alert-circle' : 'time-outline'}
            label={cd.label}
            tone={cdTone}
            testID={`assigned-cd-${id}`}
          />
        ) : null}
      </View>

      <RouteStops pickup={pickAddress(item, 'pickup')} dropoff={pickAddress(item, 'dropoff')} />

      <View style={styles.chipsRow}>
        {vehicle ? <Chip icon="car-outline" label={String(vehicle)} /> : null}
        {pax ? <Chip icon="people-outline" label={String(pax)} /> : null}
        {totalDist > 0 ? (
          <Chip icon="git-commit-outline" label={fmtDistanceKm(totalDist)} testID={`assigned-total-${id}`} />
        ) : Number.isFinite(bookingKm) && bookingKm > 0 ? (
          <Chip icon="git-commit-outline" label={`${Math.round(bookingKm)} km`} />
        ) : null}
        {leg1 ? (
          <Chip
            icon="navigate-outline"
            label={`Approche ${fmtDurationMin(leg1.durationSec)}`}
            tone="primary"
            testID={`assigned-leg1-${id}`}
          />
        ) : null}
      </View>

      {driverNet != null || (commissionEur != null && commissionEur > 0) ? (
        <View style={styles.moneyRow}>
          {commissionEur != null && commissionEur > 0 ? (
            <Text style={styles.commission} testID={`assigned-commission-${id}`}>
              Commission −{fmtEuro(commissionEur)}
            </Text>
          ) : <View />}
          {driverNet != null ? (
            <Text style={styles.net} testID={`assigned-net-${id}`}>
              Net chauffeur <Text style={styles.netVal}>{fmtEuro(driverNet)}</Text>
            </Text>
          ) : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 12,
    marginBottom: 10,
    ...shadow,
  },
  cardDimmed: { opacity: 0.55 },
  headerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  timeWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexShrink: 1 },
  time: { color: colors.text, fontSize: 22, fontWeight: '800' },
  day: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  price: { color: colors.text, fontSize: 22, fontWeight: '800' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  moneyRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10,
  },
  commission: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  net: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  netVal: { color: colors.success, fontSize: 14, fontWeight: '800' },
});
