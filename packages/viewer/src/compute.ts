/**
 * The CPU-heavy part of the pipeline, loaded on demand (`compute-loader.ts`): the diff engine
 * and the force layout. Reports (precomputed payloads) never need it, which keeps the
 * standalone bundle small; the ESM build gets it as a separate chunk.
 */
export { diff } from '@kgdiff/core';
export { extendLayout, layoutDiff } from '@kgdiff/layout';
