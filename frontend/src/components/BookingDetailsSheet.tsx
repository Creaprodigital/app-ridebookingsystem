import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Pressable,
  Platform,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme';
import { ProBooking, ProDriver } from '../proApi';
import { haptic } from '../feedback';

/* ------------------------------- Helpers ---------------------------------- */

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', {
      weekday: 'short', day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
}

function fmtEuro(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function statusMeta(status?: string): { label: string; color: string } {
  switch ((status || '').toLowerCase()) {
    case 'pending':     return { label: 'À dispatcher', color: colors.warning };
    case 'assigned':    return { label: 'Attribuée',    color: colors.info };
    case 'in_progress': return { label: 'En course',    color: colors.primary };
    case 'completed':   return { label: 'Terminée',     color: colors.success };
    case 'cancelled':   return { label: 'Annulée',      color: colors.danger };
    default:            return { label: status || '—',  color: colors.textMuted };
  }
}

function priorityMeta(p?: string): { label: string; color: string } {
  switch ((p || '').toLowerCase()) {
    case 'low':    return { label: 'Basse',   color: colors.textMuted };
    case 'high':   return { label: 'Haute',   color: colors.warning };
    case 'urgent': return { label: 'Urgente', color: colors.danger };
    case 'normal':
    default:       return { label: 'Normale', color: colors.textSecondary };
  }
}

function paymentMethodLabel(k?: string): string {
  switch ((k || '').toLowerCase()) {
    case 'card':         return 'Carte bancaire';
    case 'cash':         return 'Espèces';
    case 'invoice':      return 'Facture entreprise';
    case 'client_app':   return 'App client';
    case 'bank_transfer':return 'Virement';
    default:             return k || '—';
  }
}

function paymentStatusMeta(s?: string): { label: string; color: string } {
  switch ((s || '').toLowerCase()) {
    case 'paid':        return { label: 'Payée',      color: colors.success };
    case 'pending':     return { label: 'En attente', color: colors.warning };
    case 'refunded':    return { label: 'Remboursée', color: colors.info };
    case 'failed':      return { label: 'Échec',      color: colors.danger };
    default:            return { label: s || '—',     color: colors.textMuted };
  }
}

/* ------------------------------- Component -------------------------------- */

type Props = {
  booking: ProBooking | null;
  driver?: ProDriver | null;
  onClose: () => void;
  /** Called when the dispatcher taps "Attribuer un chauffeur". */
  onAssign?: (b: ProBooking) => void;
};

/**
 * Full-details bottom sheet for a single dispatcher booking.
 *
 * Opens on card tap in the dispatch list / dashboard. Shows every piece of
 * data available on `ProBooking` grouped into readable sections, plus quick
 * actions (call client, email client, assign driver).
 */
export default function BookingDetailsSheet({ booking, driver, onClose, onAssign }: Props) {
  const visible = !!booking;

  const sMeta = useMemo(() => statusMeta(booking?.status), [booking?.status]);
  const pMeta = useMemo(() => priorityMeta(booking?.priority), [booking?.priority]);
  const payS  = useMemo(() => paymentStatusMeta(booking?.payment_status), [booking?.payment_status]);

  if (!booking) return null;

  const client = booking.guest_contact || {};
  const clientName = [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client anonyme';
  const price =
    Number(booking?.pricing?.final ?? booking?.pricing?.total ?? 0) || 0;

  const callClient = () => {
    if (!client.phone) return;
    haptic('light');
    Linking.openURL(`tel:${client.phone}`).catch(() => {});
  };
  const mailClient = () => {
    if (!client.email) return;
    haptic('light');
    Linking.openURL(`mailto:${client.email}`).catch(() => {});
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />

          <ScrollView
            contentContainerStyle={{ paddingBottom: spacing.xl }}
            showsVerticalScrollIndicator={false}
          >
            {/* ─── Header ──────────────────────────────────────── */}
            <View style={styles.topRow}>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={styles.rowCenter}>
                  <View style={[styles.pill, { borderColor: sMeta.color, backgroundColor: sMeta.color + '1F' }]}>
                    <View style={[styles.dot, { backgroundColor: sMeta.color }]} />
                    <Text style={[styles.pillTxt, { color: sMeta.color }]}>{sMeta.label}</Text>
                  </View>
                  {booking.priority && booking.priority !== 'normal' ? (
                    <View style={[styles.pill, { borderColor: pMeta.color, backgroundColor: pMeta.color + '1F', marginLeft: 6 }]}>
                      <Ionicons name="flash" size={11} color={pMeta.color} />
                      <Text style={[styles.pillTxt, { color: pMeta.color, marginLeft: 3 }]}>{pMeta.label}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.ref}>Ref · {booking.id.slice(0, 8).toUpperCase()}</Text>
              </View>
              <Text style={styles.priceBig}>{fmtEuro(price)}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.closeX}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* ─── Route ───────────────────────────────────────── */}
            <Section title="Trajet" icon="map-outline">
              <View style={styles.route}>
                <View style={styles.routeCol}>
                  <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
                  <View style={styles.routeLine} />
                  <View style={[styles.routeDot, { backgroundColor: colors.danger }]} />
                </View>
                <View style={{ flex: 1, gap: 10 }}>
                  <View>
                    <Text style={styles.subLabel}>Prise en charge</Text>
                    <Text style={styles.addr}>{booking.pickup_address || '—'}</Text>
                  </View>
                  <View>
                    <Text style={styles.subLabel}>Destination</Text>
                    <Text style={styles.addr}>{booking.dropoff_address || '—'}</Text>
                  </View>
                </View>
              </View>
              <KeyRow icon="time-outline" label="Date & heure" value={fmtDate(booking.pickup_at)} />
              {booking.duration_hours ? (
                <KeyRow icon="hourglass-outline" label="Durée réservée" value={`${booking.duration_hours} h`} />
              ) : null}
              <KeyRow
                icon="bus-outline"
                label="Type"
                value={tripTypeLabel(booking.trip_type)}
              />
              <KeyRow
                icon="flash-outline"
                label="Planification"
                value={booking.is_immediate || booking.schedule_mode === 'now' ? 'Immédiate' : 'Planifiée'}
              />
            </Section>

            {/* ─── Client ──────────────────────────────────────── */}
            <Section title="Client" icon="person-circle-outline">
              <KeyRow icon="person-outline" label="Nom" value={clientName} />
              {client.email ? (
                <KeyRow icon="mail-outline" label="Email" value={client.email} onPress={mailClient} chevron />
              ) : null}
              {client.phone ? (
                <KeyRow icon="call-outline" label="Téléphone" value={client.phone} onPress={callClient} chevron />
              ) : null}
              <KeyRow icon="people-outline" label="Passagers" value={String(booking.pax ?? 1)} />
              {typeof booking.bags === 'number' ? (
                <KeyRow icon="briefcase-outline" label="Bagages" value={String(booking.bags)} />
              ) : null}

              {(client.phone || client.email) ? (
                <View style={styles.contactBar}>
                  {client.phone ? (
                    <TouchableOpacity style={styles.contactBtn} onPress={callClient} activeOpacity={0.85}>
                      <Ionicons name="call" size={16} color={colors.bg} />
                      <Text style={styles.contactBtnTxt}>Appeler</Text>
                    </TouchableOpacity>
                  ) : null}
                  {client.email ? (
                    <TouchableOpacity style={[styles.contactBtn, styles.contactBtnAlt]} onPress={mailClient} activeOpacity={0.85}>
                      <Ionicons name="mail" size={16} color={colors.text} />
                      <Text style={[styles.contactBtnTxt, { color: colors.text }]}>Email</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </Section>

            {/* ─── Pricing ─────────────────────────────────────── */}
            <Section title="Paiement" icon="card-outline">
              <KeyRow icon="pricetag-outline" label="Montant total" value={fmtEuro(price)} strong />
              <PricingBreakdown pricing={booking.pricing} />
              <KeyRow
                icon="wallet-outline"
                label="Méthode"
                value={paymentMethodLabel(booking.payment_method)}
              />
              <KeyRow
                icon="checkmark-circle-outline"
                label="Statut"
                value={payS.label}
                valueColor={payS.color}
              />
            </Section>

            {/* ─── Vehicle / Driver ────────────────────────────── */}
            {(booking.vehicle_type || driver) ? (
              <Section title="Chauffeur & véhicule" icon="car-sport-outline">
                {booking.vehicle_type ? (
                  <KeyRow icon="car-outline" label="Catégorie" value={booking.vehicle_type} />
                ) : null}
                {driver ? (
                  <>
                    <KeyRow
                      icon="id-card-outline"
                      label="Chauffeur"
                      value={driverFullName(driver)}
                    />
                    {driver.phone ? (
                      <KeyRow
                        icon="call-outline"
                        label="Téléphone chauffeur"
                        value={driver.phone}
                        onPress={() => Linking.openURL(`tel:${driver.phone}`).catch(() => {})}
                        chevron
                      />
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.hint}>Aucun chauffeur attribué pour le moment.</Text>
                )}
              </Section>
            ) : null}

            {/* ─── Notes ───────────────────────────────────────── */}
            {booking.notes ? (
              <Section title="Note client" icon="chatbubble-ellipses-outline">
                <Text style={styles.note}>{booking.notes}</Text>
              </Section>
            ) : null}
            {booking.internal_notes ? (
              <Section title="Note interne" icon="lock-closed-outline" subtle>
                <Text style={styles.note}>{booking.internal_notes}</Text>
              </Section>
            ) : null}

            {/* ─── Timing ──────────────────────────────────────── */}
            {booking.created_at ? (
              <Text style={styles.createdAt}>
                Créée le {fmtDate(booking.created_at)}
              </Text>
            ) : null}

            {/* ─── Actions ─────────────────────────────────────── */}
            {(booking.status || '').toLowerCase() === 'pending' && onAssign ? (
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => { haptic('medium'); onAssign(booking); }}
                activeOpacity={0.85}
              >
                <Ionicons name="person-add-outline" size={18} color={colors.bg} />
                <Text style={styles.primaryBtnTxt}>Attribuer un chauffeur</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ------------------------------- Sub-widgets ------------------------------ */

function Section({
  title, icon, subtle, children,
}: { title: string; icon: keyof typeof Ionicons.glyphMap; subtle?: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHdr}>
        <Ionicons name={icon} size={14} color={subtle ? colors.textMuted : colors.textSecondary} />
        <Text style={[styles.sectionTitle, subtle && { color: colors.textMuted }]}>{title.toUpperCase()}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function KeyRow({
  icon, label, value, strong, valueColor, onPress, chevron,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  strong?: boolean;
  valueColor?: string;
  onPress?: () => void;
  chevron?: boolean;
}) {
  const Wrap = onPress ? TouchableOpacity : View;
  return (
    <Wrap
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...(onPress ? ({ onPress, activeOpacity: 0.7 } as any) : {})}
      style={styles.kv}
    >
      <View style={styles.kvLabel}>
        <Ionicons name={icon} size={14} color={colors.textMuted} />
        <Text style={styles.kvLabelTxt}>{label}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
        <Text
          style={[
            styles.kvValue,
            strong && { fontWeight: '900', fontSize: 15 },
            valueColor ? { color: valueColor } : null,
          ]}
          numberOfLines={2}
        >
          {value}
        </Text>
        {chevron ? <Ionicons name="chevron-forward" size={14} color={colors.textMuted} style={{ marginLeft: 4 }} /> : null}
      </View>
    </Wrap>
  );
}

function PricingBreakdown({ pricing }: { pricing: any }) {
  if (!pricing || typeof pricing !== 'object') return null;
  // Show a short breakdown when available (base, surcharges, discount…).
  const items: Array<{ label: string; value: number }> = [];
  if (Number.isFinite(Number(pricing.base))) items.push({ label: 'Base', value: Number(pricing.base) });
  if (Number.isFinite(Number(pricing.night_surcharge))) items.push({ label: 'Supplément nuit', value: Number(pricing.night_surcharge) });
  if (Number.isFinite(Number(pricing.weekend_surcharge))) items.push({ label: 'Supplément week-end', value: Number(pricing.weekend_surcharge) });
  if (Number.isFinite(Number(pricing.waiting_time))) items.push({ label: 'Attente', value: Number(pricing.waiting_time) });
  if (Number.isFinite(Number(pricing.extras))) items.push({ label: 'Options', value: Number(pricing.extras) });
  if (Number.isFinite(Number(pricing.discount))) items.push({ label: 'Remise', value: -Math.abs(Number(pricing.discount)) });

  if (!items.length) return null;
  return (
    <View style={styles.breakdown}>
      {items.map((i) => (
        <View style={styles.breakdownRow} key={i.label}>
          <Text style={styles.breakdownLabel}>{i.label}</Text>
          <Text style={[styles.breakdownValue, i.value < 0 && { color: colors.success }]}>
            {i.value < 0 ? '-' : ''}{fmtEuro(Math.abs(i.value))}
          </Text>
        </View>
      ))}
    </View>
  );
}

function driverFullName(d: ProDriver): string {
  const fn = (d as any)?.first_name || '';
  const ln = (d as any)?.last_name || '';
  const combined = `${fn} ${ln}`.trim();
  return combined || (d as any)?.email || (d as any)?.id?.slice(0, 8) || 'Chauffeur';
}

function tripTypeLabel(t?: string): string {
  switch ((t || '').toLowerCase()) {
    case 'one_way':  return 'Aller simple';
    case 'round_trip': return 'Aller-retour';
    case 'hourly':   return 'Mise à disposition';
    case 'transfer': return 'Transfert';
    default:         return t || '—';
  }
}

/* --------------------------------- Styles --------------------------------- */

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    maxHeight: '92%',
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: -4 } },
      android: { elevation: 24 },
      default: {},
    }),
  },
  handle: {
    alignSelf: 'center', width: 44, height: 5, borderRadius: 3,
    backgroundColor: colors.border, marginBottom: spacing.md,
  },

  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.lg },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  ref: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  priceBig: { color: colors.text, fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  closeX: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface,
    borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },

  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1,
  },
  pillTxt: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  dot: { width: 6, height: 6, borderRadius: 3 },

  section: { marginBottom: spacing.lg },
  sectionHdr: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  sectionTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  sectionBody: {
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, padding: spacing.md, gap: 10,
  },

  route: { flexDirection: 'row', gap: spacing.md, marginBottom: 4 },
  routeCol: { alignItems: 'center', paddingTop: 4 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  routeLine: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 4 },
  subLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 },
  addr: { color: colors.text, fontSize: 14, fontWeight: '600' },

  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  kvLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kvLabelTxt: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  kvValue: { color: colors.text, fontSize: 13, fontWeight: '700', maxWidth: 220, textAlign: 'right' },

  contactBar: { flexDirection: 'row', gap: 10, marginTop: 6 },
  contactBtn: {
    flex: 1, height: 40, borderRadius: radius.lg, backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  contactBtnAlt: { backgroundColor: colors.elevated, borderColor: colors.border, borderWidth: 1 },
  contactBtnTxt: { color: colors.bg, fontWeight: '800', fontSize: 13 },

  breakdown: { borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 8, gap: 6 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between' },
  breakdownLabel: { color: colors.textSecondary, fontSize: 12 },
  breakdownValue: { color: colors.text, fontSize: 12, fontWeight: '700' },

  hint: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },
  note: { color: colors.text, fontSize: 13, lineHeight: 19 },
  createdAt: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginBottom: spacing.md },

  primaryBtn: {
    height: 52, borderRadius: radius.full, backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
  },
  primaryBtnTxt: { color: colors.bg, fontWeight: '900', fontSize: 14, letterSpacing: 0.8 },
});
