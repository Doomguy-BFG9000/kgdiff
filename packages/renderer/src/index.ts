/**
 * @kgdiff/renderer: high-DPI Canvas 2D renderer for kgdiff scenes.
 *
 * The renderer draws `FrameVisuals` (from @kgdiff/scene) and owns everything
 * pixel-related: camera, culling, level of detail, label placement, hit
 * testing, swipe clipping and the minimap. It knows nothing about diffs.
 *
 * Quality bars: docs/visual-language.md §Rendering and docs/architecture.md §Budgets.
 *
 * Primitive semantics follow @kgdiff/scene's types: nested alphas (label, ring, halo, badge)
 * multiply with their owner's; the curve convention is shared by edges and glyphs; arrowheads
 * follow `EdgeVisual.arrowMinZoom`; glyph kinds this version does not know draw as plain lines.
 */
import type { Point, Rect } from '@kgdiff/core';
import type { CollapsedGroup, FrameVisuals, Theme } from '@kgdiff/scene';
import { createMinimapImpl } from './minimap.js';
import { createRendererImpl } from './renderer.js';

/** World center + zoom. screen = (world − (x, y)) · k + viewportCenter. */
export interface CameraState {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

export interface CameraTransitionOptions {
  /** Extra space around the bounds, px. Default 48. */
  readonly padding?: number | { top: number; right: number; bottom: number; left: number };
  /** Default true (false when reduced motion). */
  readonly animate?: boolean;
  /** Override the computed duration (ms). */
  readonly duration?: number;
  /** Never zoom in beyond this. Default 2.5. */
  readonly maxZoom?: number;
}

export interface Camera {
  get(): CameraState;
  /** Jump (cancels any running transition). */
  set(state: CameraState): void;
  /** Smooth zoom-and-pan (van Wijk–Nuij) so `bounds` fills the viewport. Resolves when done or cancelled. */
  flyTo(bounds: Rect, options?: CameraTransitionOptions): Promise<void>;
  /** Fit the given bounds (or the frame's content bounds). */
  fit(bounds?: Rect, options?: CameraTransitionOptions): Promise<void>;
  /**
   * Multiply the zoom by `factor`, keeping the world point under `around` fixed (screen px,
   * canvas-relative; default the viewport centre). Animated unless `animate: false` or
   * reduced motion; repeated calls compound the target.
   */
  zoomBy(factor: number, around?: Point, options?: { readonly animate?: boolean }): void;
  /** Move the content by (dx, dy) screen px (positive dx moves it right). Cancels motions. */
  panBy(dx: number, dy: number): void;
  worldToScreen(p: Point): Point;
  screenToWorld(p: Point): Point;
  /** The part of the world currently visible. */
  viewport(): Rect;
}

export interface PickResult {
  readonly type: 'node' | 'edge' | 'collapsed';
  /** Node / edge index into the scene, or collapsed-group index. */
  readonly index: number;
}

/** Swipe comparison: `before` drawn left of `split`, `after` right of it. */
export interface SplitFrame {
  /** Divider position as a fraction of the viewport width, [0, 1]. */
  readonly split: number;
  readonly before: FrameVisuals;
  readonly after: FrameVisuals;
}

export interface RendererEvents {
  hover: PickResult | null;
  click: {
    readonly pick: PickResult | null;
    readonly world: Point;
    readonly event: PointerEvent | MouseEvent;
  };
  dblclick: { readonly pick: PickResult | null; readonly world: Point; readonly event: MouseEvent };
  /**
   * The camera moved (at most once per frame, and when the viewport is resized). `source` is
   * 'user' when any change in that frame came from input (drag, wheel, pinch, inertia, minimap)
   * and 'program' for API calls (`set`, `flyTo`, `fit`, `zoomBy`, `panBy`) and resizes.
   */
  camera: CameraState & { readonly source: 'user' | 'program' };
  /** Fired after each drawn frame with its draw time. */
  frame: { readonly ms: number };
}

export interface RendererOptions {
  readonly theme: Theme;
  /** Default `window.devicePixelRatio`, capped at 3. */
  readonly pixelRatio?: number;
  /** Default 0.05. */
  readonly minZoom?: number;
  /** Default 6. */
  readonly maxZoom?: number;
  /** Pan / zoom / pick with pointer, wheel and touch. Default true. */
  readonly interactive?: boolean;
  /** Draw the dot grid. Default true. */
  readonly grid?: boolean;
  /** Insets (px) the camera keeps clear when fitting, e.g. for floating UI. */
  readonly safeArea?: { top: number; right: number; bottom: number; left: number };
  /** Keep labels whole inside the canvas (see `Renderer.setLabelsInside`). Default false. */
  readonly labelsInside?: boolean;
}

export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly camera: Camera;
  /** What to draw. Cheap: only marks the frame dirty; drawing happens on the next animation frame. */
  setFrame(frame: FrameVisuals | SplitFrame): void;
  setTheme(theme: Theme): void;
  setSafeArea(area: { top: number; right: number; bottom: number; left: number }): void;
  /**
   * Keep labels whole inside the canvas: a label that has no free spot inside is left out, like
   * one that collides, instead of being cut at the edge. Off by default, so labels slide off the
   * edges while panning; for views without camera controls, fitted with `labelFootprint`.
   */
  setLabelsInside(inside: boolean): void;
  /** Topmost element under a screen point (px, relative to the canvas). */
  pick(x: number, y: number): PickResult | null;
  on<K extends keyof RendererEvents>(
    type: K,
    listener: (event: RendererEvents[K]) => void,
  ): () => void;
  /** Re-measure the container (called automatically through ResizeObserver). */
  resize(): void;
  requestRender(): void;
  /** PNG snapshot of the current view at the given scale (default pixelRatio). */
  toDataURL(scale?: number): string;
  destroy(): void;
}

export interface MinimapOptions {
  /** px, default 184 × 128. */
  readonly width?: number;
  readonly height?: number;
}

export interface Minimap {
  readonly canvas: HTMLCanvasElement;
  /** Redraw marks (call when the frame or theme changes; viewport tracking is automatic). */
  update(frame: FrameVisuals, collapsed?: readonly CollapsedGroup[]): void;
  destroy(): void;
}

/**
 * Create a renderer that fills `container` (which should be position: relative).
 *
 * The first frame with content is fitted automatically unless the camera was moved before.
 * Throws `KgdiffError('invalid-input')` for an invalid container or zoom / pixel-ratio options.
 */
export function createRenderer(container: HTMLElement, options: RendererOptions): Renderer {
  return createRendererImpl(container, options);
}

/**
 * A minimap bound to `renderer`: change marks, viewport rectangle, click / drag to navigate.
 * Call `update` when the frame changes; viewport and theme changes are tracked automatically.
 */
export function createMinimap(
  container: HTMLElement,
  renderer: Renderer,
  options?: MinimapOptions,
): Minimap {
  return createMinimapImpl(container, renderer, options);
}

/**
 * What a frame covers at any zoom with every label in its first-choice spot (`footprint.at(k)`,
 * a world rect), for fits that leave room for the labels: they keep their pixel size, so node
 * positions alone do not say what a fit must show.
 */
export { type LabelFootprint, labelFootprint } from './label-footprint.js';
