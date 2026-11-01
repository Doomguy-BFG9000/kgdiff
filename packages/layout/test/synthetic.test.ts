/**
 * The CLI's large benchmark: a generated 10k-node pair (scripts/gen-synthetic.ts) whose class
 * hubs used to pull every node into the `changes` scope.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diff, type GraphInput } from '@kgdiff/core';
import { afterAll, describe, expect, it } from 'vitest';
import { layoutDiff, layoutToJSON } from '../src/index.js';
import { quality } from './support/metrics.js';

const script = fileURLToPath(new URL('../../../scripts/gen-synthetic.ts', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'kgdiff-synth-'));
execFileSync(
  process.execPath,
  ['--import', 'tsx/esm', script, '--nodes', '10000', '--seed', '7', '--out', dir],
  { stdio: 'ignore' },
);
const read = (name: string): GraphInput =>
  JSON.parse(readFileSync(join(dir, name), 'utf8')) as GraphInput;

describe('synth-10k (scope changes, hub-aware context)', () => {
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const result = diff(read('before.json'), read('after.json'));

  it('lays out the changes and their context, not the whole graph, deterministically', () => {
    const t0 = performance.now();
    const layout = layoutDiff(result);
    const ms = performance.now() - t0;
    console.info(
      `synth-10k: ${result.nodes.length} union nodes → ${layout.positions.size} in scope, ` +
        `${layout.stats.iterations} ticks, ${ms.toFixed(0)} ms`,
    );
    expect(layout.scope).toBe('changes');
    expect(layout.positions.size).toBeGreaterThan(3000);
    expect(layout.positions.size).toBeLessThan(0.6 * result.nodes.length);
    for (const node of result.nodes) {
      if (node.status !== 'unchanged') expect(layout.positions.has(node.id)).toBe(true);
    }
    expect(ms).toBeLessThan(8000);
    const again = layoutDiff(result);
    expect(JSON.stringify(layoutToJSON(again))).toBe(JSON.stringify(layoutToJSON(layout)));
    expect(quality(result, layout).labelOverlapRatio).toBeLessThan(0.001);
  }, 60_000);
});
