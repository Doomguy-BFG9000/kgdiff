import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseColor, rgbaString } from '../src/color.js';
import {
  crispOffset,
  distToQuadSq,
  distToSegmentSq,
  quadAt,
  quadTrim,
  rectsOverlap,
  segmentHitsRect,
  snap,
} from '../src/math.js';

describe('culling: segment vs rectangle', () => {
  it('accepts segments with an endpoint inside', () => {
    expect(segmentHitsRect(5, 5, 100, 100, 0, 0, 10, 10)).toBe(true);
  });
  it('accepts segments crossing the rectangle with both endpoints outside', () => {
    expect(segmentHitsRect(-10, 5, 20, 5, 0, 0, 10, 10)).toBe(true);
    expect(segmentHitsRect(-5, -5, 15, 15, 0, 0, 10, 10)).toBe(true);
  });
  it('rejects segments passing beside a corner', () => {
    expect(segmentHitsRect(-5, 8, 8, 21, 0, 0, 10, 10)).toBe(false);
    expect(segmentHitsRect(11, 0, 20, 10, 0, 0, 10, 10)).toBe(false);
  });
  it('agrees with dense sampling', () => {
    const c = fc.double({ min: -50, max: 50, noNaN: true });
    fc.assert(
      fc.property(c, c, c, c, (ax, ay, bx, by) => {
        let sampled = false;
        for (let i = 0; i <= 2000; i++) {
          const t = i / 2000;
          const x = ax + (bx - ax) * t;
          const y = ay + (by - ay) * t;
          if (x >= -10 && x <= 10 && y >= -10 && y <= 10) sampled = true;
        }
        const exact = segmentHitsRect(ax, ay, bx, by, -10, -10, 10, 10);
        // Sampling can miss grazing hits but never invent one.
        return !sampled || exact;
      }),
    );
  });
});

describe('quadratic helpers', () => {
  it('trims a straight-ish quadratic by distance from either end', () => {
    const t0 = quadTrim(0, 0, 50, 0, 100, 0, 10, false);
    const t1 = quadTrim(0, 0, 50, 0, 100, 0, 10, true);
    expect(quadAt(0, 50, 100, t0)).toBeCloseTo(10, 2);
    expect(quadAt(0, 50, 100, t1)).toBeCloseTo(90, 2);
  });
  it('trims curved edges at the radius', () => {
    const t = quadTrim(0, 0, 50, 40, 100, 0, 12, false);
    const x = quadAt(0, 50, 100, t);
    const y = quadAt(0, 40, 0, t);
    expect(Math.hypot(x, y)).toBeCloseTo(12, 1);
  });
  it('measures distance to segments and curves', () => {
    expect(distToSegmentSq(5, 5, 0, 0, 10, 0)).toBeCloseTo(25, 9);
    expect(distToSegmentSq(-3, 4, 0, 0, 10, 0)).toBeCloseTo(25, 9);
    // Apex of the curve (0,0) → (100,0) with control (50,40) is at (50,20).
    expect(Math.sqrt(distToQuadSq(50, 20, 0, 0, 50, 40, 100, 0))).toBeLessThan(0.5);
    expect(Math.sqrt(distToQuadSq(50, 0, 0, 0, 50, 40, 100, 0))).toBeCloseTo(20, 0);
  });
});

describe('pixel helpers', () => {
  it('snaps to device pixels', () => {
    expect(snap(10.3, 2)).toBe(10.5);
    expect(snap(10.3, 1)).toBe(10);
  });
  it('centres odd device-width strokes on pixel centres', () => {
    expect(crispOffset(1, 1)).toBe(0.5);
    expect(crispOffset(1, 2)).toBe(0);
    expect(crispOffset(1, 3)).toBeCloseTo(1 / 6, 12);
  });
  it('detects rectangle overlap (touching is not overlap)', () => {
    expect(rectsOverlap(0, 0, 10, 10, 5, 5, 10, 10)).toBe(true);
    expect(rectsOverlap(0, 0, 10, 10, 10, 0, 10, 10)).toBe(false);
  });
});

describe('color parsing', () => {
  it('parses hex and rgb() forms', () => {
    expect(parseColor('#34D399')).toEqual({ r: 52, g: 211, b: 153, a: 1 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#00000080')?.a).toBeCloseTo(128 / 255, 9);
    expect(parseColor('rgba(52,211,153,0.16)')).toEqual({ r: 52, g: 211, b: 153, a: 0.16 });
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });
  it('returns null for unsupported colors', () => {
    expect(parseColor('oklch(0.7 0.1 200)')).toBeNull();
    expect(parseColor('#12')).toBeNull();
  });
  it('multiplies alpha when formatting', () => {
    expect(rgbaString({ r: 10, g: 20, b: 30, a: 0.5 }, 0.5)).toBe('rgba(10, 20, 30, 0.25)');
  });
});
