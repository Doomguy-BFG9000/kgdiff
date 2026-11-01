/**
 * Before / after pairs from scripts/gen-synthetic.ts, the generator behind the CLI's large
 * benchmarks. Generated into a temporary directory that is removed again.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GraphInput } from '@kgdiff/core';

const script = fileURLToPath(new URL('../../../../scripts/gen-synthetic.ts', import.meta.url));

export function syntheticPair(
  nodes: number,
  seed: number,
): { before: GraphInput; after: GraphInput } {
  const dir = mkdtempSync(join(tmpdir(), 'kgdiff-synth-'));
  try {
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx/esm',
        script,
        '--nodes',
        String(nodes),
        '--seed',
        String(seed),
        '--out',
        dir,
      ],
      { stdio: 'ignore' },
    );
    const read = (name: string): GraphInput =>
      JSON.parse(readFileSync(join(dir, name), 'utf8')) as GraphInput;
    return { before: read('before.json'), after: read('after.json') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
