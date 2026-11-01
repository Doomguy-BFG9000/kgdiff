import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { flyDuration } from '../src/camera.js';
import { smoothZoom } from '../src/smooth-zoom.js';

describe('van Wijk–Nuij smooth zoom', () => {
  it('starts and ends exactly at the given views', () => {
    const a = { x: 0, y: 0, w: 100 };
    const b = { x: 5000, y: -300, w: 40 };
    const path = smoothZoom(a, b);
    expect(path.at(0)).toEqual(a);
    expect(path.at(1)).toEqual(b);
  });

  it('is continuous at both endpoints', () => {
    const a = { x: 10, y: 20, w: 300 };
    const b = { x: -800, y: 400, w: 90 };
    const path = smoothZoom(a, b);
    const near0 = path.at(1e-6);
    const near1 = path.at(1 - 1e-6);
    expect(near0.x).toBeCloseTo(a.x, 2);
    expect(near0.w).toBeCloseTo(a.w, 2);
    expect(near1.x).toBeCloseTo(b.x, 2);
    expect(near1.y).toBeCloseTo(b.y, 2);
    expect(near1.w).toBeCloseTo(b.w, 2);
  });

  it('zooms out while travelling far, then back in', () => {
    const path = smoothZoom({ x: 0, y: 0, w: 100 }, { x: 10_000, y: 0, w: 100 });
    const mid = path.at(0.5);
    expect(mid.w).toBeGreaterThan(1000);
    expect(mid.x).toBeCloseTo(5000, 0);
  });

  it('moves monotonically along the chord', () => {
    const path = smoothZoom({ x: 0, y: 0, w: 50 }, { x: 900, y: 1200, w: 20 });
    let last = -1;
    for (let i = 0; i <= 50; i++) {
      const v = path.at(i / 50);
      const u = Math.hypot(v.x, v.y);
      expect(u).toBeGreaterThanOrEqual(last - 1e-9);
      last = u;
    }
  });

  it('handles a pure zoom with exponential width', () => {
    const path = smoothZoom({ x: 3, y: 4, w: 100 }, { x: 3, y: 4, w: 25 });
    expect(path.S).toBeCloseTo(Math.log(4) / Math.SQRT2, 9);
    expect(path.at(0.5).w).toBeCloseTo(50, 9);
  });

  it('has zero length when nothing changes', () => {
    expect(smoothZoom({ x: 1, y: 1, w: 10 }, { x: 1, y: 1, w: 10 }).S).toBe(0);
  });

  it('has a finite, non-negative length and finite views for arbitrary inputs', () => {
    const coord = fc.double({ min: -1e6, max: 1e6, noNaN: true });
    const width = fc.double({ min: 1e-3, max: 1e6, noNaN: true });
    fc.assert(
      fc.property(
        coord,
        coord,
        width,
        coord,
        coord,
        width,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (x0, y0, w0, x1, y1, w1, t) => {
          const path = smoothZoom({ x: x0, y: y0, w: w0 }, { x: x1, y: y1, w: w1 });
          const v = path.at(t);
          return (
            path.S >= 0 && Number.isFinite(path.S) && Number.isFinite(v.x + v.y + v.w) && v.w > 0
          );
        },
      ),
    );
  });

  it('derives flight durations from S, clamped to [350, 1100] ms', () => {
    expect(flyDuration(0)).toBe(350);
    expect(flyDuration(1)).toBe(620);
    expect(flyDuration(10)).toBe(1100);
  });
});
