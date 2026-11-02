// @ts-check
/**
 * Pure helpers of the kgdiff GitHub Action (../action.yml): reading the inputs and the event,
 * the hidden marker that finds the action's pull request comment again, Markdown composition
 * and escaping, and workflow commands. No I/O: main.mjs does the work.
 */
import { posix, win32 } from 'node:path';

/** An error in the action's configuration or environment, reported without a stack trace. */
export class ActionError extends Error {
  /**
   * @param {string} message
   * @param {string} [hint] What to do about it.
   */
  constructor(message, hint) {
    super(message);
    this.name = 'ActionError';
    /** @readonly */
    this.hint = hint;
  }
}

// ─── Inputs ──────────────────────────────────────────────────────────────────────────────────

/** @typedef {'en' | 'zh-CN'} Locale */

/**
 * A boolean input: `true` or `false`, in any case; empty means `fallback`.
 *
 * @param {string} name
 * @param {string | undefined} value
 * @param {boolean} fallback
 */
export function parseBoolean(name, value, fallback) {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '') return fallback;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new ActionError(`Input ${name} must be true or false, got "${value}".`);
}

/** True when a `files` entry is a glob pattern rather than a path. */
export function isGlob(/** @type {string} */ pattern) {
  return /[*?[]/.test(pattern);
}

/**
 * The `files` input: one path or glob pattern per line, relative to the working directory.
 *
 * @param {string | undefined} text
 * @returns {string[]}
 */
export function parseFiles(text) {
  /** @type {string[]} */
  const files = [];
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (posix.isAbsolute(line) || win32.isAbsolute(line)) {
      throw new ActionError(
        `Input files lists the absolute path "${line}".`,
        'List paths relative to the repository checkout (or to working-directory).',
      );
    }
    // Paths as Git lists them (`a//b`, `./a` → `a/b`, `a`); patterns as written.
    const path = isGlob(line) ? line.replace(/^(?:\.\/)+/, '') : posix.normalize(line);
    if (!files.includes(path)) files.push(path);
  }
  if (files.length === 0) {
    throw new ActionError(
      'Input files is empty.',
      'List the graph files to compare, one per line.',
    );
  }
  return files;
}

/**
 * Split the `args` input into arguments like a shell, without any expansion: whitespace
 * separates arguments, `'…'` and `"…"` group words (inside double quotes, `\"` and `\\`
 * escape), and nothing else is special.
 *
 * @param {string | undefined} text
 * @returns {string[]}
 */
export function splitArgs(text) {
  /** @type {string[]} */
  const args = [];
  const input = text ?? '';
  let current = '';
  let started = false;
  /** @type {string | undefined} */
  let quote;
  for (let i = 0; i < input.length; i++) {
    const c = /** @type {string} */ (input[i]);
    if (quote === "'") {
      if (c === "'") quote = undefined;
      else current += c;
    } else if (quote === '"') {
      const next = input[i + 1];
      if (c === '"') quote = undefined;
      else if (c === '\\' && (next === '"' || next === '\\')) {
        current += next;
        i++;
      } else current += c;
    } else if (/\s/.test(c)) {
      if (started) args.push(current);
      current = '';
      started = false;
    } else {
      started = true;
      if (c === "'" || c === '"') quote = c;
      else current += c;
    }
  }
  if (quote) {
    throw new ActionError(`Input args has an unterminated ${quote} quote.`);
  }
  if (started) args.push(current);
  return args;
}

/**
 * The `locale` input: `en` or `zh-CN` (also `zh`, `zh-Hans`, `en-US`…).
 *
 * @param {string | undefined} value
 * @returns {Locale}
 */
export function parseLocale(value) {
  const t = (value ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (t === '' || t === 'en' || t.startsWith('en-')) return 'en';
  if (t === 'zh' || t.startsWith('zh-')) return 'zh-CN';
  throw new ActionError(`Unsupported locale "${value}".`, 'Use en or zh-CN.');
}

/**
 * The `name` input, which names the report artifact (and its file, `<name>.html`) and tells
 * apart the comments of several runs of the action: the characters an artifact name may hold.
 *
 * @param {string | undefined} value
 */
export function parseName(value) {
  const name = (value ?? '').trim();
  if (name === '' || /["':<>|*?\\/\r\n]/.test(name)) {
    throw new ActionError(
      `Input name "${value}" cannot name an artifact.`,
      'Use letters, digits, dots, dashes and underscores, e.g. kgdiff-ontology.',
    );
  }
  return name;
}

/**
 * The `version` input: an npm version, range or dist-tag of @kgdiff/cli; empty means the
 * version this action was released with.
 *
 * @param {string | undefined} value
 */
export function parseVersion(value) {
  const version = (value ?? '').trim();
  if (/[\r\n]/.test(version) || version.startsWith('-')) {
    throw new ActionError(
      `Input version "${value}" is not an npm version.`,
      'Use a version such as 0.1.0, a range such as 0.1 or a tag such as latest.',
    );
  }
  return version;
}

/**
 * The `base` input: a branch, tag or commit; empty means "from the event".
 *
 * @param {string | undefined} value
 */
export function parseBase(value) {
  const base = (value ?? '').trim();
  if (/\s/.test(base) || base.startsWith('-')) {
    throw new ActionError(
      `Input base "${value}" is not a Git ref.`,
      'Use a branch, a tag or a commit, e.g. main.',
    );
  }
  return base;
}

// ─── Event ───────────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} PullRequest
 * @property {number} number
 * @property {string} baseRef Base branch name.
 * @property {string} baseSha Base branch tip when the event fired.
 * @property {string} headSha
 * @property {string} headLabel Head branch, `owner:branch` for a fork.
 * @property {boolean} readOnly A `pull_request` event from a fork: the token is read-only.
 */

/**
 * The pull request of a `pull_request` or `pull_request_target` event, if any. Branch names
 * and repository names are untrusted: they only ever reach titles that kgdiff escapes.
 *
 * @param {string} eventName
 * @param {any} event The parsed `GITHUB_EVENT_PATH` payload.
 * @param {string} repository `GITHUB_REPOSITORY`, `owner/name`.
 * @returns {PullRequest | undefined}
 */
export function pullRequestInfo(eventName, event, repository) {
  if (eventName !== 'pull_request' && eventName !== 'pull_request_target') return undefined;
  const pr = event?.pull_request;
  if (!pr || typeof pr.number !== 'number') return undefined;
  const headRepo = typeof pr.head?.repo?.full_name === 'string' ? pr.head.repo.full_name : '';
  const fork = headRepo.toLowerCase() !== repository.toLowerCase();
  return {
    number: pr.number,
    baseRef: String(pr.base?.ref ?? ''),
    baseSha: String(pr.base?.sha ?? ''),
    headSha: String(pr.head?.sha ?? ''),
    headLabel: String((fork ? pr.head?.label : pr.head?.ref) ?? pr.head?.sha ?? ''),
    // pull_request_target runs with the base repository's token, which can comment.
    readOnly: fork && eventName === 'pull_request',
  };
}

/**
 * The base commit of a pull request: the first parent of GitHub's test merge commit when that
 * is what was checked out (the default), so the diff shows exactly what merging would change,
 * else the base branch tip recorded in the event.
 *
 * @param {PullRequest} pr
 * @param {readonly string[]} headParents Parents of the checked-out commit.
 */
export function pullRequestBase(pr, headParents) {
  const [first, second] = headParents;
  return headParents.length === 2 && first && second === pr.headSha ? first : pr.baseSha;
}

/** First seven characters of a commit id. */
export function shortSha(/** @type {string} */ sha) {
  return sha.slice(0, 7);
}

/**
 * Title of one file's summary and report: `path: base → head`.
 *
 * @param {string} path
 * @param {string} baseLabel
 * @param {string} headLabel
 */
export function titleFor(path, baseLabel, headLabel) {
  return `${path}: ${baseLabel} → ${headLabel}`;
}

// ─── Text ────────────────────────────────────────────────────────────────────────────────────

const MESSAGES = {
  en: {
    failed: 'kgdiff could not compare this file.',
    noChanges: 'No graph changed.',
    /** @param {string} base @param {string} list */
    unchanged: (base, list) => `**Unchanged (same as on ${base}):** ${list}`,
    /** @param {string} base @param {string} list */
    allUnchanged: (base, list) => `Same as on ${base}: ${list}`,
    /** @param {number} n */
    andMore: (n) => `${n} more`,
    separator: ' · ',
    report: 'Interactive report',
    reports: 'Interactive reports',
    colon: ': ',
    run: 'Workflow run',
    /** @param {number} n @param {string} url */
    more: (n, url) =>
      `…and ${n} more ${n === 1 ? 'file' : 'files'}: see the [job summary](${url}).`,
    /** @param {number} n */
    tooLong: (n) => `…and ${n} more ${n === 1 ? 'file' : 'files'}: too long for the job summary.`,
    workingTree: 'working tree',
    branchCreated: 'Nothing to compare: this push created the branch.',
  },
  'zh-CN': {
    failed: 'kgdiff 无法比较这个文件。',
    noChanges: '图谱没有变化。',
    /** @param {string} base @param {string} list */
    unchanged: (base, list) => `**未变化（与 ${base} 相同）：**${list}`,
    /** @param {string} base @param {string} list */
    allUnchanged: (base, list) => `与 ${base} 相同：${list}`,
    /** @param {number} n */
    andMore: (n) => `另有 ${n} 个`,
    separator: '、',
    report: '交互式报告',
    reports: '交互式报告',
    colon: '：',
    run: '工作流运行',
    /** @param {number} n @param {string} url */
    more: (n, url) => `……另有 ${n} 个文件，见[作业摘要](${url})。`,
    /** @param {number} n */
    tooLong: (n) => `……另有 ${n} 个文件，超出了作业摘要的长度上限。`,
    workingTree: '工作区',
    branchCreated: '没有可比较的版本：这次推送新建了分支。',
  },
};

/** Messages of the action's own text in the summary and the comment. */
export function messages(/** @type {Locale} */ locale) {
  return MESSAGES[locale];
}

/** Zero-width space: invisible, but enough to stop GitHub's autolinkers and filters. */
const ZWSP = '\u200B';

/** Invisible format characters (bidirectional controls, zero-width…) made visible. */
function revealInvisible(/** @type {string} */ text) {
  return text.replace(
    /\p{Cf}/gu,
    (c) => `⟨U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}⟩`,
  );
}

/**
 * Escape untrusted text (paths, branch names) for inline GitHub-flavoured Markdown, the way
 * kgdiff escapes labels: control characters become spaces, invisible characters visible,
 * GitHub's mentions, references, emoji and autolinks are defused with a zero-width space,
 * Markdown punctuation is backslash-escaped and `<`, `>`, `&` become entities.
 */
export function escapeMarkdown(/** @type {string} */ text) {
  return (
    revealInvisible(text)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are replaced on purpose.
      .replace(/[\u0000-\u001f\u2028\u2029]+/g, ' ')
      .replace(/[\u007f-\u009f]/g, '')
      .replace(/:([a-z0-9_+-]+):/gi, `:${ZWSP}$1:`)
      .replace(/\b(GH)-(?=\d)/gi, `$1${ZWSP}-`)
      .replace(/([@#])(?=[\p{L}\p{N}_])/gu, `$1${ZWSP}`)
      .replace(/:\/\//g, `://${ZWSP}`)
      .replace(/\b(www)\./gi, `$1${ZWSP}.`)
      .replace(/[\\`*_[\]|~#$]/g, '\\$&')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .trim()
  );
}

/**
 * Command output for a fenced code block: ANSI escapes removed, line breaks normalized,
 * other control characters dropped and invisible characters made visible.
 */
export function cleanLog(/** @type {string} */ text) {
  return revealInvisible(
    text
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences are removed on purpose.
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
      .replace(/\r\n?/g, '\n')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are removed on purpose.
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ''),
  ).trim();
}

/**
 * A fenced code block that `text` cannot close: the fence is longer than any run of backticks
 * inside. Nothing in a code block is rendered, linked or mentioned.
 */
export function fenced(/** @type {string} */ text, info = 'text') {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${info}\n${text}\n${fence}`;
}

/** Longest error output quoted in a summary. */
const ERROR_LIMIT = 4000;

/**
 * @typedef {object} FileResult
 * @property {string} path As listed (relative to the working directory).
 * @property {'changed' | 'identical' | 'unchanged' | 'error'} status `unchanged`: byte for byte,
 *   kgdiff did not run; `identical`: kgdiff found no difference.
 * @property {string} [markdown] kgdiff's Markdown summary (`changed`, `identical`).
 * @property {string} [error] What went wrong (`error`).
 */

/**
 * The Markdown section of one compared file: kgdiff's summary, or what went wrong.
 *
 * @param {FileResult} result
 * @param {Locale} locale
 */
export function fileSection(result, locale) {
  if (result.status !== 'error') return (result.markdown ?? '').trim();
  const m = messages(locale);
  let error = cleanLog(result.error ?? '');
  if (error.length > ERROR_LIMIT) error = `${error.slice(0, ERROR_LIMIT)}\n…`;
  return [`## kgdiff · ${escapeMarkdown(result.path)}`, `⚠️ **${m.failed}**`, fenced(error)].join(
    '\n\n',
  );
}

/** Unchanged files listed by name. */
const UNCHANGED_LIMIT = 50;

/**
 * The line listing the files that are byte-for-byte the same as on the base, or, when no file
 * changed at all, a section saying so. `undefined` when every file changed.
 *
 * @param {readonly FileResult[]} results
 * @param {Locale} locale
 * @param {string} baseLabel
 */
export function unchangedNote(results, locale, baseLabel) {
  const m = messages(locale);
  const unchanged = results.filter((r) => r.status === 'unchanged');
  if (unchanged.length === 0) return undefined;
  const listed = unchanged.slice(0, UNCHANGED_LIMIT).map((r) => escapeMarkdown(r.path));
  if (unchanged.length > UNCHANGED_LIMIT)
    listed.push(m.andMore(unchanged.length - UNCHANGED_LIMIT));
  const list = listed.join(m.separator);
  const base = escapeMarkdown(baseLabel);
  if (unchanged.length === results.length) {
    return `## kgdiff\n\n✅ **${m.noChanges}** ${m.allUnchanged(base, list)}`;
  }
  return m.unchanged(base, list);
}

/** Longest job summary a step may write: GitHub refuses more than 1 MiB. */
export const SUMMARY_LIMIT = 1_000_000;
/** Longest pull request comment: GitHub refuses more than 65,536 characters. */
export const COMMENT_LIMIT = 65_000;

/** Length as GitHub counts it, in characters (code points). */
function characters(/** @type {string} */ text) {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/**
 * Join `head`, as many `sections` as fit within `limit` and `tail`; when sections are left
 * out, `omitted(n)` says so.
 *
 * @param {readonly string[]} head
 * @param {readonly string[]} sections
 * @param {readonly string[]} tail
 * @param {number} limit
 * @param {(text: string) => number} measure
 * @param {(n: number) => string} omitted
 */
function fitSections(head, sections, tail, limit, measure, omitted) {
  const join = (/** @type {readonly string[]} */ parts) => `${parts.join('\n\n')}\n`;
  const all = join([...head, ...sections, ...tail]);
  if (measure(all) <= limit) return all;
  /** @type {string[]} */
  const kept = [];
  for (const section of sections) {
    const left = sections.length - kept.length - 1;
    if (measure(join([...head, ...kept, section, omitted(left), ...tail])) > limit) break;
    kept.push(section);
  }
  return join([...head, ...kept, omitted(sections.length - kept.length), ...tail]);
}

/**
 * The job summary: one section per compared file, then the unchanged ones.
 *
 * @param {readonly string[]} sections
 * @param {string | undefined} note
 * @param {Locale} locale
 * @param {number} [limit] In UTF-8 bytes.
 */
export function composeSummary(sections, note, locale, limit = SUMMARY_LIMIT) {
  const m = messages(locale);
  return fitSections(
    [],
    sections,
    note ? [note] : [],
    limit,
    (text) => Buffer.byteLength(text),
    (n) => `*${m.tooLong(n)}*`,
  );
}

/**
 * The pull request comment: the marker that finds it again, the sections that fit, the
 * unchanged files and the footer.
 *
 * @param {object} parts
 * @param {string} parts.marker
 * @param {readonly string[]} parts.sections
 * @param {string | undefined} parts.note
 * @param {string} parts.footer
 * @param {string} parts.runUrl Where the job summary is, when sections are left out.
 * @param {Locale} parts.locale
 * @param {number} [parts.limit] In characters.
 */
export function composeComment({
  marker,
  sections,
  note,
  footer,
  runUrl,
  locale,
  limit = COMMENT_LIMIT,
}) {
  const m = messages(locale);
  return fitSections(
    [marker],
    sections,
    [...(note ? [note] : []), '---', footer],
    limit,
    characters,
    (n) => `*${m.more(n, runUrl)}*`,
  );
}

/** True for a URL that can go into a Markdown link as is. */
export function isSafeUrl(/** @type {string | undefined} */ url) {
  return typeof url === 'string' && /^https:\/\/[^\s<>()[\]"'`\\]+$/.test(url);
}

/**
 * The line linking the report artifact (when there is one) and, in a comment, the run.
 *
 * @param {object} options
 * @param {Locale} options.locale
 * @param {string} [options.artifactName]
 * @param {string} [options.artifactUrl]
 * @param {boolean} [options.multiple] Several reports, in a zip.
 * @param {string} [options.runUrl]
 */
export function reportLine({ locale, artifactName, artifactUrl, multiple, runUrl }) {
  const m = messages(locale);
  /** @type {string[]} */
  const parts = [];
  if (artifactName && isSafeUrl(artifactUrl)) {
    parts.push(
      `📦 ${multiple ? m.reports : m.report}${m.colon}[${escapeMarkdown(artifactName)}](${artifactUrl})`,
    );
  }
  if (isSafeUrl(runUrl)) parts.push(`[${m.run}](${runUrl})`);
  return parts.join(' · ');
}

// ─── Comment marker ──────────────────────────────────────────────────────────────────────────

/**
 * The hidden first line of the action's comment, which later runs look for. One comment per
 * workflow and `name`: two jobs, or the steps of a matrix, that set different names keep
 * separate comments. Characters outside a safe set are percent-encoded, so the marker cannot
 * end the HTML comment early.
 *
 * @param {string} workflow `GITHUB_WORKFLOW`
 * @param {string} name
 */
export function commentMarker(workflow, name) {
  const key = Array.from(`${workflow}/${name}`, (c) => {
    if (/[A-Za-z0-9 ._~/+-]/.test(c)) return c;
    try {
      return encodeURIComponent(c);
    } catch {
      return '%EF%BF%BD'; // a lone surrogate
    }
  }).join('');
  return `<!-- kgdiff-action: ${key} -->`;
}

// ─── Workflow commands ───────────────────────────────────────────────────────────────────────

/** Escape the message of a workflow command. */
export function escapeData(/** @type {string} */ text) {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** Escape a property value of a workflow command. */
export function escapeProperty(/** @type {string} */ text) {
  return escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/**
 * A workflow command line, e.g. `::warning title=kgdiff::message`.
 *
 * @param {string} name
 * @param {string} message
 * @param {Readonly<Record<string, string>>} [properties]
 */
export function workflowCommand(name, message, properties = {}) {
  const props = Object.entries(properties)
    .map(([key, value]) => `${key}=${escapeProperty(value)}`)
    .join(',');
  return `::${name}${props ? ` ${props}` : ''}::${escapeData(message)}`;
}
