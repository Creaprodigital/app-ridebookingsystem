/**
 * Responsive helpers — used across the driver app to adapt spacing,
 * paddings and font sizes to every phone size we support, from iPhone SE
 * (1st gen — 320×568) up to large flagship devices (≥ 430 px).
 *
 * Design philosophy (conservative, per product requirements):
 *   - Font sizes stay almost identical across breakpoints — we just clip
 *     them by ~1pt on the smallest screens to avoid awkward wrapping.
 *   - Paddings, gaps and outer margins scale down progressively so dense
 *     screens (mission detail, modal, missions cards) don't overflow.
 *   - Everything is built around `Dimensions.get('window')` which Expo /
 *     React Native re-reads on orientation/foldable changes when we
 *     subscribe via the `useScreenSize` hook.
 */
import { useEffect, useState } from 'react';
import { Dimensions, ScaledSize, PixelRatio, Platform } from 'react-native';

// ── Breakpoints (in dp / device-independent pixels) ────────────────────
export const BP = {
  /** iPhone SE 1st gen, very old Android, foldable closed state */
  XS: 320,
  /** Most older mid-range Android, iPhone Mini */
  SM: 360,
  /** Standard modern phone (iPhone 12/13/14, Pixel 5/6) */
  MD: 390,
  /** iPhone Plus / Pro Max, Galaxy Note */
  LG: 414,
  /** Large Pro Max / Ultra / Fold open */
  XL: 480,
} as const;

export type ScreenSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export function classifyWidth(width: number): ScreenSize {
  if (width < BP.SM) return 'xs';
  if (width < BP.MD) return 'sm';
  if (width < BP.LG) return 'md';
  if (width < BP.XL) return 'lg';
  return 'xl';
}

/** Subscribe to screen size — re-renders on orientation / fold changes. */
export function useScreenSize() {
  const [dim, setDim] = useState<ScaledSize>(() => Dimensions.get('window'));
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setDim(window));
    return () => sub.remove();
  }, []);
  return {
    width: dim.width,
    height: dim.height,
    size: classifyWidth(dim.width),
    isXS: dim.width < BP.SM,
    isSmall: dim.width < BP.MD, // xs + sm
    isLarge: dim.width >= BP.LG, // lg + xl
    isPortrait: dim.height >= dim.width,
  };
}

// ── Scale helpers ──────────────────────────────────────────────────────
const BASE_W = BP.MD; // design baseline: 390 px (iPhone 12 / 13)

/**
 * Linearly scale a numeric value (typically a padding/margin/icon size)
 * relative to the design baseline (390 dp), but clamped so we never go
 * below 80% nor above 115% of the original — keeps the layout stable.
 */
export function scale(n: number): number {
  const w = Dimensions.get('window').width;
  const factor = Math.max(0.8, Math.min(w / BASE_W, 1.15));
  return PixelRatio.roundToNearestPixel(n * factor);
}

/**
 * Conservative font scaler: only shrinks fonts by up to 1pt on the
 * smallest screens (xs/sm) and never enlarges them. Keeps the visual
 * identity intact across devices.
 */
export function fontScale(n: number): number {
  const w = Dimensions.get('window').width;
  if (w < BP.SM) return Math.max(10, n - 1); // -1pt on iPhone SE class
  return n;
}

/**
 * Adaptive padding: returns smaller padding on tight devices.
 *   getPad(16) → 12 on xs, 14 on sm, 16 on md+
 */
export function getPad(base: number): number {
  const w = Dimensions.get('window').width;
  if (w < BP.SM) return Math.max(8, base - 4);
  if (w < BP.MD) return Math.max(10, base - 2);
  return base;
}

/**
 * Adaptive gap (column spacing) — same idea as getPad but with a steeper
 * curve so wide grids stay readable on tiny screens.
 */
export function getGap(base: number): number {
  const w = Dimensions.get('window').width;
  if (w < BP.SM) return Math.max(4, Math.round(base * 0.6));
  if (w < BP.MD) return Math.max(6, Math.round(base * 0.8));
  return base;
}

/** Whether the current device is considered "tight" (≤ iPhone SE class). */
export function isTight(): boolean {
  return Dimensions.get('window').width < BP.SM;
}

/** Default touch target: 44 on iOS, 48 on Android (WCAG / Material). */
export const MIN_TOUCH = Platform.OS === 'android' ? 48 : 44;
