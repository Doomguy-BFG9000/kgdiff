/**
 * Background and dot grid.
 *
 * Dots (1.2 px) sit every 24 world units. When their screen spacing drops below 14.4 px they
 * fade out (gone at 9.6 px, i.e. zoom 0.4) while the 4× coarser level stays, recursively, so the
 * grid never moirés at any zoom. Each level is ONE `fillRect` with a repeating pattern whose
 * tile is rasterized at the exact device-pixel spacing (cost independent of dot count).
 */
import type { Theme } from '@kgdiff/scene';
import type { Ctx2D, Surface, SurfaceFactory } from '../ctx.js';
import { smoothstep, TAU } from '../math.js';
import type { View } from './view.js';

export const GRID_SPACING = 24;
export const GRID_DOT = 1.2;
const FADE_LO = 9.6;
const FADE_HI = 14.4;

/** Levels to draw at zoom `k`: [spacing (world), alpha, omit every 4th dot] pairs, coarse first. */
export function gridLevels(k: number): { spacing: number; alpha: number; nested: boolean }[] {
  if (!(k > 0)) return [];
  let spacing = GRID_SPACING;
  for (let i = 0; i < 12 && spacing * k < FADE_LO; i++) spacing *= 4;
  const a = smoothstep(FADE_LO, FADE_HI, spacing * k);
  if (a >= 0.999) return [{ spacing, alpha: 1, nested: false }];
  return [
    { spacing: spacing * 4, alpha: 1, nested: false },
    { spacing, alpha: a, nested: true },
  ];
}

interface Tile {
  surface: Surface;
  key: string;
  pattern: CanvasPattern | null;
}

/** Pattern tiles per grid level, re-rasterized only when the device spacing changes. */
export class GridTiles {
  private readonly tiles: (Tile | null)[] = [null, null];

  constructor(private readonly factory: SurfaceFactory) {}

  clear(): void {
    this.tiles[0] = null;
    this.tiles[1] = null;
  }

  /**
   * Pattern for a tile `size` device px wide holding `m × m` dots (the first omitted when
   * `nested`, as the coarser level draws it).
   */
  pattern(
    ctx: Ctx2D,
    slot: number,
    size: number,
    m: number,
    nested: boolean,
    color: string,
    dotR: number,
  ): CanvasPattern | null {
    const key = `${size}|${m}|${nested}|${color}|${dotR}`;
    let tile = this.tiles[slot] ?? null;
    if (tile?.key === key) return tile.pattern;
    if (!tile) {
      const surface = this.factory(size, size);
      if (!surface) return null;
      tile = { surface, key: '', pattern: null };
      this.tiles[slot] = tile;
    }
    const { canvas, ctx: tctx } = tile.surface;
    canvas.width = size;
    canvas.height = size;
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, size, size);
    tctx.fillStyle = color;
    tctx.beginPath();
    const step = size / m;
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < m; i++) {
        if (nested && i === 0 && j === 0) continue;
        const cx = (i + 0.5) * step;
        const cy = (j + 0.5) * step;
        tctx.moveTo(cx + dotR, cy);
        tctx.arc(cx, cy, dotR, 0, TAU);
      }
    }
    tctx.fill();
    tile.key = key;
    tile.pattern = ctx.createPattern(canvas, 'repeat');
    return tile.pattern;
  }
}

export function drawBackground(
  ctx: Ctx2D,
  v: View,
  theme: Theme,
  tiles: GridTiles | null,
  spotlight: number,
): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.canvas.background;
  ctx.fillRect(0, 0, v.width, v.height);
  if (!tiles) return;
  const dim = 1 - 0.5 * Math.min(1, Math.max(0, Number.isFinite(spotlight) ? spotlight : 0));
  const levels = gridLevels(v.k);
  const dpr = v.dpr;
  const W = Math.ceil(v.width * dpr);
  const H = Math.ceil(v.height * dpr);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let slot = 0; slot < levels.length; slot++) {
    const level = levels[slot]!;
    const m = level.nested ? 4 : 1;
    const period = m * level.spacing * v.k * dpr; // device px between tile repeats
    const size = Math.max(2, Math.round(period));
    const pattern = tiles.pattern(
      ctx,
      slot,
      size,
      m,
      level.nested,
      theme.canvas.grid,
      (GRID_DOT / 2) * dpr,
    );
    if (!pattern || typeof pattern.setTransform !== 'function') continue;
    const s = period / size;
    // Align the first dot of the tile (at half a step) with world (0, 0).
    const half = (0.5 * period) / m;
    const e = (((v.ox * dpr - half) % period) + period) % period;
    const f = (((v.oy * dpr - half) % period) + period) % period;
    pattern.setTransform({ a: s, b: 0, c: 0, d: s, e, f });
    ctx.globalAlpha = level.alpha * dim;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}
