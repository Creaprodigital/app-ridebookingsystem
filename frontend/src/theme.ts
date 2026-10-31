import { Appearance } from 'react-native';

// Brand palette taken from ridebookingsystem.com: primary blue #0B63F6,
// navy text #0A0F2C, light blue-grey backgrounds; the dark variant uses the
// navy of the website's dark sections. The scheme follows the phone setting
// and is resolved once at launch (StyleSheets are built at import time).
export type ColorScheme = 'light' | 'dark';

export const scheme: ColorScheme = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
export const isDark = scheme === 'dark';

const light = {
  primary: '#0B63F6',
  primaryHover: '#0952CC',
  primarySoft: '#E7F0FE',
  onPrimary: '#FFFFFF',
  bg: '#F5F8FC',
  surface: '#FFFFFF',
  surface2: '#EEF3FA',
  elevated: '#E7EDF6',
  border: '#E2E8F1',
  text: '#0A0F2C',
  textSecondary: '#55607A',
  textMuted: '#8A94AA',
  success: '#12A35C',
  successSoft: '#E3F7EC',
  danger: '#DC2626',
  dangerSoft: '#FDECEC',
  warning: '#D97706',
  warningSoft: '#FEF3E2',
  info: '#0B63F6',
  infoSoft: '#E7F0FE',
  overlay: 'rgba(10, 15, 44, 0.45)',
  // End-of-ride payment screens (coloured buttons/messages)
  paidAccent: '#12A35C',
  cashAccent: '#EA580C',
  alertAccent: '#DC2626',
};

const dark: typeof light = {
  primary: '#3B82F6',
  primaryHover: '#2F6FE0',
  primarySoft: 'rgba(59, 130, 246, 0.16)',
  onPrimary: '#FFFFFF',
  bg: '#030D1C',
  surface: '#0A1A30',
  surface2: '#10243F',
  elevated: '#163056',
  border: '#1A2E4D',
  text: '#F2F6FC',
  textSecondary: '#9DADC6',
  textMuted: '#6B7D99',
  success: '#2BD47D',
  successSoft: 'rgba(43, 212, 125, 0.14)',
  danger: '#F05252',
  dangerSoft: 'rgba(240, 82, 82, 0.14)',
  warning: '#F5A524',
  warningSoft: 'rgba(245, 165, 36, 0.15)',
  info: '#3B82F6',
  infoSoft: 'rgba(59, 130, 246, 0.16)',
  overlay: 'rgba(1, 6, 15, 0.7)',
  paidAccent: '#2BD47D',
  cashAccent: '#F97316',
  alertAccent: '#F05252',
};

export const colors = isDark ? dark : light;

// Families loaded in app/_layout.tsx. Headings use Plus Jakarta Sans, body
// text uses Manrope — same pairing as the website.
export const fonts = {
  body: 'Manrope_500Medium',
  bodyRegular: 'Manrope_400Regular',
  bodySemi: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
  heading: 'PlusJakartaSans_700Bold',
  headingSemi: 'PlusJakartaSans_600SemiBold',
  headingHeavy: 'PlusJakartaSans_800ExtraBold',
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

// Soft card shadow for the light theme; the dark theme relies on borders.
export const shadow = isDark
  ? {}
  : {
      shadowColor: '#0A0F2C',
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    };
