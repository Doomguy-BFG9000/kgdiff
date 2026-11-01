/**
 * The engine at the sizes of the budgets in docs/architecture.md: results stay correct on big
 * inputs. The timings are in performance.bench.ts (`pnpm bench`); the timeout here only guards
 * against hangs.
 */
import { applyDelta, diff, hashGraph, matchNodes, normalize } from '@kgdiff/core';
import { describe, expect, it } from 'vitest';
import { editGraph, extractionPair, syntheticGraph } from './support/synthetic.js';

describe('large inputs', { timeout: 60_000 }, () => {
  it('diffs 10k nodes / 30k edges with exact ids into a delta that applies', () => {
    const before = syntheticGraph(10_000, 30_000);
    const result = diff(before, editGraph(before));
    expect(result.stats.nodes.added).toBeGreaterThan(0);
    expect(hashGraph(applyDelta(result.before, result.delta))).toBe(hashGraph(result.after));
  });

  it.each([2000, 5000])('matches %i unmatched nodes per side by similarity', (n) => {
    const [before, after] = extractionPair(n).map((g) => normalize(g));
    const result = matchNodes(before!, after!, { strategy: 'similarity' });
    expect(result.matches.length).toBeGreaterThan(n * 0.95);
  });

  it('round-trips 20k parallel copies of one triple', () => {
    const p = 20_000;
    const nodes = [{ id: 'a' }, { id: 'b' }];
    const edges = (offset: number) =>
      Array.from({ length: p }, (_, i) => ({
        source: 'a',
        target: 'b',
        predicate: 'p',
        attrs: { i: i + offset },
      }));
    const before = normalize({ nodes, edges: edges(0) });
    const after = normalize({ nodes, edges: edges(p) });
    expect(hashGraph(applyDelta(before, diff(before, after).delta))).toBe(hashGraph(after));
  });
});
