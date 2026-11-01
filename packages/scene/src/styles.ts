/**
 * Static encodings: the "Layer encodings" table of docs/visual-language.md as precomputed,
 * shared style records per element and layer (`union`, `before`, `after`). The resolver copies
 * these into frame visuals and only animates elements inside active replay windows.
 */

import { desaturate, RampCache } from './color.js';
import { DASH_EDGE, DASH_GHOST, EMPHASIS, HALO, STROKE } from './constants.js';
import { assertNever } from './roles.js';
import type { Family, SceneEdge, SceneNode, Theme } from './types.js';

// ─── Family codes ───────────────────────────────────────────────────────────

export const F_ADDED = 0;
export const F_REMOVED = 1;
export const F_CONTENT = 2;
export const F_STRUCTURE = 3;
export const F_IDENTITY = 4;
export const F_NEUTRAL = 5;

export const FAMILY_BY_CODE: readonly Family[] = [
  'added',
  'removed',
  'content',
  'structure',
  'identity',
  'neutral',
];

export function familyCode(f: Family): number {
  switch (f) {
    case 'added':
      return F_ADDED;
    case 'removed':
      return F_REMOVED;
    case 'content':
      return F_CONTENT;
    case 'structure':
      return F_STRUCTURE;
    case 'identity':
      return F_IDENTITY;
    case 'neutral':
      return F_NEUTRAL;
    default:
      return assertNever(f);
  }
}

// ─── Derived tokens ─────────────────────────────────────────────────────────

/** Theme colors indexed by family code, plus derived colors (precomputed once per theme). */
export interface Tokens {
  readonly theme: Theme;
  /** Mark color (neutral: node fill). */
  readonly base: readonly string[];
  /** Emphasis / node stroke (neutral: node stroke). */
  readonly strong: readonly string[];
  /** Text color (neutral: neutral label). */
  readonly text: readonly string[];
  /** Badge backgrounds (neutral: raised surface). */
  readonly soft: readonly string[];
  /** Edge color (neutral: neutral edge). */
  readonly edge: readonly string[];
  readonly deprecatedFill: string;
  readonly deprecatedStroke: string;
  readonly background: string;
  readonly primary: string;
  readonly secondary: string;
  readonly muted: string;
  readonly neutralLabel: string;
  readonly accent: string;
  readonly glow: boolean;
  /** Halo radius as a multiple of r (glow 2.6; offset ring 1, drawn 5 px outside r). */
  readonly haloScale: number;
  readonly haloAlpha: number;
  readonly weightRegular: number;
  readonly weightStrong: number;
  readonly ramps: RampCache;
}

const tokenCache = new WeakMap<Theme, Tokens>();

export function tokensFor(theme: Theme): Tokens {
  const cached = tokenCache.get(theme);
  if (cached !== undefined) return cached;
  const fam = theme.family;
  const order = [fam.added, fam.removed, fam.content, fam.structure, fam.identity] as const;
  const tokens: Tokens = {
    theme,
    base: [...order.map((f) => f.base), theme.neutral.node],
    strong: [...order.map((f) => f.strong), theme.neutral.nodeStroke],
    text: [...order.map((f) => f.text), theme.neutral.label],
    soft: [...order.map((f) => f.soft), theme.surface.raised],
    edge: [...order.map((f) => f.base), theme.neutral.edge],
    // "content-colored, desaturated": keeps the amber family hint but reads as retired.
    deprecatedFill: desaturate(fam.content.base, 0.6),
    deprecatedStroke: desaturate(fam.content.strong, 0.6),
    background: theme.canvas.background,
    primary: theme.text.primary,
    secondary: theme.text.secondary,
    muted: theme.text.muted,
    neutralLabel: theme.neutral.label,
    accent: theme.accent.base,
    glow: theme.glow,
    haloScale: theme.glow ? HALO.glowScale : 1,
    haloAlpha: theme.glow ? HALO.glowAlpha : HALO.ringAlpha,
    weightRegular: theme.font.weightRegular,
    weightStrong: theme.font.weightStrong,
    ramps: new RampCache(),
  };
  tokenCache.set(theme, tokens);
  return tokens;
}

// ─── Node styles ────────────────────────────────────────────────────────────

export interface NodeStyle {
  readonly hidden: boolean;
  /** Family code the style is drawn in (halo / badge colors). */
  readonly family: number;
  readonly fill: string | null;
  readonly stroke: string | null;
  readonly dash: readonly number[] | null;
  /** Ring color, or null for no ring. */
  readonly ring: string | null;
  /** Halo color, or null for no halo. */
  readonly halo: string | null;
  /** Primary label shows the before name. */
  readonly labelBefore: boolean;
  readonly labelColor: string;
  readonly labelWeight: number;
  readonly strike: boolean;
  /** Changed-label LOD and priority (vs neutral). */
  readonly changed: boolean;
  /** Show the old name, struck, under the primary label (renames). */
  readonly secondary: boolean;
  readonly badge: boolean;
  readonly z: number;
}

export type NodeLook =
  | 'neutral'
  | 'solid'
  | 'added'
  | 'ringed'
  | 'ringHalo'
  | 'ghost'
  | 'deprecated';

export interface LookOptions {
  readonly labelBefore?: boolean;
  readonly strike?: boolean;
  readonly secondary?: boolean;
  readonly badge?: boolean;
}

/** Rebuild a node style as one literal in fixed field order: every style shares one map. */
function nodeStyle(o: NodeStyle): NodeStyle {
  return Object.freeze({
    hidden: o.hidden,
    family: o.family,
    fill: o.fill,
    stroke: o.stroke,
    dash: o.dash,
    ring: o.ring,
    halo: o.halo,
    labelBefore: o.labelBefore,
    labelColor: o.labelColor,
    labelWeight: o.labelWeight,
    strike: o.strike,
    changed: o.changed,
    secondary: o.secondary,
    badge: o.badge,
    z: o.z,
  });
}

export const HIDDEN_NODE: NodeStyle = nodeStyle({
  hidden: true,
  family: F_NEUTRAL,
  fill: null,
  stroke: null,
  dash: null,
  ring: null,
  halo: null,
  labelBefore: false,
  labelColor: '',
  labelWeight: 400,
  strike: false,
  changed: false,
  secondary: false,
  badge: false,
  z: 0,
});

// ─── Edge styles ────────────────────────────────────────────────────────────

/** Edge label sources. */
export const EL_NONE = 0;
export const EL_CURRENT = 1;
export const EL_BEFORE = 2;
/** `old → new` (union layer of a relabeled edge). */
export const EL_UNION = 3;

export interface EdgeStyle {
  readonly hidden: boolean;
  readonly family: number;
  /** Draw the before form (sb → tb) instead of the after form (s → t). */
  readonly before: boolean;
  readonly color: string;
  readonly width: number;
  readonly alpha: number;
  readonly dash: readonly number[] | null;
  readonly arrow: boolean;
  readonly label: number;
  readonly labelColor: string;
  readonly strike: boolean;
  readonly changed: boolean;
  readonly z: number;
}

export type EdgeLook = 'neutral' | 'solid' | 'dashed' | 'collapsed';

/** Rebuild an edge style as one literal in fixed field order: every style shares one map. */
function edgeStyle(o: EdgeStyle): EdgeStyle {
  return Object.freeze({
    hidden: o.hidden,
    family: o.family,
    before: o.before,
    color: o.color,
    width: o.width,
    alpha: o.alpha,
    dash: o.dash,
    arrow: o.arrow,
    label: o.label,
    labelColor: o.labelColor,
    strike: o.strike,
    changed: o.changed,
    z: o.z,
  });
}

export const HIDDEN_EDGE: EdgeStyle = edgeStyle({
  hidden: true,
  family: F_NEUTRAL,
  before: false,
  color: '',
  width: 0,
  alpha: 0,
  dash: null,
  arrow: false,
  label: EL_NONE,
  labelColor: '',
  strike: false,
  changed: false,
  z: 0,
});

/** Memoized style records: equal looks share one frozen object. */
export class StyleBook {
  private readonly nodes = new Map<string, NodeStyle>();
  private readonly edges = new Map<string, EdgeStyle>();

  constructor(readonly tokens: Tokens) {}

  node(look: NodeLook, family: number, o: LookOptions = {}): NodeStyle {
    const key = `${look}|${family}|${o.labelBefore ? 1 : 0}${o.strike ? 1 : 0}${o.secondary ? 1 : 0}${o.badge ? 1 : 0}`;
    let style = this.nodes.get(key);
    if (style === undefined) {
      style = nodeStyle(this.makeNode(look, family, o));
      this.nodes.set(key, style);
    }
    return style;
  }

  private makeNode(look: NodeLook, family: number, o: LookOptions): NodeStyle {
    const t = this.tokens;
    const common = {
      hidden: false,
      family,
      dash: null,
      ring: null,
      halo: null,
      labelBefore: o.labelBefore ?? false,
      labelColor: t.primary,
      labelWeight: t.weightStrong,
      strike: o.strike ?? false,
      changed: true,
      secondary: o.secondary ?? false,
      badge: o.badge ?? false,
      z: 2,
    };
    switch (look) {
      case 'neutral':
        return {
          ...common,
          family: F_NEUTRAL,
          fill: t.base[F_NEUTRAL] as string,
          stroke: t.strong[F_NEUTRAL] as string,
          labelColor: t.neutralLabel,
          labelWeight: t.weightRegular,
          changed: false,
          z: 0,
        };
      case 'solid':
        return { ...common, fill: t.base[family] as string, stroke: t.strong[family] as string };
      case 'added':
        return {
          ...common,
          fill: t.base[family] as string,
          stroke: t.strong[family] as string,
          halo: t.base[family] as string,
        };
      case 'ringed':
        return {
          ...common,
          fill: t.base[family] as string,
          stroke: t.strong[family] as string,
          ring: t.base[family] as string,
        };
      case 'ringHalo':
        return {
          ...common,
          fill: t.base[family] as string,
          stroke: t.strong[family] as string,
          ring: t.base[family] as string,
          halo: t.base[family] as string,
        };
      case 'ghost':
        return { ...common, fill: null, stroke: t.base[family] as string, dash: DASH_GHOST, z: 1 };
      case 'deprecated':
        return {
          ...common,
          family: F_CONTENT,
          fill: t.deprecatedFill,
          stroke: t.deprecatedStroke,
          ring: t.deprecatedFill,
          strike: true,
        };
      default:
        return assertNever(look);
    }
  }

  edge(look: EdgeLook, family: number, before: boolean, label: number, strike = false): EdgeStyle {
    const key = `${look}|${family}|${before ? 1 : 0}|${label}|${strike ? 1 : 0}`;
    let style = this.edges.get(key);
    if (style === undefined) {
      style = edgeStyle(this.makeEdge(look, family, before, label, strike));
      this.edges.set(key, style);
    }
    return style;
  }

  private makeEdge(
    look: EdgeLook,
    family: number,
    before: boolean,
    label: number,
    strike: boolean,
  ): EdgeStyle {
    const t = this.tokens;
    const changed: EdgeStyle = {
      hidden: false,
      family,
      before,
      color: t.edge[family] as string,
      width: STROKE.changedEdge,
      alpha: 1,
      dash: null,
      arrow: true,
      label,
      labelColor: t.text[family] as string,
      strike,
      changed: true,
      z: 2,
    };
    switch (look) {
      case 'neutral':
        return {
          ...changed,
          family: F_NEUTRAL,
          color: t.edge[F_NEUTRAL] as string,
          width: STROKE.neutralEdge,
          labelColor: t.neutralLabel,
          changed: false,
          z: 0,
        };
      case 'solid':
        return changed;
      case 'dashed':
        return { ...changed, dash: DASH_EDGE, z: 1 };
      case 'collapsed':
        return { ...changed, dash: DASH_EDGE, alpha: EMPHASIS.collapsedEdge, z: 1 };
      default:
        return assertNever(look);
    }
  }
}

/** [union, before, after] styles of a node (docs/visual-language.md §Layer encodings). */
export function nodeLayerStyles(
  book: StyleBook,
  n: SceneNode,
): readonly [NodeStyle, NodeStyle, NodeStyle] {
  const fam = familyCode(n.family);
  const renamed = n.labelBefore !== undefined;
  switch (n.role) {
    case 'unchanged': {
      const s = book.node('neutral', F_NEUTRAL);
      return [s, s, s];
    }
    case 'added': {
      const s = book.node('added', F_ADDED, { badge: true });
      return [s, HIDDEN_NODE, s];
    }
    case 'removed':
      return [
        book.node('ghost', F_REMOVED, { strike: true, badge: true }),
        book.node('solid', F_REMOVED),
        HIDDEN_NODE,
      ];
    case 'modified':
      return [
        book.node('ringed', fam, { secondary: renamed, badge: true }),
        book.node('ringed', fam, { labelBefore: true }),
        book.node('ringed', fam, { badge: true }),
      ];
    case 'deprecated':
      return [
        book.node('deprecated', F_CONTENT, { secondary: renamed, badge: true }),
        book.node('ringed', F_CONTENT, { labelBefore: true }),
        book.node('deprecated', F_CONTENT, { badge: true }),
      ];
    case 'merge-source':
      return [
        book.node('ghost', F_IDENTITY, { strike: true }),
        book.node('solid', F_IDENTITY, { labelBefore: true }),
        n.presentAfter ? book.node('deprecated', F_CONTENT) : HIDDEN_NODE,
      ];
    case 'merge-target':
    case 'split-target': {
      // Before: "neutral or own facet" (`familyBefore`).
      const own = familyCode(n.familyBefore);
      const before = !n.presentBefore
        ? HIDDEN_NODE
        : own === F_NEUTRAL
          ? book.node('neutral', F_NEUTRAL)
          : book.node('ringed', own, { labelBefore: true });
      return [
        book.node('ringHalo', F_IDENTITY, { secondary: renamed, badge: true }),
        before,
        book.node('ringHalo', F_IDENTITY, { badge: true }),
      ];
    }
    case 'split-source':
      return [
        n.presentAfter
          ? book.node('ringHalo', F_IDENTITY, { secondary: renamed, badge: true })
          : book.node('ghost', F_IDENTITY, { strike: true }),
        book.node('solid', F_IDENTITY, { labelBefore: true }),
        n.presentAfter ? book.node('ringHalo', F_IDENTITY, { badge: true }) : HIDDEN_NODE,
      ];
    default:
      return assertNever(n.role);
  }
}

/** [union, before, after] styles of an edge (docs/visual-language.md §Layer encodings). */
export function edgeLayerStyles(
  book: StyleBook,
  e: SceneEdge,
): readonly [EdgeStyle, EdgeStyle, EdgeStyle] {
  const fam = familyCode(e.family);
  const relabeled = e.labelBefore !== undefined;
  switch (e.role) {
    case 'unchanged': {
      const s = book.edge('neutral', F_NEUTRAL, false, EL_NONE);
      return [s, s, s];
    }
    case 'added': {
      const s = book.edge('solid', F_ADDED, false, EL_CURRENT);
      return [s, HIDDEN_EDGE, s];
    }
    case 'removed':
      return [
        book.edge('dashed', F_REMOVED, false, EL_CURRENT, true),
        book.edge('solid', F_REMOVED, false, EL_CURRENT),
        HIDDEN_EDGE,
      ];
    case 'modified':
      return [
        book.edge('solid', fam, false, relabeled ? EL_UNION : EL_CURRENT),
        book.edge('solid', fam, false, EL_BEFORE),
        book.edge('solid', fam, false, EL_CURRENT),
      ];
    case 'retarget':
    case 'carried':
      return [
        book.edge('solid', fam, false, relabeled ? EL_UNION : EL_CURRENT),
        book.edge('solid', fam, true, EL_BEFORE),
        book.edge('solid', fam, false, EL_CURRENT),
      ];
    case 'collapsed':
      return [
        book.edge('collapsed', F_IDENTITY, false, EL_CURRENT, true),
        book.edge('solid', F_IDENTITY, false, EL_CURRENT),
        HIDDEN_EDGE,
      ];
    default:
      return assertNever(e.role);
  }
}
