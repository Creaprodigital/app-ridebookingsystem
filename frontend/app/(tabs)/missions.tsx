import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, Platform, Modal } from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { colors, radius, spacing, shadow } from '../../src/theme';
import Chip, { type ChipTone } from '../../src/ui/Chip';
import RouteStops from '../../src/ui/RouteStops';
import { fmtPrice, fmtEuro, fmtTime, fmtDay } from '../../src/rideFormat';
import { haptic, playSound, ensureNotifPermission, notifyNewRide } from '../../src/feedback';
import { NOTIF_SOUNDS, getNotifSoundId } from '../../src/prefs';
import { isImmediateRide, pickPickupCoords, haversineKm, estimateEtaMin } from '../../src/rideTypes';
import { useRides } from '../../src/ridesContext';
import { formatPickupCountdown, useTicker } from '../../src/timeUtils';
import { getLastCoords, subscribeCoords } from '../../src/locationStore';
import AssignedMissionCard from '../../src/components/AssignedMissionCard';
import {
  getDriverMissions,
  getMarketplace,
  getMarketplaceConfig,
  claimMarketplace,
  getDriverProfile,
  getDriverWallet,
  apiError,
} from '../../src/api';

type Tab = 'assigned' | 'immediate' | 'available';

const STATUS_META: Record<string, { label: string; color: string }> = {
  assigned: { label: 'Assignée', color: colors.warning },
  en_route: { label: 'En route', color: colors.info },
  arrived: { label: 'Sur place', color: colors.info },
  in_progress: { label: 'À bord', color: colors.primary },
  completed: { label: 'Terminée', color: colors.success },
  cancelled: { label: 'Annulée', color: colors.danger },
};


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

function pickVehicleCategory(m: any) {
  return (
    m?.booking?.vehicle_category_label ||
    m?.vehicle_category_label ||
    m?.booking?.vehicle_category ||
    m?.vehicle_category
  );
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

/**
 * Extract the commission the platform/professional takes on this ride.
 * The exact field name varies across backend versions; we try the most
 * common shapes. Returns a number or null when no commission information
 * is available (in that case the UI hides the commission row).
 */
function pickCommission(m: any, configCommissionPct?: number) {
  // Direct numeric fields
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
  // Percentage-based (rare, but supported)
  const pct =
    m?.commission_pct ??
    m?.commission_percent ??
    m?.commission_percentage ??
    m?.pricing?.commission_pct ??
    configCommissionPct;
  const total = Number(pickAmount(m));
  if (Number.isFinite(total) && pct != null) {
    const p = Number(pct);
    if (Number.isFinite(p)) {
      const ratio = p > 1 ? p / 100 : p; // accept "20" or "0.2"
      return Number((total * ratio).toFixed(2));
    }
  }
  return null;
}

function pickDriverNet(m: any, configCommissionPct?: number) {
  // Strict rule (per business): Net chauffeur = Prix de la course − Commission.
  // We do not trust any backend "direct" field here because the operator may
  // have a different formula on their side. If either the total or the
  // commission cannot be resolved, we return null (UI hides the row).
  const total = Number(pickAmount(m));
  const com = Number(pickCommission(m, configCommissionPct));
  if (Number.isFinite(total) && Number.isFinite(com)) {
    return Number((total - com).toFixed(2));
  }
  return null;
}

function pickDistance(m: any) {
  return (
    m?.distance_km ??
    m?.pricing?.distance_km ??
    m?.distance ??
    m?.booking?.distance_km
  );
}


export default function MissionsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('assigned');
  // Re-render every 30 s so the per-card pickup countdowns stay fresh
  // without us having to re-fetch the whole list.
  useTicker(30_000);

  // Live driver coords (from foreground + background GPS) so the "À X km · Y min"
  // chips on the Immédiates tab stay accurate as the driver moves.
  const [me, setMe] = useState(() => {
    const c = getLastCoords();
    return c ? { lat: c.lat, lng: c.lng } : null;
  });
  useEffect(() => {
    const unsub = subscribeCoords((c) => {
      if (c) setMe({ lat: c.lat, lng: c.lng });
      else setMe(null);
    });
    return () => unsub();
  }, []);
  const [assigned, setAssigned] = useState<any[]>([]);
  const [available, setAvailable] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<any>(null);
  const [onShift, setOnShift] = useState<boolean | null>(null);
  const [debug, setDebug] = useState<string>('');
  const [walletBal, setWalletBal] = useState<number>(0);
  const [showTopupModal, setShowTopupModal] = useState<boolean>(false);
  // Pull the dismissById action from the global rides context so we can
  // refuse an immediate ride directly from the Missions → Immédiates tab.
  const { dismissById } = useRides();
  const pollRef = useRef<any>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef<boolean>(true);
  const soundIdRef = useRef<string>('classic');

  useEffect(() => {
    (async () => {
      soundIdRef.current = await getNotifSoundId();
      ensureNotifPermission();
    })();
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [a, av, cfg, prof, wal] = await Promise.allSettled([
        getDriverMissions(),
        getMarketplace(),
        getMarketplaceConfig(),
        getDriverProfile(),
        getDriverWallet(),
      ]);

      if (a.status === 'fulfilled') {
        const v: any = a.value;
        // Backend returns { current: [...], history: [...] }
        const list = Array.isArray(v) ? v : (v?.current ?? v?.items ?? []);
        setAssigned(list);
      } else {
        setAssigned([]);
      }

      if (av.status === 'fulfilled') {
        const v = av.value;
        const list = Array.isArray(v) ? v : v?.items ?? v?.listings ?? [];
        setAvailable(list);

        // Track ids; the global RidesProvider handles cross-screen notifications & sounds.
        const currentIds = new Set<string>(list.map((it: any) => String(it.id ?? it._id)));
        firstLoadRef.current = false;
        knownIdsRef.current = currentIds;
        // Detailed diagnostic
        const driverInfo: any = prof.status === 'fulfilled' ? prof.value : {};
        const u = driverInfo?.user || {};
        const tenantInfo = driverInfo?.tenant || {};
        const dbg: string[] = [];
        if (Array.isArray(v)) {
          dbg.push(`✓ Marketplace OK: ${list.length} course(s)`);
        } else if (v && typeof v === 'object') {
          const keys = Object.keys(v);
          dbg.push(keys.length === 0
            ? `Réponse vide {} → marketplace désactivée pour votre tenant`
            : `Marketplace: ${list.length} course(s) · Wrapper keys: ${keys.join(',')}`
          );
        }
        // Inspect first listing to find correct field names
        if (list.length > 0) {
          const first = list[0];
          const topKeys = Object.keys(first || {}).slice(0, 12).join(',');
          dbg.push(`Item keys: ${topKeys}`);
          if (first?.booking) {
            const bk = Object.keys(first.booking).slice(0, 12).join(',');
            dbg.push(`booking keys: ${bk}`);
          }
        }
        if (u.email) dbg.push(`Driver: ${u.email}`);
        if (u.tenant_id || tenantInfo.id) dbg.push(`Tenant: ${u.tenant_id || tenantInfo.id}`);
        if (cfg.status === 'fulfilled' && cfg.value) {
          const c: any = cfg.value;
          if (c.enabled !== undefined) dbg.push(`Config enabled: ${c.enabled}`);
        }
        setDebug(dbg.join('\n'));
      } else {
        setAvailable([]);
        const msg = apiError(av.reason);
        setError(msg);
        setDebug(`Erreur marketplace: ${msg}`);
      }

      if (cfg.status === 'fulfilled') {
        const raw: any = cfg.value;
        // Backend may wrap the response as { config: { ... } }; unwrap.
        setConfig(raw?.config ?? raw);
      }

      if (prof.status === 'fulfilled') {
        const p: any = prof.value;
        const shiftFlag = p?.user?.on_shift ?? p?.on_shift ?? p?.is_on_shift ?? p?.shift_active;
        setOnShift(Boolean(shiftFlag));
      }

      if (wal.status === 'fulfilled') {
        const w: any = wal.value;
        setWalletBal(Number(w?.balance_eur ?? 0));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      // Auto refresh marketplace every 20s while focused
      pollRef.current = setInterval(() => load(true), 20000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }, [load])
  );

  const requiredMinBalance = Number(config?.min_balance_eur ?? 0);
  const balanceTooLow = Boolean(config?.require_min_balance) && walletBal < requiredMinBalance;

  const requireOnShift = useCallback(() => {
    if (onShift === false) {
      haptic('warning');
      const msg = 'Vous êtes hors service. Passez en service depuis l’Accueil pour accéder aux courses.';
      if (Platform.OS !== 'web') Alert.alert('Hors ligne', msg);
      else if (typeof window !== 'undefined') window.alert(msg);
      return false;
    }
    return true;
  }, [onShift]);

  const claim = async (id: string) => {
    if (!requireOnShift()) return;
    if (balanceTooLow) {
      haptic('warning');
      setShowTopupModal(true);
      return;
    }
    haptic('medium');
    setClaimingId(id);
    try {
      await claimMarketplace(id);
      haptic('success');
      await load();
      setTab('assigned');
    } catch (e) {
      haptic('error');
      const msg = apiError(e);
      // Backend may also return balance error
      if (/solde|balance|seuil|recharg/i.test(msg)) {
        setShowTopupModal(true);
      } else if (Platform.OS !== 'web') {
        Alert.alert('Erreur', msg);
      } else {
        window.alert(msg);
      }
    } finally {
      setClaimingId(null);
    }
  };

  const openMission = (id: string) => {
    if (!requireOnShift()) return;
    router.push(`/mission/${id}`);
  };

  /**
   * Refuse an immediate ride from the Immédiates tab.
   *   • marks the ride as dismissed in the global rides context (so it
   *     doesn't re-pop in the modal for the next 60 s)
   *   • bumps the refused stats counter
   *   • removes the row immediately from the local list
   */
  const refuseImmediate = (id: string) => {
    if (!requireOnShift()) return;
    if (!id) return;
    haptic('warning');
    dismissById(id);
    setAvailable((prev) => prev.filter((r) => String(r.id ?? r._id) !== id));
  };

  // Split the marketplace feed into two visible lists:
  //   • visibleImmediate — immediate rides that haven't been claimed yet
  //     (the same items that trigger the full-screen Uber-style modal)
  //   • visibleAvailable — scheduled (planned) rides only
  // 'available' here means "not yet claimed by any driver" — the backend
  // marketplace endpoint already filters out claimed rides.
  const visibleImmediate = available.filter((it) => isImmediateRide(it));
  const visibleAvailable = available.filter((it) => !isImmediateRide(it));
  const data =
    tab === 'assigned' ? assigned :
    tab === 'immediate' ? visibleImmediate :
    visibleAvailable;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.h1}>Courses</Text>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => router.push('/(tabs)/history')}
          testID="open-history"
          accessibilityLabel="Historique des courses"
        >
          <Ionicons name="time-outline" size={21} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabsRow}>
        {(['assigned', 'immediate', 'available'] as Tab[]).map((t) => {
          const count =
            t === 'assigned' ? assigned.length :
            t === 'immediate' ? visibleImmediate.length :
            visibleAvailable.length;
          const label =
            t === 'assigned' ? 'Mes courses' :
            t === 'immediate' ? 'Immédiates' :
            'Planifiées';
          const active = tab === t;
          // Red badge on Immédiates while rides are waiting there, so the
          // driver notices them even without the full-screen modal.
          const urgent = t === 'immediate' && count > 0;
          return (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              style={[styles.tab, active && styles.tabActive]}
              testID={`tab-${t}`}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
                {label}
              </Text>
              {count > 0 ? (
                <View style={[styles.tabCount, urgent && styles.tabCountUrgent]}>
                  <Text style={[styles.tabCountText, urgent && styles.tabCountTextUrgent]}>{count}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={data}
        keyExtractor={(item, i) => String(item.id ?? item._id ?? i)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} tintColor={colors.primary} />}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingTop: 4, paddingBottom: 32 }}
        ListHeaderComponent={
          <View style={{ gap: 8 }}>
            {onShift === false ? (
              <View style={styles.offShiftBanner} testID="off-shift-banner">
                <Ionicons name="pause-circle" size={22} color={colors.warning} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.offShiftTitle}>Vous êtes hors service</Text>
                  <Text style={styles.offShiftSub}>
                    Passez en service pour accepter des courses et démarrer une mission.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.offShiftBtn}
                  onPress={() => router.push('/(tabs)')}
                  testID="off-shift-cta"
                >
                  <Text style={styles.offShiftBtnText}>Activer</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {(tab === 'available' || tab === 'immediate') ? (
              <>
                {/* Marketplace status banners */}
                {config && config.enabled === false ? (
                  <View style={styles.warnBanner} testID="market-disabled">
                    <Ionicons name="lock-closed" size={16} color={colors.warning} />
                    <Text style={styles.warnText}>
                      Le marketplace est désactivé pour votre flotte. Demandez à votre opérateur de l’activer.
                    </Text>
                  </View>
                ) : null}

                {error ? (
                  <View style={styles.errorBanner} testID="market-error">
                    <Ionicons name="alert-circle" size={16} color={colors.danger} />
                    <Text style={styles.errorText}>{error}</Text>
                    <TouchableOpacity onPress={() => load()} style={styles.retryBtn} testID="retry-btn">
                      <Ionicons name="refresh" size={14} color={colors.primary} />
                      <Text style={styles.retryText}>Réessayer</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {balanceTooLow ? (
                  <View style={styles.lowBalanceBanner} testID="low-balance-banner">
                    <Ionicons name="wallet" size={18} color={colors.danger} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lowBalanceTitle}>Portefeuille sous le seuil requis</Text>
                      <Text style={styles.lowBalanceSub}>
                        Vous devez avoir au moins {requiredMinBalance.toFixed(2)} € pour prendre une course.
                        Solde actuel : {walletBal.toFixed(2)} €.
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.lowBalanceBtn}
                      onPress={() => setShowTopupModal(true)}
                      testID="low-balance-recharge"
                    >
                      <Text style={styles.lowBalanceBtnText}>Recharger</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Tab-specific informational banner for IMMÉDIATES */}
                {tab === 'immediate' ? (
                  <View style={styles.immediateInfo} testID="immediate-info-banner">
                    <Ionicons name="flash" size={16} color={colors.danger} />
                    <Text style={styles.immediateInfoTxt}>
                      Ces courses sont à départ immédiat. Acceptez-les ici si vous avez raté la notification.
                    </Text>
                  </View>
                ) : null}

                {available.length > 0 ? (
                  <View style={styles.liveRow}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>En direct · mise à jour automatique</Text>
                  </View>
                ) : null}

                {debug && false ? (
                  <Text style={styles.debugTxt} testID="market-debug">{debug}</Text>
                ) : null}
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <View style={styles.empty}>
              <Ionicons
                name={
                  tab === 'assigned' ? 'checkmark-done' :
                  tab === 'immediate' ? 'flash-off' :
                  'search'
                }
                size={44}
                color={colors.textMuted}
              />
              <Text style={styles.emptyTitle}>
                {tab === 'assigned' ? 'Aucune course prévue' :
                 tab === 'immediate' ? 'Aucune course immédiate' :
                 'Aucune course disponible'}
              </Text>
              <Text style={styles.emptySub}>
                {tab === 'assigned'
                  ? 'Vos prochaines courses apparaîtront ici.'
                  : tab === 'immediate'
                  ? 'Aucune course à départ immédiat pour le moment. Quand une nouvelle arrive, une fenêtre prioritaire s\'affiche automatiquement. Cette page se rafraîchit toutes les 20 s.'
                  : 'Aucune course dans le marketplace pour le moment. Cette page se rafraîchit automatiquement toutes les 20 secondes.'}
              </Text>
              {(tab === 'available' || tab === 'immediate') ? (
                <TouchableOpacity onPress={() => load()} style={styles.retryBtn} testID="empty-refresh-btn">
                  <Ionicons name="refresh" size={14} color={colors.primary} />
                  <Text style={styles.retryText}>Rafraîchir maintenant</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )
        }
        renderItem={({ item }) => {
          const status = item.status || (tab !== 'assigned' ? 'open' : 'assigned');
          const meta = STATUS_META[status] ?? { label: status, color: colors.textSecondary };
          const price = pickAmount(item);
          const pax = pickPax(item);
          const vehicleCat = pickVehicleCategory(item);
          const isMarketplace = tab === 'available' || tab === 'immediate';
          // Visual kind tag: IMMÉDIATE vs PLANIFIÉE. Drivers must be able to
          // distinguish the two modes at a single glance.
          const immediate = isImmediateRide(item);
          // Pricing breakdown: total price + platform commission + driver net.
          // Commission can come from the listing itself (commission_eur,
          // commission_pct…) or fall back to the marketplace config.
          const cfgPct =
            (config?.commission_pct as number | undefined) ??
            (config?.commission_percent as number | undefined) ??
            (config?.commission_percentage as number | undefined);
          const commissionEur = pickCommission(item, cfgPct);
          const driverNet = pickDriverNet(item, cfgPct);

          // ─── NOUVEAU DESIGN « Mes missions » (assigned tab) ─────────
          if (tab === 'assigned') {
            return (
              <AssignedMissionCard
                item={item}
                driverPos={me}
                commissionEur={commissionEur}
                driverNet={driverNet}
                onOpen={() => openMission(String(item.id ?? item._id))}
                dimmed={onShift === false}
              />
            );
          }
          // ────────────────────────────────────────────────────────────
          // Distance + ETA from driver to pickup (live GPS based). We only
          // render these "À X km · Y min" pickup-badges on the Immédiates
          // tab because they're the most useful when the driver has to
          // decide right now. On the Planifiées tab, the trip distance
          // chip (already present) is more relevant.
          let pickupKm: number | null = null;
          let pickupEta: number | null = null;
          if (tab === 'immediate' && me) {
            const pc = pickPickupCoords(item);
            if (pc) {
              const km = haversineKm(me, pc);
              if (Number.isFinite(km)) {
                pickupKm = km;
                pickupEta = estimateEtaMin(km);
              }
            }
          }
          // Compute the live countdown to pickup. Re-renders are driven by
          // the top-level useTicker(30s). We hide the chip once the trip
          // has effectively started (no point counting down anymore).
          const hideCountdown = ['arrived', 'in_progress', 'completed', 'cancelled'].includes(String(status).toLowerCase());
          const cd = hideCountdown ? null : formatPickupCountdown(pickDt(item));
          const id = item.id ?? item._id;
          const dt = pickDt(item);
          const cdTone: ChipTone =
            cd?.kind === 'overdue' ? 'danger' : cd?.kind === 'soon' || cd?.kind === 'now' ? 'warning' : 'primary';
          const km = Number(pickDistance(item));
          return (
            <View
              style={[styles.card, onShift === false && styles.cardDimmed]}
              testID={`mission-card-${id}`}
            >
              <View style={styles.cardHead}>
                <View style={styles.timeWrap}>
                  <Text style={styles.time}>{fmtTime(dt) || '—'}</Text>
                  <Text style={styles.day}>{fmtDay(dt)}</Text>
                </View>
                <Text style={styles.price}>{fmtPrice(price)}</Text>
              </View>

              <View style={styles.chipsRow} testID={`kind-ribbon-${id}`}>
                <Chip
                  icon={immediate ? 'flash' : 'calendar-outline'}
                  label={immediate ? 'Immédiate' : 'Planifiée'}
                  tone={immediate ? 'danger' : 'primary'}
                />
                {isMarketplace ? (
                  <Chip label={item.auto_posted ? 'Automatique' : 'Compagnie'} />
                ) : (
                  <Chip label={meta.label} />
                )}
                {cd ? (
                  <Chip
                    icon={cd.kind === 'overdue' ? 'alert-circle' : 'time-outline'}
                    label={cd.label}
                    tone={cdTone}
                    testID={`countdown-${id}`}
                  />
                ) : null}
              </View>

              <RouteStops pickup={pickAddress(item, 'pickup')} dropoff={pickAddress(item, 'dropoff')} />

              <View style={styles.chipsRow}>
                {tab === 'immediate' && pickupKm != null ? (
                  <Chip
                    icon="navigate"
                    label={`À ${pickupKm < 10 ? pickupKm.toFixed(1).replace('.', ',') : Math.round(pickupKm)} km`}
                    tone="primary"
                    testID={`pickup-distance-${id}`}
                  />
                ) : null}
                {tab === 'immediate' && pickupEta != null ? (
                  <Chip icon="time" label={`${pickupEta} min`} tone="primary" testID={`pickup-eta-${id}`} />
                ) : null}
                {tab === 'immediate' && pickupKm == null ? (
                  <Chip icon="locate-outline" label="Position en attente…" testID={`pickup-distance-pending-${id}`} />
                ) : null}
                {vehicleCat ? <Chip icon="car-outline" label={String(vehicleCat)} testID={`vehicle-cat-${id}`} /> : null}
                {pax ? <Chip icon="people-outline" label={String(pax)} testID={`pax-${id}`} /> : null}
                {Number.isFinite(km) && km > 0 ? (
                  <Chip icon="git-commit-outline" label={`${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`} />
                ) : null}
              </View>

              {driverNet != null || (commissionEur != null && commissionEur > 0) ? (
                <View style={styles.moneyRow}>
                  {commissionEur != null && commissionEur > 0 ? (
                    <Text style={styles.moneyTxt} testID={`commission-${id}`}>
                      Commission −{fmtEuro(commissionEur)}
                    </Text>
                  ) : <View />}
                  {driverNet != null ? (
                    <Text style={styles.moneyTxt} testID={`driver-net-${id}`}>
                      Net chauffeur <Text style={styles.netVal}>{fmtEuro(driverNet)}</Text>
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {tab === 'available' ? (
                <TouchableOpacity
                  style={[styles.claimBtn, onShift === false && styles.claimBtnDisabled]}
                  onPress={() => claim(id)}
                  disabled={claimingId === id}
                  testID={`claim-${id}`}
                >
                  {claimingId === id ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <>
                      <Ionicons name={onShift === false ? 'lock-closed' : 'checkmark'} size={18} color={colors.onPrimary} />
                      <Text style={styles.claimText}>
                        {onShift === false ? 'Passez en service' : 'Accepter la course'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : tab === 'immediate' ? (
                <View style={styles.immediateActions}>
                  <TouchableOpacity
                    style={[styles.refuseBtn, onShift === false && styles.refuseBtnDisabled]}
                    onPress={() => refuseImmediate(String(id))}
                    disabled={onShift === false || claimingId === id}
                    testID={`refuse-${id}`}
                  >
                    <Ionicons name="close" size={18} color={colors.danger} />
                    <Text style={styles.refuseText}>Refuser</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.acceptBtn, onShift === false && styles.claimBtnDisabled]}
                    onPress={() => claim(id)}
                    disabled={claimingId === id || onShift === false}
                    testID={`accept-${id}`}
                  >
                    {claimingId === id ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name={onShift === false ? 'lock-closed' : 'checkmark'} size={18} color="#fff" />
                        <Text style={styles.acceptText}>
                          {onShift === false ? 'Hors service' : 'Accepter'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          );
        }}
      />

      {/* Low balance — Top-up modal */}
      <Modal visible={showTopupModal} animationType="fade" transparent onRequestClose={() => setShowTopupModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="balance-modal">
            <View style={styles.modalIconWrap}>
              <Ionicons name="wallet" size={36} color={colors.danger} />
            </View>
            <Text style={styles.modalTitle}>Solde insuffisant</Text>
            <Text style={styles.modalText}>
              Votre solde de portefeuille est sous le seuil minimum exigé par votre flotte pour
              prendre une nouvelle course.
            </Text>

            <View style={styles.modalRow}>
              <View style={styles.modalCell}>
                <Text style={styles.modalCellLbl}>Solde actuel</Text>
                <Text style={[styles.modalCellVal, { color: colors.danger }]}>
                  {walletBal.toFixed(2)} €
                </Text>
              </View>
              <View style={styles.modalCell}>
                <Text style={styles.modalCellLbl}>Seuil requis</Text>
                <Text style={[styles.modalCellVal, { color: colors.primary }]}>
                  {requiredMinBalance.toFixed(2)} €
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.modalPrimaryBtn}
              onPress={() => {
                setShowTopupModal(false);
                router.push('/(tabs)/earnings');
              }}
              testID="modal-recharge-btn"
            >
              <Ionicons name="add-circle" size={18} color={colors.onPrimary} />
              <Text style={styles.modalPrimaryText}>Recharger le portefeuille</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalGhostBtn}
              onPress={() => setShowTopupModal(false)}
              testID="modal-cancel-btn"
            >
              <Text style={styles.modalGhostText}>Plus tard</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 12,
  },
  h1: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  headerBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  tabsRow: {
    flexDirection: 'row', marginHorizontal: spacing.md, marginBottom: 12, padding: 4, gap: 4,
    backgroundColor: colors.surface2, borderRadius: 14,
  },
  tab: {
    flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 9, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  tabActive: { backgroundColor: colors.surface, ...shadow },
  tabText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13.5 },
  tabTextActive: { color: colors.text, fontWeight: '700' },
  tabCount: {
    minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10,
    backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center',
  },
  tabCountUrgent: { backgroundColor: colors.danger },
  tabCountText: { color: colors.primary, fontSize: 11.5, fontWeight: '800' },
  tabCountTextUrgent: { color: '#fff' },
  immediateInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.dangerSoft, borderRadius: radius.lg,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  immediateInfoTxt: { color: colors.text, fontSize: 13, fontWeight: '500', flex: 1, lineHeight: 18 },
  empty: { alignItems: 'center', paddingTop: 70, gap: 10 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 4 },
  emptySub: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 36, lineHeight: 20 },
  liveRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: colors.successSoft, borderRadius: radius.full, alignSelf: 'flex-start',
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  liveText: { color: colors.success, fontWeight: '700', fontSize: 12 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.dangerSoft, borderRadius: radius.lg, padding: 12,
  },
  errorText: { color: colors.danger, fontSize: 13, fontWeight: '600', flex: 1 },
  warnBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.warningSoft, borderRadius: radius.lg, padding: 12,
  },
  warnText: { color: colors.text, fontSize: 13, fontWeight: '500', flex: 1, lineHeight: 18 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
  },
  retryText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  debugTxt: { color: colors.textMuted, fontSize: 10 },
  offShiftBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.warningSoft, borderRadius: radius.lg, padding: 14,
  },
  offShiftTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  offShiftSub: { color: colors.textSecondary, fontSize: 13, marginTop: 2, lineHeight: 18 },
  offShiftBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  offShiftBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 13 },
  lowBalanceBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.dangerSoft, borderRadius: radius.lg, padding: 14,
  },
  lowBalanceTitle: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  lowBalanceSub: { color: colors.text, fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  lowBalanceBtn: {
    backgroundColor: colors.danger, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  lowBalanceBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, gap: 12, marginBottom: 10, ...shadow,
  },
  cardDimmed: { opacity: 0.55 },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  timeWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexShrink: 1 },
  time: { color: colors.text, fontSize: 22, fontWeight: '800' },
  day: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  price: { color: colors.text, fontSize: 22, fontWeight: '800' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  moneyRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10,
  },
  moneyTxt: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  netVal: { color: colors.success, fontSize: 14, fontWeight: '800' },
  claimBtn: {
    height: 50, borderRadius: radius.lg, backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  claimBtnDisabled: { backgroundColor: colors.textMuted },
  claimText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15.5 },
  immediateActions: { flexDirection: 'row', gap: 10 },
  refuseBtn: {
    flex: 1, height: 50, borderRadius: radius.lg, backgroundColor: colors.surface2,
    borderWidth: 1, borderColor: colors.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  refuseBtnDisabled: { opacity: 0.5 },
  refuseText: { color: colors.danger, fontWeight: '700', fontSize: 15.5 },
  acceptBtn: {
    flex: 2, height: 50, borderRadius: radius.lg, backgroundColor: colors.success,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  acceptText: { color: '#fff', fontWeight: '700', fontSize: 15.5 },
  modalBackdrop: {
    flex: 1, backgroundColor: colors.overlay, padding: spacing.lg, justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg,
    alignItems: 'center', gap: 12,
  },
  modalIconWrap: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: colors.dangerSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  modalText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  modalRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  modalCell: {
    flex: 1, backgroundColor: colors.surface2, borderRadius: radius.lg, padding: 12, alignItems: 'center',
  },
  modalCellLbl: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  modalCellVal: { fontSize: 20, fontWeight: '800', marginTop: 2 },
  modalPrimaryBtn: {
    alignSelf: 'stretch', height: 52, borderRadius: radius.lg, backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  modalPrimaryText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15.5 },
  modalGhostBtn: { paddingVertical: 10 },
  modalGhostText: { color: colors.textSecondary, fontWeight: '600', fontSize: 14 },
});
