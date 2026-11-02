import { describe, expect, it } from 'vitest';
import {
  ActionError,
  cleanLog,
  commentMarker,
  composeComment,
  composeSummary,
  escapeData,
  escapeMarkdown,
  fenced,
  fileSection,
  parseBase,
  parseBoolean,
  parseFiles,
  parseLocale,
  parseName,
  parseVersion,
  pullRequestBase,
  pullRequestInfo,
  reportLine,
  splitArgs,
  unchangedNote,
  workflowCommand,
} from '../lib.mjs';

describe('inputs', () => {
  it('reads booleans, empty as the default', () => {
    expect(parseBoolean('comment', 'true', false)).toBe(true);
    expect(parseBoolean('comment', ' FALSE ', true)).toBe(false);
    expect(parseBoolean('comment', '', true)).toBe(true);
    expect(() => parseBoolean('comment', 'yes', true)).toThrow(ActionError);
  });

  it('reads one path or pattern per line, normalizing paths only', () => {
    expect(
      parseFiles('ontology/onto.ttl\n\n  ./data//graph.json  \r\n./data/*.json\nontology/onto.ttl'),
    ).toEqual(['ontology/onto.ttl', 'data/graph.json', 'data/*.json']);
    expect(parseFiles('../graphs/a.ttl')).toEqual(['../graphs/a.ttl']);
    expect(() => parseFiles('/etc/graph.ttl')).toThrow(/absolute/);
    expect(() => parseFiles('C:\\graphs\\a.ttl')).toThrow(/absolute/);
    expect(() => parseFiles(' \n ')).toThrow(/empty/);
  });

  it('splits args like a shell, without expansion', () => {
    expect(splitArgs('')).toEqual([]);
    expect(splitArgs('  --match similarity\n--lang zh,en ')).toEqual([
      '--match',
      'similarity',
      '--lang',
      'zh,en',
    ]);
    expect(splitArgs(`--title "Ontology: \\"v2\\"" --ignore-attr 'modified at'`)).toEqual([
      '--title',
      'Ontology: "v2"',
      '--ignore-attr',
      'modified at',
    ]);
    expect(splitArgs(`--x="" '' $HOME a\\b`)).toEqual(['--x=', '', '$HOME', 'a\\b']);
    expect(() => splitArgs('--title "open')).toThrow(/unterminated/);
  });

  it('reads the locale, name, version and base', () => {
    expect(parseLocale('')).toBe('en');
    expect(parseLocale('zh-CN')).toBe('zh-CN');
    expect(parseLocale('zh_Hans')).toBe('zh-CN');
    expect(parseLocale('en-GB')).toBe('en');
    expect(() => parseLocale('fr')).toThrow(/locale/);
    expect(parseName(' kgdiff-ontology ')).toBe('kgdiff-ontology');
    for (const bad of ['', 'a/b', 'a:b', 'a"b', 'a\nb']) expect(() => parseName(bad)).toThrow();
    expect(parseVersion(' 0.1 ')).toBe('0.1');
    expect(parseVersion('>=0.1 <0.3')).toBe('>=0.1 <0.3');
    expect(() => parseVersion('--registry=x')).toThrow();
    expect(parseBase(' origin/main ')).toBe('origin/main');
    expect(() => parseBase('--upload-pack=x')).toThrow();
    expect(() => parseBase('main; rm')).toThrow();
  });
});

describe('the pull request', () => {
  const event = (headRepo: string | null) => ({
    pull_request: {
      number: 42,
      base: { ref: 'main', sha: 'b'.repeat(40) },
      head: {
        ref: 'feature/x',
        label: 'someone:feature/x',
        sha: 'h'.repeat(40),
        repo: headRepo === null ? null : { full_name: headRepo },
      },
    },
  });

  it('is read from pull request events only', () => {
    expect(pullRequestInfo('push', event('o/r'), 'o/r')).toBeUndefined();
    expect(pullRequestInfo('pull_request', {}, 'o/r')).toBeUndefined();
    expect(pullRequestInfo('pull_request', event('O/R'), 'o/r')).toEqual({
      number: 42,
      baseRef: 'main',
      baseSha: 'b'.repeat(40),
      headSha: 'h'.repeat(40),
      headLabel: 'feature/x',
      readOnly: false,
    });
  });

  it('from a fork has a read-only token, except with pull_request_target', () => {
    const fork = pullRequestInfo('pull_request', event('someone/r'), 'o/r');
    expect(fork?.readOnly).toBe(true);
    expect(fork?.headLabel).toBe('someone:feature/x');
    // A deleted fork has no head repository.
    expect(pullRequestInfo('pull_request', event(null), 'o/r')?.readOnly).toBe(true);
    expect(pullRequestInfo('pull_request_target', event('someone/r'), 'o/r')?.readOnly).toBe(false);
  });

  it('is compared with the first parent of its merge commit, else the event base', () => {
    const pr = pullRequestInfo('pull_request', event('o/r'), 'o/r');
    if (!pr) throw new Error('no pull request');
    expect(pullRequestBase(pr, ['p'.repeat(40), 'h'.repeat(40)])).toBe('p'.repeat(40));
    expect(pullRequestBase(pr, ['p'.repeat(40)])).toBe('b'.repeat(40));
    expect(pullRequestBase(pr, ['p'.repeat(40), 'x'.repeat(40)])).toBe('b'.repeat(40));
  });
});

describe('Markdown', () => {
  it('escapes paths and branch names like kgdiff escapes labels', () => {
    const escaped = escapeMarkdown(
      '<img src=x> @team #12 :tada: www.x.io https://x.io *a*_b_ `c` | $x$',
    );
    expect(escaped).not.toMatch(/<|>/);
    expect(escaped).toContain('&lt;img src=x&gt;');
    expect(escaped).toContain('@\u200Bteam');
    expect(escaped).toContain('\\#\u200B12');
    expect(escaped).toContain(':\u200Btada:');
    expect(escaped).toContain('www\u200B.x.io');
    expect(escaped).toContain('https://\u200Bx.io');
    expect(escaped).toContain('\\*a\\*\\_b\\_ \\`c\\` \\| \\$x\\$');
    expect(escapeMarkdown('a\u202Eb\nc')).toBe('a⟨U+202E⟩b c');
  });

  it('fences text that holds backticks', () => {
    expect(fenced('a ``` b')).toBe('````text\na ``` b\n````');
    expect(fenced('plain')).toBe('```text\nplain\n```');
  });

  it('cleans command output', () => {
    expect(cleanLog('\u001b[31merror:\u001b[0m bad\r\nline\u0007 \u2066x\n')).toBe(
      'error: bad\nline ⟨U+2066⟩x',
    );
  });

  it('quotes what went wrong with a file', () => {
    const section = fileSection(
      { path: 'g/@x.json', status: 'error', error: '\u001b[1merror:\u001b[0m ```bad```' },
      'en',
    );
    expect(section).toBe(
      '## kgdiff · g/@\u200Bx.json\n\n⚠️ **kgdiff could not compare this file.**\n\n````text\nerror: ```bad```\n````',
    );
    expect(fileSection({ path: 'a', status: 'changed', markdown: '## kgdiff · a\n\n' }, 'en')).toBe(
      '## kgdiff · a',
    );
  });

  it('lists unchanged files', () => {
    const unchanged = { path: 'a.ttl', status: 'unchanged' } as const;
    const changed = { path: 'b.ttl', status: 'changed', markdown: '' } as const;
    expect(unchangedNote([changed], 'en', 'main')).toBeUndefined();
    expect(unchangedNote([unchanged, changed], 'en', 'main')).toBe(
      '**Unchanged (same as on main):** a.ttl',
    );
    expect(unchangedNote([unchanged, { ...unchanged, path: 'c_d.ttl' }], 'zh-CN', 'main')).toBe(
      '## kgdiff\n\n✅ **图谱没有变化。** 与 main 相同：a.ttl、c\\_d.ttl',
    );
    const many = Array.from(
      { length: 60 },
      (_, i) => ({ path: `f${i}`, status: 'unchanged' }) as const,
    );
    expect(unchangedNote([...many, changed], 'en', 'main')).toMatch(/f49 · 10 more$/);
  });

  it('keeps a comment under the limit, with its marker and footer', () => {
    const marker = commentMarker('Graph diff', 'kgdiff-report');
    const sections = ['a', 'b', 'c'].map((s) => `## ${s}\n\n${s.repeat(400)}`);
    const parts = {
      marker,
      sections,
      note: '**Unchanged:** x',
      footer: 'FOOTER',
      locale: 'en',
    } as const;
    const full = composeComment({ ...parts, runUrl: 'https://github.com/o/r/actions/runs/1' });
    expect(full).toBe(
      `${marker}\n\n${sections.join('\n\n')}\n\n**Unchanged:** x\n\n---\n\nFOOTER\n`,
    );
    const short = composeComment({
      ...parts,
      runUrl: 'https://github.com/o/r/actions/runs/1',
      limit: 700,
    });
    expect([...short].length).toBeLessThanOrEqual(700);
    expect(short.startsWith(`${marker}\n\n## a`)).toBe(true);
    expect(short).toContain(
      '*…and 2 more files: see the [job summary](https://github.com/o/r/actions/runs/1).*',
    );
    expect(short).not.toContain('## b');
    expect(short.endsWith('---\n\nFOOTER\n')).toBe(true);
  });

  it('keeps a job summary under the limit', () => {
    const sections = ['a', 'b'].map((s) => s.repeat(600));
    expect(composeSummary(sections, undefined, 'en')).toBe(`${sections.join('\n\n')}\n`);
    expect(composeSummary(sections, 'note', 'zh-CN', 1000)).toBe(
      `${sections[0]}\n\n*……另有 1 个文件，超出了作业摘要的长度上限。*\n\nnote\n`,
    );
  });

  it('links the report and the run, and only safe URLs', () => {
    const run = 'https://github.com/o/r/actions/runs/1';
    expect(
      reportLine({
        locale: 'en',
        artifactName: 'kgdiff-report.html',
        artifactUrl: `${run}/artifacts/2`,
        runUrl: run,
      }),
    ).toBe(
      `📦 Interactive report: [kgdiff-report.html](${run}/artifacts/2) · [Workflow run](${run})`,
    );
    expect(
      reportLine({
        locale: 'zh-CN',
        artifactName: 'r',
        artifactUrl: `${run}/artifacts/2`,
        multiple: true,
      }),
    ).toBe(`📦 交互式报告：[r](${run}/artifacts/2)`);
    expect(
      reportLine({ locale: 'en', artifactName: 'r', artifactUrl: 'javascript:alert(1)' }),
    ).toBe('');
    expect(reportLine({ locale: 'en', artifactName: 'r', artifactUrl: `${run})[x](y` })).toBe('');
  });
});

describe('the comment marker', () => {
  it('names the workflow and the run of the action', () => {
    expect(commentMarker('Graph diff', 'kgdiff-report')).toBe(
      '<!-- kgdiff-action: Graph diff/kgdiff-report -->',
    );
  });

  it('cannot close the HTML comment early', () => {
    const marker = commentMarker('x --> <script>', '图谱');
    expect(marker).toBe('<!-- kgdiff-action: x --%3E %3Cscript%3E/%E5%9B%BE%E8%B0%B1 -->');
    expect(marker.indexOf('-->')).toBe(marker.length - 3);
  });
});

describe('workflow commands', () => {
  it('escape messages and properties', () => {
    expect(escapeData('50% done\r\n::error::x')).toBe('50%25 done%0D%0A::error::x');
    expect(workflowCommand('warning', 'a\nb', { title: 'kgdiff: x, y' })).toBe(
      '::warning title=kgdiff%3A x%2C y::a%0Ab',
    );
    expect(workflowCommand('group', 'g/a.ttl')).toBe('::group::g/a.ttl');
  });
});
