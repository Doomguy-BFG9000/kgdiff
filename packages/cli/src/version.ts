import { readFileSync } from 'node:fs';

let cached: string | undefined;

/**
 * The CLI version from its package.json (one directory above both `src/` and `dist/`).
 * Read lazily and once.
 */
export function cliVersion(): string {
  if (cached === undefined) {
    try {
      const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        version?: unknown;
      };
      cached = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
    } catch {
      cached = '0.0.0';
    }
  }
  return cached;
}
