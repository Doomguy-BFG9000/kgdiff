/**
 * Reading inputs: files or stdin, gzip-compressed or not, UTF-8 / UTF-16 text, parsed with
 * `@kgdiff/formats`. Failures become `CliError`s that name the file and suggest a fix.
 */
import { basename, resolve } from 'node:path';
import { type FormatId, type ParseOptions, type ParseResult, parseGraph } from '@kgdiff/formats';
import { FORMATS, STDIO } from './args.js';
import { CliError, isKgdiffError, systemErrorCode, systemReason } from './errors.js';
import type { CliIO } from './io.js';
import type { Env } from './style.js';
import { sanitize } from './width.js';

export const FORMAT_NAMES: Readonly<Record<FormatId, string>> = {
  json: 'JSON',
  jsonld: 'JSON-LD',
  turtle: 'Turtle',
  ntriples: 'N-Triples',
  nquads: 'N-Quads',
  trig: 'TriG',
  rdfxml: 'RDF/XML',
  obo: 'OBO',
};

export interface RawInput {
  /** How the input is called in messages: the path as given, or `stdin`. */
  readonly display: string;
  /** File name without directories and without `.gz` (format detection, `meta.source`). */
  readonly filename?: string;
  readonly text: string;
  /** True for empty or whitespace-only input (only returned with `allowEmpty`). */
  readonly empty: boolean;
}

const READ_HINTS: Readonly<Record<string, string>> = {
  ENOENT: 'Check the path. Use - to read from stdin.',
  EISDIR: 'Pass a file, not a directory.',
  EACCES: 'Check the file permissions.',
};

/** Resolve a user-supplied path against the IO's working directory. */
export function resolvePath(io: CliIO, path: string): string {
  return resolve(io.cwd, path);
}

/** Default input size limit (bytes, after decompression): 1 GiB. */
export const DEFAULT_MAX_INPUT = 1024 ** 3;

const SIZE_UNITS: Readonly<Record<string, number>> = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 };

/**
 * Input size limit: `KGDIFF_MAX_INPUT` (bytes, or with a binary `K` / `M` / `G` suffix, e.g.
 * `4G`), else `DEFAULT_MAX_INPUT`. Applies to files, stdin and decompressed gzip data.
 *
 * @throws CliError `usage` for an unreadable value.
 */
export function maxInputBytes(env: Env): number {
  const raw = env.KGDIFF_MAX_INPUT?.trim();
  if (!raw) return DEFAULT_MAX_INPUT;
  const match = /^(\d+(?:\.\d+)?)\s*([kmg]?)i?b?$/i.exec(raw);
  const value = match ? Number(match[1]) * (SIZE_UNITS[(match[2] ?? '').toLowerCase()] ?? 1) : NaN;
  if (!Number.isFinite(value) || value < 1) {
    throw new CliError(
      'usage',
      `Invalid KGDIFF_MAX_INPUT "${sanitize(raw)}".`,
      'Use a byte count such as 2147483648, or 512M / 2G.',
    );
  }
  return Math.floor(value);
}

function formatBytes(bytes: number): string {
  for (const [unit, size] of [
    ['GiB', 1024 ** 3],
    ['MiB', 1024 ** 2],
    ['KiB', 1024],
  ] as const) {
    if (bytes >= size) return `${Number((bytes / size).toFixed(1))} ${unit}`;
  }
  return `${bytes} B`;
}

function tooLarge(where: string, limit: number, cause?: unknown): CliError {
  return new CliError(
    'input',
    `${where} is too large: the input limit is ${formatBytes(limit)}.`,
    'If the input is genuine, raise the limit with KGDIFF_MAX_INPUT (e.g. KGDIFF_MAX_INPUT=4G).',
    cause === undefined ? undefined : { cause },
  );
}

function isTooLarge(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    error instanceof RangeError ||
    code === 'ERR_BUFFER_TOO_LARGE' ||
    code === 'ERR_FS_FILE_TOO_LARGE' ||
    code === 'ERR_STRING_TOO_LONG'
  );
}

/**
 * Decode input bytes: gunzip when gzip-compressed (output capped at `limit`, so a gzip bomb is
 * an error, not an out-of-memory crash), UTF-16 by BOM, else strict UTF-8.
 */
export async function decodeText(bytes: Uint8Array, where: string, limit: number): Promise<string> {
  let data = bytes;
  if (data[0] === 0x1f && data[1] === 0x8b) {
    const { gunzipSync } = await import('node:zlib');
    try {
      data = gunzipSync(data, { maxOutputLength: limit });
    } catch (error) {
      if (isTooLarge(error)) throw tooLarge(`${where} (decompressed)`, limit, error);
      throw new CliError(
        'input',
        `Cannot decompress ${where}: ${systemReason(error)}.`,
        undefined,
        {
          cause: error,
        },
      );
    }
  }
  const encoding =
    data[0] === 0xff && data[1] === 0xfe
      ? 'utf-16le'
      : data[0] === 0xfe && data[1] === 0xff
        ? 'utf-16be'
        : 'utf-8';
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(data);
  } catch (error) {
    if (isTooLarge(error)) throw tooLarge(where, limit, error);
    throw new CliError(
      'input',
      `${where} is not valid ${encoding.toUpperCase()} text.`,
      `kgdiff reads text formats (${Object.values(FORMAT_NAMES).join(', ')}). Convert binary formats first.`,
      { cause: error },
    );
  }
}

export interface ReadOptions {
  /** Accept an empty (or whitespace-only) input as an empty graph (`--allow-empty`). */
  readonly allowEmpty?: boolean;
  /** Hint shown when the input is empty and that is not allowed. */
  readonly emptyHint?: string;
}

/**
 * Read a file (or stdin for `-`) as text. `role` names the argument in messages. Inputs above
 * the size limit, and empty inputs unless `allowEmpty`, are errors.
 */
export async function readInput(
  io: CliIO,
  path: string,
  role: string,
  options: ReadOptions = {},
): Promise<RawInput> {
  const limit = maxInputBytes(io.env);
  let raw: { display: string; where: string; filename?: string; bytes: Uint8Array };
  if (path === STDIO) {
    if (io.stdinIsTTY) {
      io.stderr.write(`Reading ${role} from stdin… (end with Ctrl-D)\n`);
    }
    let bytes: Uint8Array;
    try {
      bytes = await io.readStdin(limit);
    } catch (error) {
      if (isTooLarge(error)) throw tooLarge(`${role} (stdin)`, limit, error);
      throw error;
    }
    raw = { display: 'stdin', where: `${role} (stdin)`, bytes };
  } else {
    const display = sanitize(path);
    const where = `${role} "${display}"`;
    const absolute = resolvePath(io, path);
    let bytes: Uint8Array;
    try {
      const size = (await io.fs.stat(absolute))?.size;
      if (size !== undefined && size > limit) throw tooLarge(where, limit);
      bytes = await io.fs.readFile(absolute);
    } catch (error) {
      if (error instanceof CliError) throw error;
      if (isTooLarge(error)) throw tooLarge(where, limit, error);
      const code = systemErrorCode(error);
      throw new CliError(
        'input',
        `Cannot read ${where}: ${systemReason(error)}.`,
        (code && READ_HINTS[code]) || undefined,
        { cause: error },
      );
    }
    raw = { display, where, filename: basename(path).replace(/\.gz$/i, ''), bytes };
  }
  const text = await decodeText(raw.bytes, raw.where, limit);
  const empty = text.trim() === '';
  if (empty && !options.allowEmpty) {
    throw new CliError(
      'input',
      `${raw.where} is empty.`,
      options.emptyHint ??
        (path === STDIO
          ? 'Did the command before the pipe fail? Pass --allow-empty if an empty graph is intended.'
          : 'Pass --allow-empty to compare with an empty graph (e.g. before a first release).'),
    );
  }
  return {
    display: raw.display,
    ...(raw.filename !== undefined ? { filename: raw.filename } : {}),
    text,
    empty,
  };
}

/**
 * Read two inputs concurrently; when both fail, the first one's error is reported (so the
 * message does not depend on which read finished first).
 */
export async function readPair(
  first: Promise<RawInput>,
  second: Promise<RawInput>,
): Promise<[RawInput, RawInput]> {
  const [a, b] = await Promise.allSettled([first, second]);
  if (a.status === 'rejected') throw a.reason;
  if (b.status === 'rejected') throw b.reason;
  return [a.value, b.value];
}

export interface GraphParseOptions {
  readonly format: FormatId | 'auto';
  readonly languages?: readonly string[];
  /** Flag that overrides the format of this input, for hints (`--before-format`). */
  readonly formatFlag: string;
}

/** Parse a graph, turning parser errors into messages that name the input. */
export function parseInput(input: RawInput, options: GraphParseOptions): ParseResult {
  const parseOptions: ParseOptions = {
    format: options.format,
    ...(input.filename !== undefined ? { filename: input.filename } : {}),
    ...(options.languages ? { rdf: { languages: options.languages } } : {}),
  };
  if (input.empty) {
    // --allow-empty: an empty graph, without asking a parser to guess the format of nothing.
    return parseGraph('{"nodes":[],"edges":[]}', { ...parseOptions, format: 'json' });
  }
  try {
    return parseGraph(input.text, parseOptions);
  } catch (error) {
    if (!isKgdiffError(error)) throw error;
    const where = input.display === 'stdin' ? 'stdin' : `"${input.display}"`;
    const undetected = /could not detect the format/i.test(error.message);
    const message = undetected
      ? `Cannot tell the format of ${where}.`
      : `${where}: ${error.message.replace(/\.$/, '')}.`;
    const formats = FORMATS.filter((format) => format !== 'auto').join(', ');
    const hint = undetected
      ? `Pass ${options.formatFlag} <fmt> (${formats}) or use a known file extension.`
      : options.format === 'auto'
        ? `If the format was detected wrongly, pass ${options.formatFlag} <fmt> (${formats}).`
        : undefined;
    throw new CliError('input', message, hint, { cause: error });
  }
}
