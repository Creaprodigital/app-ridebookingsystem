import React, { forwardRef } from 'react';
import {
  Text as RNText,
  TextInput as RNTextInput,
  StyleSheet,
  type TextProps,
  type TextInputProps,
  type TextStyle,
  type StyleProp,
} from 'react-native';

/**
 * Drop-in replacements for React Native's Text / TextInput that apply the
 * brand fonts. Custom fonts ship one family per weight, so the requested
 * fontWeight (and size, for headings) is mapped to the right family:
 *   • bold text ≥ 18px  → Plus Jakarta Sans (headings, prices, titles)
 *   • everything else   → Manrope (body)
 * An explicit fontFamily in the style always wins (e.g. monospace).
 */

const MANROPE: Record<string, string> = {
  '100': 'Manrope_400Regular',
  '200': 'Manrope_400Regular',
  '300': 'Manrope_400Regular',
  '400': 'Manrope_400Regular',
  normal: 'Manrope_400Regular',
  '500': 'Manrope_500Medium',
  '600': 'Manrope_600SemiBold',
  '700': 'Manrope_700Bold',
  bold: 'Manrope_700Bold',
  '800': 'Manrope_800ExtraBold',
  '900': 'Manrope_800ExtraBold',
};

const JAKARTA: Record<string, string> = {
  '600': 'PlusJakartaSans_600SemiBold',
  '700': 'PlusJakartaSans_700Bold',
  bold: 'PlusJakartaSans_700Bold',
  '800': 'PlusJakartaSans_800ExtraBold',
  '900': 'PlusJakartaSans_800ExtraBold',
};

function fontStyle(style: StyleProp<TextStyle>): TextStyle | null {
  const flat = StyleSheet.flatten(style) || {};
  if (flat.fontFamily) return null;
  const weight = String(flat.fontWeight ?? '400');
  const size = flat.fontSize ?? 14;
  const family =
    (size >= 18 && JAKARTA[weight]) || MANROPE[weight] || MANROPE['400'];
  // The family already carries the weight; keeping fontWeight would make
  // Android/iOS look for a synthetic bold variant that does not exist.
  return { fontFamily: family, fontWeight: 'normal' };
}

export const Text = forwardRef<RNText, TextProps>(function Text({ style, ...rest }, ref) {
  return <RNText ref={ref} {...rest} style={[style, fontStyle(style)]} />;
});

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(
  { style, ...rest },
  ref,
) {
  return <RNTextInput ref={ref} {...rest} style={[style, fontStyle(style)]} />;
});
