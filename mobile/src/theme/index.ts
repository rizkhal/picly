// Design tokens — dark-first, mirrors the desktop Picly theme.
import type { QualityTier } from '../types';

export const colors = {
  bg: '#0f0f0f',
  surface: '#1a1a1a',
  surface2: '#222222',
  border: '#2a2a2a',
  borderStrong: '#3a3a3a',
  text: '#e5e5e5',
  textMuted: '#888888',
  textFaint: '#5c5c5c',
  accent: '#3b82f6',
  accentSoft: 'rgba(59, 130, 246, 0.14)',
  faceBox: '#fb923c',
  danger: '#ef4444',
  dangerSoft: 'rgba(239, 68, 68, 0.12)',
  success: '#22c55e',
  warning: '#f59e0b',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
};

export const typography = {
  title: 20,
  subtitle: 17,
  body: 15,
  caption: 13,
  micro: 11,
  header: 34,
};

/** Quality tier badge colors — consistent with desktop (H/M/L/VL). */
export const qualityTierColors: Record<QualityTier, string> = {
  high: colors.success,
  medium: colors.warning,
  low: colors.faceBox,
  very_low: colors.textMuted,
};

export const qualityTierLabels: Record<QualityTier, string> = {
  high: 'H',
  medium: 'M',
  low: 'L',
  very_low: 'VL',
};
