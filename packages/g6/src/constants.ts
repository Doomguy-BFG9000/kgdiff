/**
 * Numbers and names shared by the mapping, the custom node and the controller.
 *
 * Scene sizes marked "px" (stroke widths, gaps, font sizes, label offsets) become G6 world
 * units: G6 scales everything with the camera, so they read as specified at zoom 1.
 */

/** Element type of the custom node registered by `createDiffGraph` (see node.ts). */
export const NODE_TYPE = 'kgdiff-node';

/** Element state set by the hover behavior (a private name, so G6 theme states never apply). */
export const HOVER_STATE = 'kgdiff-hover';

/** Key of the hover behavior and of the background plugin in the generated G6 options. */
export const HOVER_BEHAVIOR_KEY = 'kgdiff-hover';
export const BACKGROUND_PLUGIN_KEY = 'kgdiff-background';

/** Id prefixes of generated elements that are not scene nodes / edges. */
export const GLYPH_ID_PREFIX = 'kgdiff-glyph-';
export const COLLAPSED_ID_PREFIX = 'kgdiff-collapsed-';
export const ANCHOR_ID_PREFIX = 'kgdiff-anchor-';

/**
 * zIndex bands. G6 draws nodes and edges in one container ordered by zIndex, so every element
 * gets an explicit band: collapsed pills < edges < glyph arcs < nodes < pivot dots (the native
 * renderer's pass order). The scene's `z` (0–4) orders elements inside their band.
 */
export const Z = {
  collapsed: 0,
  edge: 10,
  glyph: 20,
  node: 30,
  pivot: 40,
  /** Width of a band: scene `z` values are clamped to [0, span). */
  span: 10,
} as const;

/** Arrowheads (docs/visual-language.md §Geometry): 7 long, 5 wide. */
export const ARROW_LENGTH = 7;
export const ARROW_WIDTH = 5;
/** Gap between an arrow tip and the node outline. */
export const ARROW_GAP = 1.5;

/** Text halo: stroked with the canvas background, 3 wide, alpha 0.9, round joins. */
export const TEXT_HALO_WIDTH = 3;
export const TEXT_HALO_ALPHA = 0.9;

/** Labels wider than this are truncated with an ellipsis (as in the native renderer). */
export const LABEL_MAX_WIDTH = 240;

/** Light-theme halo: an offset ring `r + 5` out, 2 wide. */
export const HALO_RING_OFFSET = 5;
export const HALO_RING_WIDTH = 2;
/** Dark-theme glows are never smaller than this multiple of r. */
export const GLOW_MIN_SCALE = 1.6;

/** Badges: 10 px mono, weight 600, 15 px pills with 5 px horizontal padding. */
export const BADGE_FONT_SIZE = 10;
export const BADGE_HEIGHT = 15;
export const BADGE_PAD_X = 5;

/** Collapsed-group pills (“+38 unchanged”): 20 px high, 8 px padding, 11 px / 500 text. */
export const PILL_HEIGHT = 20;
export const PILL_PAD_X = 8;
export const PILL_FONT_SIZE = 11;

/** Suggestion `?` mark: a 7-radius disc at the curve midpoint. */
export const MARK_RADIUS = 7;

/** Pivot dots get a background outline this wide so they stand out from what is under them. */
export const PIVOT_OUTLINE = 1.5;

/** Hovered strokes (STROKE.hoveredNode / STROKE.selectedEdge in @kgdiff/scene). */
export const HOVER_NODE_WIDTH = 2;
export const HOVER_EDGE_WIDTH = 2.5;
/** Edge label size used when hovering reveals a label the frame does not carry. */
export const EDGE_LABEL_SIZE = 10.5;

/** Extra hit width around thin edges so they can be hovered and clicked. */
export const EDGE_HIT_WIDTH = 6;

/**
 * Replay sampling: each timeline window (chapter in chapter mode) is resolved at these fractions
 * of its duration: end of the spotlight, middle of the transform, start of the settle, end.
 * G6 animates linearly between consecutive samples.
 */
export const REPLAY_SAMPLES: readonly number[] = Object.freeze([0.18, 0.5, 0.82, 1]);
/**
 * A draw is awaited at most its animation duration plus this long (ms): G6 settles a draw when
 * its animation ends, and browsers pause animations in background pages.
 */
export const DRAW_GRACE_MS = 1000;
/** Replay steps shorter than this (ms, after speed scaling) are merged into the next one. */
export const MIN_STEP_MS = 16;
/** The camera follows a replay unit when less than this share of its bounds is in view. */
export const FOLLOW_VISIBLE_SHARE = 0.7;
