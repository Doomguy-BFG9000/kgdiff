/**
 * Shared output plumbing of the commands: painters for stdout / stderr, the resolved locale,
 * `--quiet`, and writing output files with a short notice on stderr.
 */
import type { Locale } from '@kgdiff/core';
import type { CommonOptions } from './args.js';
import { CliError, systemErrorCode, systemReason } from './errors.js';
import { resolvePath } from './inputs.js';
import type { CliIO } from './io.js';
import { resolveLocale } from './locale.js';
import { createPainter, isLightBackground, type Painter, resolveColorLevel } from './style.js';
import { sanitize } from './width.js';

export interface OutputContext {
  readonly io: CliIO;
  readonly locale: Locale;
  /** Painter for stdout. */
  readonly paint: Painter;
  /** Painter for stderr. */
  readonly errPaint: Painter;
  readonly quiet: boolean;
  /** Write to stdout unless `--quiet`. */
  stdout(text: string): void;
  /** Write a notice or warning to stderr unless `--quiet`. */
  notice(text: string): void;
}

export function outputContext(io: CliIO, options: CommonOptions): OutputContext {
  const light = isLightBackground(io.env);
  return {
    io,
    locale: resolveLocale(options.locale, io.env),
    paint: createPainter(resolveColorLevel(options.color, io.env, io.isTTY), light),
    errPaint: createPainter(resolveColorLevel(options.color, io.env, io.stderrIsTTY), light),
    quiet: options.quiet,
    stdout: (text) => {
      if (!options.quiet && text) io.stdout.write(text);
    },
    notice: (text) => {
      if (!options.quiet) io.stderr.write(text);
    },
  };
}

/** `1.2 MB`, `512 kB`, `90 B` (decimal units, like most file managers). */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

const WRITE_HINTS: Readonly<Record<string, string>> = {
  ENOENT: 'Create the directory first.',
  EISDIR: 'Pass a file name, not a directory.',
  EACCES: 'Check the permissions of the directory.',
};

/** Write an output file and report it on stderr (`✓ Wrote report.html (1.2 MB)`). */
export async function writeOutputFile(
  ctx: OutputContext,
  path: string,
  content: string,
  label: string,
): Promise<void> {
  const data = new TextEncoder().encode(content);
  try {
    await ctx.io.fs.writeFile(resolvePath(ctx.io, path), data);
  } catch (error) {
    const code = systemErrorCode(error);
    throw new CliError(
      'output',
      `Cannot write ${label} to "${sanitize(path)}": ${systemReason(error)}.`,
      (code && WRITE_HINTS[code]) || undefined,
      { cause: error },
    );
  }
  const p = ctx.errPaint;
  ctx.notice(
    `${p.tone('added', '✓')} Wrote ${label} ${p.bold(sanitize(path))} ${p.dim(`(${formatSize(data.byteLength)})`)}\n`,
  );
}
