import { KgdiffError } from '@kgdiff/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type LayoutJSON, layoutDiff, layoutFromJSON, layoutToJSON } from '../src/index.js';
import { makeDiff } from './support/diff-builder.js';
import { changes, components } from './support/fixtures.js';

describe('layoutToJSON / layoutFromJSON', () => {
  const layout = layoutDiff(makeDiff(changes()), { scope: 'changes' });
  const json = layoutToJSON(layout);

  it('emits a versioned document without timing information', () => {
    expect(json.format).toBe('kgdiff.layout');
    expect(json.version).toBe(1);
    expect(json.strategy).toBe(layout.stats.strategy);
    expect(json.scope).toBe('changes');
    expect(json.iterations).toBe(layout.stats.iterations);
    expect(JSON.stringify(json)).not.toContain('"ms"');
    expect(Object.keys(json.positions)).toHaveLength(layout.positions.size);
    expect(Object.keys(json.hidden)).toHaveLength(layout.hidden.size);
  });

  it('rounds coordinates and radii to 0.01', () => {
    for (const [x, y] of Object.values(json.positions)) {
      expect(Math.round(x * 100) / 100).toBe(x);
      expect(Math.round(y * 100) / 100).toBe(y);
    }
    for (const r of Object.values(json.radii)) expect(Math.round(r * 100) / 100).toBe(r);
  });

  it('round-trips: toJSON(fromJSON(json)) equals json, also through text', () => {
    const text = JSON.stringify(json);
    const back = layoutFromJSON(JSON.parse(text) as LayoutJSON);
    expect(JSON.stringify(layoutToJSON(back))).toBe(text);
    expect(back.stats.ms).toBe(0);
    expect(back.stats.nodes).toBe(layout.positions.size);
    for (const [id, p] of layout.positions) {
      expect(back.positions.get(id)!.x).toBeCloseTo(p.x, 2);
      expect(back.positions.get(id)!.y).toBeCloseTo(p.y, 2);
    }
    expect(back.components.map((c) => c.nodes)).toEqual(layout.components.map((c) => c.nodes));
  });

  it('is independent of map insertion order', () => {
    const shuffledLayout = {
      ...layout,
      positions: new Map([...layout.positions].reverse()),
      radii: new Map([...layout.radii].reverse()),
      hidden: new Map([...layout.hidden].reverse()),
    };
    expect(JSON.stringify(layoutToJSON(shuffledLayout))).toBe(JSON.stringify(json));
  });

  it('keeps awkward ids as plain data', () => {
    const ids = [
      '__proto__',
      'constructor',
      '0',
      '10',
      '2',
      'a"b',
      'x|y',
      'http://e.org/a#b',
      '中文',
    ];
    const diff = makeDiff({ nodes: ids.map((id) => ({ id })), edges: [] });
    const out = layoutToJSON(layoutDiff(diff));
    expect(Object.keys(out.positions).sort()).toEqual([...ids].sort());
    expect(Object.getPrototypeOf(out.positions)).toBe(Object.prototype);
    const back = layoutFromJSON(JSON.parse(JSON.stringify(out)) as LayoutJSON);
    expect([...back.positions.keys()]).toEqual([...ids].sort((a, b) => (a < b ? -1 : 1)));
  });

  it('property: round trip is idempotent for any seed', () => {
    const diff = makeDiff(components(6, 4));
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), (seed) => {
        const once = layoutToJSON(layoutDiff(diff, { seed, iterations: 30 }));
        const twice = layoutToJSON(layoutFromJSON(once));
        return JSON.stringify(once) === JSON.stringify(twice);
      }),
      { numRuns: 15 },
    );
  });

  it('rejects other documents and versions', () => {
    const expectCode = (value: unknown, code: string): void => {
      try {
        layoutFromJSON(value as LayoutJSON);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(KgdiffError);
        expect((error as KgdiffError).code).toBe(code);
      }
    };
    expectCode(null, 'invalid-input');
    expectCode({ ...json, format: 'kgdiff.diff' }, 'invalid-input');
    expectCode({ ...json, version: 2 }, 'unsupported-version');
    expectCode({ ...json, strategy: 'random' }, 'invalid-input');
    expectCode({ ...json, positions: { a: [1] } }, 'invalid-input');
    expectCode({ ...json, positions: { a: [1, 'x'] } }, 'invalid-input');
    expectCode({ ...json, radii: { a: null } }, 'invalid-input');
    expectCode({ ...json, bounds: { x: 0 } }, 'invalid-input');
    expectCode({ ...json, components: [{ nodes: [1], bounds: json.bounds }] }, 'invalid-input');
  });
});
