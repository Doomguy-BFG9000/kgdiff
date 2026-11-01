/** Minimal CSS color parsing for alpha ramps (halo sprites). Hex and rgb()/rgba() only. */
import { clamp } from './math.js';

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** [0, 1] */
  readonly a: number;
}

const cache = new Map<string, Rgba | null>();

/** Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`; null for anything else. */
export function parseColor(input: string): Rgba | null {
  const hit = cache.get(input);
  if (hit !== undefined) return hit;
  const parsed = parse(input.trim().toLowerCase());
  if (cache.size > 512) cache.clear();
  cache.set(input, parsed);
  return parsed;
}

function parse(s: string): Rgba | null {
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) {
      const v = (i: number): number => Number.parseInt(hex.charAt(i) + hex.charAt(i), 16);
      return { r: v(0), g: v(1), b: v(2), a: hex.length === 4 ? v(3) / 255 : 1 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const v = (i: number): number => Number.parseInt(hex.slice(i, i + 2), 16);
      return { r: v(0), g: v(2), b: v(4), a: hex.length === 8 ? v(6) / 255 : 1 };
    }
    return null;
  }
  const m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (!m) return null;
  const parts = (m[1] ?? '').split(/[\s,/]+/).filter((p) => p.length > 0);
  if (parts.length < 3 || parts.length > 4) return null;
  const channel = (p: string): number =>
    p.endsWith('%') ? Number.parseFloat(p) * 2.55 : Number.parseFloat(p);
  const alpha = (p: string | undefined): number =>
    p === undefined ? 1 : p.endsWith('%') ? Number.parseFloat(p) / 100 : Number.parseFloat(p);
  const r = channel(parts[0] ?? '');
  const g = channel(parts[1] ?? '');
  const b = channel(parts[2] ?? '');
  const a = alpha(parts[3]);
  if (![r, g, b, a].every(Number.isFinite)) return null;
  return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a, 0, 1) };
}

/** `rgba()` string of `color` with its alpha multiplied by `alpha`. */
export function rgbaString(color: Rgba, alpha: number): string {
  const a = Math.round(clamp(color.a * alpha, 0, 1) * 1000) / 1000;
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${a})`;
}
