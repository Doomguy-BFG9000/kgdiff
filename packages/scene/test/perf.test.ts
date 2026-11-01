/**
 * Scenes at the sizes of the performance budgets (docs/architecture.md §Budgets). Their timings
 * are in perf.bench.ts (`pnpm bench`).
 */
import { describe, expect, it, vi } from 'vitest';
import { buildScene, createViewState, createVisualResolver, type ViewState } from '../src/index.js';
import { synthetic } from './fixtures.js';

vi.mock('@kgdiff/core', async (orig) => ({
  ...(await orig<object>()),
  formatHunk: (await import('./mock-core.js')).fakeFormatHunk,
}));

describe('budget-sized scenes', () => {
  const { diff, layout } = synthetic(5000, 10_000);

  it('builds a 5k-node / 10k-edge scene', () => {
    const scene = buildScene(diff, layout);
    expect(scene.nodes.length).toBe(5000);
    expect(scene.edges.length).toBeGreaterThan(9000);
  });

  it('resolves every layer into the frame it is given', () => {
    const scene = buildScene(diff, layout);
    const resolver = createVisualResolver(scene);
    const out = resolver.resolve(createViewState());
    const views: Partial<ViewState>[] = [
      { layer: 'union' },
      { layer: 'union', selectedHunk: 3, families: new Set(['added'] as const) },
      { layer: 'after' },
      { layer: 'replay', t: scene.timeline.duration / 2 },
      { layer: 'replay', t: scene.timeline.duration / 2, reducedMotion: true },
    ];
    for (const view of views) {
      expect(resolver.resolve(createViewState(view), out)).toBe(out);
      expect(out.nodes).toHaveLength(scene.nodes.length);
      expect(out.edges).toHaveLength(scene.edges.length);
    }
  });
});
