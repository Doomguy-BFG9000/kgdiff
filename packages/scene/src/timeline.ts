/**
 * Review / replay order and the replay timeline (docs/algorithms.md §10).
 */
import type { HunkKind, Rect, ReplayPhase } from '@kgdiff/core';
import { TIMELINE } from './constants.js';
import { BoundsBuilder } from './geometry.js';
import type { Timeline, TimelineChapter, TimelineWindow } from './types.js';

export const PHASE_ORDER: readonly ReplayPhase[] = ['remove', 'restructure', 'modify', 'add'];

export interface TourHunk {
  readonly phase: ReplayPhase;
  /** Changed nodes + edges. */
  readonly size: number;
  /** Default review order from core (tie-breaker). */
  readonly order: number;
  /** Anchor position. */
  readonly x: number;
  readonly y: number;
  /** Indices (into the same array) of hunks that must come first (core `Hunk.requires`). */
  readonly requires: readonly number[];
}

/** Lexicographic (squared distance, default order) comparison: true when a beats b. */
const better = (d2a: number, oa: number, d2b: number, ob: number): boolean =>
  d2a < d2b || (d2a === d2b && oa < ob);

/**
 * Uniform grid over a set of points supporting "nearest eligible point" queries. Points start
 * ineligible; `activate` makes one eligible (its requirements are placed), `take` removes it.
 * Ties are broken by `order`. Expected O(1) cells per query for spread points.
 */
class NearestGrid {
  private readonly minX: number;
  private readonly minY: number;
  private readonly cw: number;
  private readonly ch: number;
  private readonly gw: number;
  private readonly gh: number;
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;
  private readonly cellAlive: Int32Array;
  private readonly alive: Uint8Array;
  private remaining: number;

  constructor(
    private readonly items: readonly TourHunk[],
    private readonly members: readonly number[],
  ) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const m of members) {
      const it = items[m] as TourHunk;
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x);
      maxY = Math.max(maxY, it.y);
    }
    const side = Math.max(1, Math.ceil(Math.sqrt(members.length)));
    this.gw = side;
    this.gh = side;
    this.minX = minX;
    this.minY = minY;
    // Guard against zero / underflowing extents (e.g. coordinates a denormal apart).
    const cw = (maxX - minX) / side;
    const ch = (maxY - minY) / side;
    this.cw = cw > 0 && Number.isFinite(cw) ? cw : 1;
    this.ch = ch > 0 && Number.isFinite(ch) ? ch : 1;
    const cells = this.gw * this.gh;
    const counts = new Int32Array(cells + 1);
    const cellOf = new Int32Array(members.length);
    for (let k = 0; k < members.length; k++) {
      const it = items[members[k] as number] as TourHunk;
      const c = this.cellIndex(it.x, it.y);
      cellOf[k] = c;
      counts[c + 1] = (counts[c + 1] as number) + 1;
    }
    for (let c = 0; c < cells; c++)
      counts[c + 1] = (counts[c + 1] as number) + (counts[c] as number);
    this.cellStart = counts;
    const fill = counts.slice(0, cells);
    this.cellItems = new Int32Array(members.length);
    for (let k = 0; k < members.length; k++) {
      const c = cellOf[k] as number;
      this.cellItems[fill[c] as number] = k;
      fill[c] = (fill[c] as number) + 1;
    }
    this.cellAlive = new Int32Array(cells);
    this.alive = new Uint8Array(members.length);
    this.remaining = 0;
  }

  private cellX(x: number): number {
    const c = Math.floor((x - this.minX) / this.cw);
    return c >= 0 ? (c >= this.gw ? this.gw - 1 : c) : 0;
  }

  private cellY(y: number): number {
    const c = Math.floor((y - this.minY) / this.ch);
    return c >= 0 ? (c >= this.gh ? this.gh - 1 : c) : 0;
  }

  private cellIndex(x: number, y: number): number {
    return this.cellY(y) * this.gw + this.cellX(x);
  }

  get size(): number {
    return this.remaining;
  }

  /** Make member slot `k` (index into `members`) eligible. */
  activate(k: number): void {
    if (this.alive[k] === 1) return;
    this.alive[k] = 1;
    this.remaining++;
    const it = this.items[this.members[k] as number] as TourHunk;
    const c = this.cellIndex(it.x, it.y);
    this.cellAlive[c] = (this.cellAlive[c] as number) + 1;
  }

  /** Remove eligible member slot `k`. */
  take(k: number): void {
    if (this.alive[k] === 0) return;
    this.alive[k] = 0;
    this.remaining--;
    const it = this.items[this.members[k] as number] as TourHunk;
    const c = this.cellIndex(it.x, it.y);
    this.cellAlive[c] = (this.cellAlive[c] as number) - 1;
  }

  /** Eligible member slot with the largest size (ties → lowest order), or -1. O(members). */
  largest(): number {
    let best = -1;
    for (let k = 0; k < this.members.length; k++) {
      if (this.alive[k] === 0) continue;
      const a = this.items[this.members[k] as number] as TourHunk;
      const b = best < 0 ? undefined : (this.items[this.members[best] as number] as TourHunk);
      if (b === undefined || a.size > b.size || (a.size === b.size && a.order < b.order)) best = k;
    }
    return best;
  }

  /** Member slot of the nearest remaining point (ties → lowest order), or -1. */
  nearest(x: number, y: number): number {
    if (this.remaining === 0) return -1;
    const qx = this.cellX(x);
    const qy = this.cellY(y);
    const minCell = Math.min(this.cw, this.ch);
    let best = -1;
    let bestD2 = Number.POSITIVE_INFINITY;
    let bestOrder = Number.POSITIVE_INFINITY;
    const maxRing = Math.max(this.gw, this.gh);
    for (let ring = 0; ring <= maxRing; ring++) {
      const x0 = qx - ring;
      const x1 = qx + ring;
      const y0 = qy - ring;
      const y1 = qy + ring;
      for (let cy = y0; cy <= y1; cy++) {
        if (cy < 0 || cy >= this.gh) continue;
        const edgeRow = cy === y0 || cy === y1;
        for (let cx = x0; cx <= x1; cx += edgeRow ? 1 : x1 - x0 || 1) {
          if (cx < 0 || cx >= this.gw) continue;
          const c = cy * this.gw + cx;
          if (this.cellAlive[c] === 0) continue;
          for (let p = this.cellStart[c] as number; p < (this.cellStart[c + 1] as number); p++) {
            const k = this.cellItems[p] as number;
            if (this.alive[k] === 0) continue;
            const it = this.items[this.members[k] as number] as TourHunk;
            const dx = it.x - x;
            const dy = it.y - y;
            const d2 = dx * dx + dy * dy;
            if (better(d2, it.order, bestD2, bestOrder)) {
              best = k;
              bestD2 = d2;
              bestOrder = it.order;
            }
          }
        }
      }
      // Every cell at ring ≥ ring + 1 is at least ring·minCell away; strict so ties keep searching.
      const bound = ring * minCell;
      if (best >= 0 && bestD2 < bound * bound) break;
    }
    return best;
  }
}

/**
 * Order hunks as a short spatial tour (docs/algorithms.md §10) that respects `requires`:
 *
 * - Only *ready* hunks (every requirement already placed) are candidates.
 * - Phase is a preference, not a barrier: the candidates are the ready hunks of the earliest
 *   phase that has any, so a hunk may follow a later-phase hunk it requires.
 * - The very first hunk is the largest candidate; every next one is the candidate nearest the
 *   previous anchor (greedy nearest neighbour), which also starts each phase near where the
 *   previous one ended.
 * - Ties are broken by the default `order`. Unknown or self requirements are ignored; a cycle
 *   (never produced by core) is broken by releasing its lowest-`order` hunk.
 *
 * Returns indices into `hunks`. ~O((H + R) √H) worst case, near-linear typically.
 */
export function tourOrder(hunks: readonly TourHunk[]): number[] {
  const H = hunks.length;
  const phaseRank = (p: ReplayPhase): number => PHASE_ORDER.indexOf(p);
  // Per-phase grids over all hunks of the phase; slots activate once their hunk is ready.
  const members: number[][] = PHASE_ORDER.map(() => []);
  for (let i = 0; i < H; i++) members[phaseRank((hunks[i] as TourHunk).phase)]?.push(i);
  for (const m of members)
    m.sort((a, b) => (hunks[a] as TourHunk).order - (hunks[b] as TourHunk).order);
  const grids = members.map((m) => new NearestGrid(hunks, m));
  const slotOf = new Int32Array(H);
  for (const m of members) for (let k = 0; k < m.length; k++) slotOf[m[k] as number] = k;
  // Pending requirement counts and reverse edges (deduplicated).
  const pending = new Int32Array(H);
  const dependents: number[][] = Array.from({ length: H }, () => []);
  for (let i = 0; i < H; i++) {
    for (const r of new Set((hunks[i] as TourHunk).requires)) {
      if (r === i || r < 0 || r >= H) continue;
      pending[i] = (pending[i] as number) + 1;
      (dependents[r] as number[]).push(i);
    }
  }
  const placed = new Uint8Array(H);
  const activate = (i: number): void => {
    grids[phaseRank((hunks[i] as TourHunk).phase)]?.activate(slotOf[i] as number);
  };
  for (let i = 0; i < H; i++) if (pending[i] === 0) activate(i);

  const result: number[] = [];
  let last: TourHunk | null = null;
  while (result.length < H) {
    let g = grids.findIndex((grid) => grid.size > 0);
    if (g < 0) {
      // A requirement cycle: release the unplaced hunk with the lowest default order.
      let pick = -1;
      for (let i = 0; i < H; i++) {
        if (placed[i] === 1) continue;
        if (pick < 0 || (hunks[i] as TourHunk).order < (hunks[pick] as TourHunk).order) pick = i;
      }
      pending[pick] = 0;
      activate(pick);
      g = phaseRank((hunks[pick] as TourHunk).phase);
    }
    const grid = grids[g] as NearestGrid;
    const slot = last === null ? grid.largest() : grid.nearest(last.x, last.y);
    grid.take(slot);
    const idx = (members[g] as number[])[slot] as number;
    placed[idx] = 1;
    result.push(idx);
    last = hunks[idx] as TourHunk;
    for (const d of dependents[idx] as number[]) {
      if (placed[d] === 1) continue;
      pending[d] = (pending[d] as number) - 1;
      if (pending[d] === 0) activate(d);
    }
  }
  return result;
}

/**
 * Chapter of each hunk (hunks in a requirement-respecting order, e.g. the tour) for `chapters`
 * mode: one chapter per phase present, in replay order; a hunk that requires a hunk of a later
 * chapter moves to that chapter (the earliest chapter not before any requirement). O(H + R).
 */
export function chapterPlan(
  hunks: readonly { readonly phase: ReplayPhase; readonly requires: readonly number[] }[],
): Int32Array {
  const present = PHASE_ORDER.filter((p) => hunks.some((h) => h.phase === p));
  const chapter = new Int32Array(hunks.length);
  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i] as (typeof hunks)[number];
    let c = present.indexOf(h.phase);
    for (const r of h.requires) {
      // Requirements placed earlier in the order have their chapter already.
      if (r >= 0 && r < i) c = Math.max(c, chapter[r] as number);
    }
    chapter[i] = c;
  }
  return chapter;
}

const KIND_FACTOR: Readonly<Record<HunkKind, number>> = {
  add: 0.85,
  remove: 0.85,
  modify: 0.8,
  relations: 0.95,
  merge: 1.3,
  split: 1.3,
};

/** Times are rounded to µs so results do not depend on last-ulp differences between engines. */
const roundMs = (ms: number): number => Math.round(ms * 1000) / 1000;

/** Play time of one hunk in `hunks` mode: `pace · kindFactor · clamp(√size, 1, 2.2)`. */
export function hunkDuration(kind: HunkKind, size: number, pace: number): number {
  return roundMs(pace * KIND_FACTOR[kind] * Math.min(2.2, Math.max(1, Math.sqrt(size))));
}

/** Length of a chapter of `n` hunks in `chapters` mode: `pace · clamp(1.2 + log₂ n, 1.2, 4)`. */
export function chapterDuration(n: number, pace: number): number {
  return roundMs(pace * Math.min(4, Math.max(1.2, 1.2 + Math.log2(Math.max(1, n)))));
}

export interface TimelineHunk {
  readonly kind: HunkKind;
  readonly phase: ReplayPhase;
  readonly size: number;
  readonly bounds: Rect;
  /** Indices (into the same array) of hunks that must play first. */
  readonly requires: readonly number[];
}

function chapterBounds(hunks: readonly TimelineHunk[], members: readonly number[]): Rect {
  const b = new BoundsBuilder();
  for (const h of members) b.addRect((hunks[h] as TimelineHunk).bounds);
  return b.rect();
}

export const timelineMode = (hunkCount: number, chapterThreshold: number): Timeline['mode'] =>
  hunkCount > chapterThreshold ? 'chapters' : 'hunks';

/**
 * Replay schedule for hunks already in play order (docs/algorithms.md §10). The order must
 * respect `requires` (the tour does; in `chapters` mode, stable-sort the tour by `chapterPlan`).
 *
 * - `hunks` mode (≤ `chapterThreshold` hunks): one hunk at a time, 160 ms apart, so every hunk
 *   starts after its requirements end. Chapters are the consecutive runs of one phase, reported
 *   for scrubber grouping.
 * - `chapters` mode: one chapter per `chapterPlan` value, of length
 *   `pace · clamp(1.2 + log₂ n, 1.2, 4)`; its hunks play together, staggered in play order over
 *   `35% · (n − 1) / n` of the chapter, so a hunk requiring another of its chapter starts later.
 *   A chapter's `phase` is the phase it was planned for. Chapters are 160 ms apart.
 */
export function buildTimeline(
  hunks: readonly TimelineHunk[],
  pace: number,
  chapterThreshold: number,
): Timeline {
  const mode = timelineMode(hunks.length, chapterThreshold);
  const windows: TimelineWindow[] = [];
  const chapters: TimelineChapter[] = [];
  const plan = mode === 'chapters' ? chapterPlan(hunks) : null;
  const present = PHASE_ORDER.filter((p) => hunks.some((h) => h.phase === p));
  // Runs of consecutive hunks sharing a phase (hunks mode) or a planned chapter (chapters mode).
  const runs: { key: number; phase: ReplayPhase; members: number[] }[] = [];
  for (let h = 0; h < hunks.length; h++) {
    const hunk = hunks[h] as TimelineHunk;
    const key = plan === null ? PHASE_ORDER.indexOf(hunk.phase) : (plan[h] as number);
    const run = runs[runs.length - 1];
    if (run !== undefined && run.key === key) run.members.push(h);
    else {
      const phase = plan === null ? hunk.phase : (present[key] ?? hunk.phase);
      runs.push({ key, phase, members: [h] });
    }
  }
  let cursor = 0;
  for (let c = 0; c < runs.length; c++) {
    const { phase, members: run } = runs[c] as (typeof runs)[number];
    if (c > 0) cursor = roundMs(cursor + TIMELINE.gap);
    const start = cursor;
    if (mode === 'hunks') {
      for (let k = 0; k < run.length; k++) {
        if (k > 0) cursor = roundMs(cursor + TIMELINE.gap);
        const h = hunks[run[k] as number] as TimelineHunk;
        const end = roundMs(cursor + hunkDuration(h.kind, h.size, pace));
        windows.push({ hunk: run[k] as number, start: cursor, end, chapter: c });
        cursor = end;
      }
    } else {
      const n = run.length;
      const length = chapterDuration(n, pace);
      const span = (TIMELINE.maxStagger * length * (n - 1)) / n;
      const step = n > 1 ? span / (n - 1) : 0;
      const windowLength = length - span;
      for (let k = 0; k < n; k++) {
        const ws = roundMs(start + k * step);
        windows.push({
          hunk: run[k] as number,
          start: ws,
          end: roundMs(ws + windowLength),
          chapter: c,
        });
      }
      cursor = roundMs(start + length);
    }
    chapters.push({ phase, start, end: cursor, hunks: run, bounds: chapterBounds(hunks, run) });
  }
  return { duration: cursor, windows, chapters, mode };
}
