/**
 * Design tokens (docs/visual-language.md §Color tokens, §Typography, motion).
 *
 * Four frozen themes: dark ("night") / light ("paper") × default / colorblind palette.
 * Contrast requirements are asserted by `test/theme.test.ts`.
 */
import { KgdiffError } from '@kgdiff/core';
import { withAlpha } from './color.js';
import type { ChangeFamily, FamilyColors, PaletteName, Theme, ThemeName } from './types.js';

export const FONT_FAMILY =
  'Inter, "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", ' +
  '"Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';
export const FONT_MONO = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace';

const MOTION: Theme['motion'] = { fast: 120, base: 220, slow: 420, easing: [0.2, 0, 0, 1] };
const FONT: Theme['font'] = {
  family: FONT_FAMILY,
  mono: FONT_MONO,
  size: 12,
  weightRegular: 400,
  weightStrong: 600,
};

type FamilyTable = Readonly<Record<ChangeFamily, FamilyColors>>;

const DARK_FAMILIES: FamilyTable = {
  added: { base: '#34D399', strong: '#6EE7B7', soft: 'rgba(52,211,153,0.16)', text: '#6EE7B7' },
  removed: { base: '#F87171', strong: '#FCA5A5', soft: 'rgba(248,113,113,0.15)', text: '#FCA5A5' },
  content: { base: '#FBBF24', strong: '#FCD34D', soft: 'rgba(251,191,36,0.15)', text: '#FCD34D' },
  structure: { base: '#38BDF8', strong: '#7DD3FC', soft: 'rgba(56,189,248,0.15)', text: '#7DD3FC' },
  identity: { base: '#A78BFA', strong: '#C4B5FD', soft: 'rgba(167,139,250,0.17)', text: '#C4B5FD' },
};

const LIGHT_FAMILIES: FamilyTable = {
  // text: spec #15803D measures 4.20:1 over its soft tint on the canvas (badges); one step
  // darker, same hue → 4.54:1.
  added: { base: '#16A34A', strong: '#15803D', soft: 'rgba(22,163,74,0.11)', text: '#147A3A' },
  removed: { base: '#DC2626', strong: '#B91C1C', soft: 'rgba(220,38,38,0.09)', text: '#B91C1C' },
  // Spec value #D97706 measures 2.998:1 on #F7F8FA (needs ≥ 3:1); one step darker passes (3.06:1)
  // and is visually indistinguishable. The soft tint keeps the original hue.
  content: { base: '#D87506', strong: '#B45309', soft: 'rgba(217,119,6,0.11)', text: '#92400E' },
  structure: { base: '#0284C7', strong: '#0369A1', soft: 'rgba(2,132,199,0.10)', text: '#075985' },
  identity: { base: '#7C3AED', strong: '#6D28D9', soft: 'rgba(124,58,237,0.10)', text: '#5B21B6' },
};

/**
 * Okabe–Ito based palette (spec gives base / text). Derived tokens follow the default palette's
 * pattern: dark `strong` = `text` (as in every default dark family); light `strong` = the sRGB
 * midpoint of base and text (between mark and text, like content / structure / identity);
 * `soft` = base at the default palette's per-family tint alpha.
 */
function okabeIto(
  base: Record<ChangeFamily, readonly [base: string, text: string, strong: string]>,
  soft: Readonly<Record<ChangeFamily, number>>,
): FamilyTable {
  const make = (f: ChangeFamily): FamilyColors => {
    const [b, text, strong] = base[f];
    return { base: b, strong, soft: withAlpha(b, soft[f]), text };
  };
  return {
    added: make('added'),
    removed: make('removed'),
    content: make('content'),
    structure: make('structure'),
    identity: make('identity'),
  };
}

const DARK_SOFT = { added: 0.16, removed: 0.15, content: 0.15, structure: 0.15, identity: 0.17 };
const LIGHT_SOFT = { added: 0.11, removed: 0.09, content: 0.11, structure: 0.1, identity: 0.1 };

const DARK_COLORBLIND = okabeIto(
  {
    added: ['#56B4E9', '#8FD0F5', '#8FD0F5'],
    removed: ['#E69F00', '#F5C45C', '#F5C45C'],
    content: ['#F0E442', '#F5EC85', '#F5EC85'],
    structure: ['#009E73', '#3CC79E', '#3CC79E'],
    identity: ['#CC79A7', '#E0A6C6', '#E0A6C6'],
  },
  DARK_SOFT,
);

const LIGHT_COLORBLIND = okabeIto(
  {
    added: ['#0072B2', '#005A8C', '#00669F'],
    removed: ['#D55E00', '#A84A00', '#BF5400'],
    content: ['#9A8700', '#6E6100', '#847400'],
    structure: ['#00805C', '#006248', '#007152'],
    identity: ['#A3477F', '#83335F', '#933D6F'],
  },
  LIGHT_SOFT,
);

function dark(palette: PaletteName): Theme {
  return {
    name: 'dark',
    palette,
    canvas: { background: '#0B0E14', grid: 'rgba(148, 163, 184, 0.07)' },
    surface: {
      panel: '#11151D',
      raised: '#171C26',
      overlay: 'rgba(17, 21, 29, 0.78)',
      border: 'rgba(255,255,255,0.07)',
      borderStrong: 'rgba(255,255,255,0.13)',
      controlBorder: '#5E687C',
      shadow: '0 8px 32px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.04) inset',
    },
    // muted: spec #737D8F measures 4.11:1 on raised; same hue, lighter → ≥ 4.5:1 everywhere.
    text: { primary: '#E7EBF3', secondary: '#A6AFBF', muted: '#7A8495' },
    accent: { base: '#7C9CFF', strong: '#A3BAFF', soft: 'rgba(124,156,255,0.16)', text: '#A9BEFF' },
    neutral: { node: '#4B5568', nodeStroke: '#5E687C', edge: '#323A4A', label: '#8B94A6' },
    family: palette === 'colorblind' ? DARK_COLORBLIND : DARK_FAMILIES,
    glow: true,
    font: FONT,
    motion: MOTION,
  };
}

function light(palette: PaletteName): Theme {
  return {
    name: 'light',
    palette,
    canvas: { background: '#F7F8FA', grid: 'rgba(15, 23, 42, 0.07)' },
    surface: {
      panel: '#FFFFFF',
      raised: '#FFFFFF',
      overlay: 'rgba(255, 255, 255, 0.82)',
      border: 'rgba(15,23,42,0.08)',
      borderStrong: 'rgba(15,23,42,0.15)',
      controlBorder: '#8690A3',
      shadow: '0 8px 28px rgba(15,23,42,0.10), 0 1px 2px rgba(15,23,42,0.06)',
    },
    // muted: spec #7B8597 measures 3.50:1 on the canvas; same hue, darker → ≥ 4.5:1 everywhere.
    text: { primary: '#0F172A', secondary: '#475569', muted: '#687284' },
    accent: { base: '#3B5BDB', strong: '#2F49B5', soft: 'rgba(59,91,219,0.10)', text: '#2F49B5' },
    neutral: { node: '#A7B0BF', nodeStroke: '#8C96A8', edge: '#D3D9E2', label: '#5F6B7D' },
    family: palette === 'colorblind' ? LIGHT_COLORBLIND : LIGHT_FAMILIES,
    glow: false,
    font: FONT,
    motion: MOTION,
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const cache = new Map<string, Theme>();

export const THEME_NAMES: readonly ThemeName[] = ['dark', 'light'];
export const PALETTE_NAMES: readonly PaletteName[] = ['default', 'colorblind'];

/**
 * Design tokens for a theme / palette pair (docs/visual-language.md §Color).
 * Returns a deeply frozen, cached object: the same pair always yields the same instance,
 * so it can key caches.
 *
 * @throws KgdiffError(`invalid-input`) for an unknown theme or palette name.
 */
export function getTheme(name: ThemeName, palette: PaletteName = 'default'): Theme {
  if (!THEME_NAMES.includes(name)) {
    throw new KgdiffError(
      'invalid-input',
      `Unknown theme "${String(name)}" (expected "dark" or "light").`,
    );
  }
  if (!PALETTE_NAMES.includes(palette)) {
    throw new KgdiffError(
      'invalid-input',
      `Unknown palette "${String(palette)}" (expected "default" or "colorblind").`,
    );
  }
  const key = `${name}/${palette}`;
  let theme = cache.get(key);
  if (theme === undefined) {
    theme = deepFreeze(name === 'dark' ? dark(palette) : light(palette));
    cache.set(key, theme);
  }
  return theme;
}
