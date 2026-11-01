/**
 * Numeric constants of the visual language (docs/visual-language.md §Geometry, §Typography,
 * §Level of detail, §Replay choreography). One place so every module agrees.
 */

/** Stroke widths in screen px (constant under zoom). */
export const STROKE = {
  neutralEdge: 1,
  changedEdge: 1.75,
  selectedEdge: 2.5,
  node: 1.25,
  hoveredNode: 2,
  ring: 1.5,
  /** Gap between the node boundary and its ring, px. */
  ringGap: 3.5,
  glyph: 1.5,
  suggestion: 1.25,
  /** Diameter of a pivot dot, px. */
  pivot: 5,
} as const;

/** Dash patterns, px. Frozen so they can be shared by every visual without copying. */
export const DASH_GHOST: readonly number[] = Object.freeze([3, 2.5]);
export const DASH_EDGE: readonly number[] = Object.freeze([4, 3]);
export const DASH_DOTTED: readonly number[] = Object.freeze([1, 3]);

export const HALO = {
  /** Dark themes: radial glow radius as a multiple of r. */
  glowScale: 2.6,
  glowAlpha: 0.32,
  /** Light themes: offset ring; `radius` is r and renderers draw the ring 5 px outside it, 2 px wide. */
  ringAlpha: 0.35,
  ringOffset: 5,
  ringWidth: 2,
} as const;

/** Label typography in px. */
export const LABEL = {
  size: 12,
  oldSize: 11,
  edgeSize: 10.5,
  /** Gap between the node's bottom and its label, px (`offset = r·k + 5 px`). */
  offset: 5,
  /** Secondary label sits this much lower than the primary one. */
  secondaryGap: 14,
  /** Line box used for bounds estimation (font size × line height). */
  lineHeight: 1.3,
} as const;

/**
 * Level-of-detail thresholds (camera zoom). Label thresholds are permissive on purpose: the
 * renderer's greedy collision culling decides what fits, so the overview of a small graph is
 * not a field of anonymous dots.
 */
export const LOD = {
  changedLabel: 0.35,
  neutralLabel: 0.5,
  importantNeutralLabel: 0.35,
  importantThreshold: 0.7,
  /** Scenes with at most this many visible nodes (after focus) use the small-scene thresholds. */
  smallScene: 300,
  smallChangedLabel: 0.2,
  smallNeutralLabel: 0.25,
  edgeLabel: 1.1,
  badge: 1.2,
  /** Renderers draw arrowheads on edges with `arrow: false` from this zoom on. */
  arrow: 1.2,
} as const;

/** Parallel edges between one pair curve with ±k·this (k = 1, 2, …). */
export const PARALLEL_CURVATURE = 0.18;

/** Alpha levels of the selection spotlight, the replay spotlight, filters and focus. */
export const EMPHASIS = {
  selectedContext: 0.7,
  selectedRest: 0.18,
  replayContext: 0.7,
  replayRest: 0.3,
  filtered: 0.4,
  focusContext: 0.55,
  ghostEdge: 0.45,
  collapsedEdge: 0.5,
} as const;

/** Replay window phases as fractions of the window (spotlight / transform / settle). */
export const PHASE = {
  spotlightEnd: 0.18,
  settleStart: 0.82,
} as const;

/** Replay timeline (docs/algorithms.md §10). */
export const TIMELINE = {
  pace: 1100,
  chapterThreshold: 40,
  gap: 160,
  maxStagger: 0.35,
} as const;
