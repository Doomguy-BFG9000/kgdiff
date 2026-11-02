/**
 * Label footprint: what a frame covers at a given zoom with every label in its first-choice
 * spot, for fits that leave room for the labels. Labels keep their pixel size, so the world they
 * cover grows as the camera zooms out, and a fit computed from node positions alone clips the
 * labels of the outermost nodes. Labels pushed beside or above their node by a neighbour are not
 * modelled (their spot depends on the zoom in jumps); with `setLabelsInside` the renderer keeps
 * those inside the canvas or leaves them out.
 */
import type { Rect } from '@kgdiff/core';
import type { FrameVisuals, Theme } from '@kgdiff/scene';
import { domSurfaceFactory } from './ctx.js';
import { BadgePass } from './draw/badges.js';
import { LabelPass, type LabelResources } from './draw/labels.js';
import { NODE_MIN_R, type View } from './draw/view.js';
import { FrameCache, Interner } from './frame-cache.js';
import { CollisionGrid } from './labels.js';
import { createStats } from './paint-stats.js';
import { Fonts, LABEL_MAX_WIDTH, TextMeasurer } from './text.js';

/** Room around the discs for the labels, px (a label is at most this wide). */
const ROOM = LABEL_MAX_WIDTH;

export interface LabelFootprint {
  /**
   * World rect covering the visible node discs and every label, pill and badge shown at zoom
   * `k`, each label centred below its node (edge labels and pills on their anchor). Grows as `k`
   * falls. `k = Infinity`: the discs alone. Null when no node is visible.
   */
  at(k: number): Rect | null;
}

let measureCtx: ReturnType<typeof domSurfaceFactory> | undefined;

/** The footprint of `frame`, its labels measured with `theme`'s fonts. */
export function labelFootprint(frame: FrameVisuals, theme: Theme): LabelFootprint {
  if (measureCtx === undefined) measureCtx = domSurfaceFactory(1, 1);
  return new FrameFootprint(frame, {
    fonts: new Fonts(theme),
    measurer: new TextMeasurer(measureCtx?.ctx ?? null),
    atlas: null,
  });
}

export class FrameFootprint implements LabelFootprint {
  private readonly cache = new FrameCache();
  private readonly labels = new LabelPass();
  private readonly badges = new BadgePass();
  private readonly grid = new CollisionGrid();
  private readonly box = new Float64Array(4);
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
    strictY: false,
    stats: createStats(),
  };

  constructor(
    private readonly frame: FrameVisuals,
    private readonly res: LabelResources,
  ) {
    this.cache.sync(frame, 1, new Interner());
  }

  at(k: number): Rect | null {
    const labels = Number.isFinite(k) && k > 0;
    const s = labels ? k : 1;
    // Screen space at zoom s with the world origin at (0, 0): the discs first.
    const b = this.box;
    b.fill(Number.POSITIVE_INFINITY, 0, 2).fill(Number.NEGATIVE_INFINITY, 2, 4);
    for (const n of this.frame.nodes) {
      if (!n.visible) continue;
      const r = labels ? Math.max(n.r * s, NODE_MIN_R) : n.r;
      b[0] = Math.min(b[0]!, n.x * s - r);
      b[1] = Math.min(b[1]!, n.y * s - r);
      b[2] = Math.max(b[2]!, n.x * s + r);
      b[3] = Math.max(b[3]!, n.y * s + r);
    }
    if (!(b[0]! <= b[2]!)) return null;
    if (labels) {
      const v = this.view;
      v.k = s;
      v.x0 = b[0]! - ROOM;
      v.y0 = b[1]! - ROOM;
      v.x1 = b[2]! + ROOM;
      v.y1 = b[3]! + ROOM;
      v.width = v.x1 - v.x0;
      v.height = v.y1 - v.y0;
      // Badges register in the grid; one cell is enough, nothing is placed against them.
      this.grid.reset(v.x0, v.y0, v.width, v.height, Math.max(v.width, v.height));
      this.badges.layout(this.frame, this.cache, v, this.res.fonts, this.res.measurer, this.grid);
      this.labels.collect(this.frame, this.cache, v, this.res);
      this.grid.extend(b);
      this.labels.extend(b);
    }
    return { x: b[0]! / s, y: b[1]! / s, width: (b[2]! - b[0]!) / s, height: (b[3]! - b[1]!) / s };
  }
}
