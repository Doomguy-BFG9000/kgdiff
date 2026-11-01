/**
 * Deterministic arithmetic.
 *
 * ECMAScript only guarantees exact (correctly rounded) results for + − × ÷ and, in every engine
 * in practice, `Math.sqrt`. `Math.log2`, `Math.pow`, `Math.sin`… are implementation-approximated
 * and can differ in the last bit between V8, SpiderMonkey and JavaScriptCore. A force simulation
 * amplifies such differences, so everything that feeds it goes through these helpers to keep
 * layouts byte-identical between the CLI (Node) and the browser.
 */

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Round to 0.01 (the layout's output precision); never returns `-0`. */
export function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** log₂(x) for x > 0, using only exactly rounded operations. Accurate to ~1e-15. */
export function log2(x: number): number {
  if (!(x > 0)) return Number.NEGATIVE_INFINITY;
  if (x === Number.POSITIVE_INFINITY) return x;
  // x = m·2^e with m ∈ [1, 2); scaling by 2 is exact.
  let m = x;
  let e = 0;
  while (m >= 2) {
    m /= 2;
    e++;
  }
  while (m < 1) {
    m *= 2;
    e--;
  }
  // ln(m) = 2·atanh(s), s = (m − 1)/(m + 1) ∈ [0, 1/3): the series converges by 1/9 per term.
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let term = s;
  let sum = 0;
  for (let k = 1; k < 40; k += 2) {
    sum += term / k;
    term *= s2;
  }
  return e + (2 * sum) / Math.LN2;
}

/** bⁿ for integer n ≥ 0 by repeated squaring (exact operation sequence). */
export function powInt(base: number, exponent: number): number {
  let result = 1;
  let b = base;
  let n = exponent;
  while (n > 0) {
    if (n & 1) result *= b;
    b *= b;
    n >>>= 1;
  }
  return result;
}

/**
 * The per-tick factor `r` with `r^ticks = ratio` (ratio ∈ (0, 1]), found by bisection over
 * `powInt` so it is reproducible everywhere. Used for the alpha cooling schedule.
 */
export function coolingFactor(ratio: number, ticks: number): number {
  if (ticks <= 0 || ratio >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (powInt(mid, ticks) < ratio) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Monotonic stand-in for the polar angle of (x, y), in [0, 4). Sorting by it equals sorting by
 * `atan2` without any transcendental function.
 */
export function pseudoAngle(x: number, y: number): number {
  const d = Math.abs(x) + Math.abs(y);
  if (d === 0) return 0;
  const p = x / d;
  return y >= 0 ? 1 - p : 3 + p;
}

/** Shortest distance between two pseudo-angles on the [0, 4) circle. */
export function pseudoAngleDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return d > 2 ? 4 - d : d;
}
