/**
 * Smoke tests of the real entry point (`src/bin.ts` through tsx): process exit codes, stdio,
 * stdin piping and error output without stack traces.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dataset } from './helpers.js';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const TSX = createRequire(import.meta.url).resolve('tsx/cli');

function kgdiff(args: string[], input?: string) {
  const result = spawnSync(process.execPath, [TSX, 'src/bin.ts', ...args], {
    cwd: PACKAGE,
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: undefined,
      DEBUG: undefined,
      LANG: 'en_US.UTF-8',
    },
    timeout: 60_000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('bin', () => {
  it('prints the version', () => {
    const r = kgdiff(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^kgdiff \d+\.\d+\.\d+\n$/);
  });

  it('exits 1 with --exit-code when graphs differ, 0 when they do not', () => {
    const d = dataset('schema-vocab');
    expect(kgdiff([d.before, d.after, '--exit-code', '-q']).code).toBe(1);
    expect(kgdiff([d.before, d.before, '--exit-code', '-q']).code).toBe(0);
  });

  it('exits 2 with a friendly message and no stack trace', () => {
    const r = kgdiff(['does-not-exist.ttl', 'nope.ttl']);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(
      /^error: Cannot read <before> "does-not-exist\.ttl": no such file or directory\.\n/,
    );
    expect(r.stderr).not.toMatch(/\s+at /);
  });

  it('reads stdin and writes the summary to stdout', () => {
    const d = dataset('enterprise-kg');
    const r = kgdiff([d.before, '-', ...d.flags, '--name-status'], readFileSync(d.after, 'utf8'));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('G\tLEGAL_REP\t');
  });
});
