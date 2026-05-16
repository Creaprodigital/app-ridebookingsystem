/**
 * Lightweight Google Places autocomplete input.
 *
 * Wraps a native TextInput + an absolute-positioned suggestion list. Queries
 * the Places Autocomplete API directly from the device with debouncing.
 *
 * NOTE: On Web preview, the API returns CORS errors — autocomplete only works
 * on real native devices. The fallback is a plain text input.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme';

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
  /** Optional override for the API key (per-tenant key). */
  apiKey?: string;
  /** Bias suggestions toward a given country (ISO 3166-1 alpha-2). */
  country?: string;
};

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

  const key = apiKey || GMAPS_KEY;

  useEffect(() => {
    if (!value || !key) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    // Avoid querying again if the value matches the last picked suggestion
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
        const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(value)}&key=${key}&language=fr&components=country:${country}&sessiontoken=${sessionTokenRef.current}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data?.status === 'OK' && Array.isArray(data.predictions)) {
          setSuggestions(
            data.predictions.slice(0, 5).map((p: any) => ({ place_id: p.place_id, description: p.description })),
          );
          setOpen(true);
        } else {
          setSuggestions([]);
          setOpen(false);
        }
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value, key, country]);

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
    // Elevation/shadow for Android
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
