/**
 * Outputs never overwrite inputs, and two outputs never share a file — under any spelling:
 * case variants on case-insensitive file systems, symlinks and hard links all resolve to the
 * same (device, inode) pair; files that do not exist yet compare by canonical directory and
 * case-folded name.
 */
import { basename, dirname, join } from 'node:path';
import { STDIO } from './args.js';
import { CliError } from './errors.js';
import { resolvePath } from './inputs.js';
import type { CliIO } from './io.js';
import { sanitize } from './width.js';

export interface PathRole {
  /** How the path was given, for messages (`<before>`, `--json`, `-o`). */
  readonly role: string;
  /** Path as given; `-` (stdin / stdout) and `undefined` are ignored. */
  readonly path: string | undefined;
}

/** Identity of the file at `path`: `inode:dev:ino` when it exists, else a canonical path. */
export async function fileIdentity(io: CliIO, path: string): Promise<string> {
  const absolute = resolvePath(io, path);
  const stat = await io.fs.stat(absolute);
  if (stat) return `inode:${stat.dev}:${stat.ino}`;
  let directory = dirname(absolute);
  try {
    directory = await io.fs.realpath(directory);
  } catch {
    // A missing directory makes the write fail later with its own message.
  }
  // Case-folded: on case-insensitive file systems `A.json` and `a.json` are one file. On
  // case-sensitive ones this can only refuse two outputs that differ in case alone.
  return `path:${join(directory, basename(absolute)).toLowerCase()}`;
}

/**
 * @throws CliError `usage` when an output is one of the inputs or two outputs are one file.
 */
export async function checkNoOverwrite(
  io: CliIO,
  inputs: readonly PathRole[],
  outputs: readonly PathRole[],
): Promise<void> {
  const used = (p: PathRole): p is PathRole & { path: string } =>
    p.path !== undefined && p.path !== STDIO;
  const inputIds = new Map<string, PathRole>();
  for (const input of inputs.filter(used)) {
    // Missing inputs are reported when they are read.
    if (await io.fs.stat(resolvePath(io, input.path))) {
      inputIds.set(await fileIdentity(io, input.path), input);
    }
  }
  const outputIds = new Map<string, PathRole>();
  for (const output of outputs.filter(used)) {
    const id = await fileIdentity(io, output.path);
    const input = inputIds.get(id);
    if (input) {
      throw new CliError(
        'usage',
        `${output.role} "${sanitize(output.path)}" is the input ${input.role} "${sanitize(input.path as string)}"; kgdiff never overwrites its inputs.`,
        'Write to another file, then move it into place if you want to replace the input.',
      );
    }
    const other = outputIds.get(id);
    if (other) {
      throw new CliError(
        'usage',
        `${other.role} and ${output.role} both write to "${sanitize(output.path)}".`,
        'Give each output its own file.',
      );
    }
    outputIds.set(id, output);
  }
}
