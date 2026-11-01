/**
 * Timing tests for the budgets in docs/architecture.md. Assertions are 10× the budget so CI
 * noise never fails them; the measured times are printed for the record.
 */
import { applyDelta, diff, diffToJSON, hashGraph, matchNodes, normalize } from '@kgdiff/core';
import { describe, expect, it } from 'vitest';
import { editGraph, extractionPair, syntheticGraph } from './support/synthetic.js';

/** Best of `runs` timings (ms) after one warm-up run. */
function time<T>(run: () => T, runs = 3): { ms: number; result: T } {
  let result = run();
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    result = run();
    best = Math.min(best, performance.now() - start);
  }
  return { ms: Math.round(best * 10) / 10, result };
}

describe('performance', () => {
  it('diffs 10k nodes / 30k edges with exact ids (budget 150 ms)', () => {
    const before = syntheticGraph(10_000, 30_000);
    const after = editGraph(before);
    const full = time(() => diff(before, after));
    const a = normalize(before);
    const b = normalize(after);
    const prepared = time(() => diff(a, b));
    const json = time(() => JSON.stringify(diffToJSON(full.result)));
    console.info(
      `[perf] diff 10k/30k: ${full.ms} ms from inputs, ${prepared.ms} ms from normalized graphs; ` +
        `diffToJSON ${json.ms} ms; ${full.result.hunks.length} hunks, ${full.result.delta.ops.length} ops`,
    );
    expect(full.result.stats.nodes.added).toBeGreaterThan(0);
    expect(full.ms).toBeLessThan(1500);
    expect(hashGraph(applyDelta(full.result.before, full.result.delta))).toBe(
      hashGraph(full.result.after),
    );
  });

  it.each([2000, 5000])(
    'matches %i unmatched nodes per side by similarity (budget 1.5 s at 5k)',
    (n) => {
      const [before, after] = extractionPair(n).map((g) => normalize(g));
      const { ms, result } = time(() => matchNodes(before!, after!, { strategy: 'similarity' }), 2);
      const full = time(() => diff(before!, after!, { match: { strategy: 'similarity' } }), 1);
      console.info(
        `[perf] similarity ${n}×${n}: matchNodes ${ms} ms, diff ${full.ms} ms; ` +
          `${result.matches.length} matches, ${result.suggestions.length} suggestions`,
      );
      expect(result.matches.length).toBeGreaterThan(n * 0.95);
      expect(ms).toBeLessThan(15_000);
    },
  );

  it('stays fast around a hub: 5k leaves removed from / added to a 10k-child hub (merge and split detection on)', () => {
    const n = 10_000;
    const nodes = [
      { id: 'root', label: 'Root' },
      ...Array.from({ length: n }, (_, i) => ({ id: `c${i}`, label: `Child term number ${i}` })),
    ];
    const edges = Array.from({ length: n }, (_, i) => ({
      source: `c${i}`,
      target: 'root',
      predicate: 'is_a',
    }));
    const full = normalize({ nodes, edges });
    const half = normalize({
      nodes: nodes.filter((_, i) => i % 2 === 0),
      edges: edges.filter((_, i) => i % 2 === 1),
    });
    const grown = normalize({
      nodes: [
        ...nodes,
        ...Array.from({ length: n / 2 }, (_, i) => ({ id: `n${i}`, label: `New term ${i}` })),
      ],
      edges: [
        ...edges,
        ...Array.from({ length: n / 2 }, (_, i) => ({
          source: `n${i}`,
          target: 'root',
          predicate: 'is_a',
        })),
      ],
    });
    const removal = time(() => diff(full, half), 2);
    const addition = time(() => diff(full, grown), 2);
    console.info(`[perf] hub: remove 5k leaves ${removal.ms} ms, add 5k leaves ${addition.ms} ms`);
    expect(removal.ms).toBeLessThan(1500);
    expect(addition.ms).toBeLessThan(1500);
  });

  it('handles 20k parallel copies of one triple linearly', () => {
    const p = 20_000;
    const nodes = [{ id: 'a' }, { id: 'b' }];
    const before = normalize({
      nodes,
      edges: Array.from({ length: p }, (_, i) => ({
        source: 'a',
        target: 'b',
        predicate: 'p',
        attrs: { i },
      })),
    });
    const after = normalize({
      nodes,
      edges: Array.from({ length: p }, (_, i) => ({
        source: 'a',
        target: 'b',
        predicate: 'p',
        attrs: { i: i + p },
      })),
    });
    const d = time(() => diff(before, after), 1);
    const applied = time(() => applyDelta(before, d.result.delta), 1);
    console.info(`[perf] 20k parallel edges: diff ${d.ms} ms, apply ${applied.ms} ms`);
    expect(hashGraph(applied.result)).toBe(hashGraph(after));
    expect(d.ms + applied.ms).toBeLessThan(3000);
  });
});
