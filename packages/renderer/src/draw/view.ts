/** Shared per-pass state: the world → screen mapping and the region being drawn. */
import type { PaintStats } from '../paint-stats.js';

export interface View {
  /** screen = world · k + (ox, oy), css px. */
  k: number;
  ox: number;
  oy: number;
  /** Canvas size, css px. */
  width: number;
  height: number;
  dpr: number;
  /** Region of the current layer (css px); the whole canvas unless swiping. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Labels may not cross x0 / x1 (swipe divider, labels kept inside), y0 / y1 (kept inside). */
  strictX: boolean;
  strictY: boolean;
  stats: PaintStats;
}

/** Elements this far (px) outside the region are still drawn (strokes, halos, glows). */
export const CULL_MARGIN = 48;
/** Nodes never shrink below this screen radius (px), so far zoom-outs keep a visible graph. */
export const NODE_MIN_R = 1;
/** Below this screen radius nodes are drawn as filled squares without stroke. */
export const NODE_TINY_R = 1.25;
/** Below this screen radius dashed node outlines are drawn solid. */
export const NODE_DASH_MIN_R = 3;
export const ARROW_LEN = 7;
export const ARROW_WIDTH = 5;
/** Gap (px) between an arrow tip and the node outline. */
export const ARROW_GAP = 1.5;
/** Light-theme halo ring: `r + 5` px, 2 px wide. */
export const HALO_RING_OFFSET = 5;
export const HALO_RING_WIDTH = 2;
