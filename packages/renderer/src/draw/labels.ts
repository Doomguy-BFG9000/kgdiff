/**
 * Label pass: collect visible labels (node primary + secondary blocks, edge labels at curve
 * midpoints, glyph labels) and collapsed-group pills, place them greedily against node discs and
 * badges, then draw the labels from the label atlas (or directly without offscreen surfaces).
 * Placement runs before anything is drawn, so pills (drawn early, under edges) know whether
 * they won their spot; a pill that collides is hidden at this zoom.
 */
import type { FrameVisuals, LabelVisual, Theme } from '@kgdiff/scene';
import { ATLAS_PAD, type AtlasEntry, drawTextLine, type LabelAtlas } from '../atlas.js';
import type { Ctx2D } from '../ctx.js';
import type { FrameCache } from '../frame-cache.js';
import {
  type CollisionGrid,
  createRequest,
  type LabelClip,
  type LabelRequest,
  MODE_FIXED,
  MODE_NODE,
  MODE_POINT,
  placeLabels,
  SIDE_ABOVE,
  SIDE_BELOW,
  SIDE_CENTER,
  SIDE_LEFT,
  SIDE_RIGHT,
} from '../labels.js';
import { snap } from '../math.js';
import { type Fonts, LABEL_MAX_WIDTH, lineHeight, type TextMeasurer } from '../text.js';
import { pillRect } from './collapsed.js';
import { isLoop } from './edges.js';
import { SUGGESTION_MARK_R } from './glyphs.js';
import { linkMidpoint, loopCenterY, loopRadius } from './link.js';
import { NODE_MIN_R, type View } from './view.js';

/** Labels whose anchor is this far (px) outside the region still compete for space. */
export const LABEL_MARGIN = 160;
/** Nodes at least this big (screen radius, px) keep labels off their disc. */
export const OBSTACLE_MIN_R = 3;
const MIN_ALPHA = 0.02;
/**
 * Collision priority of collapsed pills, on the scene's label scale: below changed-node labels
 * (1 + importance; ties go to labels) and above neutral ones (importance < 1) and edge labels.
 */
export const PILL_PRIORITY = 1;

const rect = new Float64Array(4);

export interface LabelResources {
  readonly fonts: Fonts;
  readonly measurer: TextMeasurer;
  readonly atlas: LabelAtlas | null;
}

/**
 * LOD fade: fully visible from `minZoom` on (as specified), fading in over the 10% of zoom just
 * below it, so labels never pop in or out while zooming.
 */
export function lodAlpha(minZoom: number, k: number): number {
  if (!(minZoom > 0) || k >= minZoom) return 1;
  const t = (k - 0.9 * minZoom) / (0.1 * minZoom);
  return t <= 0 ? 0 : t * t * (3 - 2 * t);
}

function shown(l: LabelVisual | null, k: number, ownerAlpha: number): l is LabelVisual {
  return (
    l !== null && l.text.length > 0 && l.alpha * ownerAlpha * lodAlpha(l.minZoom, k) >= MIN_ALPHA
  );
}

export class LabelPass {
  private readonly pool: LabelRequest[] = [];
  private readonly active: LabelRequest[] = [];
  private readonly clip: LabelClip = { x0: 0, y0: 0, x1: 0, y1: 0, strictX: false };

  /** Reset `grid` to the region and add node discs as obstacles. */
  begin(frame: FrameVisuals, cache: FrameCache, v: View, grid: CollisionGrid): void {
    const m = LABEL_MARGIN;
    grid.reset(v.x0 - m, v.y0 - m, v.x1 - v.x0 + 2 * m, v.y1 - v.y0 + 2 * m);
    const { k, ox, oy } = v;
    if (cache.maxR * k < OBSTACLE_MIN_R) return;
    for (const b of cache.nodeBuckets) {
      for (const i of b.members) {
        const n = frame.nodes[i]!;
        const r = n.r * k;
        if (r < OBSTACLE_MIN_R) continue;
        const x = n.x * k + ox;
        const y = n.y * k + oy;
        if (x + r < v.x0 - m || x - r > v.x1 + m || y + r < v.y0 - m || y - r > v.y1 + m) continue;
        grid.insert(x - r, y - r, 2 * r, 2 * r);
      }
    }
  }

  /**
   * Collect labels and pills and place them against `grid` (call after `begin` and after badges
   * registered their obstacles). Records which pills won a spot in `cache.pillShown`.
   */
  place(
    frame: FrameVisuals,
    cache: FrameCache,
    v: View,
    res: LabelResources,
    grid: CollisionGrid,
  ): void {
    this.active.length = 0;
    this.collectNodes(frame, v, res);
    this.collectEdges(frame, v, res);
    this.collectGlyphs(frame, cache, v, res);
    this.collectPills(frame, v, res);
    const pills = frame.collapsed.length;
    if (cache.pillShown.length < pills) cache.pillShown = new Uint8Array(pills);
    cache.pillShown.fill(0, 0, pills);
    cache.pillsVersion = cache.version;
    if (this.active.length === 0) return;
    const clip = this.clip;
    clip.x0 = v.x0;
    clip.x1 = v.x1;
    clip.y0 = v.y0;
    clip.y1 = v.y1;
    clip.strictX = v.strictX;
    placeLabels(this.active, grid, clip);
    for (const req of this.active) if (req.placed && req.pill >= 0) cache.pillShown[req.pill] = 1;
  }

  /** Draw the labels placed by `place`. Returns how many were drawn. */
  draw(ctx: Ctx2D, v: View, theme: Theme, res: LabelResources): number {
    let drawn = 0;
    const bg = theme.canvas.background;
    const atlas = res.atlas;
    const source = atlas?.canvas ?? null;
    for (const req of this.active) {
      if (!req.placed || req.pill >= 0) continue;
      drawn++;
      if (req.primary) {
        const x = alignX(req, req.wP);
        drawLine(
          ctx,
          req,
          req.primary,
          req.textP,
          req.fontP,
          req.wP,
          req.hP,
          x,
          req.by,
          v,
          bg,
          atlas,
          source,
        );
      }
      if (req.secondary) {
        const x = alignX(req, req.wS);
        drawLine(
          ctx,
          req,
          req.secondary,
          req.textS,
          req.fontS,
          req.wS,
          req.hS,
          x,
          req.by + req.dyS,
          v,
          bg,
          atlas,
          source,
        );
      }
    }
    return drawn;
  }

  private take(): LabelRequest {
    const i = this.active.length;
    let req = this.pool[i];
    if (!req) {
      req = createRequest();
      this.pool.push(req);
    }
    this.active.push(req);
    req.pill = -1;
    return req;
  }

  private collectPills(frame: FrameVisuals, v: View, res: LabelResources): void {
    const m = LABEL_MARGIN;
    const groups = frame.collapsed;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]!;
      if (!(g.count > 0) || !Number.isFinite(g.x + g.y)) continue;
      pillRect(g, v, res.fonts, res.measurer, rect);
      const w = rect[2]!;
      const h = rect[3]!;
      const x = rect[0]! + w / 2;
      const y = rect[1]! + h / 2;
      if (x < v.x0 - m || x > v.x1 + m || y < v.y0 - m || y > v.y1 + m) continue;
      const req = this.take();
      req.pill = i;
      req.x = x;
      req.y = y;
      req.r = 0;
      req.w = w;
      req.h = h;
      req.offset = 0;
      req.mode = MODE_FIXED;
      req.priority = PILL_PRIORITY;
      req.order = 3e7 + i;
      req.placed = false;
      req.primary = null;
      req.secondary = null;
    }
  }

  private collectNodes(frame: FrameVisuals, v: View, res: LabelResources): void {
    const { k, ox, oy } = v;
    const m = LABEL_MARGIN;
    const nodes = frame.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      if (!n.visible || n.alpha < MIN_ALPHA) continue;
      const p = shown(n.label, k, n.alpha) ? n.label : null;
      const s = shown(n.secondaryLabel, k, n.alpha) ? n.secondaryLabel : null;
      if (!p && !s) continue;
      const x = n.x * k + ox;
      const y = n.y * k + oy;
      if (x < v.x0 - m || x > v.x1 + m || y < v.y0 - m || y > v.y1 + m) continue;
      const req = this.take();
      req.x = x;
      req.y = y;
      req.r = Math.max(n.r * k, NODE_MIN_R);
      req.mode = MODE_NODE;
      req.order = i;
      req.alpha = n.alpha;
      this.fill(req, p, s, res);
    }
  }

  private collectEdges(frame: FrameVisuals, v: View, res: LabelResources): void {
    const { k, ox, oy } = v;
    const m = LABEL_MARGIN;
    const edges = frame.edges;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]!;
      if (e.label === null || !e.visible || e.progress < 0.999) continue;
      if (!shown(e.label, k, e.alpha)) continue;
      const x1 = e.x1 * k + ox;
      const y1 = e.y1 * k + oy;
      let x: number;
      let y: number;
      if (isLoop(e.x1, e.y1, e.x2, e.y2)) {
        const r = Math.max(e.r1 * k, NODE_MIN_R);
        const rho = loopRadius(r, e.curvature);
        x = x1;
        y = loopCenterY(y1, r, rho) - rho;
      } else {
        [x, y] = linkMidpoint(x1, y1, e.x2 * k + ox, e.y2 * k + oy, e.curvature);
      }
      if (x < v.x0 - m || x > v.x1 + m || y < v.y0 - m || y > v.y1 + m) continue;
      const req = this.take();
      req.x = x;
      req.y = y;
      req.r = 0;
      req.mode = MODE_POINT;
      req.order = 1e7 + i;
      req.alpha = e.alpha;
      this.fill(req, e.label, null, res);
    }
  }

  private collectGlyphs(
    frame: FrameVisuals,
    cache: FrameCache,
    v: View,
    res: LabelResources,
  ): void {
    const { k, ox, oy } = v;
    const m = LABEL_MARGIN;
    for (const i of cache.glyphArcs) {
      const g = frame.glyphs[i]!;
      if (!shown(g.label, k, g.alpha) || g.progress < 0.999) continue;
      const [x, y] = linkMidpoint(
        g.x1 * k + ox,
        g.y1 * k + oy,
        g.x2 * k + ox,
        g.y2 * k + oy,
        g.curvature,
      );
      if (x < v.x0 - m || x > v.x1 + m || y < v.y0 - m || y > v.y1 + m) continue;
      const req = this.take();
      req.x = x;
      req.y = y;
      // Suggestions carry a `?` mark at the midpoint: place the label around it.
      req.r = g.kind === 'suggestion' ? SUGGESTION_MARK_R : 0;
      req.mode = g.kind === 'suggestion' ? MODE_NODE : MODE_POINT;
      req.order = 2e7 + i;
      req.alpha = g.alpha;
      this.fill(req, g.label, null, res);
    }
  }

  /** Measure and size the block for a primary and / or secondary line. */
  private fill(
    req: LabelRequest,
    p: LabelVisual | null,
    s: LabelVisual | null,
    res: LabelResources,
  ): void {
    const { fonts, measurer } = res;
    req.primary = p;
    req.secondary = s;
    req.placed = false;
    req.dyS = 0;
    if (p) {
      req.fontP = fonts.get(p.size, p.weight);
      req.textP = measurer.fit(req.fontP, p.text, LABEL_MAX_WIDTH);
      req.wP = Math.ceil(measurer.width(req.fontP, req.textP));
      req.hP = lineHeight(p.size);
    }
    if (s) {
      req.fontS = fonts.get(s.size, s.weight);
      req.textS = measurer.fit(req.fontS, s.text, LABEL_MAX_WIDTH);
      req.wS = Math.ceil(measurer.width(req.fontS, req.textS));
      req.hS = lineHeight(s.size);
    }
    if (p && s) {
      req.dyS = Math.max(s.offset - p.offset, req.hP - 1);
      req.w = Math.max(req.wP, req.wS);
      req.h = req.dyS + req.hS;
      req.offset = p.offset;
      req.priority = Math.max(p.priority, s.priority);
    } else if (p) {
      req.w = req.wP;
      req.h = req.hP;
      req.offset = p.offset;
      req.priority = p.priority;
    } else if (s) {
      req.w = req.wS;
      req.h = req.hS;
      req.offset = s.offset;
      req.priority = s.priority;
    }
  }
}

/** Left x of one line inside its block (centred below / above, flush beside the node). */
function alignX(req: LabelRequest, width: number): number {
  switch (req.side) {
    case SIDE_RIGHT:
      return req.bx;
    case SIDE_LEFT:
      return req.bx + req.w - width;
    case SIDE_BELOW:
    case SIDE_ABOVE:
    case SIDE_CENTER:
      return req.bx + (req.w - width) / 2;
    default:
      return req.bx;
  }
}

function drawLine(
  ctx: Ctx2D,
  req: LabelRequest,
  label: LabelVisual,
  text: string,
  font: string,
  width: number,
  height: number,
  x: number,
  y: number,
  v: View,
  bg: string,
  atlas: LabelAtlas | null,
  source: CanvasImageSource | null,
): void {
  const alpha = label.alpha * req.alpha * lodAlpha(label.minZoom, v.k);
  const sx = snap(x, v.dpr);
  const sy = snap(y, v.dpr);
  const entry: AtlasEntry | null | undefined =
    atlas && source ? atlas.get(text, font, label.color, label.strike, width, height) : null;
  if (entry === undefined) return; // over this frame's raster budget: drawn next frame
  if (entry && source) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      source,
      entry.sx,
      entry.sy,
      entry.sw,
      entry.sh,
      sx - ATLAS_PAD,
      sy - ATLAS_PAD,
      entry.sw / v.dpr,
      entry.sh / v.dpr,
    );
    return;
  }
  drawTextLine(ctx, text, font, label.color, bg, label.strike, sx, sy, width, height, alpha);
}
