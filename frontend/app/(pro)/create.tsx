import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Image, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import ProHeader from '../../src/components/ProHeader';
import { useAuth } from '../../src/auth';
import {
  createBooking, quoteBooking, getProVehicleCategories, getProDrivers,
  ProCategory, ProDriver, getProMapsConfig,
} from '../../src/proApi';
import { getProClients, ProClient } from '../../src/proClients';
import { haptic } from '../../src/feedback';
import AddressInput from '../../src/components/AddressInput';

// ─────────────────────────────────────────────────────────────────────────
// Types / helpers
// ─────────────────────────────────────────────────────────────────────────

type TripType = 'one_way' | 'round_trip' | 'hourly' | 'pool' | 'tour';
type PayMode = 'card_online' | 'cash_onboard' | 'card_onboard';

const ALL_TRIP_TYPES: { k: TripType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { k: 'one_way', label: 'Aller simple', icon: 'arrow-forward' },
  { k: 'round_trip', label: 'Aller-retour', icon: 'swap-horizontal' },
  { k: 'hourly', label: 'Mise à disposition', icon: 'time-outline' },
  { k: 'pool', label: 'Taxi Partagé', icon: 'people-outline' },
  { k: 'tour', label: 'Circuit touristique', icon: 'compass-outline' },
];

const ALL_PAY_OPTIONS: { k: PayMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { k: 'card_online', label: 'À bord', icon: 'card-outline' },
  { k: 'cash_onboard', label: 'Espèces à bord', icon: 'cash-outline' },
  { k: 'card_onboard', label: 'CB à bord (TPE)', icon: 'card' },
];

// Trip types where "Prise en charge maintenant" cannot apply — these need
// advance scheduling because of vehicle/driver coordination.
const FORCE_LATER: TripType[] = ['hourly', 'pool', 'tour'];

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function fmtDate(d: Date) { return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; }
function buildIso(date: Date, h: number, m: number) {
  const d = new Date(date); d.setHours(h, m, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:${pad(m)}`;
}
function clientName(c: ProClient) {
  return `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || '—';
}
// Price exactly as computed by the backend quote (no client-side adjustment).
function quotePrice(q: any): number | null {
  if (!q) return null;
  const v = Number(q.final ?? q.total ?? q.subtotal);
  return Number.isFinite(v) ? v : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────

export default function CreateBookingScreen() {
  const router = useRouter();
  const { tenant } = useAuth();
  const tenantId = tenant?.id;
  const tt = (tenant as any)?.trip_types_config || {};
  const pc = (tenant as any)?.payment_config || {};
  const pool = (tenant as any)?.pool_config || {};

  // Filter trip types from tenant config — hidden if disabled in backoffice
  const TRIP_TYPES = useMemo(() => {
    return ALL_TRIP_TYPES.filter((t) => {
      if (t.k === 'one_way') return tt?.one_way?.enabled !== false;
      if (t.k === 'round_trip') return tt?.round_trip?.enabled === true;
      if (t.k === 'hourly') return tt?.hourly?.enabled === true;
      if (t.k === 'pool') return pool?.enabled === true;
      if (t.k === 'tour') return tt?.tour?.enabled === true || (tt?.tour_circuit?.enabled === true);
      return false;
    });
  }, [tt, pool]);

  // Filter payment methods from tenant config — only enabled methods show up.
  // "À bord" (online) appears if any online gateway is enabled (Stripe / PayPal / SumUp / MyPOS).
  const PAY_OPTIONS = useMemo(() => {
    return ALL_PAY_OPTIONS.filter((p) => {
      if (p.k === 'online') {
        return !!(pc?.stripe?.enabled || pc?.paypal?.enabled || pc?.sumup?.enabled || pc?.mypos?.enabled);
      }
      if (p.k === 'cash_onboard') return pc?.cash_onboard_enabled === true;
      if (p.k === 'card_onboard') return pc?.card_onboard_enabled === true;
      return false;
    });
  }, [pc]);

  // Form state
  const [tripType, setTripType] = useState<TripType>('one_way');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('later');

  // Auto-pick the first available trip type / payment method once the tenant
  // config has loaded, and force "later" scheduling for restricted services.
  useEffect(() => {
    if (TRIP_TYPES.length > 0 && !TRIP_TYPES.find((t) => t.k === tripType)) {
      setTripType(TRIP_TYPES[0].k);
    }
  }, [TRIP_TYPES, tripType]);
  useEffect(() => {
    if (FORCE_LATER.includes(tripType) && scheduleMode === 'now') {
      setScheduleMode('later');
    }
  }, [tripType, scheduleMode]);
  const nowDisabled = FORCE_LATER.includes(tripType);
  const [date, setDate] = useState<Date>(() => { const d = new Date(); d.setDate(d.getDate()); return d; });
  const [hour, setHour] = useState<number>(() => new Date().getHours());
  const [minute, setMinute] = useState<number>(0);
  const [pax, setPax] = useState(1);
  const [bags, setBags] = useState(0);
  const [categories, setCategories] = useState<ProCategory[]>([]);
  const [vehicleType, setVehicleType] = useState<string | null>(null);
  const [manualPrice, setManualPrice] = useState<string>('');
  const [clients, setClients] = useState<ProClient[]>([]);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [hourPickerOpen, setHourPickerOpen] = useState(false);
  const [minutePickerOpen, setMinutePickerOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ProClient | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [flightNumber, setFlightNumber] = useState('');
  const [trainNumber, setTrainNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [payment, setPayment] = useState<PayMode>('card_online');

  // Auto-pick the first available payment method once the tenant config loads.
  useEffect(() => {
    if (PAY_OPTIONS.length > 0 && !PAY_OPTIONS.find((p) => p.k === payment)) {
      setPayment(PAY_OPTIONS[0].k);
    }
  }, [PAY_OPTIONS, payment]);
  const [drivers, setDrivers] = useState<ProDriver[]>([]); // used only for marketplace flow
  // One backend quote per vehicle category (key '' = no category).
  const [quotes, setQuotes] = useState<Record<string, any>>({});
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mapsKey, setMapsKey] = useState<string | undefined>(undefined);
  const [mapsCountry, setMapsCountry] = useState<string>('fr');

  // Load static data once
  useEffect(() => {
    (async () => {
      try {
        const [cats, drvs, cls, mapsCfg] = await Promise.all([
          getProVehicleCategories(),
          getProDrivers().catch(() => []),
          getProClients().catch(() => []),
          getProMapsConfig().catch(() => null),
        ]);
        setCategories(cats);
        if (cats?.[0]) setVehicleType(cats[0].id);
        setDrivers(drvs);
        setClients(cls);
        if (mapsCfg?.google_maps_api_key) setMapsKey(mapsCfg.google_maps_api_key);
        if (mapsCfg?.country) setMapsCountry(mapsCfg.country);
      } catch {}
    })();
  }, []);

  const isoPickup = useMemo(() => {
    if (scheduleMode === 'now') {
      const d = new Date(); d.setMinutes(d.getMinutes() + 15);
      return buildIso(d, d.getHours(), d.getMinutes());
    }
    return buildIso(date, hour, minute);
  }, [scheduleMode, date, hour, minute]);

  // Auto-quote whenever required fields change
  const canQuote = !!(tenantId && pickup.trim() && isoPickup);
  const triggerQuote = useCallback(async () => {
    if (!canQuote || !tenantId) return;
    setQuoting(true);
    const ids = categories.length ? categories.map((c) => c.id) : [''];
    const results = await Promise.all(ids.map(async (id) => {
      try {
        const q = await quoteBooking({
          tenant_id: tenantId,
          pickup_address: pickup.trim(),
          dropoff_address: dropoff.trim() || undefined,
          pickup_at: isoPickup,
          trip_type: tripType,
          vehicle_type: id || undefined,
          pax,
          bags,
        });
        return [id, q] as const;
      } catch {
        return [id, null] as const;
      }
    }));
    const next: Record<string, any> = {};
    results.forEach(([id, q]) => { if (q) next[id] = q; });
    setQuotes(next);
    setQuoting(false);
  }, [canQuote, tenantId, pickup, dropoff, isoPickup, tripType, pax, bags, categories]);

  useEffect(() => {
    const id = setTimeout(() => { triggerQuote(); }, 700);
    return () => clearTimeout(id);
  }, [pickup, dropoff, isoPickup, tripType, triggerQuote]);

  const quote = quotes[vehicleType || ''] ?? Object.values(quotes)[0] ?? null;
  const selectedPrice = quotePrice(quote);

  // When user fills manualPrice, use that for submission. Otherwise use computed.
  const finalPrice = useMemo(() => {
    const m = Number(manualPrice);
    if (Number.isFinite(m) && m > 0) return m;
    return selectedPrice ?? 0;
  }, [manualPrice, selectedPrice]);

  const canSubmit = !!(
    tenantId && pickup.trim() && isoPickup &&
    firstName.trim() && lastName.trim() && phone.trim() && email.trim()
  );

  const pickClient = (c: ProClient) => {
    setSelectedClient(c);
    setFirstName(c.first_name || '');
    setLastName(c.last_name || '');
    setEmail(c.email || '');
    setPhone(c.phone || '');
    setClientPickerOpen(false);
    haptic('light');
  };

  const onSubmit = async () => {
    if (!canSubmit || !tenantId) {
      Alert.alert(
        'Champs manquants',
        'Adresse de départ, date, prénom, nom, email et téléphone sont obligatoires.',
      );
      return;
    }
    setSubmitting(true);
    try {
      await createBooking({
        tenant_id: tenantId,
        pickup_address: pickup.trim(),
        dropoff_address: dropoff.trim() || undefined,
        pickup_at: isoPickup,
        trip_type: tripType,
        vehicle_type: vehicleType || undefined,
        pax,
        bags,
        payment_method: payment,
        contact: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim(),
          email: email.trim(),
        },
        notes: notes.trim() || undefined,
      });
      haptic('success');
      Alert.alert('Réservation créée', 'La course a été enregistrée avec succès.', [
        { text: 'OK', onPress: () => router.replace('/(pro)/dispatch' as any) },
      ]);
    } catch (e: any) {
      // Surface the Pydantic validation error in a readable way
      const detail = e?.response?.data?.detail;
      let msg = '';
      if (Array.isArray(detail)) {
        msg = detail
          .map((d: any) => `${(d.loc || []).join('.')} : ${d.msg}`)
          .join('\n');
      } else if (typeof detail === 'string') {
        msg = detail;
      } else {
        msg = e?.message || 'Erreur lors de la création.';
      }
      Alert.alert('Échec de création', msg);
    } finally {
      setSubmitting(false);
    }
  };

  // Date helpers for picker — up to 1 year ahead
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const nextDays = useMemo(() => {
    const arr: Date[] = [];
    for (let i = 0; i < 365; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i); arr.push(d);
    }
    return arr;
  }, [today]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ProHeader title="Créer une course" subtitle="Nouvelle réservation" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 180 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ─── TYPE DE COURSE ─── */}
          <View style={styles.block}>
            <Text style={styles.kicker}>TYPE DE COURSE</Text>
            <View style={styles.tripGrid}>
              {TRIP_TYPES.map((t) => {
                const active = tripType === t.k;
                return (
                  <TouchableOpacity
                    key={t.k}
                    style={[styles.tripCard, active && styles.tripCardActive]}
                    onPress={() => { setTripType(t.k); haptic('light'); }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name={t.icon} size={22} color={active ? colors.primary : colors.textSecondary} />
                    <Text style={[styles.tripLabel, active && { color: colors.primary }]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ─── ADRESSES (with Google Places autocomplete) ─── */}
          <View style={[styles.block, { zIndex: 30 }]}>
            <AddressInput
              label="Adresse de départ"
              placeholder="Ex : Paris, Gare de Lyon…"
              value={pickup}
              onChange={setPickup}
              iconName="navigate-circle-outline"
              apiKey={mapsKey}
              country={mapsCountry}
              testID="pickup-input"
            />
            <AddressInput
              label="Destination"
              placeholder="Ex : Paris CDG, Versailles…"
              value={dropoff}
              onChange={setDropoff}
              iconName="location-outline"
              apiKey={mapsKey}
              country={mapsCountry}
              testID="dropoff-input"
            />
          </View>

          {/* ─── QUAND ─── */}
          <View style={styles.block}>
            <Text style={styles.kicker}>QUAND ?</Text>
            <TouchableOpacity
              style={[
                styles.whenCard,
                scheduleMode === 'now' && !nowDisabled && styles.whenCardActive,
                nowDisabled && styles.whenCardDisabled,
              ]}
              onPress={() => { if (nowDisabled) return; setScheduleMode('now'); haptic('light'); }}
              activeOpacity={nowDisabled ? 1 : 0.85}
              disabled={nowDisabled}
            >
              <Ionicons name="flash-outline" size={22} color={nowDisabled ? colors.textMuted : (scheduleMode === 'now' ? colors.primary : colors.textSecondary)} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.whenTitle, scheduleMode === 'now' && !nowDisabled && { color: colors.primary }, nowDisabled && { color: colors.textMuted }]}>
                  Prise en charge maintenant
                </Text>
                <Text style={styles.whenSub}>
                  {nowDisabled ? 'Indisponible pour ce service' : 'Départ immédiat (~15 min)'}
                </Text>
              </View>
              {nowDisabled ? <Ionicons name="lock-closed" size={14} color={colors.textMuted} /> : null}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.whenCard, scheduleMode === 'later' && styles.whenCardActive]}
              onPress={() => { setScheduleMode('later'); haptic('light'); }}
              activeOpacity={0.85}
            >
              <Ionicons name="calendar-outline" size={22} color={scheduleMode === 'later' ? colors.primary : colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.whenTitle, scheduleMode === 'later' && { color: colors.primary }]}>Planifier plus tard</Text>
                <Text style={styles.whenSub}>Choisir date & heure</Text>
              </View>
            </TouchableOpacity>

            {scheduleMode === 'later' ? (
              <>
                <Text style={styles.label}>Date & heure</Text>
                <View style={styles.dateRow}>
                  <TouchableOpacity style={[styles.dateBtn, { flex: 1.4 }]} onPress={() => setDatePickerOpen(true)}>
                    <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                    <Text style={styles.dateTxt}>{fmtDate(date)}</Text>
                    <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.dateBtn, { flex: 1 }]} onPress={() => setHourPickerOpen(true)}>
                    <Text style={styles.dateTxt}>{pad(hour)} h</Text>
                    <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.dateBtn, { flex: 1 }]} onPress={() => setMinutePickerOpen(true)}>
                    <Text style={styles.dateTxt}>{pad(minute)}</Text>
                    <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </>
            ) : null}

            {/* Passenger + Bags counters */}
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Passager(s)</Text>
                <Counter value={pax} onChange={setPax} min={1} max={20} icon="people-outline" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Bagage(s)</Text>
                <Counter value={bags} onChange={setBags} min={0} max={20} icon="briefcase-outline" />
              </View>
            </View>
          </View>

          {/* ─── VÉHICULES ─── */}
          <View style={styles.block}>
            <Text style={styles.kicker}>CHOISISSEZ VOTRE VÉHICULE</Text>
            {categories.map((c) => {
              const active = vehicleType === c.id;
              const price = quotePrice(quotes[c.id]);
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.vehicleCard, active && styles.vehicleCardActive]}
                  onPress={() => { setVehicleType(c.id); haptic('light'); }}
                  activeOpacity={0.9}
                >
                  {c.image_url ? (
                    <Image source={{ uri: c.image_url }} style={styles.vehicleImg} resizeMode="cover" />
                  ) : (
                    <View style={[styles.vehicleImg, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }]}>
                      <Ionicons name="car-sport" size={28} color={colors.textMuted} />
                    </View>
                  )}
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.vehicleName}>{c.label}</Text>
                    <View style={styles.vehicleMeta}>
                      <View style={styles.vehicleMetaItem}>
                        <Ionicons name="people-outline" size={12} color={colors.textSecondary} />
                        <Text style={styles.vehicleMetaTxt}>{c.max_seats ?? '—'} pax</Text>
                      </View>
                      <View style={styles.vehicleMetaItem}>
                        <Ionicons name="briefcase-outline" size={12} color={colors.textSecondary} />
                        <Text style={styles.vehicleMetaTxt}>{c.max_luggage ?? '—'} bag.</Text>
                      </View>
                    </View>
                    {c.description ? <Text style={styles.vehicleDesc} numberOfLines={2}>{c.description}</Text> : null}
                  </View>
                  <View style={styles.vehicleRight}>
                    <Text style={[styles.vehiclePrice, active && { color: colors.primary }]}>
                      {price != null ? `${price.toFixed(2)} €` : '—'}
                    </Text>
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active ? <Ionicons name="checkmark" size={14} color={colors.bg} /> : null}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}

            <View style={styles.summaryRow}>
              <View style={styles.summaryLeft}>
                <Ionicons name="git-network-outline" size={14} color={colors.textSecondary} />
                <Text style={styles.summaryLeftTxt}>
                  {quote ? `${(quote.distance_km ?? 0).toFixed(2)} km · ${Math.round(quote.duration_min ?? 0)} min` : (quoting ? 'Calcul…' : 'Renseignez les adresses')}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.summaryKicker}>TARIF ESTIMÉ</Text>
                <Text style={styles.summaryValue}>{selectedPrice != null ? `${selectedPrice.toFixed(2)} €` : '—'}</Text>
              </View>
            </View>

            <View style={styles.manualRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.manualLabel}>Tarif manuel <Text style={styles.manualOpt}>(optionnel)</Text></Text>
                <Text style={styles.manualSub}>Remplace le tarif estimé</Text>
              </View>
              <View style={styles.manualInputWrap}>
                <TextInput
                  style={styles.manualInput}
                  placeholder={selectedPrice != null ? selectedPrice.toFixed(2) : '0.00'}
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  value={manualPrice}
                  onChangeText={setManualPrice}
                />
                <Text style={styles.manualCurrency}>€</Text>
                <Ionicons name="create-outline" size={14} color={colors.textMuted} />
              </View>
            </View>
          </View>

          {/* ─── PASSAGER & CONTACT ─── */}
          <View style={styles.block}>
            <Text style={styles.kicker}>PASSAGER & CONTACT</Text>

            <TouchableOpacity style={styles.clientSelect} onPress={() => setClientPickerOpen(true)}>
              <Ionicons name="person-circle-outline" size={18} color={colors.textSecondary} />
              <Text style={[styles.clientSelectTxt, !selectedClient && { color: colors.textMuted }]}>
                {selectedClient ? clientName(selectedClient) : 'Sélectionner un client'}
              </Text>
              <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
            </TouchableOpacity>

            <View style={styles.row2}>
              <View style={[styles.inputBox, { flex: 1 }]}>
                <Ionicons name="person-outline" size={14} color={colors.textSecondary} />
                <TextInput style={styles.input} placeholder="Prénom *" placeholderTextColor={colors.textMuted} value={firstName} onChangeText={setFirstName} />
              </View>
              <View style={[styles.inputBox, { flex: 1 }]}>
                <TextInput style={styles.input} placeholder="Nom *" placeholderTextColor={colors.textMuted} value={lastName} onChangeText={setLastName} />
              </View>
            </View>
            <View style={styles.inputBox}>
              <Ionicons name="mail-outline" size={14} color={colors.textSecondary} />
              <TextInput style={styles.input} placeholder="Email *" placeholderTextColor={colors.textMuted} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} />
            </View>
            <View style={styles.inputBox}>
              <Ionicons name="call-outline" size={14} color={colors.textSecondary} />
              <TextInput style={styles.input} placeholder="Téléphone *" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
            </View>
            <View style={styles.inputBox}>
              <Ionicons name="airplane-outline" size={14} color={colors.textSecondary} />
              <TextInput style={styles.input} placeholder="Numéro de vol (optionnel)" placeholderTextColor={colors.textMuted} autoCapitalize="characters" value={flightNumber} onChangeText={setFlightNumber} />
            </View>
            <View style={styles.inputBox}>
              <Ionicons name="train-outline" size={14} color={colors.textSecondary} />
              <TextInput style={styles.input} placeholder="Numéro de train (optionnel)" placeholderTextColor={colors.textMuted} autoCapitalize="characters" value={trainNumber} onChangeText={setTrainNumber} />
            </View>
            <View style={styles.notesBox}>
              <TextInput
                style={styles.notesInput}
                placeholder="Siège bébé, panneau d'accueil, arrêt intermédiaire…"
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={200}
                value={notes}
                onChangeText={setNotes}
              />
              <Text style={styles.notesCount}>{notes.length} / 200</Text>
            </View>
          </View>

          {/* ─── PAIEMENT ─── */}
          <View style={styles.block}>
            <Text style={styles.kicker}>OPTIONS DE PAIEMENT</Text>
            <View style={styles.payCol}>
              {PAY_OPTIONS.map((p) => {
                const active = payment === p.k;
                return (
                  <TouchableOpacity
                    key={p.k}
                    style={[styles.payCard, active && styles.payCardActive]}
                    onPress={() => { setPayment(p.k); haptic('light'); }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name={p.icon} size={18} color={active ? colors.primary : colors.textSecondary} />
                    <Text style={[styles.payTxt, active && { color: colors.primary }]}>{p.label}</Text>
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active ? <Ionicons name="checkmark" size={12} color={colors.bg} /> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.payHint}>Les paiements en ligne sont traités via les passerelles certifiées.</Text>
          </View>

          {/* ─── SUBMIT ─── */}
          <TouchableOpacity
            style={[styles.submit, (!canSubmit || submitting) && { opacity: 0.6 }]}
            onPress={onSubmit}
            disabled={!canSubmit || submitting}
            testID="create-submit"
          >
            {submitting ? <ActivityIndicator color={colors.bg} /> : (
              <>
                <Text style={styles.submitTxt}>Créer la réservation</Text>
                <Ionicons name="arrow-forward" size={20} color={colors.bg} />
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ─── Client picker modal ─── */}
      <Modal visible={clientPickerOpen} transparent animationType="slide" onRequestClose={() => setClientPickerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Sélectionner un client</Text>
            <TouchableOpacity style={styles.newClientRow} onPress={() => { setSelectedClient(null); setFirstName(''); setLastName(''); setEmail(''); setPhone(''); setClientPickerOpen(false); }}>
              <Ionicons name="add-circle" size={20} color={colors.primary} />
              <Text style={styles.newClientTxt}>Nouveau client</Text>
            </TouchableOpacity>
            <ScrollView style={{ maxHeight: 360 }}>
              {clients.length === 0 ? (
                <Text style={styles.empty}>Aucun client enregistré</Text>
              ) : clients.map((c, idx) => (
                <TouchableOpacity key={`${c.phone || c.email || idx}`} style={styles.clientRow} onPress={() => pickClient(c)}>
                  <View>
                    <Text style={styles.clientName}>{clientName(c)}</Text>
                    <Text style={styles.clientSub}>{c.phone || c.email || '—'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setClientPickerOpen(false)}>
              <Text style={styles.closeBtnTxt}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── Date picker modal ─── */}
      <Modal visible={datePickerOpen} transparent animationType="slide" onRequestClose={() => setDatePickerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Choisir la date</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {nextDays.map((d, idx) => {
                const sel = d.toDateString() === date.toDateString();
                return (
                  <TouchableOpacity key={idx} style={[styles.dateOption, sel && styles.dateOptionActive]} onPress={() => { setDate(d); setDatePickerOpen(false); }}>
                    <Text style={[styles.dateOptionTxt, sel && { color: colors.primary }]}>
                      {d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ─── Hour picker ─── */}
      <Modal visible={hourPickerOpen} transparent animationType="slide" onRequestClose={() => setHourPickerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Heure</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {Array.from({ length: 24 }).map((_, h) => (
                <TouchableOpacity key={h} style={[styles.dateOption, hour === h && styles.dateOptionActive]} onPress={() => { setHour(h); setHourPickerOpen(false); }}>
                  <Text style={[styles.dateOptionTxt, hour === h && { color: colors.primary }]}>{pad(h)} h</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ─── Minute picker ─── */}
      <Modal visible={minutePickerOpen} transparent animationType="slide" onRequestClose={() => setMinutePickerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Minutes</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                <TouchableOpacity key={m} style={[styles.dateOption, minute === m && styles.dateOptionActive]} onPress={() => { setMinute(m); setMinutePickerOpen(false); }}>
                  <Text style={[styles.dateOptionTxt, minute === m && { color: colors.primary }]}>{pad(m)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Counter sub-component (passenger / bag)
// ─────────────────────────────────────────────────────────────────────────
function Counter({ value, onChange, min, max, icon, suffix }: { value: number; onChange: (n: number) => void; min: number; max: number; icon: keyof typeof Ionicons.glyphMap; suffix?: string }) {
  return (
    <View style={styles.counter}>
      <Ionicons name={icon} size={14} color={colors.textSecondary} />
      <TouchableOpacity style={styles.counterBtn} onPress={() => onChange(Math.max(min, value - 1))}>
        <Ionicons name="remove" size={16} color={colors.text} />
      </TouchableOpacity>
      <Text style={styles.counterVal}>{value}{suffix ? ` ${suffix}${value > 1 ? 's' : ''}` : ''}</Text>
      <TouchableOpacity style={styles.counterBtn} onPress={() => onChange(Math.min(max, value + 1))}>
        <Ionicons name="add" size={16} color={colors.text} />
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  block: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm,
  },
  kicker: { color: colors.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  label: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.4, marginTop: 4 },

  // Type de course (2x2)
  tripGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tripCard: {
    flexBasis: '47%', flexGrow: 1, minHeight: 80,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: spacing.md,
  },
  tripCardActive: { backgroundColor: colors.primary + '15', borderColor: colors.primary, borderWidth: 1.5 },
  tripLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '800', textAlign: 'center' },

  // Field with internal label
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 8,
  },
  fieldLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  fieldInput: { color: colors.text, fontSize: 14, fontWeight: '600', paddingVertical: 4, marginTop: 2 },

  // Quand cards
  whenCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, padding: spacing.md,
  },
  whenCardActive: { backgroundColor: colors.primary + '15', borderColor: colors.primary, borderWidth: 1.5 },
  whenCardDisabled: { opacity: 0.45 },
  whenTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  whenSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },

  // Date row
  dateRow: { flexDirection: 'row', gap: 6 },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, paddingHorizontal: 10, height: 44,
  },
  dateTxt: { color: colors.text, fontSize: 13, fontWeight: '700' },

  row2: { flexDirection: 'row', gap: 8 },

  // Counter (pax/bags)
  counter: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, paddingHorizontal: 8, height: 44, marginTop: 4,
  },
  counterBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  counterVal: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '800', textAlign: 'center' },

  // Vehicle cards
  vehicleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, padding: 10,
  },
  vehicleCardActive: { backgroundColor: colors.primary + '12', borderColor: colors.primary, borderWidth: 1.5 },
  vehicleImg: { width: 64, height: 50, borderRadius: 8, backgroundColor: colors.surface },
  vehicleName: { color: colors.text, fontSize: 14, fontWeight: '900' },
  vehicleMeta: { flexDirection: 'row', gap: 10 },
  vehicleMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  vehicleMetaTxt: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  vehicleDesc: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  vehicleRight: { alignItems: 'flex-end', gap: 6 },
  vehiclePrice: { color: colors.text, fontSize: 13, fontWeight: '900' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioActive: { backgroundColor: colors.primary, borderColor: colors.primary },

  // Summary
  summaryRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1, marginTop: 4,
  },
  summaryLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryLeftTxt: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  summaryKicker: { color: colors.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  summaryValue: { color: colors.text, fontSize: 20, fontWeight: '900' },

  // Manual price
  manualRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  manualLabel: { color: colors.text, fontSize: 13, fontWeight: '800' },
  manualOpt: { color: colors.textMuted, fontWeight: '600' },
  manualSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  manualInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 10, height: 40, width: 130 },
  manualInput: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  manualCurrency: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },

  // Passenger & contact
  clientSelect: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 46 },
  clientSelectTxt: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  inputBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44 },
  input: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '500' },
  notesBox: { backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm },
  notesInput: { color: colors.text, fontSize: 13, minHeight: 60, textAlignVertical: 'top' },
  notesCount: { color: colors.textMuted, fontSize: 11, textAlign: 'right', marginTop: 4 },

  // Paiement
  payCol: { gap: 8 },
  payCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  payCardActive: { backgroundColor: colors.primary + '12', borderColor: colors.primary, borderWidth: 1.5 },
  payTxt: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '800' },
  payHint: { color: colors.textMuted, fontSize: 11, marginTop: 4, fontStyle: 'italic' },

  // Submit
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, marginTop: 4 },
  submitTxt: { color: colors.bg, fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },

  // Modal
  backdrop: { flex: 1, backgroundColor: '#000C', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.md, paddingBottom: spacing.xl, gap: 8 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 8 },
  sheetTitle: { color: colors.text, fontSize: 16, fontWeight: '900', textAlign: 'center', marginBottom: 6 },
  newClientRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.sm, backgroundColor: colors.primary + '15', borderRadius: radius.md, borderColor: colors.primary, borderWidth: 1 },
  newClientTxt: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  clientRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  clientName: { color: colors.text, fontSize: 14, fontWeight: '800' },
  clientSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  closeBtn: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  closeBtnTxt: { color: colors.textSecondary, fontWeight: '800' },
  empty: { color: colors.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: spacing.md },
  dateOption: { padding: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  dateOptionActive: { backgroundColor: colors.primary + '15' },
  dateOptionTxt: { color: colors.text, fontSize: 14, fontWeight: '700' },
});
