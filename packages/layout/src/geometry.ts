/**
 * Extents and rectangles of node + label boxes.
 */
import type { Rect } from '@kgdiff/core';
import type { LayoutGraph } from './graph.js';

/** Gap kept between node / label boxes (world units). */
export const BOX_PADDING = 4;

export interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const emptyExtent = (): Extent => ({
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
});

/** Grow `extent` by node `i`'s visual box (circle + label block) centered at (x, y). */
export function includeNode(
  extent: Extent,
  graph: LayoutGraph,
  i: number,
  x: number,
  y: number,
): void {
  const hw = graph.boxHalfWidth[i]!;
  extent.minX = Math.min(extent.minX, x - hw);
  extent.maxX = Math.max(extent.maxX, x + hw);
  extent.minY = Math.min(extent.minY, y + graph.boxTop[i]!);
  extent.maxY = Math.max(extent.maxY, y + graph.boxBottom[i]!);
}

export function extentOf(
  graph: LayoutGraph,
  members: Iterable<number>,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): Extent {
  const extent = emptyExtent();
  for (const i of members) includeNode(extent, graph, i, x[i]!, y[i]!);
  return extent;
}

export const isEmpty = (e: Extent): boolean => !(e.maxX >= e.minX);

const floor2 = (v: number): number => Math.floor(v * 100) / 100 || 0;
const ceil2 = (v: number): number => Math.ceil(v * 100) / 100 || 0;

/** The smallest 0.01-aligned rectangle containing `extent` (zero rect when empty). */
export function toRect(extent: Extent): Rect {
  if (isEmpty(extent)) return Object.freeze({ x: 0, y: 0, width: 0, height: 0 });
  const x = floor2(extent.minX);
  const y = floor2(extent.minY);
  return Object.freeze({
    x,
    y,
    width: Math.round((ceil2(extent.maxX) - x) * 100) / 100,
    height: Math.round((ceil2(extent.maxY) - y) * 100) / 100,
  });
}
