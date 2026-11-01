/**
 * Per-frame hot paths at 10k nodes / 12.7k edges. Their timings (generous bounds that catch
 * accidental O(n²) and allocation storms) are in perf.bench.ts (`pnpm bench`); real draw times
 * are measured in the dev harness.
 */
import { describe, expect, it } from 'vitest';
import { createSynthetic } from '../dev/synthetic.js';
import { darkTheme } from '../dev/theme.js';
import { FrameCache, Interner } from '../src/frame-cache.js';
import { pickAt } from '../src/pick.js';
import { Fonts, TextMeasurer } from '../src/text.js';
import { RecordingContext } from './helpers/recording-ctx.js';

const big = createSynthetic(darkTheme, 10_000);

describe('hot paths at 10k nodes / 12.7k edges', () => {
  it('groups the edges into a few dozen style buckets', () => {
    const cache = new FrameCache();
    cache.sync(big.frame, 1, new Interner());
    expect(cache.edgeBuckets.length).toBeLessThan(40);
  });

  it('picks elements through the node grid and the edge scan', () => {
    const cache = new FrameCache();
    cache.sync(big.frame, 1, new Interner());
    const fonts = new Fonts(darkTheme);
    const measurer = new TextMeasurer(new RecordingContext());
    cache.nodeGrid();
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
    expect(hits).toBeGreaterThan(0);
  });
});
