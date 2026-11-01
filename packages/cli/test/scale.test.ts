import { diff } from '@kgdiff/core';
import { describe, expect, it } from 'vitest';
import { createPainter } from '../src/style.js';
import { renderNameStatus, renderSummary, type TextContext } from '../src/summary.js';

/**
 * More hunks than fit in a call's arguments (roughly 10^5 on V8's default stack): the aligned
 * `--name-status` width and the `--limit 0` summary used to spread every row into one call and
 * throw `RangeError`. These assert results, not speed.
 */
const HUNKS = 150_000;
const TIMEOUT = 120_000;

describe('more hunks than a call’s argument limit', () => {
  const result = diff(
    { nodes: [], edges: [] },
    { nodes: Array.from({ length: HUNKS }, (_, i) => ({ id: `n${i}` })), edges: [] },
  );
  const ctx: TextContext = { paint: createPainter(0), locale: 'en', width: 100, limit: 0 };

  it(
    'aligns --name-status for 150k hunks',
    () => {
      const lines = renderNameStatus(result, ctx, true).trimEnd().split('\n');
      expect(lines).toHaveLength(HUNKS);
      expect(lines.every((line) => line.startsWith('A  n'))).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'lists all 150k hunks in the summary with --limit 0',
    () => {
      const out = renderSummary(result, 'wide', ctx);
      expect(out).toContain('n149999');
      expect(out).not.toContain('more');
    },
    TIMEOUT,
  );
});
