import {
  applyDelta,
  type DeltaOp,
  type DiffOptions,
  type DiffResult,
  diff,
  diffFromJSON,
  diffToJSON,
  type GraphInput,
  hashGraph,
  invertDelta,
  type KGraph,
  normalize,
  textSimilarity,
} from '@kgdiff/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { graphArb, shuffleGraph, versionPairArb } from './support/arbitraries.js';

/** Override with KGDIFF_PROPERTY_RUNS for a deeper soak run. */
const RUNS = Number(process.env.KGDIFF_PROPERTY_RUNS ?? 300);

const VARIANTS: readonly [string, DiffOptions][] = [
  ['default options', {}],
  ['similarity matching', { match: { strategy: 'similarity' } }],
  ['id edge identity', { edgeIdentity: 'id' }],
  [
    'id matching without restructuring',
    { match: { strategy: 'id' }, detectMerges: false, detectSplits: false },
  ],
];

/** Every changed element is owned by exactly one hunk, and every op by exactly one hunk. */
function expectHunkPartition(d: DiffResult): void {
  const nodeOwner = new Map<string, string>();
  const edgeOwner = new Map<string, string>();
  const opOwner = new Map<number, string>();
  for (const h of d.hunks) {
    expect(h.nodes.length + h.edges.length).toBeGreaterThan(0);
    for (const id of h.nodes) {
      expect(nodeOwner.has(id)).toBe(false);
      nodeOwner.set(id, h.id);
    }
    for (const id of h.edges) {
      expect(edgeOwner.has(id)).toBe(false);
      edgeOwner.set(id, h.id);
    }
    for (const i of h.ops) {
      expect(opOwner.has(i)).toBe(false);
      opOwner.set(i, h.id);
    }
    expect([...h.ops]).toEqual([...h.ops].sort((a, b) => a - b));
    for (const id of h.context) {
      expect(h.nodes).not.toContain(id);
      expect(d.index.node(id)).toBeDefined();
    }
    if (h.kind !== 'relations') expect(h.nodes[0]).toBe(h.anchor);
  }
  for (const n of d.nodes) {
    expect(n.hunk).toBe(n.status === 'unchanged' ? undefined : nodeOwner.get(n.id));
    if (n.status !== 'unchanged') expect(n.hunk).toBeDefined();
  }
  for (const e of d.edges) {
    expect(e.hunk).toBe(e.status === 'unchanged' ? undefined : edgeOwner.get(e.id));
    if (e.status !== 'unchanged') expect(e.hunk).toBeDefined();
  }
  expect(nodeOwner.size).toBe(d.nodes.filter((n) => n.status !== 'unchanged').length);
  expect(edgeOwner.size).toBe(d.edges.filter((e) => e.status !== 'unchanged').length);
  d.delta.ops.forEach((op, i) => {
    if (opOwner.has(i)) return;
    // Only the id changes of `similarity` matches, which are not changes, live outside hunks.
    expect(op.op).toBe('node.rekey');
    expect(d.options.match.strategy).toBe('similarity');
  });
  expect(d.hunks.map((h) => h.order)).toEqual(d.hunks.map((_, i) => i));
}

/**
 * Applies the ops that belong to no hunk, then every hunk's ops in `order`, each step strict
 * against the graph reached so far; checks that `requires` is respected on the way.
 */
function applyHunkByHunk(d: DiffResult): KGraph {
  let graph = d.before;
  const step = (indices: readonly number[]): void => {
    if (indices.length === 0) return;
    const ops = indices.map((i) => d.delta.ops[i] as DeltaOp);
    graph = applyDelta(graph, {
      ...d.delta,
      base: { ...d.delta.base, hash: hashGraph(graph) },
      ops,
    });
  };
  const owned = new Set(d.hunks.flatMap((h) => h.ops));
  step(d.delta.ops.map((_, i) => i).filter((i) => !owned.has(i)));
  const applied = new Set<string>();
  for (const h of d.hunks) {
    for (const r of h.requires) expect(applied.has(r), `${h.id} requires ${r}`).toBe(true);
    step(h.ops);
    applied.add(h.id);
  }
  return graph;
}

describe.each(VARIANTS)('diff invariants (%s)', (_name, options) => {
  it('applies hunk by hunk, in order, strictly, to the after graph', () => {
    fc.assert(
      fc.property(versionPairArb(), ([a, b]) => {
        const d = diff(a, b, options);
        expect(hashGraph(applyHunkByHunk(d))).toBe(hashGraph(d.after));
      }),
      { numRuns: RUNS },
    );
  });

  it('applying the delta to the before graph yields the after graph', () => {
    fc.assert(
      fc.property(versionPairArb(), ([a, b]) => {
        const d = diff(a, b, options);
        expect(hashGraph(applyDelta(d.before, d.delta))).toBe(hashGraph(d.after));
      }),
      { numRuns: RUNS },
    );
  });

  it('applying the inverted delta to the after graph yields the before graph', () => {
    fc.assert(
      fc.property(versionPairArb(), ([a, b]) => {
        const d = diff(a, b, options);
        expect(hashGraph(applyDelta(d.after, invertDelta(d.delta)))).toBe(hashGraph(d.before));
      }),
      { numRuns: RUNS },
    );
  });

  it('partitions the changed elements and the delta ops into hunks', () => {
    fc.assert(
      fc.property(versionPairArb(), ([a, b]) => expectHunkPartition(diff(a, b, options))),
      { numRuns: RUNS },
    );
  });

  it('reports nothing for identical inputs', () => {
    fc.assert(
      fc.property(graphArb(), (g) => {
        const d = diff(g, g, options);
        expect(d.delta.ops).toEqual([]);
        expect(d.hunks).toEqual([]);
        expect(d.stats.identical).toBe(true);
        expect(d.nodes.every((n) => n.status === 'unchanged')).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('is deterministic under shuffled node and edge order', () => {
    fc.assert(
      fc.property(versionPairArb(), fc.integer({ min: 1, max: 1e6 }), ([a, b], seed) => {
        const reference = JSON.stringify(diffToJSON(diff(a, b, options)));
        const shuffled = diff(shuffleGraph(a, seed), shuffleGraph(b, seed + 1), options);
        expect(JSON.stringify(diffToJSON(shuffled))).toBe(reference);
      }),
      { numRuns: RUNS },
    );
  });

  it('round-trips through diffToJSON / diffFromJSON', () => {
    fc.assert(
      fc.property(versionPairArb(), ([a, b]) => {
        const d = diff(a, b, options);
        const json = diffToJSON(d);
        const back = diffFromJSON(JSON.parse(JSON.stringify(json)));
        expect(JSON.stringify(diffToJSON(back))).toBe(JSON.stringify(json));
        expect(hashGraph(back.before)).toBe(hashGraph(d.before));
        expect(hashGraph(back.after)).toBe(hashGraph(d.after));
        for (const n of d.nodes) expect(back.index.node(n.id)).toEqual(n);
        for (const e of d.edges) expect(back.index.edge(e.id)).toEqual(e);
      }),
      { numRuns: RUNS / 2 },
    );
  });
});

describe('graph invariants', () => {
  it('hashGraph ignores node and edge order', () => {
    fc.assert(
      fc.property(graphArb(), fc.integer({ min: 1, max: 1e6 }), (g, seed) => {
        expect(hashGraph(normalize(shuffleGraph(g, seed)))).toBe(hashGraph(normalize(g)));
      }),
      { numRuns: RUNS },
    );
  });

  it('a delta and its inverse cancel out', () => {
    fc.assert(
      fc.property(versionPairArb(), ([a, b]) => {
        const d = diff(a, b);
        const there = applyDelta(d.before, d.delta);
        const back = applyDelta(there, invertDelta(d.delta));
        expect(hashGraph(back)).toBe(hashGraph(d.before));
        expect(invertDelta(invertDelta(d.delta))).toEqual(d.delta);
      }),
      { numRuns: RUNS },
    );
  });

  it('the diff of B and A mirrors the diff of A and B in size (without directional replacement links)', () => {
    const unlinked = (g: GraphInput): GraphInput => ({
      ...g,
      nodes: g.nodes.map(({ replaces: _r, replacedBy: _b, ...node }) => node),
    });
    fc.assert(
      fc.property(
        versionPairArb().map(([x, y]) => [unlinked(x), unlinked(y)] as const),
        ([a, b]) => {
          const options: DiffOptions = {
            match: { strategy: 'id' },
            detectMerges: false,
            detectSplits: false,
          };
          const forward = diff(a, b, options);
          const backward = diff(b, a, options);
          expect(backward.stats.nodes.added).toBe(forward.stats.nodes.removed);
          expect(backward.stats.nodes.removed).toBe(forward.stats.nodes.added);
          expect(backward.stats.nodes.modified).toBe(forward.stats.nodes.modified);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe('textSimilarity properties', () => {
  const text = fc.oneof(
    fc.string({ maxLength: 12 }),
    fc.string({ unit: 'grapheme', maxLength: 8 }),
    fc.constantFrom('Marie Curie', 'Univ. of Paris', '法定代表人', '法人代表', 'GO:0008150'),
  );

  it('is symmetric, bounded and reflexive', () => {
    fc.assert(
      fc.property(text, text, (a, b) => {
        const s = textSimilarity(a, b);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
        expect(textSimilarity(b, a)).toBe(s);
        expect(textSimilarity(a, a)).toBe(1);
      }),
      { numRuns: 1000 },
    );
  });
});
