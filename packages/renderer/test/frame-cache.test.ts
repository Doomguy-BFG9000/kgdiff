import { describe, expect, it } from 'vitest';
import { FrameCache, Interner, quantizeAlpha, unionBounds } from '../src/frame-cache.js';
import { PointGrid } from '../src/spatial.js';
import { edge, frameOf, glyph, group, node } from './helpers/recording-ctx.js';

const DASH = [4, 3];

describe('FrameCache', () => {
  it('groups edges into one bucket per style, sorted by z', () => {
    const a = node(0, 0);
    const b = node(100, 0);
    const edges = [
      edge(a, b, { color: '#f00', z: 1 }),
      edge(a, b),
      edge(a, b, { color: '#f00', z: 1 }),
      edge(a, b),
      edge(a, b, { dash: DASH }),
      edge(a, b, { width: 1.75 }),
      edge(a, b, { alpha: 0.5 }),
      edge(a, b, { alpha: 0.501 }), // quantized into the same bucket as 0.5
    ];
    const cache = new FrameCache();
    cache.sync(frameOf([a, b], edges), 1, new Interner());
    const buckets = cache.edgeBuckets.map((bk) => [
      bk.z,
      bk.color,
      bk.width,
      bk.dash?.join(',') ?? '',
      bk.alpha,
      [...bk.members],
    ]);
    expect(buckets).toEqual([
      [0, '#323A4A', 1, '', 1, [1, 3]],
      [0, '#323A4A', 1, '4,3', 1, [4]],
      [0, '#323A4A', 1.75, '', 1, [5]],
      [0, '#323A4A', 1, '', 0.5, [6, 7]],
      [1, '#f00', 1, '', 1, [0, 2]],
    ]);
  });

  it('separates dashed buckets by dash offset (flow animation)', () => {
    const a = node(0, 0);
    const b = node(100, 0);
    const cache = new FrameCache();
    cache.sync(
      frameOf(
        [a, b],
        [
          edge(a, b, { dash: DASH, dashOffset: 0 }),
          edge(a, b, { dash: DASH, dashOffset: 7 }),
          edge(a, b, { dash: DASH, dashOffset: 3 }),
        ],
      ),
      1,
      new Interner(),
    );
    // Offset 7 is one full period of [4, 3]: same bucket as 0.
    expect(cache.edgeBuckets.map((bk) => [...bk.members])).toEqual([[0, 1], [2]]);
  });

  it('skips invisible, transparent and non-finite elements', () => {
    const a = node(0, 0);
    const b = node(100, 0);
    const nodes = [
      a,
      b,
      node(1, 1, { visible: false }),
      node(2, 2, { alpha: 0 }),
      node(Number.NaN, 0),
    ];
    const edges = [
      edge(a, b, { visible: false }),
      edge(a, b, { alpha: 0.001 }),
      edge(a, b, { x1: Number.POSITIVE_INFINITY }),
      edge(a, b, { width: 0 }),
    ];
    const cache = new FrameCache();
    cache.sync(frameOf(nodes, edges), 1, new Interner());
    expect(cache.nodeCount).toBe(2);
    expect(cache.edgeCount).toBe(0);
  });

  it('groups nodes by fill / stroke / dash / alpha and lists decorations', () => {
    const nodes = [
      node(0, 0),
      node(10, 0, { fill: null, stroke: '#f00', dash: [3, 2.5] }),
      node(20, 0),
      node(30, 0, { ring: { color: '#0f0', width: 1.5, gap: 3.5, alpha: 1 }, z: 1 }),
      node(40, 0, { pulse: 0.5 }),
      node(50, 0, { halo: { color: '#0f0', radius: 20, alpha: 0.32 } }),
      node(60, 0, { badge: { text: '+1', color: '#fff', background: '#000', minZoom: 0 } }),
    ];
    const cache = new FrameCache();
    cache.sync(frameOf(nodes), 1, new Interner());
    expect(cache.nodeBuckets.map((bk) => [...bk.members])).toEqual([[0, 2, 4, 5, 6], [1], [3]]);
    expect(cache.decor).toEqual([4, 3]);
    expect(cache.halos).toEqual([5]);
    expect(cache.badges).toEqual([6]);
  });

  it('rebuilds only when the frame or version changes', () => {
    const frame = frameOf([node(0, 0)]);
    const cache = new FrameCache();
    const interner = new Interner();
    cache.sync(frame, 1, interner);
    frame.nodes[0]!.fill = '#123456';
    cache.sync(frame, 1, interner);
    expect(cache.nodeBuckets[0]!.fill).toBe('#4B5568');
    cache.sync(frame, 2, interner);
    expect(cache.nodeBuckets[0]!.fill).toBe('#123456');
  });

  it('computes content bounds from nodes, pills and glyph arcs', () => {
    const frame = frameOf([node(0, 0, { r: 5 }), node(100, 50, { r: 10 })], [], {
      collapsed: [group(-40, 0, 3)],
      glyphs: [glyph('merge-arrow', { x2: 0, y2: 200 })],
    });
    const cache = new FrameCache();
    cache.sync(frame, 1, new Interner());
    expect(cache.contentBounds()).toEqual({ x: -40, y: -5, width: 150, height: 205 });
    const empty = new FrameCache();
    empty.sync(frameOf([]), 1, new Interner());
    expect(empty.contentBounds()).toBeNull();
  });

  it('quantizes alpha to 1/64', () => {
    expect(quantizeAlpha(1)).toBe(64);
    expect(quantizeAlpha(0.004)).toBe(0);
    expect(quantizeAlpha(Number.NaN)).toBe(0);
  });

  it('unions bounds', () => {
    expect(unionBounds(null, null)).toBeNull();
    expect(
      unionBounds({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: -5, width: 10, height: 10 }),
    ).toEqual({ x: 0, y: -5, width: 15, height: 15 });
  });
});

describe('PointGrid', () => {
  it('returns every point in a query rectangle (and nothing far away)', () => {
    const n = 2000;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const rs = new Float64Array(n).fill(4);
    const ids = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = (i * 7919) % 1000;
      ys[i] = (i * 104729) % 700;
      ids[i] = i;
    }
    const grid = new PointGrid();
    grid.build(xs, ys, rs, ids, n);
    const out: number[] = [];
    grid.query(100, 100, 200, 150, out);
    const expected = [...ids].filter(
      (i) => xs[i]! >= 100 && xs[i]! <= 200 && ys[i]! >= 100 && ys[i]! <= 150,
    );
    for (const i of expected) expect(out).toContain(i);
    // Candidates come from nearby cells only.
    expect(out.length).toBeLessThan(n / 4);
    expect(grid.maxR).toBe(4);
  });

  it('handles empty input and coincident points', () => {
    const grid = new PointGrid();
    grid.build(new Float64Array(0), new Float64Array(0), new Float64Array(0), new Int32Array(0), 0);
    const out: number[] = [];
    expect(grid.query(0, 0, 10, 10, out)).toBe(0);
    grid.build(
      new Float64Array([5, 5]),
      new Float64Array([5, 5]),
      new Float64Array([1, 1]),
      new Int32Array([3, 4]),
      2,
    );
    grid.query(4, 4, 6, 6, out);
    expect(out.sort()).toEqual([3, 4]);
  });
});
