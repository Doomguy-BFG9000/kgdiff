/**
 * Paints one frame (or a swipe pair) into a `Ctx2D`. Pass order (docs/visual-language.md):
 * background + grid → collapsed pills → edges → glyph arcs → halos → nodes (+ rings, pulses)
 * → pivots → badges → labels. Swipe draws the background once, then each side clipped to its
 * half with its own label placement.
 */

import type { FrameVisuals, Theme } from '@kgdiff/scene';
import { LabelAtlas } from './atlas.js';
import type { Ctx2D, SurfaceFactory } from './ctx.js';
import { drawBackground, GridTiles } from './draw/background.js';
import { BadgePass } from './draw/badges.js';
import { drawCollapsed } from './draw/collapsed.js';
import { drawEdges } from './draw/edges.js';
import { drawGlyphArcs, drawPivots } from './draw/glyphs.js';
import { drawHalos, HaloSprites } from './draw/halos.js';
import { LabelPass } from './draw/labels.js';
import { drawNodes } from './draw/nodes.js';
import type { View } from './draw/view.js';
import { type FrameCache, Interner } from './frame-cache.js';
import type { CameraState, SplitFrame } from './index.js';
import { CollisionGrid } from './labels.js';
import { clamp, snap } from './math.js';
import { createStats, type PaintStats, resetStats } from './paint-stats.js';
import { Fonts, TextMeasurer } from './text.js';

export function isSplit(frame: FrameVisuals | SplitFrame): frame is SplitFrame {
  return 'before' in frame && 'after' in frame && 'split' in frame;
}

/** Divider position (css px, on the device-pixel grid) for a split fraction. */
export function splitX(split: number, width: number, dpr: number): number {
  return snap(clamp(Number.isFinite(split) ? split : 0.5, 0, 1) * width, dpr);
}

/** Caches that live as long as a renderer: fonts, text metrics, sprites, atlas, tiles. */
export class Resources {
  readonly fonts: Fonts;
  readonly measurer: TextMeasurer;
  readonly atlas: LabelAtlas | null;
  readonly halos: HaloSprites;
  readonly tiles: GridTiles;
  readonly interner = new Interner();
  private dpr = 0;
  private theme: Theme;

  constructor(
    readonly factory: SurfaceFactory,
    theme: Theme,
    fallbackMeasureCtx: Ctx2D | null,
  ) {
    this.theme = theme;
    this.fonts = new Fonts(theme);
    // A private context for measuring, so measuring never disturbs drawing state.
    this.measurer = new TextMeasurer(factory(1, 1)?.ctx ?? fallbackMeasureCtx);
    this.atlas = new LabelAtlas(factory);
    this.halos = new HaloSprites(factory);
    this.tiles = new GridTiles(factory);
  }

  setTheme(theme: Theme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.fonts.setTheme(theme);
    this.measurer.clear();
    this.halos.clear();
    this.tiles.clear();
    this.atlas?.configure(this.dpr || 1, theme.canvas.background);
  }

  /** Called before painting: re-keys pixel-ratio dependent caches. */
  prepare(dpr: number): void {
    if (dpr === this.dpr) return;
    this.dpr = dpr;
    this.tiles.clear();
    this.atlas?.configure(dpr, this.theme.canvas.background);
  }

  /** Web fonts finished loading: metrics and rasterized labels are stale. */
  fontsChanged(): void {
    this.measurer.clear();
    this.atlas?.wipe();
  }
}

export interface PaintTarget {
  readonly ctx: Ctx2D;
  /** css px */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export interface PaintCaches {
  readonly main: FrameCache;
  readonly before: FrameCache;
  readonly after: FrameCache;
}

/** New label rasterizations per frame (≈ 3–5 ms of text rendering on mid-range hardware). */
export const LABEL_RASTER_BUDGET = 160;

export class Painter {
  readonly stats: PaintStats = createStats();
  /** Override for exports, which must contain every label in one paint. */
  rasterBudget = LABEL_RASTER_BUDGET;
  private readonly labels = new LabelPass();
  private readonly badges = new BadgePass();
  private readonly grid = new CollisionGrid();
  private readonly view: View = {
    k: 1,
    ox: 0,
    oy: 0,
    width: 0,
    height: 0,
    dpr: 1,
    x0: 0,
    x1: 0,
    y0: 0,
    y1: 0,
    strictX: false,
    stats: this.stats,
  };

  constructor(private readonly res: Resources) {}

  paint(
    target: PaintTarget,
    cam: CameraState,
    frame: FrameVisuals | SplitFrame | null,
    caches: PaintCaches,
    version: number,
    theme: Theme,
    grid: boolean,
  ): PaintStats {
    const { ctx, width, height, dpr } = target;
    const v = this.view;
    resetStats(this.stats);
    this.res.prepare(dpr);
    this.res.atlas?.beginFrame(this.rasterBudget);
    v.k = cam.k;
    v.ox = width / 2 - cam.x * cam.k;
    v.oy = height / 2 - cam.y * cam.k;
    v.width = width;
    v.height = height;
    v.dpr = dpr;
    v.x0 = 0;
    v.x1 = width;
    v.y0 = 0;
    v.y1 = height;
    v.strictX = false;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    const split = frame !== null && isSplit(frame);
    const spotlight =
      frame === null
        ? 0
        : split
          ? Math.max(frame.before.spotlight, frame.after.spotlight)
          : frame.spotlight;
    drawBackground(ctx, v, theme, grid ? this.res.tiles : null, spotlight);
    this.stats.phases.push('background');
    if (frame === null) return this.stats;

    if (!split) {
      caches.main.sync(frame, version, this.res.interner);
      this.layers(ctx, frame, caches.main, theme);
      return this.stats;
    }

    const sx = splitX(frame.split, width, dpr);
    caches.before.sync(frame.before, version, this.res.interner);
    caches.after.sync(frame.after, version, this.res.interner);
    if (sx > 0) {
      v.x0 = 0;
      v.x1 = sx;
      v.strictX = true;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, sx, height);
      ctx.clip();
      this.layers(ctx, frame.before, caches.before, theme);
      ctx.restore();
    }
    if (sx < width) {
      v.x0 = sx;
      v.x1 = width;
      v.strictX = true;
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, 0, width - sx, height);
      ctx.clip();
      this.layers(ctx, frame.after, caches.after, theme);
      ctx.restore();
    }
    if (sx > 0 && sx < width) {
      // 1 css px divider on whole device pixels.
      const w = Math.max(1, Math.round(dpr));
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.surface.borderStrong;
      ctx.fillRect(Math.round(sx * dpr - w / 2) / dpr, 0, w / dpr, height);
    }
    this.stats.phases.push('divider');
    return this.stats;
  }

  private layers(ctx: Ctx2D, frame: FrameVisuals, cache: FrameCache, theme: Theme): void {
    const v = this.view;
    const res = this.res;
    const phases = this.stats.phases;
    // Screen-space layout first: node discs and badges are obstacles; labels and pills compete
    // for the rest by priority. Drawing then follows the documented pass order.
    this.labels.begin(frame, cache, v, this.grid);
    this.badges.layout(frame, cache, v, res.fonts, res.measurer, this.grid);
    this.labels.place(frame, cache, v, res, this.grid);
    drawCollapsed(ctx, frame.collapsed, cache.pillShown, v, theme, res.fonts, res.measurer);
    phases.push('collapsed');
    drawEdges(ctx, frame, cache, v);
    phases.push('edges');
    drawGlyphArcs(ctx, frame, cache, v, theme, res.fonts);
    phases.push('glyphs');
    drawHalos(ctx, frame, cache, v, theme, res.halos);
    phases.push('halos');
    drawNodes(ctx, frame, cache, v, theme);
    phases.push('nodes');
    drawPivots(ctx, frame, cache, v, theme);
    phases.push('pivots');
    this.badges.draw(ctx, frame, theme);
    phases.push('badges');
    this.stats.labels += this.labels.draw(ctx, v, theme, res);
    this.stats.deferredLabels = res.atlas?.deferred ?? 0;
    phases.push('labels');
  }
}
