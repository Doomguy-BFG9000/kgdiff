/**
 * Regression tests for the CLI hardening review: overwrite protection, escape and bidi
 * injection, Markdown neutralization, empty and oversized inputs, narrow terminals, and
 * command-line corner cases.
 */
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { outputWidth } from '../src/diff-command.js';
import {
  type CliIO,
  escapeMarkdown,
  main,
  resolveColorLevel,
  sanitize,
  stringWidth,
  stripAnsi,
} from '../src/index.js';
import { DEFAULT_MAX_INPUT, maxInputBytes } from '../src/inputs.js';
import { nodeFileSystem } from '../src/node-io.js';
import { createTestIO, dataset, run } from './helpers.js';

const cp = (...points: number[]): string => String.fromCodePoint(...points);
const ESC = cp(0x1b);
const BEL = cp(0x07);
const RLO = cp(0x202e);
const ZWSP = cp(0x200b);

const graph = (nodes: unknown[], edges: unknown[] = []): string => JSON.stringify({ nodes, edges });
const A = graph([{ id: 'a', label: 'A' }]);
const B = graph([
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
]);

describe('outputs never overwrite inputs', () => {
  it('sees through case variants on case-insensitive file systems', async () => {
    const r = await run(['a.json', 'b.json', '--json', 'A.json'], {
      files: { 'a.json': A, 'b.json': B },
      caseInsensitive: true,
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('kgdiff never overwrites its inputs');
    expect(r.written.size).toBe(0);
  });

  it('sees through symlinks and hard links', async () => {
    const r = await run(['a.json', 'b.json', '--markdown', 'alias.md'], {
      files: { 'a.json': A, 'b.json': B },
      links: { 'alias.md': 'b.json' },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--markdown "alias.md" is the input <after> "b.json"');
  });

  it('refuses two outputs that are one file', async () => {
    const r = await run(['a.json', 'b.json', '--json', 'X.json', '--delta', 'x.json'], {
      files: { 'a.json': A, 'b.json': B },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--json and --delta both write to "x.json"');
  });

  it('applies to kgdiff apply too', async () => {
    const made = await run(['a.json', 'b.json', '--delta', 'd.json', '-q'], {
      files: { 'a.json': A, 'b.json': B },
    });
    for (const target of ['a.json', 'd.json', './a.json']) {
      const r = await run(['apply', 'a.json', 'd.json', '-o', target], {
        files: { 'a.json': A, 'd.json': made.file('d.json') },
      });
      expect(r.code, target).toBe(2);
      expect(r.stderr).toContain('kgdiff never overwrites its inputs');
      expect(r.written.size).toBe(0);
    }
  });

  describe('on the real file system', () => {
    let dir = '';
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    function realIO(cwd: string): CliIO {
      return { ...createTestIO().io, fs: nodeFileSystem(), cwd };
    }

    it('refuses symlinks, hard links and (where the file system folds case) case variants', async () => {
      dir = mkdtempSync(join(tmpdir(), 'kgdiff-test-'));
      writeFileSync(join(dir, 'a.json'), A);
      writeFileSync(join(dir, 'b.json'), B);
      symlinkSync(join(dir, 'a.json'), join(dir, 'sym.json'));
      linkSync(join(dir, 'b.json'), join(dir, 'hard.json'));
      const caseFolding = existsSync(join(dir, 'A.JSON'));
      const targets = ['sym.json', 'hard.json', ...(caseFolding ? ['A.json'] : [])];
      for (const target of targets) {
        const code = await main(['a.json', 'b.json', '--json', target], realIO(dir));
        expect(code, target).toBe(2);
      }
      expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe(A);
      expect(readFileSync(join(dir, 'b.json'), 'utf8')).toBe(B);
    });

    it('writes atomically, keeps permissions and leaves no temporary files', async () => {
      dir = mkdtempSync(join(tmpdir(), 'kgdiff-test-'));
      writeFileSync(join(dir, 'a.json'), A);
      writeFileSync(join(dir, 'b.json'), B);
      writeFileSync(join(dir, 'out.json'), 'old');
      chmodSync(join(dir, 'out.json'), 0o640);
      const code = await main(['a.json', 'b.json', '--json', 'out.json', '-q'], realIO(dir));
      expect(code).toBe(0);
      expect(JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')).format).toBe('kgdiff.diff');
      expect(statSync(join(dir, 'out.json')).mode & 0o777).toBe(0o640);
      expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });
  });
});

describe('no escape sequences or bidi controls reach the terminal', () => {
  const evil = `${ESC}]8;;https://evil.example/${BEL}click${ESC}]8;;${BEL}${ESC}[2J`;

  it('sanitizes parser messages that quote the input', async () => {
    for (const [name, text] of [
      ['bad.json', `{"nodes": [${evil}]}`],
      ['bad.ttl', `@prefix ex: <http://e/> .\nex:a ex:b ${evil} .`],
    ] as const) {
      const r = await run(['a.json', name], { files: { 'a.json': A, [name]: text } });
      expect(r.code, name).toBe(2);
      expect(r.stderr).not.toContain(ESC);
      expect(r.stderr).not.toContain(BEL);
    }
  });

  it('sanitizes JSON.parse excerpts of a broken delta', async () => {
    const r = await run(['apply', 'a.json', 'd.json'], {
      files: { 'a.json': A, 'd.json': `{"format": "kgdiff.delta", ${evil}` },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^error: "d\.json" is not valid JSON/);
    expect(r.stderr).not.toContain(ESC);
    expect(r.stderr).not.toContain(BEL);
  });

  it('sanitizes file names in errors, warnings and stack traces', async () => {
    const r = await run([`missing${ESC}[31m${RLO}.json`, 'b.json'], {
      files: { 'b.json': B },
      env: { DEBUG: 'kgdiff' },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).not.toContain(ESC);
    expect(r.stderr).not.toContain(RLO);
    expect(r.stderr).toContain('⟨U+202E⟩');
  });

  it('reveals bidi and invisible characters in labels, keeps emoji joiners', async () => {
    const family = cp(0x1f469, 0x200d, 0x1f469, 0x200d, 0x1f467);
    const labels = [
      `admin${RLO}txt.exe`,
      `zero${ZWSP}width${cp(0xfeff)}`,
      `iso${cp(0x2067)}late`,
      family,
    ];
    const after = graph(labels.map((label, i) => ({ id: `n${i}`, label })));
    for (const flags of [[], ['--name-status'], ['--markdown']]) {
      const r = await run(['a.json', 'after.json', ...flags], {
        files: { 'a.json': A, 'after.json': after },
      });
      expect(r.code).toBe(0);
      for (const hidden of [RLO, cp(0xfeff), cp(0x2067)]) {
        expect(r.stdout, flags.join(' ')).not.toContain(hidden);
      }
      expect(r.stdout).toContain('⟨U+202E⟩');
      expect(r.stdout).toContain('⟨U+FEFF⟩');
      expect(r.stdout).toContain(family);
    }
    expect(sanitize(`a${cp(0x9b)}31m`)).toBe(`a${cp(0xfffd)}31m`);
    expect(escapeMarkdown(`a${cp(0x9b)}31m`)).toBe('a31m');
  });
});

describe('Markdown neutralization', () => {
  it('defuses emoji shortcodes, references, mentions, autolinks and math', () => {
    expect(escapeMarkdown(':white_check_mark:')).toBe(`:${ZWSP}white\\_check\\_mark:`);
    expect(escapeMarkdown(':+1:')).toBe(`:${ZWSP}+1:`);
    expect(escapeMarkdown('see GH-123')).toBe(`see GH${ZWSP}-123`);
    expect(escapeMarkdown('org/repo#12')).toBe(`org/repo\\#${ZWSP}12`);
    expect(escapeMarkdown('@octocat')).toBe(`@${ZWSP}octocat`);
    expect(escapeMarkdown('https://evil.example/x')).toBe(`https://${ZWSP}evil.example/x`);
    expect(escapeMarkdown('www.evil.example')).toBe(`www${ZWSP}.evil.example`);
    expect(escapeMarkdown('$\\frac{a}{b}$ and $x$')).toBe('\\$\\\\frac{a}{b}\\$ and \\$x\\$');
    expect(escapeMarkdown('<!-- c --> & <b>')).toBe('&lt;!-- c --&gt; &amp; &lt;b&gt;');
    expect(escapeMarkdown(`a${RLO}b`)).toBe('a⟨U+202E⟩b');
  });

  it('applies to whole documents', async () => {
    const after = graph([{ id: 'x', label: ':tada: GH-1 www.x.org $y$' }]);
    const r = await run(['a.json', 'after.json', '--markdown'], {
      files: { 'a.json': A, 'after.json': after },
    });
    expect(r.stdout).not.toMatch(/:tada:|GH-1|www\.x|(?<!\\)\$/);
  });
});

describe('empty input', () => {
  it('is an error unless --allow-empty', async () => {
    for (const empty of ['', '  \n\t']) {
      const r = await run(['a.json', 'empty.json'], {
        files: { 'a.json': A, 'empty.json': empty },
      });
      expect(r.code).toBe(2);
      expect(r.stderr).toBe(
        'error: <after> "empty.json" is empty.\nhint: Pass --allow-empty to compare with an empty graph (e.g. before a first release).\n',
      );
    }
    const ok = await run(['empty.json', 'b.json', '--allow-empty', '--name-status'], {
      files: { 'b.json': B, 'empty.json': '' },
    });
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('A\t');
  });

  it('points at the pipe for empty stdin', async () => {
    const r = await run(['a.json', '-'], { files: { 'a.json': A }, stdin: '' });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('error: <after> (stdin) is empty.');
    expect(r.stderr).toContain('Did the command before the pipe fail?');
  });

  it('is an error for deltas', async () => {
    const r = await run(['apply', 'a.json', 'd.json'], { files: { 'a.json': A, 'd.json': '' } });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('error: <delta> "d.json" is empty.');
  });
});

describe('input size limit', () => {
  it('reads KGDIFF_MAX_INPUT', () => {
    expect(maxInputBytes({})).toBe(DEFAULT_MAX_INPUT);
    expect(DEFAULT_MAX_INPUT).toBe(1024 ** 3);
    expect(maxInputBytes({ KGDIFF_MAX_INPUT: '4096' })).toBe(4096);
    expect(maxInputBytes({ KGDIFF_MAX_INPUT: '2K' })).toBe(2048);
    expect(maxInputBytes({ KGDIFF_MAX_INPUT: '512M' })).toBe(512 * 1024 ** 2);
    expect(maxInputBytes({ KGDIFF_MAX_INPUT: '4G' })).toBe(4 * 1024 ** 3);
    expect(() => maxInputBytes({ KGDIFF_MAX_INPUT: 'lots' })).toThrow(/Invalid KGDIFF_MAX_INPUT/);
  });

  it('stops gzip bombs', async () => {
    const bomb = gzipSync(`{"nodes": [], "edges": [] ${' '.repeat(200_000)}}`);
    expect(bomb.byteLength).toBeLessThan(1024);
    const r = await run(['a.json', 'bomb.json.gz'], {
      files: { 'a.json': A, 'bomb.json.gz': bomb },
      env: { KGDIFF_MAX_INPUT: '64K' },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(
      'error: <after> "bomb.json.gz" (decompressed) is too large: the input limit is 64 KiB.\n' +
        'hint: If the input is genuine, raise the limit with KGDIFF_MAX_INPUT (e.g. KGDIFF_MAX_INPUT=4G).\n',
    );
    const raised = await run(['a.json', 'bomb.json.gz', '-q'], {
      files: { 'a.json': A, 'bomb.json.gz': bomb },
      env: { KGDIFF_MAX_INPUT: '1M' },
    });
    expect(raised.code).toBe(0);
  });

  it('limits plain files and stdin', async () => {
    const big = graph(Array.from({ length: 200 }, (_, i) => ({ id: `n${i}` })));
    const file = await run(['a.json', 'big.json'], {
      files: { 'a.json': A, 'big.json': big },
      env: { KGDIFF_MAX_INPUT: '1K' },
    });
    expect(file.stderr).toContain(
      'error: <after> "big.json" is too large: the input limit is 1 KiB.',
    );
    const stdin = await run(['a.json', '-'], {
      files: { 'a.json': A },
      stdin: big,
      env: { KGDIFF_MAX_INPUT: '1K' },
    });
    expect(stdin.stderr).toContain('error: <after> (stdin) is too large');
  });
});

describe('terminal width', () => {
  it('falls back when a terminal reports 0 columns, and clamps to 40–120', () => {
    const io = (isTTY: boolean, columns: number | undefined, env: Record<string, string> = {}) =>
      ({ ...createTestIO().io, isTTY, columns, env }) as CliIO;
    expect(outputWidth(io(true, 0))).toBe(80);
    expect(outputWidth(io(true, 0, { COLUMNS: '100' }))).toBe(100);
    expect(outputWidth(io(true, 132))).toBe(120);
    expect(outputWidth(io(true, 25))).toBe(40);
    expect(outputWidth(io(false, undefined))).toBe(120);
    expect(outputWidth(io(false, undefined, { COLUMNS: 'abc' }))).toBe(120);
  });

  it('fits every line at every width from 40 to 130 columns', async () => {
    const cases = [
      { d: dataset('enterprise-kg'), locale: 'zh-CN' },
      { d: dataset('ontology-release'), locale: 'en' },
    ];
    for (const { d, locale } of cases) {
      for (const mode of [[], ['--stat'], ['--name-status']]) {
        for (let columns = 30; columns <= 130; columns += 7) {
          const r = await run(
            [d.before, d.after, ...d.flags, '--locale', locale, '--limit', '0', ...mode],
            {
              isTTY: true,
              columns,
              env: { COLORTERM: 'truecolor' },
            },
          );
          const max = Math.max(40, Math.min(120, columns));
          for (const line of stripAnsi(r.stdout).split('\n')) {
            expect(
              stringWidth(line),
              `${locale} ${mode.join('')} ${columns}: ${line}`,
            ).toBeLessThanOrEqual(max);
          }
        }
      }
    }
  }, 60_000);
});

describe('command line', () => {
  it('accepts - as stdout for optional-value outputs', async () => {
    for (const flag of ['--json', '--delta', '--markdown']) {
      const r = await run(['a.json', 'b.json', flag, '-'], { files: { 'a.json': A, 'b.json': B } });
      expect(r.code, flag).toBe(0);
      expect(r.stdout.length).toBeGreaterThan(0);
      expect(r.written.size).toBe(0);
    }
  });

  it('suggests how to pass values that start with -', async () => {
    const r = await run(['a.json', 'b.json', '-o', '-x.html'], {
      files: { 'a.json': A, 'b.json': B },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('hint: If that is the value, write --html=-x.html or -o ./-x.html.');
    const t = await run(['a.json', 'b.json', '--title', '-draft']);
    expect(t.stderr).toContain('write --title=-draft.');
  });

  it('pluralizes totals', async () => {
    const one = graph([{ id: 'a' }], [{ source: 'a', target: 'a', predicate: 'self' }]);
    const r = await run(['one.json', 'one.json'], { files: { 'one.json': one } });
    expect(r.stdout).toMatch(/ 1 node · 1 edge\n/);
    expect(r.stdout).toContain('Both versions have 1 node and 1 edge.');
  });

  it('lets FORCE_COLOR=1 force 16 colors even on truecolor terminals', () => {
    expect(resolveColorLevel('auto', { FORCE_COLOR: '1', COLORTERM: 'truecolor' }, true)).toBe(1);
    expect(resolveColorLevel('always', { FORCE_COLOR: '2', COLORTERM: 'truecolor' }, false)).toBe(
      2,
    );
    expect(resolveColorLevel('auto', { FORCE_COLOR: 'true', COLORTERM: 'truecolor' }, false)).toBe(
      3,
    );
  });

  it('accepts options after a help topic', async () => {
    const r = await run(['help', 'apply', '--color', 'never'], { isTTY: true });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('kgdiff apply <graph> <delta>');
    expect(r.stdout).not.toContain(ESC);
    const colored = await run(['help', '--color', 'always']);
    expect(colored.stdout).toContain(ESC);
    expect((await run(['help', 'nope'])).code).toBe(2);
  });
});
