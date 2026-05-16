import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../../src/theme';
import ProHeader from '../../src/components/ProHeader';
import { useAuth } from '../../src/auth';
import { createBooking, quoteBooking, getProVehicleCategories, getProDrivers, ProCategory, ProDriver } from '../../src/proApi';
import { haptic } from '../../src/feedback';

type Priority = 'low' | 'normal' | 'high' | 'urgent';

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function toIsoLocal(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function driverName(d: ProDriver) {
  return `${d.first_name || ''} ${d.last_name || ''}`.trim() || d.email || d.id.slice(0,6);
}

export default function CreateBookingScreen() {
  const { tenant } = useAuth();
  const router = useRouter();
  const tenantId = tenant?.id;

  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [whenIso, setWhenIso] = useState<string>(() => {
    const d = new Date(); d.setMinutes(d.getMinutes() + 30); d.setSeconds(0, 0);
    return toIsoLocal(d);
  });
  const [scheduleNow, setScheduleNow] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [pax, setPax] = useState('1');
  const [bags, setBags] = useState('0');
  const [categories, setCategories] = useState<ProCategory[]>([]);
  const [vehicleType, setVehicleType] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<ProDriver[]>([]);
  const [assignedDriver, setAssignedDriver] = useState<string | null>(null);
  const [autoAssign, setAutoAssign] = useState(true);
  const [priority, setPriority] = useState<Priority>('normal');
  const [internalNotes, setInternalNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [payment, setPayment] = useState<'cash_onboard' | 'card_online'>('cash_onboard');
  const [quote, setQuote] = useState<any>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [cats, drvs] = await Promise.all([getProVehicleCategories(), getProDrivers()]);
        setCategories(cats);
        if (cats?.[0]) setVehicleType(cats[0].id);
        setDrivers(drvs);
      } catch {}
    })();
  }, []);

  const canQuote = !!(tenantId && pickup.trim() && (scheduleNow || whenIso));
  const canSubmit = !!(tenantId && pickup.trim() && (scheduleNow || whenIso) && firstName.trim() && phone.trim());

  const onQuote = useCallback(async () => {
    if (!canQuote || !tenantId) return;
    setQuoting(true);
    try {
      const at = scheduleNow ? toIsoLocal(new Date()) : whenIso;
      const q = await quoteBooking({
        tenant_id: tenantId,
        pickup_address: pickup.trim(),
        dropoff_address: dropoff.trim() || undefined,
        pickup_at: at,
        vehicle_type: vehicleType || undefined,
        pax: Number(pax) || 1,
        bags: Number(bags) || 0,
      });
      setQuote(q);
      haptic('light');
    } catch (e: any) {
      Alert.alert('Estimation impossible', e?.message || 'Vérifiez les adresses.');
    } finally {
      setQuoting(false);
    }
  }, [canQuote, tenantId, pickup, dropoff, scheduleNow, whenIso, vehicleType, pax, bags]);

  const onSubmit = async () => {
    if (!canSubmit || !tenantId) {
      Alert.alert('Champs manquants', 'Adresse de départ, date, prénom et téléphone obligatoires.');
      return;
    }
    setSubmitting(true);
    try {
      const at = scheduleNow ? toIsoLocal(new Date()) : whenIso;
      await createBooking({
        tenant_id: tenantId,
        pickup_address: pickup.trim(),
        dropoff_address: dropoff.trim() || undefined,
        pickup_at: at,
        vehicle_type: vehicleType || undefined,
        pax: Number(pax) || 1,
        bags: Number(bags) || 0,
        payment_method: payment,
        contact: { first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim(), email: email.trim() || undefined },
        notes: notes.trim() || undefined,
        internal_notes: internalNotes.trim() || undefined,
        priority,
        driver_id: autoAssign ? null : assignedDriver,
      });
      haptic('success');
      Alert.alert('Course créée', 'La course a été enregistrée avec succès.', [
        { text: 'OK', onPress: () => router.replace('/(pro)/dispatch' as any) },
      ]);
    } catch (e: any) {
      Alert.alert('Échec de création', e?.response?.data?.detail || e?.message || 'Erreur lors de la création.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ProHeader title="Créer une course" subtitle={tenant?.company_name || 'Nouvelle réservation'} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 160 }} keyboardShouldPersistTaps="handled">

          {/* Trajet */}
          <View style={styles.card}>
            <Text style={styles.section}>Trajet</Text>
            <View style={styles.field}>
              <Ionicons name="radio-button-on" size={16} color={colors.primary} />
              <TextInput style={styles.input} placeholder="Adresse de départ" placeholderTextColor={colors.textMuted} value={pickup} onChangeText={setPickup} />
            </View>
            <View style={styles.field}>
              <Ionicons name="location" size={16} color={colors.danger} />
              <TextInput style={styles.input} placeholder="Destination (optionnel)" placeholderTextColor={colors.textMuted} value={dropoff} onChangeText={setDropoff} />
            </View>
          </View>

          {/* Date / Heure */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.section}>Date & heure</Text>
              <View style={styles.segRow}>
                <TouchableOpacity style={[styles.segBtn, !scheduleNow && styles.segBtnActive]} onPress={() => setScheduleNow(false)}>
                  <Text style={[styles.segTxt, !scheduleNow && styles.segTxtActive]}>Plus tard</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.segBtn, scheduleNow && styles.segBtnActive]} onPress={() => setScheduleNow(true)}>
                  <Text style={[styles.segTxt, scheduleNow && styles.segTxtActive]}>Immédiat</Text>
                </TouchableOpacity>
              </View>
            </View>
            {!scheduleNow ? (
              <View style={styles.field}>
                <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                <TextInput style={styles.input} placeholder="YYYY-MM-DDTHH:MM" placeholderTextColor={colors.textMuted} value={whenIso} onChangeText={setWhenIso} />
              </View>
            ) : (
              <Text style={styles.hint}>La course sera planifiée pour maintenant.</Text>
            )}
          </View>

          {/* Catégorie véhicule */}
          <View style={styles.card}>
            <Text style={styles.section}>Catégorie véhicule</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {categories.map((c) => (
                <TouchableOpacity key={c.id} style={[styles.chip, vehicleType === c.id && styles.chipActive]} onPress={() => setVehicleType(c.id)}>
                  <Text style={[styles.chipTxt, vehicleType === c.id && styles.chipTxtActive]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
              {categories.length === 0 ? <Text style={styles.hint}>Aucune catégorie disponible.</Text> : null}
            </ScrollView>
            <View style={styles.row}>
              <View style={[styles.fieldSm, { flex: 1 }]}>
                <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
                <TextInput style={styles.input} keyboardType="number-pad" placeholder="Pax" placeholderTextColor={colors.textMuted} value={pax} onChangeText={setPax} />
              </View>
              <View style={[styles.fieldSm, { flex: 1 }]}>
                <Ionicons name="briefcase-outline" size={14} color={colors.textSecondary} />
                <TextInput style={styles.input} keyboardType="number-pad" placeholder="Bagages" placeholderTextColor={colors.textMuted} value={bags} onChangeText={setBags} />
              </View>
            </View>
          </View>

          {/* Passager */}
          <View style={styles.card}>
            <Text style={styles.section}>Passager</Text>
            <View style={styles.row}>
              <View style={[styles.field, { flex: 1 }]}>
                <Ionicons name="person-outline" size={14} color={colors.textSecondary} />
                <TextInput style={styles.input} placeholder="Prénom *" placeholderTextColor={colors.textMuted} value={firstName} onChangeText={setFirstName} />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <TextInput style={styles.input} placeholder="Nom" placeholderTextColor={colors.textMuted} value={lastName} onChangeText={setLastName} />
              </View>
            </View>
            <View style={styles.field}>
              <Ionicons name="call-outline" size={14} color={colors.textSecondary} />
              <TextInput style={styles.input} keyboardType="phone-pad" placeholder="Téléphone *" placeholderTextColor={colors.textMuted} value={phone} onChangeText={setPhone} />
            </View>
            <View style={styles.field}>
              <Ionicons name="mail-outline" size={14} color={colors.textSecondary} />
              <TextInput style={styles.input} keyboardType="email-address" autoCapitalize="none" placeholder="Email" placeholderTextColor={colors.textMuted} value={email} onChangeText={setEmail} />
            </View>
          </View>

          {/* Attribution */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.section}>Attribution</Text>
              <View style={styles.segRow}>
                <TouchableOpacity style={[styles.segBtn, autoAssign && styles.segBtnActive]} onPress={() => setAutoAssign(true)}>
                  <Text style={[styles.segTxt, autoAssign && styles.segTxtActive]}>Auto</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.segBtn, !autoAssign && styles.segBtnActive]} onPress={() => setAutoAssign(false)}>
                  <Text style={[styles.segTxt, !autoAssign && styles.segTxtActive]}>Manuel</Text>
                </TouchableOpacity>
              </View>
            </View>
            {!autoAssign ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {drivers.map((d) => (
                  <TouchableOpacity key={d.id} style={[styles.chip, assignedDriver === d.id && styles.chipActive]} onPress={() => setAssignedDriver(d.id)}>
                    <View style={[styles.driverDot, { backgroundColor: d.on_shift ? colors.success : colors.textMuted }]} />
                    <Text style={[styles.chipTxt, assignedDriver === d.id && styles.chipTxtActive]}>{driverName(d)}</Text>
                  </TouchableOpacity>
                ))}
                {drivers.length === 0 ? <Text style={styles.hint}>Aucun chauffeur disponible.</Text> : null}
              </ScrollView>
            ) : (
              <Text style={styles.hint}>Le système attribuera automatiquement un chauffeur disponible.</Text>
            )}
          </View>

          {/* Priorité + Paiement */}
          <View style={styles.card}>
            <Text style={styles.section}>Priorité</Text>
            <View style={styles.row}>
              {(['low','normal','high','urgent'] as Priority[]).map((p) => (
                <TouchableOpacity key={p} style={[styles.priorityChip, priority === p && styles.priorityChipActive(p)]} onPress={() => setPriority(p)}>
                  <Text style={[styles.priorityTxt, priority === p && { color: colors.bg }]}>{p === 'low' ? 'Basse' : p === 'normal' ? 'Normale' : p === 'high' ? 'Haute' : 'Urgente'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.section, { marginTop: 10 }]}>Paiement</Text>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.chip, payment === 'cash_onboard' && styles.chipActive]} onPress={() => setPayment('cash_onboard')}>
                <Ionicons name="cash-outline" size={14} color={payment === 'cash_onboard' ? colors.bg : colors.textSecondary} />
                <Text style={[styles.chipTxt, payment === 'cash_onboard' && styles.chipTxtActive]}>Espèces</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.chip, payment === 'card_online' && styles.chipActive]} onPress={() => setPayment('card_online')}>
                <Ionicons name="card-outline" size={14} color={payment === 'card_online' ? colors.bg : colors.textSecondary} />
                <Text style={[styles.chipTxt, payment === 'card_online' && styles.chipTxtActive]}>Carte en ligne</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Notes */}
          <View style={styles.card}>
            <Text style={styles.section}>Notes</Text>
            <View style={styles.fieldMulti}>
              <TextInput style={[styles.input, { height: 60 }]} multiline placeholder="Notes visibles par le chauffeur" placeholderTextColor={colors.textMuted} value={notes} onChangeText={setNotes} />
            </View>
            <Text style={[styles.section, { marginTop: 8 }]}>Notes internes dispatcher</Text>
            <View style={styles.fieldMulti}>
              <TextInput style={[styles.input, { height: 60 }]} multiline placeholder="Visibles uniquement par les dispatchers" placeholderTextColor={colors.textMuted} value={internalNotes} onChangeText={setInternalNotes} />
            </View>
          </View>

          {/* Estimation */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.section}>Estimation</Text>
              <TouchableOpacity onPress={onQuote} disabled={!canQuote || quoting} style={[styles.outlineBtn, (!canQuote || quoting) && { opacity: 0.5 }]}>
                {quoting ? <ActivityIndicator color={colors.primary} size="small" /> : (
                  <>
                    <Ionicons name="calculator-outline" size={14} color={colors.primary} />
                    <Text style={styles.outlineBtnTxt}>Calculer</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
            {quote ? (
              <View style={styles.quoteBox}>
                <View style={styles.quoteRow}><Text style={styles.quoteLabel}>Distance</Text><Text style={styles.quoteVal}>{(quote?.distance_km ?? 0).toFixed(2)} km</Text></View>
                <View style={styles.quoteRow}><Text style={styles.quoteLabel}>Durée</Text><Text style={styles.quoteVal}>{Math.round(quote?.duration_min ?? 0)} min</Text></View>
                <View style={styles.quoteRow}><Text style={styles.quoteLabel}>Total</Text><Text style={[styles.quoteVal, { color: colors.primary }]}>{(quote?.final ?? quote?.total ?? 0).toFixed(2)} €</Text></View>
              </View>
            ) : <Text style={styles.hint}>Renseignez départ / heure pour calculer.</Text>}
          </View>

          <TouchableOpacity style={[styles.submit, (!canSubmit || submitting) && { opacity: 0.6 }]} onPress={onSubmit} disabled={!canSubmit || submitting} testID="create-submit">
            {submitting ? <ActivityIndicator color={colors.bg} /> : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={colors.bg} />
                <Text style={styles.submitTxt}>CRÉER LA COURSE</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  section: { color: colors.text, fontSize: 14, fontWeight: '900', letterSpacing: -0.2 },
  hint: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 46 },
  fieldSm: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 10, height: 42 },
  fieldMulti: { backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 8 },
  input: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '500' },
  segRow: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: radius.full, padding: 3, gap: 4, borderWidth: 1, borderColor: colors.border },
  segBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  segBtnActive: { backgroundColor: colors.primary },
  segTxt: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  segTxtActive: { color: colors.bg },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: radius.full },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
  chipTxtActive: { color: colors.bg },
  driverDot: { width: 8, height: 8, borderRadius: 4 },
  priorityChip: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: radius.full },
  priorityChipActive: (p: Priority) => ({
    backgroundColor: p === 'urgent' ? colors.danger : p === 'high' ? colors.warning : p === 'low' ? colors.textMuted : colors.primary,
    borderColor: 'transparent',
  }),
  priorityTxt: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
  outlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.primary + '22', borderColor: colors.primary, borderWidth: 1, borderRadius: radius.full },
  outlineBtnTxt: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  quoteBox: { backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, gap: 4 },
  quoteRow: { flexDirection: 'row', justifyContent: 'space-between' },
  quoteLabel: { color: colors.textSecondary, fontSize: 12 },
  quoteVal: { color: colors.text, fontSize: 13, fontWeight: '800' },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, marginTop: 4 },
  submitTxt: { color: colors.bg, fontSize: 14, fontWeight: '900', letterSpacing: 1 },
});
