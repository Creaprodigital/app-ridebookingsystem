/**
 * Lightweight Google Places autocomplete input.
 *
 * Strategy:
 *  1. Try the secure backend proxy `/api/pro/places/autocomplete` first (the
 *     tenant's API key never leaves the server).
 *  2. If the proxy returns nothing/404 (not yet deployed), automatically fall
 *     back to a direct call to Google's Places Autocomplete API with the
 *     globally-configured EXPO_PUBLIC_GOOGLE_MAPS_API_KEY.
 *
 * The fallback runs only on the first miss — afterwards the component remembers
 * which transport is alive to avoid wasting roundtrips.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme';
import { proPlacesAutocomplete } from '../proApi';

const GMAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string;

type Suggestion = { place_id: string; description: string };

type Props = {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  iconColor?: string;
  iconName?: keyof typeof Ionicons.glyphMap;
  testID?: string;
  /** Optional explicit key — overrides the global key for the direct fallback. */
  apiKey?: string;
  /** Bias suggestions toward a given country (ISO 3166-1 alpha-2). */
  country?: string;
};

type Transport = 'proxy' | 'direct';

export default function AddressInput({
  label, placeholder, value, onChange, iconName = 'location-outline', iconColor = colors.textSecondary,
  testID, apiKey, country = 'fr',
}: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<any>(null);
  const lastQueryRef = useRef<string>('');
  const sessionTokenRef = useRef<string>(`${Date.now()}-${Math.random()}`);
  // Try the secure proxy first; auto-switch to direct on the first miss.
  const transportRef = useRef<Transport>('proxy');

  const directKey = apiKey || GMAPS_KEY;

  const fetchDirect = async (input: string): Promise<Suggestion[]> => {
    if (!directKey) return [];
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&key=${directKey}&language=fr&components=country:${country}&sessiontoken=${sessionTokenRef.current}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data?.status === 'OK' && Array.isArray(data.predictions)) {
        return data.predictions.slice(0, 5).map((p: any) => ({ place_id: p.place_id, description: p.description }));
      }
    } catch {}
    return [];
  };

  useEffect(() => {
    if (!value) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    if (value === lastQueryRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (value.trim().length < 3) {
        setSuggestions([]);
        setOpen(false);
        return;
      }
      setLoading(true);
      try {
        let preds: Suggestion[] = [];
        // 1) Try the secure backend proxy first
        if (transportRef.current === 'proxy') {
          const r = await proPlacesAutocomplete(value, sessionTokenRef.current, country, 'fr');
          if (r && Array.isArray(r.predictions) && r.predictions.length >= 0) {
            preds = r.predictions.slice(0, 5);
          } else {
            // Proxy not available — switch to direct calls for the rest of the session
            transportRef.current = 'direct';
            preds = await fetchDirect(value);
          }
        } else {
          preds = await fetchDirect(value);
        }
        setSuggestions(preds);
        setOpen(preds.length > 0);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value, country, directKey]);

  const pick = (s: Suggestion) => {
    lastQueryRef.current = s.description;
    onChange(s.description);
    setSuggestions([]);
    setOpen(false);
    // Refresh session token after a pick — Google bills per session
    sessionTokenRef.current = `${Date.now()}-${Math.random()}`;
  };

  return (
    <View style={{ position: 'relative', zIndex: open ? 50 : 1 }}>
      <View style={styles.field}>
        <Ionicons name={iconName} size={18} color={iconColor} />
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <TextInput
            style={styles.fieldInput}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            value={value}
            onChangeText={onChange}
            onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
            testID={testID}
          />
        </View>
        {loading ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
        {value.length > 0 ? (
          <TouchableOpacity onPress={() => { onChange(''); setSuggestions([]); setOpen(false); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>
      {open && suggestions.length > 0 ? (
        <View style={styles.dropdown}>
          {suggestions.map((s, idx) => (
            <TouchableOpacity
              key={s.place_id}
              style={[styles.suggestion, idx === suggestions.length - 1 && { borderBottomWidth: 0 }]}
              onPress={() => pick(s)}
              activeOpacity={0.7}
            >
              <Ionicons name="location" size={14} color={colors.textMuted} />
              <Text style={styles.suggestionTxt} numberOfLines={2}>{s.description}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 8,
  },
  fieldLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  fieldInput: { color: colors.text, fontSize: 14, fontWeight: '600', paddingVertical: 4, marginTop: 2 },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0, right: 0,
    backgroundColor: colors.surface,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md,
    marginTop: 4,
    overflow: 'hidden',
    elevation: 8,
    zIndex: 999,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
      default: {},
    }),
  },
  suggestion: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderBottomColor: colors.border, borderBottomWidth: 1,
  },
  suggestionTxt: { color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
});
