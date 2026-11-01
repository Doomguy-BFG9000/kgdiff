/**
 * Camera framing around floating chrome. The legend, minimap, replay transport and top chips
 * float over the canvas; a fit or flight must keep its target clear of them without wasting the
 * rest of the canvas. Each obstacle can be avoided through one side (an inset); all assignments
 * are tried (4ⁿ, n ≤ ~6 visible chips) and the one that shows `bounds` largest wins, ties going
 * to the free region closest to the canvas center. Pure; all sizes in canvas px.
 */
import type { Rect } from '@kgdiff/core';

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** The canvas size and the chrome floating over it (rects relative to the canvas). */
export interface ChromeLayout {
  readonly width: number;
  readonly height: number;
  readonly obstacles: readonly Rect[];
}

export interface CameraTarget {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

/** Breathing room around the target, px. */
export const FRAME_PADDING = 24;
/** Gap kept between the target and an obstacle, px. */
const OBSTACLE_GAP = 8;
/** Zooms within this ratio of the best count as equal (then the most centered region wins). */
const ZOOM_TOLERANCE = 0.94;
/** Above this many obstacles only the largest are considered (keeps the search tiny). */
const MAX_OBSTACLES = 6;
const MIN_FREE = 48;

export const NO_INSETS: Insets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** Zoom that fits `bounds` into the canvas minus `insets` (unclamped; 0 when nothing fits). */
export function fitZoom(bounds: Rect, width: number, height: number, insets: Insets): number {
  const w = width - insets.left - insets.right;
  const h = height - insets.top - insets.bottom;
  if (w < MIN_FREE || h < MIN_FREE) return 0;
  const kw = bounds.width > 0 ? w / bounds.width : Number.POSITIVE_INFINITY;
  const kh = bounds.height > 0 ? h / bounds.height : Number.POSITIVE_INFINITY;
  return Math.min(kw, kh);
}

/**
 * Insets (padding included) that keep `bounds` clear of every obstacle while showing it as
 * large as possible, the free region as centered as possible. Obstacles outside the canvas are
 * ignored. With no feasible assignment, only the padding is returned.
 */
export function chromeInsets(
  bounds: Rect,
  layout: ChromeLayout,
  padding = FRAME_PADDING,
  maxZoom = Number.POSITIVE_INFINITY,
): Insets {
  const { width: W, height: H } = layout;
  const base: Insets = { top: padding, right: padding, bottom: padding, left: padding };
  const obstacles = layout.obstacles
    .filter(
      (r) =>
        r.width > 0 &&
        r.height > 0 &&
        r.x < W &&
        r.y < H &&
        r.x + r.width > 0 &&
        r.y + r.height > 0,
    )
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, MAX_OBSTACLES);
  // The inset each obstacle needs on each side to be avoided through it.
  const needs = obstacles.map((r) => [
    r.y + r.height + OBSTACLE_GAP, // top
    W - r.x + OBSTACLE_GAP, // right
    H - r.y + OBSTACLE_GAP, // bottom
    r.x + r.width + OBSTACLE_GAP, // left
  ]);
  const cap = (k: number): number => Math.min(k, maxZoom);
  let best = base;
  let bestK = -1;
  let bestOff = Number.POSITIVE_INFINITY;
  const count = 4 ** obstacles.length;
  for (let code = 0; code < count; code++) {
    let top = padding;
    let right = padding;
    let bottom = padding;
    let left = padding;
    let c = code;
    for (const need of needs) {
      const side = c & 3;
      c >>= 2;
      const v = need[side] as number;
      if (side === 0) top = Math.max(top, v);
      else if (side === 1) right = Math.max(right, v);
      else if (side === 2) bottom = Math.max(bottom, v);
      else left = Math.max(left, v);
    }
    const insets = { top, right, bottom, left };
    const k = cap(fitZoom(bounds, W, H, insets));
    if (!(k > 0)) continue;
    // Distance of the free region's center from the canvas center.
    const off = Math.hypot((left - right) / 2, (top - bottom) / 2);
    const better =
      k > bestK / ZOOM_TOLERANCE || (k >= bestK * ZOOM_TOLERANCE && off < bestOff - 0.5);
    if (bestK < 0 || better) {
      best = insets;
      bestK = Math.max(k, bestK);
      bestOff = off;
    }
  }
  return best;
}

/**
 * Where a fit lands: `bounds` centered in the canvas minus `insets`, zoom clamped to
 * [minK, maxK] (the renderer's `fitState` with no extra safe area). Screen = (world − (x, y))·k +
 * canvas center.
 */
export function frameTarget(
  bounds: Rect,
  width: number,
  height: number,
  insets: Insets,
  minK: number,
  maxK: number,
): CameraTarget {
  const fit = fitZoom(bounds, width, height, insets);
  const k = Math.min(maxK, Math.max(minK, fit > 0 ? fit : maxK));
  const sx = insets.left + (width - insets.left - insets.right) / 2;
  const sy = insets.top + (height - insets.top - insets.bottom) / 2;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return { x: cx - (sx - width / 2) / k, y: cy - (sy - height / 2) / k, k };
}

/** The part of `view` (world units) not covered by `insets` at zoom `k`. */
export function freeView(view: Rect, k: number, insets: Insets): Rect {
  return {
    x: view.x + insets.left / k,
    y: view.y + insets.top / k,
    width: Math.max(0, view.width - (insets.left + insets.right) / k),
    height: Math.max(0, view.height - (insets.top + insets.bottom) / k),
  };
}
