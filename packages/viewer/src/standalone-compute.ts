/**
 * Entry of the optional standalone add-on (`dist/standalone/kgdiff-viewer-compute.js`): makes
 * the compute module (diff engine + force layout) available to the standalone viewer.
 */
import * as compute from './compute.js';
import { COMPUTE_GLOBAL } from './compute-loader.js';

(globalThis as Record<string, unknown>)[COMPUTE_GLOBAL] = compute;
