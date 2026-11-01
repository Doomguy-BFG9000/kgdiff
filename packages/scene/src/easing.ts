/**
 * Easing and interpolation helpers for the replay choreography. All functions are pure and
 * allocation-free once created (curves are built once at module load). The per-frame helpers are
 * deliberately tiny so the JIT inlines them: a non-inlined call returning a double boxes it.
 */
import { KgdiffError } from '@kgdiff/core';

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Local progress of `u` inside the sub-interval [a, b], clamped to [0, 1]. */
export const segment = (u: number, a: number, b: number): number => {
  if (b <= a) return u >= b ? 1 : 0;
  const v = (u - a) / (b - a);
  return Math.min(1, Math.max(0, v));
};

/** 0 → 1 → 0 bump over [0, 1] (flashes, pulses). */
export const bump = (t: number): number => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t));

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)` as a function of progress in [0, 1]: Newton–Raphson on
 * the x polynomial with a bisection fallback (WebKit's UnitBezier approach), precise to 1e-7.
 *
 * @throws KgdiffError(`invalid-input`) when x1 or x2 lie outside [0, 1] (x must be monotonic).
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  if (!(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1)) {
    throw new KgdiffError(
      'invalid-input',
      `cubicBezier: x1 and x2 must be in [0, 1], got ${x1}, ${x2}.`,
    );
  }
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  const solveX = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-7) return t;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 64 && hi - lo > 1e-7; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-7) return t;
      if (x > v) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : sampleY(solveX(t)));
}

const STANDARD = cubicBezier(0.2, 0, 0, 1);
const LUT_STEPS = 1024;
const LUT = new Float64Array(LUT_STEPS + 2);
for (let i = 0; i <= LUT_STEPS; i++) LUT[i] = STANDARD(i / LUT_STEPS);
LUT[LUT_STEPS + 1] = 1;

/**
 * The house easing `cubic-bezier(0.2, 0, 0, 1)` (theme.motion.easing), sampled into a
 * 1024-step table with linear interpolation (max error ≈ 1e-5). Kept tiny on purpose: the
 * replay calls it many times per frame, and only functions small enough to be inlined return
 * doubles without boxing them on the heap.
 */
export const easeStandard = (t: number): number => {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  const x = t * LUT_STEPS;
  const i = x | 0;
  const a = LUT[i] as number;
  return a + ((LUT[i + 1] as number) - a) * (x - i);
};

/** Symmetric cubic ease-in-out, for travel along arcs. */
export const easeInOut = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  if (u < 0.5) return 4 * u * u * u;
  const v = 2 - 2 * u;
  return 1 - (v * v * v) / 2;
};

/**
 * Back-out easing: overshoots then settles at 1. The peak is `1 + 4s³ / (27 (s + 1)²)`, so the
 * default `s = 1.5` peaks at exactly 1.08 (the node pop: scale 0 → 1.08 → 1).
 */
export const backOut = (t: number, s = 1.5): number => {
  const u = Math.min(1, Math.max(0, t)) - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};
