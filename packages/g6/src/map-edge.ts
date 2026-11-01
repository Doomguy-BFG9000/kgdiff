/**
 * Scene edges and glyphs → G6 edge data (glyph arcs) or small nodes (pivot dots); see map.ts
 * for the conventions.
 */
import type { EdgeData, NodeData } from '@antv/g6';
import type { EdgeVisual, GlyphVisual, NodeVisual, SceneEdge, SceneNode } from '@kgdiff/scene';
import {
  ANCHOR_ID_PREFIX,
  ARROW_GAP,
  ARROW_LENGTH,
  ARROW_WIDTH,
  EDGE_HIT_WIDTH,
  GLYPH_ID_PREFIX,
  LABEL_MAX_WIDTH,
  MARK_RADIUS,
  PIVOT_OUTLINE,
  TEXT_HALO_ALPHA,
  TEXT_HALO_WIDTH,
  Z,
} from './constants.js';
import { band, finite, linkLength, unit } from './geometry.js';
import { NodeLocator } from './locator.js';
import {
  type Ctx,
  claim,
  type EdgeStyle,
  type KgdiffDatumData,
  type NodeStyle,
  noteLod,
  shown,
  type Text,
  text,
} from './map-context.js';
import { nodeBase } from './map-node.js';

/** How a glyph kind is drawn; unknown kinds (newer scenes) degrade to a plain line. */
interface GlyphStyle {
  readonly arrow: boolean;
  /** Pattern used when the glyph has no `dash` of its own. */
  readonly dash: readonly number[] | null;
  /** `?` mark at the midpoint. */
  readonly mark: boolean;
}

const ARC: GlyphStyle = { arrow: true, dash: null, mark: false };
const GHOST: GlyphStyle = { arrow: true, dash: [4, 3], mark: false };
const SUGGESTION: GlyphStyle = { arrow: false, dash: [1, 3], mark: true };
const PLAIN: GlyphStyle = { arrow: false, dash: null, mark: false };

function glyphStyle(kind: string): GlyphStyle {
  switch (kind) {
    case 'merge-arrow':
    case 'split-arrow':
    case 'replacement-arrow':
    case 'move-arrow':
      return ARC;
    case 'edge-ghost':
      return GHOST;
    case 'suggestion':
      return SUGGESTION;
    default:
      return PLAIN;
  }
}

/**
 * G6 arrowhead size: [length along the line, width]. Shared by every edge so G6's shallow style
 * comparison sees no change; G6 only reads it (`parseSize` copies), freezing guards the rest.
 */
const ARROW_SIZE = Object.freeze([ARROW_LENGTH, ARROW_WIDTH]) as unknown as [number, number];
/** Gap long enough to hide the rest of a partially drawn line. */
const DASH_REST = 1e6;

function edgeBase(ctx: Ctx): Readonly<EdgeStyle> {
  if (ctx.edgeBase === null) ctx.edgeBase = Object.freeze(buildEdgeBase(ctx));
  return ctx.edgeBase;
}

function buildEdgeBase(ctx: Ctx): EdgeStyle {
  const t = ctx.theme;
  return {
    zIndex: Z.edge,
    visibility: 'visible',
    cursor: 'pointer',
    pointerEvents: 'auto',
    increasedLineWidthForHitTesting: EDGE_HIT_WIDTH,
    opacity: 1,
    stroke: t.neutral.edge,
    strokeOpacity: 1,
    lineWidth: 1,
    lineDash: 0,
    lineDashOffset: 0,
    lineCap: 'round',
    curvePosition: 0.5,
    curveOffset: 0,
    loop: true,
    loopPlacement: 'top',
    halo: false,
    startArrow: false,
    endArrow: false,
    endArrowType: 'triangle',
    endArrowSize: ARROW_SIZE,
    endArrowLineWidth: 0,
    endArrowOffset: ARROW_LENGTH / 2 + ARROW_GAP,
    label: false,
    labelText: '',
    labelFill: t.neutral.label,
    labelFontSize: 10.5,
    labelFontWeight: t.font.weightRegular,
    labelFontFamily: t.font.family,
    labelOpacity: 0,
    labelPlacement: 'center',
    labelAutoRotate: false,
    labelOffsetX: 0,
    labelOffsetY: 0,
    labelTextAlign: 'center',
    labelTextBaseline: 'middle',
    labelTextDecorationLine: 'none',
    labelTextDecorationColor: t.neutral.label,
    labelStroke: ctx.bg,
    labelLineWidth: TEXT_HALO_WIDTH,
    labelStrokeOpacity: 0,
    labelLineJoin: 'round',
    labelMaxWidth: LABEL_MAX_WIDTH,
    labelWordWrap: true,
    labelMaxLines: 1,
    labelTextOverflow: '…',
    labelBackground: false,
    labelBackgroundFill: ctx.bg,
    labelBackgroundStroke: ctx.bg,
    labelBackgroundLineWidth: 0,
    labelBackgroundRadius: 0,
    labelBackgroundOpacity: 1,
    labelBackgroundWidth: 0,
    labelBackgroundHeight: 0,
    labelPadding: 0,
  };
}

/** A link endpoint: a drawn node, or an anchor point (radius 0). */
interface End {
  /** G6 node id. */
  readonly id: string;
  /** Identity used in glyph ids: the scene union id, or the anchor key. */
  readonly key: string;
  /** Scene node index, or -1 for an anchor without one. */
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

interface Link {
  readonly a: End;
  readonly b: End;
  readonly curvature: number;
  readonly progress: number;
  readonly fromTarget: boolean;
  readonly dash: readonly number[] | null;
  readonly alpha: number;
  /** Extra world units the arrow keeps away from the target outline (ring clearance). */
  readonly clearance: number;
}

/**
 * Geometry shared by edges and glyph arcs: G6 type, curve offset, partial drawing, arrow.
 * G6 has no "draw a fraction of the path": a solid line shows `progress` with a dash pattern
 * (visible part, then a gap longer than the path); a dashed one fades with it instead.
 */
function linkStyle(link: Link, arrow: boolean): { type: 'line' | 'quadratic'; style: EdgeStyle } {
  const { a, b } = link;
  const loop = a.id === b.id;
  const len = loop ? 0 : Math.hypot(b.x - a.x, b.y - a.y);
  const c = loop || !(len > 0) ? 0 : finite(link.curvature, 0);
  const p = unit(link.progress);
  let alpha = link.alpha;
  let lineDash: number | number[] = link.dash !== null && link.dash.length > 0 ? [...link.dash] : 0;
  let lineDashOffset = 0;
  if (p < 1) {
    if (lineDash === 0) {
      const drawn = Math.max(0, linkLength(len, c) - Math.max(0, a.r) - Math.max(0, b.r));
      lineDash = [drawn * p, DASH_REST];
      if (link.fromTarget) lineDashOffset = -drawn * (1 - p);
    } else alpha *= p;
  }
  const dashed = Array.isArray(lineDash) && lineDash.length > 0 && (lineDash[0] as number) >= 0.5;
  return {
    type: c !== 0 ? 'quadratic' : 'line',
    style: {
      opacity: unit(alpha),
      lineDash,
      lineDashOffset,
      lineCap: dashed ? 'butt' : 'round',
      // Scene: control = midpoint + c·(−dy, dx). G6: midpoint + curveOffset·unit(dy, −dx).
      curveOffset: c === 0 ? 0 : -c * len,
      // The tip follows the drawn end, so a line growing from its source shows no arrow yet.
      endArrow: arrow && !loop && (p >= 1 || link.fromTarget),
      endArrowOffset: ARROW_LENGTH / 2 + ARROW_GAP + Math.max(0, link.clearance),
    },
  };
}

function edgeLabelKeys(l: Text, ctx: Ctx): EdgeStyle {
  return {
    label: l.show,
    labelText: l.text,
    labelFill: l.fill,
    labelFontSize: l.size,
    labelFontWeight: l.weight,
    labelOpacity: l.opacity,
    labelOffsetY: l.offset,
    labelTextDecorationLine: l.strike ? 'line-through' : 'none',
    labelTextDecorationColor: l.fill,
    labelStroke: ctx.bg,
    labelStrokeOpacity: TEXT_HALO_ALPHA * l.opacity,
  };
}

/** The present node among the candidates nearest to (x, y), or -1. Ties keep `a`. */
function endpoint(ctx: Ctx, x: number, y: number, a: number, b: number): number {
  const nodes = ctx.frame.nodes;
  const ok = (i: number): boolean => i >= 0 && i < nodes.length && ctx.present[i] === 1;
  if (a === b || !ok(b)) return ok(a) ? a : -1;
  if (!ok(a)) return b;
  const na = nodes[a] as NodeVisual;
  const nb = nodes[b] as NodeVisual;
  const da = Math.hypot(na.x - x, na.y - y);
  const db = Math.hypot(nb.x - x, nb.y - y);
  return db < da ? b : a;
}

function nodeEnd(ctx: Ctx, i: number): End {
  const v = ctx.frame.nodes[i] as NodeVisual;
  return {
    id: ctx.nodeIds[i] as string,
    key: (ctx.scene.nodes[i] as SceneNode).id,
    index: i,
    x: v.x,
    y: v.y,
    r: Math.max(0, finite(v.r, 0)),
  };
}

export function mapEdge(se: SceneEdge, ev: EdgeVisual, ctx: Ctx): EdgeData | null {
  const drawn = ev.visible && ev.progress > 0;
  if (!drawn && !ctx.keepHidden) return null;
  // Retargeted / carried edges are drawn at their before or after endpoints depending on the
  // layer: attach to whichever candidate node the visual's endpoint sits on.
  const source = endpoint(ctx, ev.x1, ev.y1, se.s, se.sb);
  const target = endpoint(ctx, ev.x2, ev.y2, se.t, se.tb);
  if (source < 0 || target < 0) return null;
  if (ev.arrow) noteLod(ctx, ev.arrowMinZoom);
  const { type, style: link } = linkStyle(
    {
      a: nodeEnd(ctx, source),
      b: nodeEnd(ctx, target),
      curvature: ev.curvature,
      progress: ev.progress,
      fromTarget: ev.fromTarget,
      dash: ev.dash,
      alpha: ev.alpha,
      clearance: 0,
    },
    ev.arrow && shown(ev.arrowMinZoom, ctx.zoom),
  );
  const label = text(ev.label, unit(ev.alpha), ctx, 10.5, ctx.theme.neutral.label);
  const style: EdgeStyle = {
    ...edgeBase(ctx),
    ...link,
    ...edgeLabelKeys(label, ctx),
    zIndex: band(Z.edge, ev.z, Z.span),
    visibility: drawn ? 'visible' : 'hidden',
    stroke: ev.color,
    lineWidth: Math.max(0, finite(ev.width, 1)),
    lineDashOffset: (link.lineDashOffset as number) + finite(ev.dashOffset, 0),
  };
  const data: KgdiffDatumData = {
    kgdiff: 'edge',
    index: se.index,
    hunk: se.hunk,
    family: se.family,
    changed: se.family !== 'neutral',
    label: label.text.length > 0 ? label.text : se.label,
    glyph: '',
  };
  return {
    id: claim(ctx, ctx.prefix + se.id),
    source: ctx.nodeIds[source] as string,
    target: ctx.nodeIds[target] as string,
    type,
    style,
    data,
  };
}

// ─── Glyphs ─────────────────────────────────────────────────────────────────

function locator(ctx: Ctx): NodeLocator {
  if (ctx.locator === null) {
    const nodes = ctx.frame.nodes;
    ctx.locator = new NodeLocator(
      nodes,
      (i) => ctx.present[i] === 1 && (nodes[i] as NodeVisual).visible,
    );
  }
  return ctx.locator;
}

/** Every scene node, drawn or not: names the anchor of a glyph end that has no drawn node. */
function anyLocator(ctx: Ctx): NodeLocator {
  if (ctx.anyLocator === null) ctx.anyLocator = new NodeLocator(ctx.frame.nodes, () => true);
  return ctx.anyLocator;
}

/**
 * The end of a glyph line at (x, y): the drawn node whose disc holds it, else an anchor — an
 * invisible, non-interactive point node — so arcs towards nodes that are not drawn yet (a split
 * target before it emerges) are kept. Anchors are shared within a frame and named after the
 * scene node at that point when there is one, so their ids are stable across frames.
 */
function glyphEnd(ctx: Ctx, x: number, y: number, nodes: NodeData[]): End | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const at = locator(ctx).nearest(x, y, 0.5);
  if (at >= 0) return nodeEnd(ctx, at);
  const owner = anyLocator(ctx).nearest(x, y, 0.5);
  const key =
    owner >= 0 ? (ctx.scene.nodes[owner] as SceneNode).id : `@${Math.round(x)},${Math.round(y)}`;
  let id = ctx.anchors.get(key);
  if (id === undefined) {
    id = claim(ctx, `${ctx.prefix}${ANCHOR_ID_PREFIX}${JSON.stringify(key)}`);
    ctx.anchors.set(key, id);
    const style: NodeStyle = {
      ...nodeBase(ctx),
      x,
      y,
      // Not 0: G measures an empty circle as an empty box, and edges need a real point.
      size: 0.01,
      zIndex: Z.pivot,
      cursor: 'default',
      pointerEvents: 'none',
      fill: 'transparent',
      stroke: 'transparent',
      lineWidth: 0,
    };
    const data: KgdiffDatumData = {
      kgdiff: 'anchor',
      index: owner,
      hunk: owner >= 0 ? (ctx.scene.nodes[owner] as SceneNode).hunk : -1,
      family: 'neutral',
      changed: false,
      label: '',
      glyph: '',
    };
    nodes.push({ id, style, data });
  }
  return { id, key, index: owner, x, y, r: 0 };
}

function glyphHunk(ctx: Ctx, a: End, b: End): number {
  const ha = a.index >= 0 ? (ctx.scene.nodes[a.index] as SceneNode).hunk : -1;
  return ha >= 0 || b.index < 0 ? ha : (ctx.scene.nodes[b.index] as SceneNode).hunk;
}

function glyphId(ctx: Ctx, kind: string, a: End, b: End): string {
  // JSON keeps ids containing separators unambiguous.
  return claim(ctx, `${ctx.prefix}${GLYPH_ID_PREFIX}${kind}:${JSON.stringify([a.key, b.key])}`);
}

function glyphData(ctx: Ctx, g: GlyphVisual, i: number, a: End, b: End): KgdiffDatumData {
  const hunk = glyphHunk(ctx, a, b);
  return {
    kgdiff: 'glyph',
    index: i,
    hunk,
    family: hunk >= 0 ? (ctx.scene.hunks[hunk]?.family ?? 'neutral') : 'neutral',
    changed: hunk >= 0,
    label: g.label?.text ?? '',
    glyph: g.kind,
  };
}

/** A pivot: a dot of diameter `width` with a background outline, as a non-interactive node. */
function mapPivot(g: GlyphVisual, i: number, ctx: Ctx): GlyphDatum | null {
  const w = Math.max(3, finite(g.width, 5));
  // The dot sits on its node's outline: attach its identity to that node.
  const at = locator(ctx).nearest(g.x1, g.y1, w);
  if (at < 0) return null;
  const end = nodeEnd(ctx, at);
  const style: NodeStyle = {
    ...nodeBase(ctx),
    x: g.x1,
    y: g.y1,
    size: w + PIVOT_OUTLINE,
    zIndex: Z.pivot,
    cursor: 'default',
    pointerEvents: 'none',
    opacity: unit(g.alpha),
    fill: g.color,
    stroke: ctx.bg,
    lineWidth: PIVOT_OUTLINE,
  };
  return {
    node: { id: glyphId(ctx, g.kind, end, end), style, data: glyphData(ctx, g, i, end, end) },
  };
}

export type GlyphDatum = { readonly node: NodeData } | { readonly edge: EdgeData };

/**
 * A glyph as G6 data: pivots become nodes, everything else an edge between the ends' nodes or
 * anchors (anchor nodes are pushed to `nodes`). Null when the glyph is invisible or degenerate.
 */
export function mapGlyph(
  g: GlyphVisual,
  i: number,
  ctx: Ctx,
  nodes: NodeData[],
): GlyphDatum | null {
  if (!(g.alpha > 0)) return null;
  const kind = String(g.kind);
  if (kind === 'pivot' || (g.x1 === g.x2 && g.y1 === g.y2)) return mapPivot(g, i, ctx);
  const source = glyphEnd(ctx, g.x1, g.y1, nodes);
  const target = glyphEnd(ctx, g.x2, g.y2, nodes);
  if (source === null || target === null || source.id === target.id) return null;
  const spec = glyphStyle(kind);
  // A newer scene may carry its own arrow flag (the native renderer honours it too).
  const own = (g as GlyphVisual & { readonly arrow?: unknown }).arrow;
  const arrow = typeof own === 'boolean' ? own : spec.arrow;
  const { type, style: link } = linkStyle(
    {
      a: source,
      b: target,
      curvature: g.curvature,
      progress: g.progress,
      fromTarget: false,
      dash: g.dash !== null && g.dash.length > 0 ? g.dash : spec.dash,
      alpha: g.alpha,
      clearance: finite(g.r2, 0) - target.r,
    },
    arrow,
  );
  const label = text(g.label, unit(g.alpha), ctx, ctx.theme.font.size, g.color);
  const chord = Math.hypot(target.x - source.x, target.y - source.y);
  // Suggestions: the `?` sits in a small disc at the midpoint once the line is complete.
  const mark = spec.mark && unit(g.progress) >= 1 && chord > 6 * MARK_RADIUS;
  const style: EdgeStyle = {
    ...edgeBase(ctx),
    ...link,
    ...edgeLabelKeys(label, ctx),
    zIndex: Z.glyph,
    stroke: g.color,
    lineWidth: Math.max(0, finite(g.width, 1.5)),
    ...(spec.mark
      ? {
          label: mark && label.show,
          labelFill: g.color,
          labelFontSize: 10,
          labelFontWeight: 700,
          labelStrokeOpacity: 0,
          labelOffsetY: 0,
          labelBackground: mark && label.show,
          labelBackgroundFill: ctx.bg,
          labelBackgroundStroke: g.color,
          labelBackgroundLineWidth: 1.25,
          labelBackgroundRadius: MARK_RADIUS,
          labelBackgroundWidth: 2 * MARK_RADIUS,
          labelBackgroundHeight: 2 * MARK_RADIUS,
        }
      : {}),
  };
  return {
    edge: {
      id: glyphId(ctx, kind, source, target),
      source: source.id,
      target: target.id,
      type,
      style,
      data: glyphData(ctx, g, i, source, target),
    },
  };
}
