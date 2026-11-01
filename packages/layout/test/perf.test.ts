/**
 * Performance guard. Budget (docs/architecture.md): layoutDiff, 2k nodes < 800 ms on an M-class
 * laptop; CLI targets: 5k nodes < 3 s, 10k nodes < 2 s. CI machines vary, so the assertions are
 * generous; the actual times are logged.
 */
import { describe, expect, it } from 'vitest';
import { layoutDiff, layoutToJSON } from '../src/index.js';
import { makeDiff } from './support/diff-builder.js';
import { scaleFree, tree } from './support/fixtures.js';
import { quality } from './support/metrics.js';

function timed(name: string, run: () => ReturnType<typeof layoutDiff>, warmUp = true) {
  const first = warmUp ? run() : undefined; // JIT warm-up
  const t0 = performance.now();
  const layout = run();
  const ms = performance.now() - t0;
  console.info(
    `${name}: ${layout.positions.size} nodes in ${ms.toFixed(0)} ms (${layout.stats.iterations} ticks)`,
  );
  return { layout, ms, first };
}

describe('performance', () => {
  it('lays out a 2k-node hierarchy well within budget', () => {
    const diff = makeDiff(tree(2000));
    const { layout, ms } = timed('tree 2k', () => layoutDiff(diff));
    expect(ms).toBeLessThan(4000);
    expect(quality(diff, layout).overlappingPairs).toBe(0);
  });

  it('lays out a 2k-node scale-free graph within budget', () => {
    const diff = makeDiff(scaleFree(2000, 1.3));
    const { layout, ms } = timed('scale-free 2k', () => layoutDiff(diff));
    expect(ms).toBeLessThan(4000);
    expect(quality(diff, layout).labelOverlapRatio).toBeLessThan(0.001);
  });

  it('lays out a 5k-node graph (scope all) within the CLI budget, deterministically', () => {
    const diff = makeDiff(scaleFree(5000, 1.3));
    const { layout, ms, first } = timed('scale-free 5k', () => layoutDiff(diff, { scope: 'all' }));
    expect(ms).toBeLessThan(9000);
    expect(layout.stats.iterations).toBe(48);
    expect(JSON.stringify(layoutToJSON(layout))).toBe(JSON.stringify(layoutToJSON(first!)));
    expect(quality(diff, layout).labelOverlapRatio).toBeLessThan(0.001);
  });

  it('lays out a dense 10k-node graph (scope all) within the CLI budget', () => {
    const diff = makeDiff(scaleFree(10_000, 2));
    const { layout, ms } = timed('scale-free 10k', () => layoutDiff(diff, { scope: 'all' }), false);
    expect(ms).toBeLessThan(8000);
    expect(layout.stats.iterations).toBe(30);
    expect(quality(diff, layout).labelOverlapRatio).toBeLessThan(0.001);
  });
});
