/**
 * `formatHunk` stand-in while core is implemented concurrently. Usage in a test file:
 *
 *   vi.mock('@kgdiff/core', async (orig) => ({
 *     ...(await orig<object>()),
 *     formatHunk: (await import('./mock-core.js')).fakeFormatHunk,
 *   }));
 */
import type { DiffResult, Hunk, Locale } from '@kgdiff/core';

export function fakeFormatHunk(
  hunk: Hunk,
  _diff: DiffResult,
  locale: Locale = 'en',
): { readonly title: string; readonly subtitle: string } {
  return {
    title: `${locale}|${hunk.kind}|${hunk.anchor}`,
    subtitle: `${hunk.nodes.length}n ${hunk.edges.length}e`,
  };
}
