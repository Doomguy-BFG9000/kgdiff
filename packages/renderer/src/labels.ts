/**
 * Greedy label placement in screen space (docs/visual-language.md §Level of detail).
 *
 * Labels are placed by priority (desc; ties by `order`, so placement is deterministic). Each
 * tries its candidate positions in order and takes the first that does not overlap anything
 * placed before it (labels, badges, node discs). Overlap tests use a uniform grid, so a frame
 * with n labels costs O(n) expected.
 */
import type { LabelVisual } from '@kgdiff/scene';
import { rectsOverlap } from './math.js';

/** Gap (px) between a node's edge and a label beside it. */
export const LABEL_SIDE_GAP = 6;
/** Breathing room (px) kept between placed boxes. */
export const LABEL_PAD = 2;

/** Candidate sides. */
export const SIDE_BELOW = 0;
export const SIDE_RIGHT = 1;
export const SIDE_ABOVE = 2;
export const SIDE_LEFT = 3;
export const SIDE_CENTER = 4;

/** Node labels try below, right, above, left. */
export const MODE_NODE = 0;
/** Edge / glyph labels try centred on the anchor, then above, then below it. */
export const MODE_POINT = 1;
/** Fixed boxes (collapsed pills): centred on the anchor or not at all. */
export const MODE_FIXED = 2;

/** One label block (a primary line with an optional secondary line under it). */
export interface LabelRequest {
  /** Anchor (node centre or edge midpoint), css px. */
  x: number;
  y: number;
  /** Clearance around the anchor (node radius on screen), px. */
  r: number;
  /** Block size, px. */
  w: number;
  h: number;
  /** Distance below the node edge for the `below` candidate (and above for `above`), px. */
  offset: number;
  priority: number;
  /** Tie-breaker: lower wins. */
  order: number;
  mode: number;
  /** Collapsed-group index for pills, -1 for labels. */
  pill: number;
  // ── output ──
  placed: boolean;
  side: number;
  bx: number;
  by: number;
  // ── payload for drawing (opaque to the placer) ──
  alpha: number;
  primary: LabelVisual | null;
  secondary: LabelVisual | null;
  textP: string;
  textS: string;
  fontP: string;
  fontS: string;
  wP: number;
  wS: number;
  hP: number;
  hS: number;
  /** Offset of the secondary line from the block top, px. */
  dyS: number;
}

export function createRequest(): LabelRequest {
  return {
    x: 0,
    y: 0,
    r: 0,
    w: 0,
    h: 0,
    offset: 0,
    priority: 0,
    order: 0,
    mode: MODE_NODE,
    pill: -1,
    placed: false,
    side: SIDE_BELOW,
    bx: 0,
    by: 0,
    alpha: 1,
    primary: null,
    secondary: null,
    textP: '',
    textS: '',
    fontP: '',
    fontS: '',
    wP: 0,
    wS: 0,
    hP: 0,
    hS: 0,
    dyS: 0,
  };
}

/**
 * Region labels must stay in. With `strictX`, boxes may not cross x0 / x1 (swipe divider); with
 * `strictY`, not y0 / y1 (labels kept inside the canvas).
 */
export interface LabelClip {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  strictX: boolean;
  strictY: boolean;
}

/** Uniform-grid index of occupied screen rectangles. */
export class CollisionGrid {
  private cell = 64;
  private cols = 1;
  private rows = 1;
  private x0 = 0;
  private y0 = 0;
  private cells: number[][] = [[]];
  private touched: number[] = [];
  private rects = new Float64Array(4 * 256);
  private n = 0;

  /** Clear and cover [x0, x0 + width] × [y0, y0 + height] with `cell`-px cells. */
  reset(x0: number, y0: number, width: number, height: number, cell = 64): void {
    for (const c of this.touched) this.cells[c]!.length = 0;
    this.touched.length = 0;
    this.n = 0;
    this.cell = cell;
    this.x0 = x0;
    this.y0 = y0;
    this.cols = Math.max(1, Math.ceil(width / cell));
    this.rows = Math.max(1, Math.ceil(height / cell));
    const need = this.cols * this.rows;
    while (this.cells.length < need) this.cells.push([]);
  }

  get count(): number {
    return this.n;
  }

  /** Grow `box` (x0, y0, x1, y1) by every inserted rectangle. */
  extend(box: Float64Array): void {
    const r = this.rects;
    for (let o = 0; o < this.n * 4; o += 4) {
      box[0] = Math.min(box[0]!, r[o]!);
      box[1] = Math.min(box[1]!, r[o + 1]!);
      box[2] = Math.max(box[2]!, r[o]! + r[o + 2]!);
      box[3] = Math.max(box[3]!, r[o + 1]! + r[o + 3]!);
    }
  }

  insert(x: number, y: number, w: number, h: number): void {
    if (this.rects.length < (this.n + 1) * 4) {
      const next = new Float64Array(this.rects.length * 2);
      next.set(this.rects);
      this.rects = next;
    }
    const id = this.n++;
    const o = id * 4;
    this.rects[o] = x;
    this.rects[o + 1] = y;
    this.rects[o + 2] = w;
    this.rects[o + 3] = h;
    const c0 = this.col(x);
    const c1 = this.col(x + w);
    const r0 = this.row(y);
    const r1 = this.row(y + h);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const idx = r * this.cols + c;
        const list = this.cells[idx]!;
        if (list.length === 0) this.touched.push(idx);
        list.push(id);
      }
    }
  }

  overlaps(x: number, y: number, w: number, h: number): boolean {
    const c0 = this.col(x);
    const c1 = this.col(x + w);
    const r0 = this.row(y);
    const r1 = this.row(y + h);
    const rects = this.rects;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const list = this.cells[r * this.cols + c]!;
        for (let i = 0; i < list.length; i++) {
          const o = list[i]! * 4;
          if (rectsOverlap(x, y, w, h, rects[o]!, rects[o + 1]!, rects[o + 2]!, rects[o + 3]!)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private col(x: number): number {
    const c = Math.floor((x - this.x0) / this.cell);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private row(y: number): number {
    const r = Math.floor((y - this.y0) / this.cell);
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }
}

function byPriority(a: LabelRequest, b: LabelRequest): number {
  return b.priority - a.priority || a.order - b.order;
}

const NODE_SIDES = [SIDE_BELOW, SIDE_RIGHT, SIDE_ABOVE, SIDE_LEFT] as const;
const POINT_SIDES = [SIDE_CENTER, SIDE_ABOVE, SIDE_BELOW] as const;
const FIXED_SIDES = [SIDE_CENTER] as const;

/** Top-left of a candidate box (written by `candidateBox`, so placement never allocates). */
export const candidate = { x: 0, y: 0 };

/** Top-left of `req`'s box for a candidate side, written into `candidate`. */
export function candidateBox(req: LabelRequest, side: number): typeof candidate {
  const { x, y, r, w, h } = req;
  let bx: number;
  let by: number;
  if (req.mode === MODE_FIXED) {
    bx = x - w / 2;
    by = y - h / 2;
  } else if (req.mode === MODE_POINT) {
    bx = x - w / 2;
    by = side === SIDE_ABOVE ? y - h - 4 : side === SIDE_BELOW ? y + 4 : y - h / 2;
  } else if (side === SIDE_RIGHT) {
    bx = x + r + LABEL_SIDE_GAP;
    by = y - h / 2;
  } else if (side === SIDE_ABOVE) {
    bx = x - w / 2;
    by = y - r - req.offset - h;
  } else if (side === SIDE_LEFT) {
    bx = x - r - LABEL_SIDE_GAP - w;
    by = y - h / 2;
  } else {
    bx = x - w / 2;
    by = y + r + req.offset;
  }
  candidate.x = bx;
  candidate.y = by;
  return candidate;
}

/**
 * Place `requests` (sorted in place by priority) against `grid`, which may already hold
 * obstacles. Sets `placed`, `side`, `bx`, `by` on each request and inserts placed boxes.
 * Returns the number of labels placed.
 */
export function placeLabels(
  requests: LabelRequest[],
  grid: CollisionGrid,
  clip: LabelClip,
): number {
  requests.sort(byPriority);
  let placed = 0;
  for (const req of requests) {
    req.placed = false;
    const sides =
      req.mode === MODE_FIXED ? FIXED_SIDES : req.mode === MODE_POINT ? POINT_SIDES : NODE_SIDES;
    for (const side of sides) {
      const { x: bx, y: by } = candidateBox(req, side);
      const { w, h } = req;
      if (bx + w < clip.x0 || bx > clip.x1 || by + h < clip.y0 || by > clip.y1) continue;
      if (clip.strictX && (bx < clip.x0 || bx + w > clip.x1)) continue;
      if (clip.strictY && (by < clip.y0 || by + h > clip.y1)) continue;
      if (grid.overlaps(bx, by, w, h)) continue;
      grid.insert(bx - LABEL_PAD, by - LABEL_PAD, w + 2 * LABEL_PAD, h + 2 * LABEL_PAD);
      req.placed = true;
      req.side = side;
      req.bx = bx;
      req.by = by;
      placed++;
      break;
    }
  }
  return placed;
}
