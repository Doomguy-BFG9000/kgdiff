/**
 * Van Wijk & Nuij, "Smooth and efficient zooming and panning" (InfoVis 2003).
 *
 * Interpolates between two views (centre + visible width) along the path that is optimal
 * for perceived motion: zoom out while travelling, zoom back in on arrival.
 */

export interface ZoomView {
  readonly x: number;
  readonly y: number;
  /** Visible extent in world units (inverse of zoom). */
  readonly w: number;
}

export interface ZoomPath {
  /** Path length `S` in the paper's units (≥ 0). Duration is derived from it. */
  readonly S: number;
  /** View at `t ∈ [0, 1]`; exact endpoints at 0 and 1. */
  at(t: number): ZoomView;
}

const TINY = 1e-12;

/** Optimal zoom-and-pan path from `a` to `b`. `rho` trades zooming for panning (√2 by default). */
export function smoothZoom(a: ZoomView, b: ZoomView, rho: number = Math.SQRT2): ZoomPath {
  const rho2 = rho * rho;
  const rho4 = rho2 * rho2;
  const w0 = Math.max(a.w, TINY);
  const w1 = Math.max(b.w, TINY);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d1 = Math.hypot(dx, dy);

  if (d1 < 1e-9 * Math.max(w0, w1)) {
    // Pure zoom (or no motion): exponential in the width keeps perceived speed constant.
    const ratio = Math.log(w1 / w0);
    return {
      S: Math.abs(ratio) / rho,
      at(t) {
        if (t <= 0) return a;
        if (t >= 1) return b;
        return { x: a.x + t * dx, y: a.y + t * dy, w: w0 * Math.exp(ratio * t) };
      },
    };
  }

  const b0 = (w1 * w1 - w0 * w0 + rho4 * d1 * d1) / (2 * w0 * rho2 * d1);
  const b1 = (w1 * w1 - w0 * w0 - rho4 * d1 * d1) / (2 * w1 * rho2 * d1);
  // ln(√(b²+1) − b) = −asinh(b), numerically stable for large |b|.
  const r0 = -Math.asinh(b0);
  const r1 = -Math.asinh(b1);
  const S = (r1 - r0) / rho;
  const coshR0 = Math.cosh(r0);
  const sinhR0 = Math.sinh(r0);
  return {
    S,
    at(t) {
      if (t <= 0) return a;
      if (t >= 1) return b;
      const s = t * S;
      const u = (w0 / (rho2 * d1)) * (coshR0 * Math.tanh(rho * s + r0) - sinhR0);
      return { x: a.x + u * dx, y: a.y + u * dy, w: (w0 * coshR0) / Math.cosh(rho * s + r0) };
    },
  };
}
