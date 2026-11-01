import type { HunkKind, ReplayPhase } from '@kgdiff/core';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { buildScene } from '../src/index.js';
import {
  buildTimeline,
  chapterDuration,
  hunkDuration,
  PHASE_ORDER,
  type TimelineHunk,
  type TourHunk,
  tourOrder,
} from '../src/timeline.js';
import {
  kitchenSink,
  makeDiff,
  makeLayout,
  type NodeSpec,
  POSITIONS,
  synthetic,
} from './fixtures.js';

vi.mock('@kgdiff/core', async (orig) => ({
  ...(await orig<object>()),
  formatHunk: (await import('./mock-core.js')).fakeFormatHunk,
}));

const RECT = { x: 0, y: 0, width: 10, height: 10 };
const th = (
  kind: HunkKind,
  phase: ReplayPhase,
  size: number,
  requires: readonly number[] = [],
): TimelineHunk => ({ kind, phase, size, bounds: RECT, requires });

/**
 * Reference implementation of §10: O(n²) greedy nearest neighbour among ready hunks of the
 * earliest phase that has any (the first pick is the largest), cycles broken by lowest order.
 */
function naiveTour(hunks: readonly TourHunk[]): number[] {
  const out: number[] = [];
  const placed = new Set<number>();
  let last: TourHunk | null = null;
  const rank = (h: TourHunk) => PHASE_ORDER.indexOf(h.phase);
  while (out.length < hunks.length) {
    let ready = hunks
      .map((h, i) => ({ h, i }))
      .filter(
        (x) =>
          !placed.has(x.i) &&
          x.h.requires.every((r) => r === x.i || r < 0 || r >= hunks.length || placed.has(r)),
      );
    if (ready.length === 0) {
      const rest = hunks.map((h, i) => ({ h, i })).filter((x) => !placed.has(x.i));
      rest.sort((a, b) => a.h.order - b.h.order);
      ready = rest.slice(0, 1);
    }
    const phase = Math.min(...ready.map((x) => rank(x.h)));
    const cands = ready.filter((x) => rank(x.h) === phase);
    let best = cands[0] as { h: TourHunk; i: number };
    for (const c of cands.slice(1)) {
      if (last === null) {
        if (c.h.size > best.h.size || (c.h.size === best.h.size && c.h.order < best.h.order))
          best = c;
      } else {
        const from: TourHunk = last;
        const dc = (c.h.x - from.x) ** 2 + (c.h.y - from.y) ** 2;
        const db = (best.h.x - from.x) ** 2 + (best.h.y - from.y) ** 2;
        if (dc < db || (dc === db && c.h.order < best.h.order)) best = c;
      }
    }
    placed.add(best.i);
    out.push(best.i);
    last = best.h;
  }
  return out;
}

/** Random DAG over `n` hunks: topological rank = `order`, requirements point to lower ranks. */
const dagArb = (maxLength: number) =>
  fc
    .array(
      fc.record({
        phase: fc.constantFrom<ReplayPhase>('remove', 'restructure', 'modify', 'add'),
        x: fc.oneof(
          fc.integer({ min: -50, max: 50 }),
          fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        ),
        y: fc.oneof(
          fc.integer({ min: -50, max: 50 }),
          fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        ),
        size: fc.integer({ min: 0, max: 5 }),
        picks: fc.array(fc.nat(), { maxLength: 3 }),
        key: fc.double({ min: 0, max: 1, noNaN: true }),
      }),
      { maxLength },
    )
    .map((raw) => {
      // Shuffle ranks against array positions so requirements are not just "lower index".
      const rankOf = raw
        .map((r, i) => ({ i, key: r.key }))
        .sort((a, b) => a.key - b.key || a.i - b.i)
        .reduce<number[]>((acc, x, rank) => {
          acc[x.i] = rank;
          return acc;
        }, []);
      const byRank = rankOf.map((_, i) => i).sort((a, b) => (rankOf[a] ?? 0) - (rankOf[b] ?? 0));
      return raw.map((r, i): TourHunk => {
        const rank = rankOf[i] ?? 0;
        const requires = rank === 0 ? [] : r.picks.map((p) => byRank[p % rank] as number);
        return { phase: r.phase, x: r.x, y: r.y, size: r.size, order: rank, requires };
      });
    });

describe('durations (docs/algorithms.md §10)', () => {
  it('uses pace · kindFactor · clamp(√size, 1, 2.2)', () => {
    expect(hunkDuration('add', 1, 1100)).toBeCloseTo(1100 * 0.85, 9);
    expect(hunkDuration('remove', 4, 1100)).toBeCloseTo(1100 * 0.85 * 2, 9);
    expect(hunkDuration('modify', 2, 1000)).toBeCloseTo(1000 * 0.8 * Math.SQRT2, 3);
    expect(hunkDuration('relations', 100, 1000)).toBeCloseTo(1000 * 0.95 * 2.2, 9);
    expect(hunkDuration('merge', 0, 1000)).toBeCloseTo(1300, 9);
    expect(hunkDuration('split', 3, 1000)).toBeCloseTo(1000 * 1.3 * Math.sqrt(3), 3);
  });

  it('uses pace · clamp(1.2 + log₂ n, 1.2, 4) for chapters', () => {
    expect(chapterDuration(1, 1000)).toBeCloseTo(1200, 9);
    expect(chapterDuration(4, 1000)).toBeCloseTo(3200, 9);
    expect(chapterDuration(1000, 1000)).toBeCloseTo(4000, 9);
  });
});

describe('buildTimeline', () => {
  it('plays hunks one at a time with 160 ms gaps', () => {
    const hunks = [th('remove', 'remove', 1), th('merge', 'restructure', 4), th('add', 'add', 2)];
    const tl = buildTimeline(hunks, 1100, 40);
    expect(tl.mode).toBe('hunks');
    expect(tl.windows.map((w) => w.hunk)).toEqual([0, 1, 2]);
    const [w0, w1, w2] = tl.windows as [
      (typeof tl.windows)[0],
      (typeof tl.windows)[0],
      (typeof tl.windows)[0],
    ];
    expect(w0.start).toBe(0);
    expect(w0.end).toBeCloseTo(935, 6);
    expect(w1.start).toBeCloseTo(w0.end + 160, 6);
    expect(w1.end - w1.start).toBeCloseTo(1100 * 1.3 * 2, 6);
    expect(w2.start).toBeCloseTo(w1.end + 160, 6);
    expect(tl.duration).toBe(w2.end);
    expect(tl.chapters.map((c) => [c.phase, c.hunks])).toEqual([
      ['remove', [0]],
      ['restructure', [1]],
      ['add', [2]],
    ]);
    expect(tl.windows.map((w) => w.chapter)).toEqual([0, 1, 2]);
  });

  it('switches to chapters above the threshold, staggering ≤ 35% of each chapter', () => {
    const hunks = [
      ...Array.from({ length: 6 }, () => th('remove', 'remove', 1)),
      ...Array.from({ length: 3 }, () => th('add', 'add', 1)),
    ];
    const tl = buildTimeline(hunks, 1000, 8);
    expect(tl.mode).toBe('chapters');
    expect(tl.chapters).toHaveLength(2);
    const [c0, c1] = tl.chapters as [(typeof tl.chapters)[0], (typeof tl.chapters)[0]];
    expect(c0.end - c0.start).toBeCloseTo(chapterDuration(6, 1000), 6);
    expect(c1.start).toBeCloseTo(c0.end + 160, 6);
    for (const c of tl.chapters) {
      const ws = tl.windows.filter((w) => c.hunks.includes(w.hunk));
      const stagger = Math.max(...ws.map((w) => w.start)) - c.start;
      expect(stagger).toBeLessThanOrEqual(0.35 * (c.end - c.start) + 1e-6);
      expect(stagger).toBeGreaterThan(0);
      for (const w of ws) {
        expect(w.start).toBeGreaterThanOrEqual(c.start);
        expect(w.end).toBeLessThanOrEqual(c.end + 1e-6);
      }
      // Hunks of a chapter overlap: they play together.
      expect(ws[1]?.start).toBeLessThan(ws[0]?.end ?? 0);
    }
    expect(tl.duration).toBe(c1.end);
  });

  it('keeps windows monotonic and well-formed', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom<HunkKind>(
              'add',
              'remove',
              'merge',
              'split',
              'modify',
              'relations',
            ),
            size: fc.integer({ min: 0, max: 50 }),
          }),
          { maxLength: 80 },
        ),
        fc.integer({ min: 0, max: 60 }),
        (items, threshold) => {
          const phaseOf: Record<HunkKind, ReplayPhase> = {
            remove: 'remove',
            merge: 'restructure',
            split: 'restructure',
            relations: 'restructure',
            modify: 'modify',
            add: 'add',
          };
          const sorted = [...items].sort(
            (a, b) => PHASE_ORDER.indexOf(phaseOf[a.kind]) - PHASE_ORDER.indexOf(phaseOf[b.kind]),
          );
          const tl = buildTimeline(
            sorted.map((x) => th(x.kind, phaseOf[x.kind], x.size)),
            1100,
            threshold,
          );
          expect(tl.windows).toHaveLength(sorted.length);
          for (let k = 0; k < tl.windows.length; k++) {
            const w = tl.windows[k] as (typeof tl.windows)[0];
            expect(w.hunk).toBe(k);
            expect(w.end).toBeGreaterThan(w.start);
            expect(w.end).toBeLessThanOrEqual(tl.duration + 1e-6);
            if (k > 0)
              expect(w.start).toBeGreaterThanOrEqual((tl.windows[k - 1] as typeof w).start);
          }
          for (let c = 1; c < tl.chapters.length; c++) {
            expect(tl.chapters[c]?.start).toBeGreaterThan(tl.chapters[c - 1]?.end ?? 0);
          }
        },
      ),
    );
  });
});

describe('tourOrder', () => {
  const hunk = (
    phase: ReplayPhase,
    x: number,
    y: number,
    order: number,
    size = 1,
    requires: readonly number[] = [],
  ): TourHunk => ({ phase, x, y, order, size, requires });

  it('starts at the largest hunk, then walks to nearest neighbours', () => {
    const hunks = [
      hunk('remove', 0, 0, 0, 1),
      hunk('remove', 100, 0, 1, 5),
      hunk('remove', 10, 0, 2, 1),
      hunk('remove', 90, 0, 3, 1),
    ];
    expect(tourOrder(hunks)).toEqual([1, 3, 2, 0]);
  });

  it('starts each later phase near the previous phase’s last anchor and keeps phase order', () => {
    const hunks = [
      hunk('add', 0, 0, 5),
      hunk('add', 1000, 0, 6),
      hunk('remove', 990, 0, 0, 3),
      hunk('modify', 500, 0, 3),
    ];
    expect(tourOrder(hunks)).toEqual([2, 3, 0, 1]);
  });

  it('breaks distance ties by default order', () => {
    const hunks = [hunk('modify', 0, 0, 0, 2), hunk('modify', 10, 0, 2), hunk('modify', -10, 0, 1)];
    expect(tourOrder(hunks)).toEqual([0, 2, 1]);
    const coincident = [hunk('add', 5, 5, 3), hunk('add', 5, 5, 1), hunk('add', 5, 5, 2)];
    expect(tourOrder(coincident)).toEqual([1, 2, 0]);
  });

  it('matches the naive O(n²) greedy tour exactly (property)', () => {
    const arb = fc.array(
      fc.record({
        phase: fc.constantFrom<ReplayPhase>('remove', 'restructure', 'modify', 'add'),
        x: fc.oneof(
          fc.integer({ min: -50, max: 50 }),
          fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        ),
        y: fc.oneof(
          fc.integer({ min: -50, max: 50 }),
          fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        ),
        size: fc.integer({ min: 0, max: 5 }),
      }),
      { maxLength: 120 },
    );
    fc.assert(
      fc.property(arb, (raw) => {
        const hunks = raw.map((h, order) => ({ ...h, order, requires: [] }));
        expect(tourOrder(hunks)).toEqual(naiveTour(hunks));
      }),
      { numRuns: 300 },
    );
  });

  it('copes with anchors a denormal apart (zero-size grid cells)', () => {
    const hunks = [
      hunk('add', 0, -5e-324, 0, 0),
      hunk('add', 0, 0, 1, 0),
      hunk('add', 3e-320, 0, 2, 0),
    ];
    expect(tourOrder(hunks)).toEqual(naiveTour(hunks));
  });

  it('places only ready hunks, phase as a preference (property, matches the naive tour)', () => {
    fc.assert(
      fc.property(dagArb(80), (hunks) => {
        const tour = tourOrder(hunks);
        expect(tour).toEqual(naiveTour(hunks));
        const pos = new Map(tour.map((h, k) => [h, k]));
        hunks.forEach((h, i) => {
          for (const r of h.requires) expect(pos.get(r) ?? -1).toBeLessThan(pos.get(i) ?? -1);
        });
      }),
      { numRuns: 300 },
    );
  });

  it('lets a hunk follow a later-phase hunk it requires', () => {
    const hunks = [
      hunk('remove', 0, 0, 1, 1, [1]), // removing requires an addition first
      hunk('add', 10, 0, 0),
      hunk('remove', 500, 0, 2),
    ];
    // Ready removes go first; the blocked remove follows the add it needs.
    expect(tourOrder(hunks)).toEqual([2, 1, 0]);
  });

  it('breaks requirement cycles deterministically', () => {
    const hunks = [hunk('modify', 0, 0, 1, 1, [1]), hunk('modify', 5, 0, 0, 1, [0])];
    expect(tourOrder(hunks)).toEqual([1, 0]);
  });

  it('is a permutation and stays fast on thousands of hunks', () => {
    const { diff, layout } = synthetic(20_000, 20_000, 3);
    const items: TourHunk[] = diff.hunks.map((h) => {
      const p = layout.positions.get(h.anchor) ?? { x: 0, y: 0 };
      return {
        phase: h.phase,
        size: h.nodes.length + h.edges.length,
        order: h.order,
        x: p.x,
        y: p.y,
        requires: [],
      };
    });
    const t0 = performance.now();
    const order = tourOrder(items);
    const ms = performance.now() - t0;
    expect(new Set(order).size).toBe(items.length);
    expect(items.length).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(500);
  });

  it('gives the scene the same timeline for the same input', () => {
    const diff = kitchenSink();
    const a = buildScene(diff, makeLayout(diff, POSITIONS));
    const b = buildScene(diff, makeLayout(diff, POSITIONS));
    expect(a.timeline).toEqual(b.timeline);
    expect(a.timeline.mode).toBe('hunks');
    const chapters = buildScene(diff, makeLayout(diff, POSITIONS), {
      replay: { chapterThreshold: 3, pace: 500 },
    });
    expect(chapters.timeline.mode).toBe('chapters');
    expect(chapters.timeline.chapters.map((c) => c.phase)).toEqual([
      'remove',
      'restructure',
      'modify',
      'add',
    ]);
    for (const c of chapters.timeline.chapters) {
      for (const h of c.hunks) {
        const bounds = chapters.hunks[h]?.bounds;
        if (bounds === undefined) continue;
        expect(c.bounds.x).toBeLessThanOrEqual(bounds.x);
        expect(c.bounds.x + c.bounds.width).toBeGreaterThanOrEqual(bounds.x + bounds.width);
      }
    }
  });
});

describe('replay respects hunk requirements (core `Hunk.requires`)', () => {
  const KIND: Record<ReplayPhase, HunkKind> = {
    remove: 'remove',
    restructure: 'relations',
    modify: 'modify',
    add: 'add',
  };
  const STATUS: Record<ReplayPhase, NodeSpec['status']> = {
    remove: 'removed',
    restructure: 'modified',
    modify: 'modified',
    add: 'added',
  };

  /** One node per hunk; requirements from a random DAG; positions random. */
  function sceneFrom(items: readonly TourHunk[], chapterThreshold: number) {
    const id = (i: number) => `h${i}`;
    const nodes: NodeSpec[] = items.map((h, i) => ({
      id: id(i),
      status: STATUS[h.phase],
      hunk: `${KIND[h.phase]}:${id(i)}`,
      ...(STATUS[h.phase] === 'modified'
        ? {
            labelBefore: 'x',
            facets: [{ kind: 'rename', from: 'x', to: id(i) }] as NodeSpec['facets'],
          }
        : {}),
    }));
    const diff = makeDiff({
      nodes,
      edges: [],
      hunks: items.map((h, i) => ({
        kind: KIND[h.phase],
        phase: h.phase,
        anchor: id(i),
        nodes: [id(i)],
        requires: h.requires.map((r) => `${KIND[(items[r] as TourHunk).phase]}:${id(r)}`),
      })),
    });
    const order = new Map(diff.hunks.map((h) => [h.id, h]));
    const positions = Object.fromEntries(
      items.map((h, i) => [id(i), [h.x, h.y] as [number, number]]),
    );
    const scene = buildScene(diff, makeLayout(diff, positions), { replay: { chapterThreshold } });
    return { scene, requires: (hunkId: string) => order.get(hunkId)?.requires ?? [] };
  }

  it.each([
    ['hunks', 1000],
    ['chapters', 0],
  ] as const)('%s mode: every hunk plays after its requirements (property)', (mode, threshold) => {
    fc.assert(
      fc.property(dagArb(40), (items) => {
        const { scene, requires } = sceneFrom(items, threshold);
        const tl = scene.timeline;
        if (items.length > 0) expect(tl.mode).toBe(mode);
        const win = new Map(tl.windows.map((w) => [w.hunk, w]));
        // Scene order is play order: windows are listed in hunk-index order.
        expect(tl.windows.map((w) => w.hunk)).toEqual(scene.hunks.map((h) => h.index));
        for (const h of scene.hunks) {
          const w = win.get(h.index);
          if (w === undefined) throw new Error('missing window');
          for (const rid of requires(h.id)) {
            const r = scene.hunkIndex.get(rid) as number;
            const rw = win.get(r);
            if (rw === undefined) throw new Error('missing requirement window');
            expect(r).toBeLessThan(h.index);
            if (mode === 'hunks') expect(w.start).toBeGreaterThanOrEqual(rw.end);
            else {
              expect(w.chapter).toBeGreaterThanOrEqual(rw.chapter);
              if (w.chapter === rw.chapter) expect(w.start).toBeGreaterThan(rw.start);
            }
          }
        }
        // Chapters stay contiguous and in time order.
        for (let c = 1; c < tl.chapters.length; c++) {
          expect(tl.chapters[c]?.start).toBeGreaterThan(tl.chapters[c - 1]?.end ?? 0);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('moves a hunk into the later chapter of a hunk it requires', () => {
    // A removal that requires an addition plays in the add chapter, after it.
    const items: TourHunk[] = [
      { phase: 'add', x: 0, y: 0, order: 0, size: 1, requires: [] },
      { phase: 'remove', x: 10, y: 0, order: 1, size: 1, requires: [0] },
      { phase: 'remove', x: 20, y: 0, order: 2, size: 1, requires: [] },
    ];
    const { scene } = sceneFrom(items, 0);
    const tl = scene.timeline;
    expect(tl.chapters.map((c) => c.phase)).toEqual(['remove', 'add']);
    expect(scene.hunks.map((h) => h.id)).toEqual(['remove:h2', 'add:h0', 'remove:h1']);
    expect(tl.windows.map((w) => w.chapter)).toEqual([0, 1, 1]);
  });
});
