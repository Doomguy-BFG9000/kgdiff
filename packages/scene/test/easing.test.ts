import { KgdiffError } from '@kgdiff/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  backOut,
  bump,
  clamp01,
  cubicBezier,
  easeInOut,
  easeStandard,
  lerp,
  segment,
} from '../src/easing.js';

describe('cubicBezier', () => {
  it('maps 0 → 0 and 1 → 1 and clamps outside', () => {
    const f = cubicBezier(0.2, 0, 0, 1);
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
    expect(f(-3)).toBe(0);
    expect(f(7)).toBe(1);
  });

  it('is the identity for the linear curve', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const t of [0.1, 0.25, 0.5, 0.9]) expect(linear(t)).toBeCloseTo(t, 6);
  });

  it('matches CSS ease (0.25, 0.1, 0.25, 1) reference samples', () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
    expect(ease(0.25)).toBeCloseTo(0.4085, 3);
  });

  it('is monotonic for the house easing', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          return easeStandard(lo) <= easeStandard(hi) + 1e-9;
        },
      ),
    );
  });

  it('decelerates: the house easing is ahead of linear', () => {
    expect(easeStandard(0.3)).toBeGreaterThan(0.3);
  });

  it('rejects non-monotonic x control points', () => {
    expect(() => cubicBezier(-0.1, 0, 0.5, 1)).toThrow(KgdiffError);
    expect(() => cubicBezier(0.1, 0, 1.5, 1)).toThrow(KgdiffError);
  });
});

describe('helpers', () => {
  it('backOut overshoots to exactly 1.08 and settles at 1', () => {
    let peak = 0;
    for (let i = 0; i <= 10_000; i++) peak = Math.max(peak, backOut(i / 10_000));
    expect(peak).toBeCloseTo(1.08, 4);
    expect(backOut(0)).toBe(0);
    expect(backOut(1)).toBe(1);
  });

  it('easeInOut is symmetric', () => {
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOut(0.2) + easeInOut(0.8)).toBeCloseTo(1, 12);
    expect(easeInOut(-1)).toBe(0);
  });

  it('segment, clamp01, lerp, bump', () => {
    expect(segment(0.5, 0.25, 0.75)).toBe(0.5);
    expect(segment(0, 0.25, 0.75)).toBe(0);
    expect(segment(1, 0.25, 0.75)).toBe(1);
    expect(segment(0.5, 0.5, 0.5)).toBe(1);
    expect(segment(0.4, 0.5, 0.5)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(-2)).toBe(0);
    expect(lerp(2, 4, 0.25)).toBe(2.5);
    expect(bump(0)).toBe(0);
    expect(bump(1)).toBe(0);
    expect(bump(0.5)).toBeCloseTo(1, 12);
  });
});
