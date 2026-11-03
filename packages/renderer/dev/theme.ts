/**
 * DEV / TEST ONLY: theme tokens copied from docs/visual-language.md §Color tokens.
 * The real themes come from `@kgdiff/scene`'s `getTheme`; the renderer never imports this file.
 */
import type { Theme } from '@kgdiff/scene';

const FONT =
  'Inter, "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';
const MONO = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace';
const MOTION = { fast: 120, base: 220, slow: 420, easing: [0.2, 0, 0, 1] } as const;

export const darkTheme: Theme = {
  name: 'dark',
  palette: 'default',
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
  text: { primary: '#E7EBF3', secondary: '#A6AFBF', muted: '#737D8F' },
  accent: { base: '#7C9CFF', strong: '#A3BAFF', soft: 'rgba(124,156,255,0.16)', text: '#A9BEFF' },
  neutral: { node: '#4B5568', nodeStroke: '#5E687C', edge: '#323A4A', label: '#7A8495' },
  family: {
    added: { base: '#34D399', strong: '#6EE7B7', soft: 'rgba(52,211,153,0.16)', text: '#6EE7B7' },
    removed: {
      base: '#F87171',
      strong: '#FCA5A5',
      soft: 'rgba(248,113,113,0.15)',
      text: '#FCA5A5',
    },
    content: { base: '#FBBF24', strong: '#FCD34D', soft: 'rgba(251,191,36,0.15)', text: '#FCD34D' },
    structure: {
      base: '#38BDF8',
      strong: '#7DD3FC',
      soft: 'rgba(56,189,248,0.15)',
      text: '#7DD3FC',
    },
    identity: {
      base: '#A78BFA',
      strong: '#C4B5FD',
      soft: 'rgba(167,139,250,0.17)',
      text: '#C4B5FD',
    },
  },
  glow: true,
  font: { family: FONT, mono: MONO, size: 12, weightRegular: 400, weightStrong: 600 },
  motion: MOTION,
};

export const lightTheme: Theme = {
  name: 'light',
  palette: 'default',
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
  text: { primary: '#0F172A', secondary: '#475569', muted: '#7B8597' },
  accent: { base: '#3B5BDB', strong: '#2F49B5', soft: 'rgba(59,91,219,0.10)', text: '#2F49B5' },
  neutral: { node: '#A7B0BF', nodeStroke: '#8C96A8', edge: '#D3D9E2', label: '#687284' },
  family: {
    added: { base: '#16A34A', strong: '#15803D', soft: 'rgba(22,163,74,0.11)', text: '#15803D' },
    removed: { base: '#DC2626', strong: '#B91C1C', soft: 'rgba(220,38,38,0.09)', text: '#B91C1C' },
    content: { base: '#D97706', strong: '#B45309', soft: 'rgba(217,119,6,0.11)', text: '#92400E' },
    structure: {
      base: '#0284C7',
      strong: '#0369A1',
      soft: 'rgba(2,132,199,0.10)',
      text: '#075985',
    },
    identity: {
      base: '#7C3AED',
      strong: '#6D28D9',
      soft: 'rgba(124,58,237,0.10)',
      text: '#5B21B6',
    },
  },
  glow: false,
  font: { family: FONT, mono: MONO, size: 12, weightRegular: 400, weightStrong: 600 },
  motion: MOTION,
};
