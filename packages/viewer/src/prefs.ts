/**
 * The one place viewer preferences are validated: attributes, properties and a report's `view`
 * all go through these. Invalid values never reach the controller (they fall back, with a
 * console warning for payloads, which come from files rather than code).
 */
import type { Locale } from '@kgdiff/core';
import type { PaletteName } from '@kgdiff/scene';
import { normalizeLocale } from './i18n.js';
import type {
  ReportPayload,
  ThemePreference,
  ViewerChrome,
  ViewerLegend,
  ViewerMode,
} from './index.js';

const MODES: readonly ViewerMode[] = ['overlay', 'swipe', 'replay', 'changes'];
const THEMES: readonly ThemePreference[] = ['auto', 'light', 'dark'];
const PALETTES: readonly PaletteName[] = ['default', 'colorblind'];
const CHROMES: readonly ViewerChrome[] = ['full', 'none'];
const LEGENDS: readonly ViewerLegend[] = ['auto', 'full', 'mini', 'none'];

/** Pause between the end of a looping replay and its next start, ms. */
export const DEFAULT_LOOP_DELAY = 1200;

export const THEME_PREFERENCES = THEMES;

export function toMode(value: unknown): ViewerMode | null {
  return MODES.includes(value as ViewerMode) ? (value as ViewerMode) : null;
}

export function toTheme(value: unknown): ThemePreference | null {
  return THEMES.includes(value as ThemePreference) ? (value as ThemePreference) : null;
}

export function toPalette(value: unknown): PaletteName | null {
  return PALETTES.includes(value as PaletteName) ? (value as PaletteName) : null;
}

export function toLocale(value: unknown): Locale | null {
  return typeof value === 'string' ? normalizeLocale(value) : null;
}

export function toChrome(value: unknown): ViewerChrome | null {
  return CHROMES.includes(value as ViewerChrome) ? (value as ViewerChrome) : null;
}

export function toLegend(value: unknown): ViewerLegend | null {
  return LEGENDS.includes(value as ViewerLegend) ? (value as ViewerLegend) : null;
}

/** A delay in ms (number or numeric string), at least 0. */
export function toDelay(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

type View = NonNullable<ReportPayload['view']>;

/** Keep only the valid fields of a report's `view` (warning about the rest). */
export function sanitizeView(view: unknown): View | undefined {
  if (typeof view !== 'object' || view === null) return undefined;
  const v = view as Record<string, unknown>;
  const mode = toMode(v.mode);
  const theme = toTheme(v.theme);
  const palette = toPalette(v.palette);
  const locale = toLocale(v.locale);
  const dropped = (['mode', 'theme', 'palette', 'locale'] as const).filter(
    (k) => v[k] !== undefined && { mode, theme, palette, locale }[k] === null,
  );
  if (dropped.length > 0 && typeof console !== 'undefined') {
    console.warn(`[kgdiff] ignoring invalid report view preferences: ${dropped.join(', ')}`);
  }
  return {
    ...(mode ? { mode } : {}),
    ...(theme ? { theme } : {}),
    ...(palette ? { palette } : {}),
    ...(locale ? { locale } : {}),
  };
}
