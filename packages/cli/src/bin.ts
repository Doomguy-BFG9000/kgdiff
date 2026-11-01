#!/usr/bin/env node
import { main } from './main.js';
import { nodeIO } from './node-io.js';

// `kgdiff … | head` closes the pipe early: stop quietly instead of crashing on EPIPE.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(process.exitCode ?? 0);
  throw error;
});

main(process.argv.slice(2), nodeIO()).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // main never rejects; this is a last line of defence.
    process.stderr.write(
      `kgdiff: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 2;
  },
);
