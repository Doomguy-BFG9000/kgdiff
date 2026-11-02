/**
 * The action's steps end to end on scratch Git repositories, with a stand-in for kgdiff (the
 * real one runs in .github/workflows/action.yml) and a fake GitHub API.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionError } from '../lib.mjs';
import { commentStep, diffStep, finishStep } from '../main.mjs';

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Write files (`null` deletes one). */
function write(dir: string, files: Record<string, string | null>): void {
  for (const [path, text] of Object.entries(files)) {
    const file = join(dir, path);
    if (text === null) rmSync(file, { force: true });
    else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
  }
}

function commitAll(repo: string, message: string): string {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--allow-empty', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

let root: string;
let lines: string[];
const cwd = process.cwd();

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'kgdiff-action-')));
  lines = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(cwd);
  rmSync(root, { recursive: true, force: true });
});

/** A repository with a base commit and a head commit on top; the head is checked out. */
function repository(base: Record<string, string>, head: Record<string, string | null>) {
  const repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
  write(repo, base);
  const baseSha = commitAll(repo, 'base');
  write(repo, head);
  const headSha = commitAll(repo, 'head');
  process.chdir(repo);
  return { repo, baseSha, headSha };
}

/** A pull request event (#7 in o/r) and the environment of the action's steps. */
function environment(
  inputs: Record<string, string>,
  event: { name: string; payload: unknown } | undefined,
): NodeJS.ProcessEnv {
  const output = join(root, 'output.txt');
  const summary = join(root, 'summary.md');
  const eventPath = join(root, 'event.json');
  writeFileSync(output, '');
  writeFileSync(summary, '');
  writeFileSync(eventPath, JSON.stringify(event?.payload ?? {}));
  return {
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summary,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_EVENT_NAME: event?.name ?? 'workflow_dispatch',
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_WORKFLOW: 'Graph diff',
    GITHUB_RUN_ID: '1',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_API_URL: 'https://api.github.com',
    RUNNER_TEMP: root,
    INPUT_NAME: 'kgdiff-report',
    INPUT_COMMENT: 'true',
    INPUT_FAIL_ON_CHANGES: 'false',
    INPUT_LOCALE: 'en',
    ...inputs,
  };
}

function pullRequest(baseSha: string, headSha: string, headRepo = 'o/r') {
  return {
    name: 'pull_request',
    payload: {
      pull_request: {
        number: 7,
        base: { ref: 'main', sha: baseSha },
        head: {
          ref: 'feature',
          label: 'someone:feature',
          sha: headSha,
          repo: { full_name: headRepo },
        },
      },
    },
  };
}

function outputs(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    readFileSync(env.GITHUB_OUTPUT as string, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
}

function state(env: NodeJS.ProcessEnv) {
  return JSON.parse(readFileSync(outputs(env).state as string, 'utf8'));
}

/**
 * Stands in for kgdiff: "identical" when the texts differ only in surrounding whitespace, an
 * error for a text that says "broken", else "changed". Records every command line.
 */
function fakeKgdiff(calls: string[][]) {
  return () => ({
    version: async () => '0.0.0-test',
    run: async (args: readonly string[], dir: string) => {
      calls.push([...args]);
      const option = (name: string) =>
        args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';
      const [before = '', after = ''] = args.slice(args.indexOf('--') + 1);
      const a = readFileSync(join(dir, before), 'utf8').trim();
      const b = readFileSync(join(dir, after), 'utf8').trim();
      if (b.includes('broken')) return { code: 2, stderr: `error: ${after}: Invalid JSON.\n` };
      writeFileSync(
        join(dir, option('markdown')),
        `## kgdiff · ${option('title')}\n\n${a === b ? 'identical' : `${a || '∅'} → ${b || '∅'}`}\n`,
      );
      writeFileSync(join(dir, option('html')), `<title>${option('title')}</title>`);
      return { code: a === b ? 0 : 1, stderr: '' };
    },
  });
}

describe('diff', () => {
  it('compares changed, new, deleted and unchanged files with the pull request base', async () => {
    const { baseSha, headSha } = repository(
      {
        'graphs/changed.json': 'one',
        'graphs/deleted.json': 'gone',
        'graphs/same.json': 'same',
        'graphs/reformatted.json': 'graph',
        'onto.ttl': 'old',
        'README.md': 'not a graph',
      },
      {
        'graphs/changed.json': 'two',
        'graphs/deleted.json': null,
        'graphs/new.json': 'new',
        'graphs/reformatted.json': 'graph\n\n',
        'onto.ttl': 'new',
      },
    );
    const calls: string[][] = [];
    const env = environment(
      { INPUT_FILES: 'graphs/*.json\nonto.ttl', INPUT_ARGS: '--match similarity --lang "zh,en"' },
      pullRequest(baseSha, headSha),
    );
    expect(await diffStep(env, { kgdiff: fakeKgdiff(calls) })).toBe(0);

    expect(calls.map((args) => args.at(-1))).toEqual([
      'after/graphs/changed.json',
      'after/graphs/deleted.json',
      'after/graphs/new.json',
      'after/graphs/reformatted.json',
      'after/onto.ttl',
    ]);
    expect(calls[0]).toEqual([
      '--title=graphs/changed.json: main → feature',
      '--locale=en',
      '--color=always',
      '--match',
      'similarity',
      '--lang',
      'zh,en',
      '--markdown=markdown/graphs/changed.json.md',
      '--html=reports/graphs/changed.json.html',
      '--reproducible',
      '--allow-empty',
      '--exit-code',
      '--',
      'before/graphs/changed.json',
      'after/graphs/changed.json',
    ]);

    const out = outputs(env);
    expect(out).toMatchObject({ changed: 'true', archive: 'true', comment: 'true' });
    expect(out['report-path']).toMatch(/reports$/);
    const summary = readFileSync(env.GITHUB_STEP_SUMMARY as string, 'utf8');
    expect(summary).toBe(readFileSync(out['summary-file'] as string, 'utf8'));
    expect(summary).toBe(
      [
        '## kgdiff · graphs/changed.json: main → feature\n\none → two',
        '## kgdiff · graphs/deleted.json: main → feature\n\ngone → ∅',
        '## kgdiff · graphs/new.json: main → feature\n\n∅ → new',
        '## kgdiff · graphs/reformatted.json: main → feature\n\nidentical',
        '## kgdiff · onto.ttl: main → feature\n\nold → new',
        '**Unchanged (same as on main):** graphs/same.json\n',
      ].join('\n\n'),
    );
    expect(state(env)).toMatchObject({
      issue: 7,
      marker: '<!-- kgdiff-action: Graph diff/kgdiff-report -->',
      create: true,
      artifactName: 'kgdiff-report',
      multiple: true,
      changed: ['graphs/changed.json', 'graphs/deleted.json', 'graphs/new.json', 'onto.ttl'],
      errors: [],
    });
    // Reports of the changed graphs only.
    const reports = out['report-path'] as string;
    expect(readFileSync(join(reports, 'onto.ttl.html'), 'utf8')).toContain('onto.ttl');
    expect(() => readFileSync(join(reports, 'graphs/reformatted.json.html'))).toThrow();
    // kgdiff's output cannot issue workflow commands.
    const stop = lines.find((l) => l.startsWith('::stop-commands::'));
    expect(lines).toContain(`::${stop?.slice('::stop-commands::'.length)}::`);
  });

  it('uploads one report as <name>.html and compares with the merge commit’s first parent', async () => {
    // main: base → main2 (changes g.json); feature: base → feature (changes h.json); the
    // checkout is GitHub's merge commit of feature into main2.
    const { repo, baseSha } = repository({ 'g.json': 'v0', 'h.json': 'h0' }, {});
    git(repo, 'checkout', '-q', '-b', 'feature', baseSha);
    write(repo, { 'h.json': 'h1' });
    const featureSha = commitAll(repo, 'feature');
    git(repo, 'checkout', '-q', 'main');
    write(repo, { 'g.json': 'v1' });
    commitAll(repo, 'main2');
    git(repo, 'merge', '-q', '--no-ff', '-m', 'merge', 'feature');
    const calls: string[][] = [];
    // The event's base is older than the merge commit's first parent.
    const env = environment(
      { INPUT_FILES: '*.json', INPUT_NAME: 'graphs' },
      pullRequest(baseSha, featureSha),
    );
    await diffStep(env, { kgdiff: fakeKgdiff(calls) });
    expect(calls.map((args) => args.at(-1))).toEqual(['after/h.json']);
    const out = outputs(env);
    expect(out['report-path']).toMatch(/graphs\.html$/);
    expect(out.archive).toBe('false');
    expect(state(env)).toMatchObject({ artifactName: 'graphs.html', multiple: false });
    expect(readFileSync(env.GITHUB_STEP_SUMMARY as string, 'utf8')).toContain(
      '**Unchanged (same as on main):** g.json',
    );
  });

  it('does not comment on a pull request from a fork', async () => {
    const { baseSha, headSha } = repository({ 'g.json': 'a' }, { 'g.json': 'b' });
    const env = environment({ INPUT_FILES: 'g.json' }, pullRequest(baseSha, headSha, 'someone/r'));
    await diffStep(env, { kgdiff: fakeKgdiff([]) });
    expect(outputs(env)).toMatchObject({ changed: 'true', comment: 'false' });
    expect(readFileSync(env.GITHUB_STEP_SUMMARY as string, 'utf8')).toContain(
      '## kgdiff · g.json: main → someone:feature',
    );
    expect(
      lines.some((l) => l.startsWith('::notice title=kgdiff::A pull request from a fork')),
    ).toBe(true);
  });

  it('says so when no graph changed', async () => {
    const { baseSha, headSha } = repository({ 'a.ttl': 'x', 'b.ttl': 'y' }, { 'README.md': 'z' });
    const calls: string[][] = [];
    const env = environment(
      { INPUT_FILES: 'a.ttl\nb.ttl', INPUT_LOCALE: 'zh-CN' },
      pullRequest(baseSha, headSha),
    );
    await diffStep(env, { kgdiff: fakeKgdiff(calls) });
    expect(calls).toEqual([]);
    expect(readFileSync(env.GITHUB_STEP_SUMMARY as string, 'utf8')).toBe(
      '## kgdiff\n\n✅ **图谱没有变化。** 与 main 相同：a.ttl、b.ttl\n',
    );
    expect(outputs(env)).toMatchObject({ changed: 'false', 'report-path': '', comment: 'true' });
    expect(state(env).create).toBe(false);
  });

  it('reports the files it cannot compare, and compares the others', async () => {
    const { repo, baseSha, headSha } = repository(
      { 'ok.json': 'a', 'bad.json': 'a', 'dir/x.json': 'a' },
      { 'ok.json': 'b', 'bad.json': 'broken' },
    );
    if (process.platform !== 'win32') symlinkSync('/etc/hosts', join(repo, 'link.json'));
    const env = environment(
      {
        INPUT_FILES:
          'ok.json\nbad.json\nmissing.json\ndir' +
          (process.platform !== 'win32' ? '\nlink.json' : ''),
      },
      pullRequest(baseSha, headSha),
    );
    await diffStep(env, { kgdiff: fakeKgdiff([]) });
    const summary = readFileSync(env.GITHUB_STEP_SUMMARY as string, 'utf8');
    expect(summary).toContain('## kgdiff · ok.json: main → feature');
    expect(summary).toContain(
      '## kgdiff · bad.json\n\n⚠️ **kgdiff could not compare this file.**\n\n```text\nerror: after/bad.json: Invalid JSON.\n```',
    );
    expect(summary).toContain(
      '```text\nThere is no such file, in the checkout or in the base.\n```',
    );
    expect(summary).toContain(
      '```text\nIt is a directory: list its files, or use a glob such as dir/**/*.ttl.\n```',
    );
    if (process.platform !== 'win32') {
      expect(summary).toContain(
        '```text\nIt is a symbolic link: kgdiff compares regular files only.\n```',
      );
    }
    expect(state(env)).toMatchObject({ changed: ['ok.json'], create: true });
    expect(state(env).errors).toContain('bad.json');
    expect(finishStep({ ...env, KGDIFF_STATE: outputs(env).state })).toBe(1);
  });

  it('compares the working tree with base: HEAD and can fail on changes', async () => {
    const { repo } = repository({ 'graph.json': 'committed' }, {});
    write(repo, { 'graph.json': 'generated' });
    const env = environment(
      { INPUT_FILES: 'graph.json', INPUT_BASE: 'HEAD', INPUT_FAIL_ON_CHANGES: 'true' },
      { name: 'push', payload: { before: '1'.repeat(40) } },
    );
    const calls: string[][] = [];
    await diffStep(env, { kgdiff: fakeKgdiff(calls) });
    expect(calls[0]?.[0]).toBe('--title=graph.json: HEAD → working tree');
    expect(outputs(env).comment).toBe('false');
    const finish = { ...env, KGDIFF_STATE: outputs(env).state };
    expect(finishStep(finish)).toBe(1);
    expect(lines).toContain('::error title=kgdiff::A graph changed (fail-on-changes): graph.json.');
  });

  it('has nothing to compare on a push that created the branch', async () => {
    repository({ 'g.json': 'a' }, { 'g.json': 'b' });
    const env = environment(
      { INPUT_FILES: 'g.json' },
      { name: 'push', payload: { before: '0'.repeat(40) } },
    );
    const calls: string[][] = [];
    expect(await diffStep(env, { kgdiff: fakeKgdiff(calls) })).toBe(0);
    expect(calls).toEqual([]);
    expect(readFileSync(env.GITHUB_STEP_SUMMARY as string, 'utf8')).toBe(
      '## kgdiff\n\nNothing to compare: this push created the branch.\n',
    );
    expect(outputs(env)).toMatchObject({ changed: 'false', 'report-path': '' });
  });

  it('compares a push with the commit before it', async () => {
    const { baseSha } = repository({ 'g.json': 'a' }, { 'g.json': 'b' });
    const env = environment(
      { INPUT_FILES: 'g.json' },
      { name: 'push', payload: { before: baseSha } },
    );
    const calls: string[][] = [];
    await diffStep(env, { kgdiff: fakeKgdiff(calls) });
    expect(calls[0]?.[0]).toMatch(/^--title=g\.json: [0-9a-f]{7} → [0-9a-f]{7}$/);
  });

  it('needs a base outside pull requests and pushes, and files that exist', async () => {
    repository({ 'g.json': 'a' }, {});
    await expect(
      diffStep(environment({ INPUT_FILES: 'g.json' }, undefined), { kgdiff: fakeKgdiff([]) }),
    ).rejects.toThrow(/no base to compare with on a workflow_dispatch event/);
    const env = environment({ INPUT_FILES: 'nothing/*.ttl', INPUT_BASE: 'main' }, undefined);
    await expect(diffStep(env, { kgdiff: fakeKgdiff([]) })).rejects.toThrow(ActionError);
    expect(lines).toContain('::warning title=kgdiff::No file matches nothing/*.ttl.');
    await expect(
      diffStep(environment({ INPUT_FILES: 'g.json', INPUT_BASE: 'no-such-branch' }, undefined), {
        kgdiff: fakeKgdiff([]),
      }),
    ).rejects.toThrow(/Cannot find the base no-such-branch/);
  });
});

describe('comment', () => {
  it('posts the summary with the marker and a link to the report', async () => {
    const { baseSha, headSha } = repository({ 'g.json': 'a' }, { 'g.json': 'b' });
    const env = environment({ INPUT_FILES: 'g.json' }, pullRequest(baseSha, headSha));
    await diffStep(env, { kgdiff: fakeKgdiff([]) });
    const bodies: string[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/user')) return new Response('{}', { status: 403 });
      if (init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)).body);
        return new Response(JSON.stringify({ html_url: 'https://github.com/o/r/pull/7#c1' }), {
          status: 201,
        });
      }
      return new Response('[]', { status: 200 });
    }) as typeof globalThis.fetch;
    const step = {
      ...env,
      KGDIFF_STATE: outputs(env).state,
      INPUT_TOKEN: 'token',
      ARTIFACT_URL: 'https://github.com/o/r/actions/runs/1/artifacts/9',
    };
    expect(await commentStep(step, { fetch })).toBe(0);
    expect(bodies).toEqual([
      [
        '<!-- kgdiff-action: Graph diff/kgdiff-report -->',
        '## kgdiff · g.json: main → feature\n\na → b',
        '---',
        '📦 Interactive report: [kgdiff-report.html](https://github.com/o/r/actions/runs/1/artifacts/9) · [Workflow run](https://github.com/o/r/actions/runs/1)\n',
      ].join('\n\n'),
    ]);
    expect(outputs(env)['comment-url']).toBe('https://github.com/o/r/pull/7#c1');
  });

  it('warns instead of failing when the token cannot comment', async () => {
    const { baseSha, headSha } = repository({ 'g.json': 'a' }, { 'g.json': 'b' });
    const env = environment({ INPUT_FILES: 'g.json' }, pullRequest(baseSha, headSha));
    await diffStep(env, { kgdiff: fakeKgdiff([]) });
    const fetch = (async () =>
      new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), {
        status: 403,
      })) as typeof globalThis.fetch;
    const step = { ...env, KGDIFF_STATE: outputs(env).state, INPUT_TOKEN: 'token' };
    expect(await commentStep(step, { fetch, retryDelay: 0 })).toBe(0);
    expect(
      lines.some((l) =>
        l.startsWith('::warning title=kgdiff::Could not comment on pull request #7'),
      ),
    ).toBe(true);
  });
});

describe('finish', () => {
  it('links the report from the job summary and passes when nothing failed', async () => {
    const { baseSha, headSha } = repository({ 'g.json': 'a' }, { 'g.json': 'b' });
    const env = environment({ INPUT_FILES: 'g.json' }, pullRequest(baseSha, headSha));
    await diffStep(env, { kgdiff: fakeKgdiff([]) });
    writeFileSync(env.GITHUB_STEP_SUMMARY as string, '');
    const step = {
      ...env,
      KGDIFF_STATE: outputs(env).state,
      ARTIFACT_URL: 'https://github.com/o/r/actions/runs/1/artifacts/9',
    };
    expect(finishStep(step)).toBe(0);
    expect(readFileSync(env.GITHUB_STEP_SUMMARY as string, 'utf8')).toBe(
      '\n📦 Interactive report: [kgdiff-report.html](https://github.com/o/r/actions/runs/1/artifacts/9)\n',
    );
  });
});
