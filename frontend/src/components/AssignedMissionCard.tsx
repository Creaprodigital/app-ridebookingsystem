/**
 * Carte « Mes missions » — redesign pixel-perfect basé sur la maquette
 * fournie par l’utilisateur.
 *
 * Affichage :
 *  1. Header : badge type de course (PLANIFIÉE / IMMÉDIATE) + countdown
 *  2. Stats : STATUT · PRIX · (Commission / Net chauffeur)
 *  3. Route : DÉPART/ARRIVÉE avec badges Leg 1 et Leg 2 (Google Directions)
 *  4. 3 chips bas : Date & heure · Passagers · Distance totale (leg1 + leg2)
 *  5. Bouton « VOIR DÉTAILS »
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme';
import {
  fetchRoute,
  fmtDistanceKm,
  fmtDurationMin,
  type DirectionsResult,
  type LatLng,
} from '../directions';
import { isImmediateRide } from '../rideTypes';
import { formatPickupCountdown, countdownStyle } from '../timeUtils';

// ── Helpers (gardés ici en mode local pour limiter les imports croisés) ──
function pickAddress(m: any, type: 'pickup' | 'dropoff') {
  const b = m?.booking || {};
  return (
    b[`${type}_address`] ||
    m?.[`${type}_address`] ||
    m?.[type]?.address ||
    m?.[`${type}`] ||
    m?.[`${type}_location`]?.address ||
    (type === 'dropoff' ? 'À disposition' : '—')
  );
}

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

function pickDt(m: any) {
  return (
    m?.booking?.pickup_at ||
    m?.pickup_at ||
    m?.scheduled_at ||
    m?.pickup_time ||
    m?.created_at
  );
}

function pickPax(m: any) {
  return m?.booking?.pax ?? m?.pax ?? m?.passengers ?? m?.passenger_count;
}

function pickAmount(m: any) {
  return (
    m?.amount ??
    m?.pricing?.final ??
    m?.price ??
    m?.fare ??
    m?.total ??
    m?.booking?.price
  );
}

function fmtMoney(v: any) {
  const n = Number(v);
  if (Number.isFinite(n)) return `${n.toFixed(2)} €`;
  return '—';
}

function fmtDate(dt?: string) {
  if (!dt) return '—';
  try {
    const d = new Date(dt);
    const date = d.toLocaleDateString('fr-FR');
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `${date}\n${time}`;
  } catch {
    return dt;
  }
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  assigned: { label: 'ASSIGNÉE', color: colors.success },
  en_route: { label: 'EN ROUTE', color: colors.info },
  arrived: { label: 'SUR PLACE', color: colors.info },
  in_progress: { label: 'À BORD', color: colors.primary },
  completed: { label: 'TERMINÉE', color: colors.success },
  cancelled: { label: 'ANNULÉE', color: colors.danger },
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
  const meta = STATUS_META[status] ?? { label: status.toUpperCase(), color: colors.textSecondary };

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

  const cd = formatPickupCountdown(pickDt(item));
  const cdStyles = cd ? countdownStyle(cd.kind) : null;

  const price = pickAmount(item);
  const pax = pickPax(item);
  const date = fmtDate(pickDt(item));

  return (
    <View
      style={[
        styles.card,
        immediate ? styles.cardImmediate : styles.cardPlanned,
        dimmed && styles.cardDimmed,
      ]}
      testID={`assigned-card-${item.id ?? item._id}`}
    >
      {/* ─── HEADER : Type + Countdown ────────────────────────────── */}
      <View style={styles.headerRow}>
        <View
          style={[
            styles.kindPill,
            immediate ? styles.kindPillImmediate : styles.kindPillPlanned,
          ]}
        >
          <Ionicons
            name={immediate ? 'flash' : 'calendar'}
            size={14}
            color={immediate ? '#fff' : colors.primary}
          />
          <Text
            style={[
              styles.kindPillTxt,
              { color: immediate ? '#fff' : colors.primary },
            ]}
          >
            {immediate ? 'COURSE IMMÉDIATE' : 'COURSE PLANIFIÉE'}
          </Text>
        </View>
        {cd && cdStyles ? (
          <View style={[styles.cdPill, cdStyles.chip]} testID={`assigned-cd-${item.id ?? item._id}`}>
            <Ionicons
              name={cd.kind === 'overdue' ? 'alert-circle' : 'time-outline'}
              size={13}
              color={cdStyles.fg}
            />
            <Text style={[styles.cdPillTxt, { color: cdStyles.fg }]}>{cd.label}</Text>
          </View>
        ) : null}
      </View>

      {/* ─── STATS : STATUT · PRIX · COMMISSION/NET ───────────────── */}
      <View style={styles.statsRow}>
        <View style={styles.statCol}>
          <Text style={styles.statLbl}>STATUT</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
            <Text style={[styles.statusTxt, { color: meta.color }]} numberOfLines={1}>
              {meta.label}
            </Text>
          </View>
        </View>

        <View style={[styles.statCol, { alignItems: 'center' }]}>
          <Text style={styles.statLbl}>PRIX DE LA COURSE</Text>
          <Text style={styles.priceVal} testID={`assigned-price-${item.id ?? item._id}`}>
            {fmtMoney(price)}
          </Text>
        </View>

        <View style={[styles.statCol, { alignItems: 'flex-end' }]}>
          {commissionEur != null && commissionEur > 0 ? (
            <View style={styles.commissionRow}>
              <Ionicons name="business-outline" size={12} color={colors.danger} />
              <Text style={styles.commissionLbl} numberOfLines={1}>Commission</Text>
              <Text style={styles.commissionVal} testID={`assigned-commission-${item.id ?? item._id}`}>
                −{Number(commissionEur).toFixed(2)} €
              </Text>
            </View>
          ) : null}
          {driverNet != null ? (
            <View style={[styles.commissionRow, { marginTop: 4 }]}>
              <Ionicons name="cash-outline" size={12} color={colors.success} />
              <Text style={[styles.commissionLbl, { color: colors.textSecondary }]} numberOfLines={1}>Net</Text>
              <Text style={styles.netVal} testID={`assigned-net-${item.id ?? item._id}`}>
                {Number(driverNet).toFixed(2)} €
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* ─── ROUTE BLOCK ─────────────────────────────────────────── */}
      <View style={styles.routeBlock}>
        <View style={styles.routeLine}>
          <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
          <View style={styles.routeVert} />
          <View style={[styles.routeDot, { backgroundColor: colors.danger }]} />
        </View>
        <View style={{ flex: 1, gap: spacing.md }}>
          {/* DÉPART */}
          <View style={styles.routeItem}>
            <View style={{ flex: 1 }}>
              <Text style={styles.routeLbl}>DÉPART</Text>
              <Text style={styles.routeAddr} numberOfLines={2}>
                {pickAddress(item, 'pickup')}
              </Text>
            </View>
            {leg1 ? (
              <View style={[styles.legChip, styles.legChipYellow]} testID={`assigned-leg1-${item.id ?? item._id}`}>
                <Ionicons name="navigate" size={11} color={colors.primary} />
                <Text style={[styles.legChipTxt, { color: colors.primary }]}>
                  {fmtDistanceKm(leg1.distanceMeters)} · {fmtDurationMin(leg1.durationSec)}
                </Text>
              </View>
            ) : null}
          </View>
          {/* ARRIVÉE */}
          <View style={styles.routeItem}>
            <View style={{ flex: 1 }}>
              <Text style={styles.routeLbl}>ARRIVÉE</Text>
              <Text style={styles.routeAddr} numberOfLines={3}>
                {pickAddress(item, 'dropoff')}
              </Text>
            </View>
            {leg2 ? (
              <View style={[styles.legChip, styles.legChipGreen]} testID={`assigned-leg2-${item.id ?? item._id}`}>
                <Ionicons name="car" size={11} color={colors.success} />
                <Text style={[styles.legChipTxt, { color: colors.success }]}>
                  {fmtDistanceKm(leg2.distanceMeters)} · {fmtDurationMin(leg2.durationSec)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* ─── BOTTOM STATS : Date · Passagers · Distance totale ──── */}
      <View style={styles.bottomStats}>
        <View style={styles.bottomStat}>
          <Ionicons name="calendar" size={14} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bottomStatLbl}>DATE & HEURE</Text>
            <Text style={styles.bottomStatVal}>{date}</Text>
          </View>
        </View>
        <View style={styles.bottomStat}>
          <Ionicons name="person" size={14} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bottomStatLbl}>PASSAGERS</Text>
            <Text style={styles.bottomStatVal}>{pax ? `${pax} pax` : '—'}</Text>
          </View>
        </View>
        <View style={styles.bottomStat}>
          <Ionicons name="navigate" size={14} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bottomStatLbl}>DISTANCE TOTALE</Text>
            <Text style={styles.bottomStatVal} testID={`assigned-total-${item.id ?? item._id}`}>
              {totalDist > 0 ? fmtDistanceKm(totalDist) : '—'}
            </Text>
          </View>
        </View>
      </View>

      {/* ─── CTA : VOIR DÉTAILS ─────────────────────────────────── */}
      <TouchableOpacity
        style={styles.detailsBtn}
        onPress={onOpen}
        activeOpacity={0.85}
        testID={`assigned-details-${item.id ?? item._id}`}
      >
        <Text style={styles.detailsTxt}>VOIR DÉTAILS</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.md,
  },
  cardImmediate: { borderLeftColor: colors.danger, borderLeftWidth: 4 },
  cardPlanned: { borderLeftColor: colors.primary, borderLeftWidth: 4 },
  cardDimmed: { opacity: 0.55 },

  // Header row
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  kindPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1,
  },
  kindPillImmediate: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  kindPillPlanned: {
    backgroundColor: colors.primary + '14',
    borderColor: colors.primary + '88',
  },
  kindPillTxt: { fontSize: 11, fontWeight: '900', letterSpacing: 0.9 },
  cdPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999, borderWidth: 1,
  },
  cdPillTxt: { fontSize: 12, fontWeight: '900', letterSpacing: 0.3 },

  // Stats row
  statsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  statCol: { flex: 1, gap: 4 },
  statLbl: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusTxt: { fontSize: 13, fontWeight: '900', letterSpacing: 0.4 },
  priceVal: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  commissionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  commissionLbl: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  commissionVal: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '900',
  },
  netVal: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '900',
  },

  // Route block
  routeBlock: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  routeLine: { alignItems: 'center', paddingTop: 6, paddingBottom: 6, width: 14 },
  routeDot: { width: 12, height: 12, borderRadius: 6 },
  routeVert: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 4 },
  routeItem: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  routeLbl: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  routeAddr: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 2 },
  legChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
  },
  legChipYellow: {
    backgroundColor: colors.primary + '15',
    borderColor: colors.primary + '88',
  },
  legChipGreen: {
    backgroundColor: colors.success + '18',
    borderColor: colors.success + '88',
  },
  legChipTxt: { fontSize: 10, fontWeight: '900', letterSpacing: 0.3 },

  // Bottom stats (3-cell grid)
  bottomStats: {
    flexDirection: 'row',
    gap: 8,
  },
  bottomStat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
  },
  bottomStatLbl: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  bottomStatVal: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },

  // CTA
  detailsBtn: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primary + '0F',
  },
  detailsTxt: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
});
