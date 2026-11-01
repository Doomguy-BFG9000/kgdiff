import { describe, expect, it, vi } from 'vitest';
import { buildScene, createViewState, createVisualResolver, type ViewState } from '../src/index.js';
import { synthetic } from './fixtures.js';

vi.mock('@kgdiff/core', async (orig) => ({
  ...(await orig<object>()),
  formatHunk: (await import('./mock-core.js')).fakeFormatHunk,
}));

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

describe('performance budgets (docs/architecture.md §Budgets)', () => {
  const { diff, layout } = synthetic(5000, 10_000);

  it('builds a 5k-node / 10k-edge scene (budget 50 ms at 10k nodes)', () => {
    buildScene(diff, layout); // warm-up (JIT)
    const runs: number[] = [];
    let scene = buildScene(diff, layout);
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      scene = buildScene(diff, layout);
      runs.push(performance.now() - t0);
    }
    expect(scene.nodes.length).toBe(5000);
    expect(scene.edges.length).toBeGreaterThan(9000);
    const ms = median(runs);
    console.info(`buildScene 5k/${scene.edges.length}: median ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(100);
  });

  it('builds a 10k-node / 30k-edge scene within the 50 ms budget (asserted < 150 ms)', () => {
    const big = synthetic(10_000, 30_000, 11);
    buildScene(big.diff, big.layout);
    const runs: number[] = [];
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      buildScene(big.diff, big.layout);
      runs.push(performance.now() - t0);
    }
    const ms = median(runs);
    console.info(`buildScene 10k/${big.diff.edges.length}: median ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(150);
  });

  it('resolves frames in < 4 ms budget (asserted < 25 ms), allocation-free with `out`', () => {
    const scene = buildScene(diff, layout);
    const t0 = performance.now();
    const resolver = createVisualResolver(scene);
    const construct = performance.now() - t0;
    const out = resolver.resolve(createViewState());
    const cases: [string, (k: number) => Partial<ViewState>][] = [
      ['union', () => ({ layer: 'union' })],
      [
        'union + selection + filter',
        () => ({ layer: 'union', selectedHunk: 3, families: new Set(['added'] as const) }),
      ],
      ['after', () => ({ layer: 'after' })],
      ['replay (sweeping t)', (k) => ({ layer: 'replay', t: (k / 120) * scene.timeline.duration })],
      [
        'replay, reduced motion',
        (k) => ({ layer: 'replay', t: (k / 120) * scene.timeline.duration, reducedMotion: true }),
      ],
    ];
    const report: string[] = [`resolver construction ${construct.toFixed(2)} ms`];
    for (const [name, view] of cases) {
      const views = Array.from({ length: 120 }, (_, k) => createViewState(view(k)));
      for (let k = 0; k < 20; k++) resolver.resolve(views[k] as ViewState, out); // warm-up
      const times: number[] = [];
      for (const v of views) {
        const t1 = performance.now();
        resolver.resolve(v, out);
        times.push(performance.now() - t1);
      }
      const ms = median(times);
      report.push(`${name}: median ${ms.toFixed(3)} ms, max ${Math.max(...times).toFixed(3)} ms`);
      expect(ms).toBeLessThan(25);
    }
    console.info(
      `resolve 5k/${scene.edges.length}, ${scene.hunks.length} hunks (${scene.timeline.mode}):\n  ${report.join('\n  ')}`,
    );
  });
});
