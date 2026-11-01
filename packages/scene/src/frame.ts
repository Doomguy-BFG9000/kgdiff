/**
 * Camera targets.
 */
import type { Rect } from '@kgdiff/core';
import { BoundsBuilder } from './geometry.js';
import type { Scene } from './types.js';

/** Relative breathing room added on each side (labels already sit inside hunk bounds). */
const PAD_RATIO = 0.06;
/** Minimum padding on each side, world units. */
const MIN_PAD = 16;
/** Smallest framed extent, world units: a one-node hunk still shows its neighbourhood. */
const MIN_EXTENT = 160;

/**
 * Camera target for a hunk / chapter / whole scene: the union of the hunks' bounds (or the
 * scene bounds when `hunks` is omitted, empty or has no valid index), padded by
 * `max(16, 6% of the larger side)` per side and grown to at least 160 × 160 world units,
 * centered. UI chrome is reserved by the renderer's `safeArea`.
 */
export function frameBounds(scene: Scene, hunks?: readonly number[]): Rect {
  let rect = scene.bounds;
  if (hunks !== undefined && hunks.length > 0) {
    const b = new BoundsBuilder();
    for (const h of hunks) {
      const hunk = scene.hunks[h];
      if (hunk !== undefined) b.addRect(hunk.bounds);
    }
    rect = b.rect(scene.bounds);
  }
  const pad = Math.max(MIN_PAD, PAD_RATIO * Math.max(rect.width, rect.height));
  const width = Math.max(MIN_EXTENT, rect.width + 2 * pad);
  const height = Math.max(MIN_EXTENT, rect.height + 2 * pad);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}
