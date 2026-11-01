/**
 * Timing guards for per-frame hot paths (generous bounds: they catch accidental O(n²) and
 * allocation storms, not micro-regressions). Real draw times are measured in the dev harness.
 */
import { describe, expect, it } from 'vitest';
import { createSynthetic } from '../dev/synthetic.js';
import { darkTheme } from '../dev/theme.js';
import { FrameCache, Interner } from '../src/frame-cache.js';
import { pickAt } from '../src/pick.js';
import { Fonts, TextMeasurer } from '../src/text.js';
import { RecordingContext } from './helpers/recording-ctx.js';

const big = createSynthetic(darkTheme, 10_000);

function median(run: () => void, times = 7): number {
  const ms: number[] = [];
  for (let i = 0; i < times; i++) {
    const t0 = performance.now();
    run();
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  return ms[Math.floor(times / 2)] ?? 0;
}

describe('hot paths at 10k nodes / 12.7k edges', () => {
  it('rebuilds the style buckets (every setFrame) in a few milliseconds', () => {
    const cache = new FrameCache();
    const interner = new Interner();
    let v = 0;
    const ms = median(() => cache.sync(big.frame, ++v, interner));
    expect(cache.edgeBuckets.length).toBeLessThan(40);
    expect(ms).toBeLessThan(15);
  });

  it('picks (grid + edge scan) well under a millisecond on average', () => {
    const cache = new FrameCache();
    cache.sync(big.frame, 1, new Interner());
    const fonts = new Fonts(darkTheme);
    const measurer = new TextMeasurer(new RecordingContext());
    cache.nodeGrid();
    const t0 = performance.now();
    let hits = 0;
    for (let i = 0; i < 500; i++) {
      const p = pickAt(
        big.frame,
        cache,
        { k: 1, ox: 400, oy: 300, dpr: 1 },
        (i * 37) % 800,
        (i * 53) % 600,
        fonts,
        measurer,
      );
      if (p) hits++;
    }
    const perPick = (performance.now() - t0) / 500;
    expect(hits).toBeGreaterThan(0);
    expect(perPick).toBeLessThan(1);
  });
});
