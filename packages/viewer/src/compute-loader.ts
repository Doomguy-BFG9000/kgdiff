/**
 * Lazy access to `compute.ts`. The standalone bundle leaves it out: there it comes from the
 * optional `kgdiff-viewer-compute.js` add-on (which sets `globalThis.KgdiffCompute`) or from an
 * import map entry for `@kgdiff/viewer/compute`.
 */
import { KgdiffError } from '@kgdiff/core';

export type Compute = typeof import('./compute.js');

/** Global set by the standalone compute add-on. */
export const COMPUTE_GLOBAL = 'KgdiffCompute';

let pending: Promise<Compute> | null = null;
let ready: Compute | null = null;
let failed = false;

function fromGlobal(): Compute | null {
  const g = (globalThis as Record<string, unknown>)[COMPUTE_GLOBAL];
  return typeof g === 'object' && g !== null ? (g as Compute) : null;
}

/**
 * The compute module once loaded (synchronously), else null. The global is read on every call,
 * so an add-on that arrives after the viewer (inlined later, or loaded on demand) is picked up
 * without a reload.
 */
export function computeNow(): Compute | null {
  ready ??= fromGlobal();
  return ready;
}

/** `ready`: loaded; `unavailable`: the last attempt failed and no add-on is present; else `unknown`. */
export function computeStatus(): 'ready' | 'unavailable' | 'unknown' {
  if (computeNow()) return 'ready';
  return failed ? 'unavailable' : 'unknown';
}

export function loadCompute(): Promise<Compute> {
  const now = computeNow();
  if (now) return Promise.resolve(now);
  pending ??= import('./compute.js').then(
    (m) => {
      ready = m;
      failed = false;
      return m;
    },
    (error: unknown) => {
      pending = null;
      failed = true;
      throw new KgdiffError(
        'invalid-input',
        'Diffing in the browser needs the compute module: import @kgdiff/viewer as a module, or add kgdiff-viewer-compute.js.',
        { cause: error instanceof Error ? error.message : String(error) },
      );
    },
  );
  return pending;
}
