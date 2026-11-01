import { describe, expect, it } from 'vitest';
import { addNodeBox, BoundsBuilder, edgeCurvatures, parallelCurvatures } from '../src/geometry.js';

describe('parallel curvature', () => {
  it('keeps a lone edge straight', () => {
    expect([...parallelCurvatures([{ a: 0, b: 1 }])]).toEqual([0]);
  });

  it('fans an even group to ±0.18·k and an odd group around a straight line', () => {
    const two = parallelCurvatures([
      { a: 0, b: 1 },
      { a: 0, b: 1 },
    ]);
    expect([...two]).toEqual([0.18, -0.18]);
    const five = parallelCurvatures(Array.from({ length: 5 }, () => ({ a: 2, b: 3 })));
    expect([...five].map((c) => Math.round(c * 100) / 100)).toEqual([0, 0.18, -0.18, 0.36, -0.36]);
  });

  it('expresses signs in each edge direction so opposite edges separate', () => {
    const c = parallelCurvatures([
      { a: 0, b: 1 },
      { a: 1, b: 0 },
    ]);
    // Same world side would be c[0] === -c[1]; separated sides means equal signed values.
    expect(c[0]).toBe(0.18);
    expect(c[1]).toBe(0.18);
  });

  it('gives self-loops a fan too', () => {
    expect([
      ...parallelCurvatures([
        { a: 4, b: 4 },
        { a: 4, b: 4 },
      ]),
    ]).toEqual([0.18, -0.18]);
  });

  it('never bends a real edge because of a ghost form', () => {
    const { primary, ghost } = edgeCurvatures([
      { s: 0, t: 1, sb: 0, tb: 1 },
      { s: 0, t: 2, sb: 0, tb: 1 }, // retargeted: before form 0 → 1 shares the pair
    ]);
    expect(primary[0]).toBe(0);
    expect(primary[1]).toBe(0);
    expect(Math.abs(ghost[1] as number)).toBeCloseTo(0.18, 12);
    expect(ghost[0]).toBe(0);
  });
});

describe('bounds', () => {
  it('boxes a node with its label below and the struck old name', () => {
    const b = new BoundsBuilder();
    expect(b.empty).toBe(true);
    addNodeBox(b, 0, 0, 10, 'ab', undefined);
    const r = b.rect();
    expect(r.x).toBe(-10);
    expect(r.y).toBe(-10);
    expect(r.height).toBeCloseTo(10 + 10 + 5 + 12 * 1.3, 10);
    const b2 = new BoundsBuilder();
    addNodeBox(b2, 0, 0, 4, 'A very long label indeed', 'old');
    expect(b2.rect().width).toBeGreaterThan(100);
    expect(b2.rect().height).toBeCloseTo(4 + 4 + 5 + 12 * 1.3 + 14, 10);
  });
});
