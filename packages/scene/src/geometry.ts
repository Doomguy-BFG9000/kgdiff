/**
 * Geometry shared by scene building, framing and the resolver: label boxes (widths from
 * `@kgdiff/layout`'s `estimateLabelWidth`, so scene bounds match the layout's label boxes),
 * rectangles, parallel-edge curvature and curve conventions.
 *
 * Curve convention (all renderers): an edge or glyph with curvature `c` from P1 to P2 is the
 * quadratic Bézier whose control point is `mid(P1, P2) + c · |P2 − P1| · n`, where
 * `n = (−dy, dx) / |P2 − P1|` (world space, y down). `c = 0` is a straight segment.
 */
import type { Rect } from '@kgdiff/core';
import { estimateLabelWidth } from '@kgdiff/layout';
import { LABEL, PARALLEL_CURVATURE } from './constants.js';

export const EMPTY_RECT: Rect = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

/** Mutable bounds accumulator (min / max), cheap to extend. */
export class BoundsBuilder {
  minX = Number.POSITIVE_INFINITY;
  minY = Number.POSITIVE_INFINITY;
  maxX = Number.NEGATIVE_INFINITY;
  maxY = Number.NEGATIVE_INFINITY;

  get empty(): boolean {
    return this.minX > this.maxX;
  }

  add(x0: number, y0: number, x1: number, y1: number): this {
    if (x0 < this.minX) this.minX = x0;
    if (y0 < this.minY) this.minY = y0;
    if (x1 > this.maxX) this.maxX = x1;
    if (y1 > this.maxY) this.maxY = y1;
    return this;
  }

  addRect(r: Rect): this {
    return this.add(r.x, r.y, r.x + r.width, r.y + r.height);
  }

  rect(fallback: Rect = EMPTY_RECT): Rect {
    if (this.empty) return fallback;
    return {
      x: this.minX,
      y: this.minY,
      width: this.maxX - this.minX,
      height: this.maxY - this.minY,
    };
  }
}

/**
 * World-space box of a node and its label(s) at zoom 1: the circle, plus the label centered
 * below it (`r + 5`), plus the struck old name 14 px lower when present.
 */
export function addNodeBox(
  b: BoundsBuilder,
  x: number,
  y: number,
  r: number,
  label: string,
  secondary: string | undefined,
): void {
  const half = Math.max(
    r,
    estimateLabelWidth(label, LABEL.size) / 2,
    secondary === undefined ? 0 : estimateLabelWidth(secondary, LABEL.oldSize) / 2,
  );
  const below =
    r +
    LABEL.offset +
    LABEL.size * LABEL.lineHeight +
    (secondary === undefined ? 0 : LABEL.secondaryGap);
  b.add(x - half, y - r, x + half, y + below);
}

export function rectCenter(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** One drawn line between two nodes, for parallel-curvature assignment. */
export interface EdgeForm {
  readonly a: number;
  readonly b: number;
  /** Ghost forms (an edge's before form) take slots only after every real line of the pair. */
  readonly ghost?: boolean;
}

/**
 * Slot `k` of a fan of lines: with an odd number of real lines the first is straight and the
 * rest alternate ±0.18·1, ±0.18·2, …; with an even number all are curved ±0.18·1, ±0.18·2, ….
 */
function slot(k: number, odd: boolean): number {
  if (odd) return k === 0 ? 0 : Math.ceil(k / 2) * PARALLEL_CURVATURE * (k % 2 === 1 ? 1 : -1);
  return (Math.floor(k / 2) + 1) * PARALLEL_CURVATURE * (k % 2 === 0 ? 1 : -1);
}

/**
 * Curvature for every form so that lines sharing an (unordered) node pair fan out. Real lines
 * are slotted first as if alone (a lone line stays straight), so their geometry never depends
 * on ghosts; ghosts continue the fan. Signs are expressed in each form's own direction so
 * A→B and B→A never overlap. Order within a group is the input order (deterministic). O(F).
 */
export function parallelCurvatures(forms: readonly EdgeForm[]): Float64Array {
  const out = new Float64Array(forms.length);
  const groups = new Map<string, number[]>();
  for (let i = 0; i < forms.length; i++) {
    const f = forms[i] as EdgeForm;
    const key = f.a <= f.b ? `${f.a},${f.b}` : `${f.b},${f.a}`;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, [i]);
    else g.push(i);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const real = members.filter((i) => forms[i]?.ghost !== true);
    const ghosts = members.filter((i) => forms[i]?.ghost === true);
    const odd = (real.length > 0 ? real.length : ghosts.length) % 2 === 1;
    const ordered = [...real, ...ghosts];
    for (let k = 0; k < ordered.length; k++) {
      const idx = ordered[k] as number;
      const f = forms[idx] as EdgeForm;
      const c = slot(k, odd);
      out[idx] = f.a <= f.b ? c : -c;
    }
  }
  return out;
}

/** Endpoints of a scene edge (after form s → t, before form sb → tb). */
export interface FormEdge {
  readonly s: number;
  readonly t: number;
  readonly sb: number;
  readonly tb: number;
}

/**
 * Curvatures of every edge's drawn form (after endpoints) and of its before form when that
 * differs (retargeted / carried ghosts; 0 otherwise).
 */
export function edgeCurvatures(edges: readonly FormEdge[]): {
  readonly primary: Float64Array;
  readonly ghost: Float64Array;
} {
  const forms: EdgeForm[] = [];
  for (const e of edges) forms.push({ a: e.s, b: e.t });
  const ghostSlot = new Int32Array(edges.length).fill(-1);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i] as FormEdge;
    if (e.sb !== e.s || e.tb !== e.t) {
      ghostSlot[i] = forms.length;
      forms.push({ a: e.sb, b: e.tb, ghost: true });
    }
  }
  const all = parallelCurvatures(forms);
  const primary = all.slice(0, edges.length);
  const ghost = new Float64Array(edges.length);
  for (let i = 0; i < edges.length; i++) {
    const k = ghostSlot[i] as number;
    if (k >= 0) ghost[i] = all[k] as number;
  }
  return { primary, ghost };
}
