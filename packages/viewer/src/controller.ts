/**
 * Viewer state and orchestration, independent of the UI:
 *
 * - load pipeline with progress steps (sources or a precomputed report);
 * - mode, selection (with an animated spotlight `emphasis`), family filters, review progress;
 * - changes-only focus with expandable collapsed groups (`extendLayout` + scene rebuild);
 * - replay clock driven by one requestAnimationFrame loop that sleeps when idle, with a camera
 *   that follows the playing hunk / chapter unless the user moved it in the last 2 s;
 * - swipe position, hover, theme / palette / locale (rebuilding the scene when they change).
 *
 * The UI subscribes to topic notifications (batched per microtask) and reads public fields.
 */
import type { DiffResult, DiffStats, Locale, Rect, UnionId } from '@kgdiff/core';
import { KgdiffError } from '@kgdiff/core';
import type { LayoutResult } from '@kgdiff/layout';
import type { Camera, CameraState, Minimap, PickResult, Renderer } from '@kgdiff/renderer';
import {
  buildScene,
  type ChangeFamily,
  computeFocus,
  createViewState,
  createVisualResolver,
  type FocusState,
  type FrameVisuals,
  frameBounds,
  getTheme,
  type Layer,
  type PaletteName,
  type Scene,
  type Theme,
  type ThemeName,
  type ViewState,
  type VisualResolver,
} from '@kgdiff/scene';
import { computeNow, computeStatus, loadCompute } from './compute-loader.js';
import {
  type ChromeLayout,
  chromeInsets,
  FRAME_PADDING,
  freeView,
  type Insets,
  NO_INSETS,
} from './framing.js';
import { translate } from './i18n.js';
import type {
  LoadOptions,
  ReportPayload,
  ReviewState,
  ThemePreference,
  ViewerMode,
} from './index.js';
import { buildList, EMPTY_LIST, type ListModel, stepHunk } from './list-model.js';
import { type LoadedDiff, type LoadStep, readPayload, runLoad } from './pipeline.js';
import { toLocale, toMode, toPalette, toTheme } from './prefs.js';
import { renderBackend } from './renderer-port.js';
import { ReplayClock } from './replay.js';
import { ReviewStore, reviewKey, type StorageLike } from './review-store.js';
import { type SearchHit, SearchIndex } from './search.js';

export type Status = 'idle' | 'loading' | 'ready' | 'error';

export type Topic =
  | 'status'
  | 'data'
  | 'mode'
  | 'selection'
  | 'filters'
  | 'review'
  | 'replay'
  | 'hover'
  | 'theme'
  | 'locale'
  | 'focus'
  | 'swipe';

export interface ControllerHost {
  ready(stats: DiffStats): void;
  select(hunk: string | null, node: string | null): void;
  mode(mode: ViewerMode): void;
  review(hunk: string, reviewed: boolean, progress: ReviewState): void;
  error(error: Error): void;
  announce(text: string): void;
}

export interface ControllerDeps {
  readonly now: () => number;
  readonly requestFrame: (cb: (time: number) => void) => number;
  readonly cancelFrame: (id: number) => void;
  /** Resolves once the browser had a chance to paint (between loading steps). */
  readonly yieldToPaint: () => Promise<void>;
  readonly storage: StorageLike | null;
}

export type Preference = 'mode' | 'theme' | 'palette' | 'locale';

/** Camera follow is suppressed this long after the user moved the camera (ms). */
export const USER_CAMERA_GRACE = 2000;
/** The camera follows when less than this share of the target bounds is in view. */
export const FOLLOW_COVERAGE = 0.7;
/** Spotlight emphasis restarts here when switching directly between two hunks. */
const SWITCH_EMPHASIS = 0.35;
/** Flights to a change never zoom in further, so its neighbourhood stays readable. */
export const FLY_MAX_ZOOM = 1.8;
/** Fitting everything never zooms in further (the renderer's default). */
export const FIT_MAX_ZOOM = 2.5;
/** Minimap marks are re-rasterized at most this often while replaying (ms). */
const MINIMAP_INTERVAL = 200;

class Superseded extends Error {}

interface Frames {
  main: FrameVisuals | null;
  before: FrameVisuals | null;
  after: FrameVisuals | null;
}

interface EmphasisAnimation {
  readonly from: number;
  readonly to: number;
  readonly start: number;
  readonly duration: number;
}

/** Share of `bounds` inside `view`, in [0, 1]. */
export function coverage(bounds: Rect, view: Rect): number {
  const w = Math.min(bounds.x + bounds.width, view.x + view.width) - Math.max(bounds.x, view.x);
  const h = Math.min(bounds.y + bounds.height, view.y + view.height) - Math.max(bounds.y, view.y);
  const area = bounds.width * bounds.height;
  if (!(area > 0)) {
    const inside =
      bounds.x >= view.x &&
      bounds.x <= view.x + view.width &&
      bounds.y >= view.y &&
      bounds.y <= view.y + view.height;
    return inside ? 1 : 0;
  }
  return w > 0 && h > 0 ? (w * h) / area : 0;
}

const ease = (u: number): number => 1 - (1 - u) ** 3;

export class ViewerController {
  status: Status = 'idle';
  /** Steps of the current load, in order; `step` is the running one. */
  steps: LoadStep[] = [];
  step: LoadStep | null = null;
  error: Error | null = null;

  data: LoadedDiff | null = null;
  layout: LayoutResult | null = null;
  scene: Scene | null = null;
  resolver: VisualResolver | null = null;
  list: ListModel = EMPTY_LIST;

  mode: ViewerMode = 'overlay';
  themePreference: ThemePreference = 'auto';
  palette: PaletteName = 'default';
  locale: Locale = 'en';
  systemDark = true;
  reducedMotion = false;
  /** Preferences set explicitly by the embedder (a report's `view` does not override them). */
  readonly explicit = new Set<Preference>();

  selectedHunk = -1;
  selectedNode = -1;
  /** An edge emphasized from the detail panel (drawn as hovered). */
  pinnedEdge = -1;
  hoverNode = -1;
  hoverEdge = -1;
  hoverGroup = -1;
  readonly families = new Set<ChangeFamily>();
  hops = 1;
  readonly expanded = new Set<UnionId>();
  focus: FocusState | null = null;
  clock: ReplayClock | null = null;
  split = 0.5;
  emphasis = 1;

  #review: ReviewStore | null = null;
  #searchIndex: SearchIndex | null = null;
  #renderer: Renderer | null = null;
  #minimap: Minimap | null = null;
  readonly #unbind: (() => void)[] = [];
  readonly #frames: Frames = { main: null, before: null, after: null };
  #fadingHunk = -1;
  #emphasisAnim: EmphasisAnimation | null = null;
  #rafId = 0;
  #lastTick = 0;
  #frameDirty = false;
  #minimapDirty = true;
  #lastMinimap = Number.NEGATIVE_INFINITY;
  #lastUserCamera = Number.NEGATIVE_INFINITY;
  #followed = '';
  #loadToken = 0;
  #pendingHunk: { readonly id: string; readonly fly: boolean } | null = null;
  #chrome: (() => ChromeLayout) | null = null;
  /** Camera kept across detach / attach (element moved in the DOM). */
  #savedCamera: CameraState | null = null;
  /** A new diff is installed but has not been fitted to a laid-out canvas yet. */
  #needsFit = false;
  readonly #listeners = new Set<(topics: ReadonlySet<Topic>) => void>();
  #pendingTopics = new Set<Topic>();
  #flushQueued = false;
  #destroyed = false;

  readonly #host: ControllerHost;
  readonly #deps: ControllerDeps;

  constructor(host: ControllerHost, deps: ControllerDeps) {
    this.#host = host;
    this.#deps = deps;
  }

  // ─── Subscriptions ────────────────────────────────────────────────────────

  subscribe(listener: (topics: ReadonlySet<Topic>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(...topics: Topic[]): void {
    for (const t of topics) this.#pendingTopics.add(t);
    if (this.#flushQueued) return;
    this.#flushQueued = true;
    queueMicrotask(() => this.flush());
  }

  /** Deliver pending notifications now (also used by tests). */
  flush(): void {
    this.#flushQueued = false;
    if (this.#pendingTopics.size === 0) return;
    const topics = this.#pendingTopics;
    this.#pendingTopics = new Set();
    for (const fn of this.#listeners) fn(topics);
  }

  // ─── Derived state ────────────────────────────────────────────────────────

  get themeName(): ThemeName {
    if (this.themePreference === 'auto') return this.systemDark ? 'dark' : 'light';
    return this.themePreference;
  }

  get theme(): Theme {
    try {
      return getTheme(this.themeName, this.palette);
    } catch {
      return getTheme('dark', 'default');
    }
  }

  get diff(): DiffResult | null {
    return this.data?.diff ?? null;
  }

  get hunkCount(): number {
    return this.scene?.hunks.length ?? 0;
  }

  isReviewed(hunkId: string): boolean {
    return this.#review?.has(hunkId) ?? false;
  }

  reviewState(): ReviewState {
    return this.#review?.state() ?? { reviewed: [], total: 0 };
  }

  search(query: string, limit?: number): SearchHit[] {
    const diff = this.diff;
    if (!diff) return [];
    this.#searchIndex ??= new SearchIndex(diff);
    return this.#searchIndex.search(query, limit);
  }

  // ─── Loading ──────────────────────────────────────────────────────────────

  async load(options: LoadOptions): Promise<void> {
    const text = (s: unknown): boolean =>
      typeof s === 'object' && s !== null && typeof (s as { text?: unknown }).text === 'string';
    const parse = text(options?.before) || text(options?.after);
    await this.#run(
      parse ? ['parse', 'match', 'layout', 'scene'] : ['match', 'layout', 'scene'],
      (onStep) => runLoad(options, onStep),
    );
  }

  async loadPayload(payload: ReportPayload): Promise<void> {
    await this.#run(['match', 'layout', 'scene'], (onStep) => readPayload(payload, onStep));
  }

  async #run(
    planned: LoadStep[],
    work: (onStep: (step: LoadStep) => Promise<void>) => Promise<LoadedDiff>,
  ): Promise<void> {
    const token = ++this.#loadToken;
    this.pause();
    this.status = 'loading';
    this.error = null;
    this.steps = planned;
    this.step = null;
    this.#notify('status');
    const onStep = async (step: LoadStep): Promise<void> => {
      if (token !== this.#loadToken || this.#destroyed) throw new Superseded();
      this.step = step;
      this.#notify('status');
      this.flush();
      await this.#deps.yieldToPaint();
      if (token !== this.#loadToken || this.#destroyed) throw new Superseded();
    };
    try {
      const loaded = await work(onStep);
      await onStep('scene');
      this.#install(loaded);
    } catch (error) {
      if (error instanceof Superseded) {
        throw new DOMException('Superseded by a newer load.', 'AbortError');
      }
      const err = error instanceof Error ? error : new KgdiffError('invalid-input', String(error));
      if (token === this.#loadToken) this.fail(err);
      throw err;
    }
  }

  /** Show an error state (bad payload, failed load). */
  fail(error: Error): void {
    this.#loadToken++;
    this.clock?.pause();
    this.status = 'error';
    this.error = error;
    this.step = null;
    // Nothing stale stays on screen next to the error.
    this.data = null;
    this.layout = null;
    this.scene = null;
    this.resolver = null;
    this.list = EMPTY_LIST;
    this.clock = null;
    this.focus = null;
    this.#review = null;
    this.selectedHunk = this.selectedNode = this.pinnedEdge = -1;
    this.#notify('status', 'data', 'selection', 'filters', 'review', 'replay', 'focus');
    this.#host.error(error);
  }

  #install(loaded: LoadedDiff): void {
    const { diff, layout, view } = loaded;
    this.data = loaded;
    this.layout = layout;
    this.#searchIndex = null;
    this.families.clear();
    this.expanded.clear();
    this.hops = Math.max(0, Math.min(2, loaded.layoutOptions?.contextHops ?? 1));
    this.selectedHunk = -1;
    this.selectedNode = -1;
    this.pinnedEdge = -1;
    this.#fadingHunk = -1;
    this.emphasis = 1;
    this.#emphasisAnim = null;
    this.hoverNode = this.hoverEdge = this.hoverGroup = -1;
    this.split = 0.5;
    this.clock = null;
    this.#followed = '';
    if (view) {
      if (view.theme && !this.explicit.has('theme')) this.themePreference = view.theme;
      if (view.palette && !this.explicit.has('palette')) this.palette = view.palette;
      if (view.locale && !this.explicit.has('locale')) this.locale = view.locale;
    }
    const previousMode = this.mode;
    if (!this.explicit.has('mode')) {
      const threshold = loaded.layoutOptions?.largeGraphThreshold ?? 3000;
      const large = layout.scope === 'changes' || diff.nodes.length > threshold;
      this.mode = view?.mode ?? (large ? 'changes' : 'overlay');
    }
    this.#review = new ReviewStore(
      this.#deps.storage,
      reviewKey(diff.delta.base.hash, diff.delta.target.hash),
      diff.hunks.map((h) => h.id),
    );
    this.#rebuildScene();
    this.status = 'ready';
    this.step = null;
    if (layout.scope === 'changes' && computeStatus() === 'unknown') {
      // Learn early whether out-of-layout groups can be expanded (standalone reports).
      loadCompute().then(
        () => this.#notify('focus'),
        () => this.#notify('focus'),
      );
    }
    this.#notify(
      'status',
      'data',
      'mode',
      'selection',
      'filters',
      'review',
      'replay',
      'theme',
      'locale',
      'focus',
      'swipe',
    );
    // A new diff starts fitted, after the UI has shown its chrome (the notification above is
    // delivered first) and once the canvas has a size (see `layoutChanged`).
    this.#needsFit = true;
    this.#savedCamera = null;
    queueMicrotask(() => this.layoutChanged());
    this.#host.ready(diff.stats);
    if (this.mode !== previousMode) this.#host.mode(this.mode);
    const pending = this.#pendingHunk;
    this.#pendingHunk = null;
    if (pending !== null) this.selectHunkById(pending.id, { fly: pending.fly });
  }

  /** (Re)build scene, resolver, list, clock and focus; selection is carried over by id. */
  #rebuildScene(): void {
    const data = this.data;
    const layout = this.layout;
    if (!data || !layout) return;
    const old = this.scene;
    const keepHunk = old && this.selectedHunk >= 0 ? old.hunks[this.selectedHunk]?.id : undefined;
    const keepNode = old && this.selectedNode >= 0 ? old.nodes[this.selectedNode]?.id : undefined;
    const keepEdge = old && this.pinnedEdge >= 0 ? old.edges[this.pinnedEdge]?.id : undefined;
    const scene = buildScene(data.diff, layout, { theme: this.theme, locale: this.locale });
    this.scene = scene;
    this.resolver = createVisualResolver(scene);
    this.#frames.main = this.#frames.before = this.#frames.after = null;
    const prevClock = this.clock;
    this.clock = new ReplayClock(scene.timeline);
    if (prevClock) {
      this.clock.setSpeed(prevClock.speed);
      this.clock.seek(prevClock.t);
      if (prevClock.playing) this.clock.play();
    }
    this.selectedHunk = keepHunk !== undefined ? (scene.hunkIndex.get(keepHunk) ?? -1) : -1;
    this.selectedNode = keepNode !== undefined ? (scene.nodeIndex.get(keepNode) ?? -1) : -1;
    this.pinnedEdge = keepEdge !== undefined ? (scene.edgeIndex.get(keepEdge) ?? -1) : -1;
    this.#fadingHunk = -1;
    this.hoverNode = this.hoverEdge = this.hoverGroup = -1;
    this.list = buildList(scene, this.families);
    this.#updateFocus();
    this.#renderer?.setTheme(scene.theme);
    this.#minimapDirty = true;
    this.invalidate();
  }

  #updateFocus(): void {
    const scene = this.scene;
    if (!scene || this.mode !== 'changes') {
      this.focus = null;
      return;
    }
    const expanded = new Set<number>();
    for (const id of this.expanded) {
      const i = scene.nodeIndex.get(id);
      if (i !== undefined) expanded.add(i);
    }
    this.focus = computeFocus(scene, { hops: this.hops, expanded });
  }

  // ─── Renderer ─────────────────────────────────────────────────────────────

  attach(stage: HTMLElement, minimapHost: HTMLElement | null): void {
    if (this.#renderer) return;
    const backend = renderBackend();
    const renderer = backend.createRenderer(stage, { theme: this.theme });
    this.#renderer = renderer;
    // Re-attached (element moved): keep the view; this also stops the renderer's auto-fit.
    if (this.#savedCamera) renderer.camera.set(this.#savedCamera);
    if (minimapHost) this.#minimap = backend.createMinimap(minimapHost, renderer);
    this.#unbind.push(
      renderer.on('hover', (pick) => this.#onHover(pick)),
      renderer.on('click', ({ pick }) => this.#onCanvasClick(pick)),
      renderer.on('dblclick', ({ pick }) => this.#onCanvasDblClick(pick)),
      renderer.on('camera', ({ source }) => {
        if (source === 'user') this.noteUserCamera();
      }),
    );
    this.#minimapDirty = true;
    this.invalidate();
  }

  detach(): void {
    // A pending initial fit still runs after re-attach (`layoutChanged`), overriding this.
    if (this.#renderer && this.status === 'ready') this.#savedCamera = this.#renderer.camera.get();
    if (this.#rafId) this.#deps.cancelFrame(this.#rafId);
    this.#rafId = 0;
    for (const fn of this.#unbind.splice(0)) fn();
    this.#minimap?.destroy();
    this.#minimap = null;
    this.#renderer?.destroy();
    this.#renderer = null;
  }

  destroy(): void {
    this.#destroyed = true;
    this.detach();
    this.#listeners.clear();
  }

  get camera(): Camera | null {
    return this.#renderer?.camera ?? null;
  }

  /**
   * Where floating chrome covers the canvas (measured by the element at fit / flight time).
   * Every fit and flight frames its target in the free part of the canvas (`framing.ts`).
   */
  setChrome(provider: (() => ChromeLayout) | null): void {
    this.#chrome = provider;
  }

  /** The canvas was laid out or resized: run the initial fit a new diff is waiting for. */
  layoutChanged(): void {
    if (!this.#needsFit || this.status !== 'ready') return;
    // A selection made before the first layout (deep link, `kgdiff-ready` handler) wins.
    const target = this.#selectionBounds();
    if (target) {
      if (!this.#frameInsets(target, FLY_MAX_ZOOM)) return;
      this.#needsFit = false;
      this.#flyTo(target, { animate: false });
      return;
    }
    const bounds = this.#contentBounds();
    const padding = bounds ? this.#frameInsets(bounds, FIT_MAX_ZOOM) : null;
    const camera = this.#renderer?.camera;
    if (!bounds || !padding || !camera) return;
    this.#needsFit = false;
    void camera.fit(bounds, { animate: false, padding, maxZoom: FIT_MAX_ZOOM });
  }

  /** The user panned / zoomed: suspend replay camera follow for `USER_CAMERA_GRACE`. */
  noteUserCamera(): void {
    this.#lastUserCamera = this.#deps.now();
  }

  // ─── Frame loop ───────────────────────────────────────────────────────────

  /** Redraw on the next animation frame. */
  invalidate(): void {
    this.#frameDirty = true;
    this.#schedule();
  }

  #schedule(): void {
    if (this.#rafId !== 0 || this.#destroyed) return;
    this.#rafId = this.#deps.requestFrame(this.#tick) || 0;
  }

  readonly #tick = (): void => {
    this.#rafId = 0;
    if (this.#destroyed) return;
    const now = this.#deps.now();
    const dt = this.#lastTick > 0 ? now - this.#lastTick : 0;
    let animating = false;
    const clock = this.clock;
    if (clock?.playing && this.mode === 'replay') {
      clock.advance(dt);
      this.#frameDirty = true;
      this.#notify('replay');
      this.#follow();
      if (clock.playing) animating = true;
      else if (clock.finished) this.#host.announce(translate(this.locale, 'announce.finished'));
    }
    if (this.#emphasisAnim) {
      const a = this.#emphasisAnim;
      const u = a.duration > 0 ? Math.min(1, (now - a.start) / a.duration) : 1;
      this.emphasis = a.from + (a.to - a.from) * ease(u);
      this.#frameDirty = true;
      if (u >= 1) {
        this.#emphasisAnim = null;
        if (this.#fadingHunk >= 0) {
          this.#fadingHunk = -1;
          this.emphasis = 1;
        }
      } else animating = true;
    }
    if (this.#frameDirty) this.draw(now);
    if (animating) {
      this.#lastTick = now;
      this.#schedule();
    } else this.#lastTick = 0;
  };

  #view(layer: Layer): ViewState {
    const selected = this.selectedHunk >= 0 ? this.selectedHunk : this.#fadingHunk;
    return createViewState({
      layer,
      t: this.clock?.t ?? 0,
      selectedHunk: selected,
      hoveredNode: this.hoverNode,
      hoveredEdge: this.hoverEdge >= 0 ? this.hoverEdge : this.pinnedEdge,
      selectedNode: this.selectedNode,
      focus: this.focus,
      families: this.families,
      reducedMotion: this.reducedMotion,
      emphasis: this.emphasis,
    });
  }

  /** Resolve the current view and hand it to the renderer (and the minimap). */
  draw(now = this.#deps.now()): void {
    this.#frameDirty = false;
    const resolver = this.resolver;
    const renderer = this.#renderer;
    if (!resolver || !renderer || this.status !== 'ready') return;
    const f = this.#frames;
    let mapFrame: FrameVisuals;
    if (this.mode === 'swipe') {
      f.before = resolver.resolve(this.#view('before'), f.before ?? undefined);
      f.after = resolver.resolve(this.#view('after'), f.after ?? undefined);
      renderer.setFrame({ split: this.split, before: f.before, after: f.after });
      mapFrame = f.after;
    } else {
      const layer: Layer = this.mode === 'replay' ? 'replay' : 'union';
      f.main = resolver.resolve(this.#view(layer), f.main ?? undefined);
      renderer.setFrame(f.main);
      mapFrame = f.main;
    }
    const replaying = this.mode === 'replay' && (this.clock?.playing ?? false);
    if (
      this.#minimap &&
      (this.#minimapDirty || (replaying && now - this.#lastMinimap >= MINIMAP_INTERVAL))
    ) {
      this.#minimap.update(mapFrame);
      this.#minimapDirty = false;
      this.#lastMinimap = now;
    }
  }

  #startEmphasis(from: number): void {
    if (this.reducedMotion) {
      this.emphasis = 1;
      this.#emphasisAnim = null;
      this.#fadingHunk = -1;
      return;
    }
    this.emphasis = from;
    this.#emphasisAnim = {
      from,
      to: 1,
      start: this.#deps.now(),
      duration: this.theme.motion.base,
    };
  }

  #fadeOutEmphasis(hunk: number): void {
    if (this.reducedMotion || hunk < 0) {
      this.#fadingHunk = -1;
      this.#emphasisAnim = null;
      this.emphasis = 1;
      return;
    }
    this.#fadingHunk = hunk;
    this.#emphasisAnim = {
      from: this.emphasis,
      to: 0,
      start: this.#deps.now(),
      duration: this.theme.motion.base,
    };
  }

  // ─── Mode ─────────────────────────────────────────────────────────────────

  setMode(value: ViewerMode): void {
    const mode = toMode(value);
    if (mode === null || mode === this.mode) return;
    this.mode = mode;
    if (mode !== 'replay') this.clock?.pause();
    this.#followed = '';
    this.#updateFocus();
    this.#minimapDirty = true;
    this.#notify('mode', 'focus', 'replay');
    this.invalidate();
    if (this.status === 'ready') {
      this.#host.mode(mode);
      this.#host.announce(
        translate(this.locale, 'announce.mode', { mode: translate(this.locale, `mode.${mode}`) }),
      );
    }
  }

  // ─── Selection ────────────────────────────────────────────────────────────

  selectHunkById(id: string | null, options: { fly?: boolean } = {}): void {
    if (id === null) {
      this.#pendingHunk = null;
      this.clearSelection();
      return;
    }
    const scene = this.scene;
    if (!scene || this.status !== 'ready') {
      this.#pendingHunk = { id, fly: options.fly ?? true };
      return;
    }
    const h = scene.hunkIndex.get(id);
    if (h !== undefined) this.selectHunk(h, options);
  }

  /**
   * Select hunk `h` (scene index; -1 clears). `node` focuses one of its nodes in the detail
   * panel. `fly` (default true) brings it into view. In replay, seeks to the end of its window.
   */
  selectHunk(h: number, options: { fly?: boolean; node?: number } = {}): void {
    const scene = this.scene;
    if (!scene) return;
    if (h < 0 || h >= scene.hunks.length) {
      this.clearSelection();
      return;
    }
    const node = options.node ?? -1;
    const prev = this.selectedHunk;
    const changed = prev !== h || this.selectedNode !== node;
    this.selectedHunk = h;
    this.selectedNode = node;
    this.pinnedEdge = -1;
    if (prev !== h) {
      this.#fadingHunk = -1;
      this.#startEmphasis(prev >= 0 ? SWITCH_EMPHASIS : 0);
      if (this.mode === 'replay' && this.clock) {
        const end = this.clock.windowEnd(h);
        this.clock.pause();
        if (end !== null) this.clock.seek(end);
        this.#followed = '';
        this.#notify('replay');
      }
    }
    if (options.fly ?? true) this.flyToHunk(h);
    this.invalidate();
    if (!changed) return;
    this.#notify('selection');
    const hunk = scene.hunks[h];
    if (!hunk) return;
    const nodeId = node >= 0 ? (scene.nodes[node]?.id ?? null) : null;
    this.#host.select(hunk.id, nodeId);
    if (prev !== h) {
      const rank = this.list.rank.get(h);
      this.#host.announce(
        translate(this.locale, 'announce.change', {
          i: (rank ?? h) + 1,
          n: rank !== undefined ? this.list.order.length : scene.hunks.length,
          title: hunk.title,
        }),
      );
    }
  }

  /** Select a node: its hunk when it has one, else the node itself. */
  selectNode(i: number, options: { fly?: boolean } = {}): void {
    const scene = this.scene;
    const n = scene?.nodes[i];
    if (!scene || !n) return;
    if (n.hunk >= 0) {
      this.selectHunk(n.hunk, { ...options, node: i });
      return;
    }
    const prev = this.selectedHunk;
    if (prev < 0 && this.selectedNode === i) {
      if (options.fly) this.flyToNode(i);
      return;
    }
    this.selectedHunk = -1;
    this.selectedNode = i;
    this.pinnedEdge = -1;
    if (prev >= 0) this.#fadeOutEmphasis(prev);
    if (options.fly) this.flyToNode(i);
    this.invalidate();
    this.#notify('selection');
    this.#host.select(null, n.id);
    this.#host.announce(
      translate(this.locale, 'announce.node', {
        label: n.label,
        status: translate(this.locale, `status.${n.status}`),
      }),
    );
  }

  clearSelection(): void {
    if (this.selectedHunk < 0 && this.selectedNode < 0 && this.pinnedEdge < 0) return;
    const prev = this.selectedHunk;
    this.selectedHunk = -1;
    this.selectedNode = -1;
    this.pinnedEdge = -1;
    this.#fadeOutEmphasis(prev);
    this.invalidate();
    this.#notify('selection');
    this.#host.select(null, null);
    this.#host.announce(translate(this.locale, 'announce.cleared'));
  }

  next(): void {
    this.#stepSelection(1);
  }

  prev(): void {
    this.#stepSelection(-1);
  }

  #stepSelection(direction: 1 | -1): void {
    const h = stepHunk(this.list, this.selectedHunk, direction);
    if (h >= 0) this.selectHunk(h);
  }

  first(): void {
    const h = this.list.order[0];
    if (h !== undefined) this.selectHunk(h);
  }

  last(): void {
    const h = this.list.order[this.list.order.length - 1];
    if (h !== undefined) this.selectHunk(h);
  }

  /** Emphasize an edge (from the detail panel) and fly to it. */
  pinEdge(j: number): void {
    const scene = this.scene;
    const e = scene?.edges[j];
    if (!scene || !e) return;
    this.pinnedEdge = j;
    const ids = [e.s, e.t, e.sb, e.tb];
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const i of ids) {
      const n = scene.nodes[i];
      if (!n) continue;
      x0 = Math.min(x0, n.x - n.r);
      y0 = Math.min(y0, n.y - n.r);
      x1 = Math.max(x1, n.x + n.r);
      y1 = Math.max(y1, n.y + n.r);
    }
    if (x0 <= x1) this.#flyTo(padRect({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }));
    this.invalidate();
  }

  // ─── Camera ───────────────────────────────────────────────────────────────

  /** Insets keeping `bounds` clear of the chrome over the canvas, or null before layout. */
  #frameInsets(bounds: Rect, maxZoom: number): Insets | null {
    const layout = this.#chrome?.();
    if (!layout || !(layout.width > 0) || !(layout.height > 0)) return null;
    return chromeInsets(bounds, layout, FRAME_PADDING, maxZoom);
  }

  #flyTo(bounds: Rect, options: { readonly animate?: boolean } = {}): void {
    const camera = this.#renderer?.camera;
    if (!camera) return;
    const padding = this.#frameInsets(bounds, FLY_MAX_ZOOM);
    void camera.flyTo(bounds, {
      ...options,
      maxZoom: FLY_MAX_ZOOM,
      ...(padding ? { padding } : {}),
    });
  }

  /** The world region visible outside the chrome, as framed for `bounds`. */
  #freeWorld(bounds: Rect): Rect | null {
    const camera = this.#renderer?.camera;
    if (!camera) return null;
    const insets = this.#frameInsets(bounds, FLY_MAX_ZOOM) ?? NO_INSETS;
    return freeView(camera.viewport(), camera.get().k, insets);
  }

  /** “Change 3 of 23: …” for a replayed hunk, “Restructured: 722 changes” for a chapter. */
  #announceTarget(kind: 'hunk' | 'chapter', index: number): void {
    const scene = this.scene;
    const clock = this.clock;
    if (!scene || !clock) return;
    if (kind === 'chapter') {
      const ch = scene.timeline.chapters[index];
      if (!ch) return;
      this.#host.announce(
        translate(this.locale, 'announce.chapter', {
          phase: translate(this.locale, `phase.${ch.phase}`),
          n: ch.hunks.length,
        }),
      );
      return;
    }
    const hunk = scene.hunks[index];
    const order = clock.timeline.windows.findIndex((w) => w.hunk === index);
    if (!hunk || order < 0) return;
    this.#host.announce(
      translate(this.locale, 'announce.change', {
        i: order + 1,
        n: clock.total,
        title: hunk.title,
      }),
    );
  }

  /** Follow `hunks` (replay): fly unless the user steered recently or they are mostly visible. */
  #followHunks(hunks: readonly number[]): void {
    const scene = this.scene;
    if (!scene || hunks.length === 0) return;
    if (this.#deps.now() - this.#lastUserCamera < USER_CAMERA_GRACE) return;
    const bounds = frameBounds(scene, hunks);
    const free = this.#freeWorld(bounds);
    if (!free || coverage(bounds, free) >= FOLLOW_COVERAGE) return;
    this.#flyTo(bounds);
  }

  #hunkBounds(h: number): Rect | null {
    const scene = this.scene;
    return scene?.hunks[h] ? frameBounds(scene, [h]) : null;
  }

  #nodeBounds(i: number): Rect | null {
    const n = this.scene?.nodes[i];
    return n ? padRect({ x: n.x - n.r, y: n.y - n.r, width: 2 * n.r, height: 2 * n.r }) : null;
  }

  /** Camera target of the current selection, or null. */
  #selectionBounds(): Rect | null {
    if (this.selectedHunk >= 0) return this.#hunkBounds(this.selectedHunk);
    if (this.selectedNode >= 0) return this.#nodeBounds(this.selectedNode);
    return null;
  }

  flyToHunk(h: number): void {
    const b = this.#hunkBounds(h);
    if (b) this.#flyTo(b);
  }

  flyToNode(i: number): void {
    const b = this.#nodeBounds(i);
    if (b) this.#flyTo(b);
  }

  flyToSelection(): void {
    const b = this.#selectionBounds();
    if (b) this.#flyTo(b);
  }

  /**
   * Fit everything visible (the focus in changes-only mode) into the free part of the canvas.
   * Before the canvas is laid out it falls back to the renderer's own fit.
   */
  fit(options: { readonly animate?: boolean } = {}): Promise<void> {
    const camera = this.#renderer?.camera;
    if (!camera) return Promise.resolve();
    const bounds = this.#contentBounds();
    const padding = bounds ? this.#frameInsets(bounds, FIT_MAX_ZOOM) : null;
    if (!bounds || !padding) return camera.fit(undefined, options);
    this.#needsFit = false;
    return camera.fit(bounds, { ...options, padding, maxZoom: FIT_MAX_ZOOM });
  }

  /** Bounds of what is drawn: the scene, or the visible part of the changes-only focus. */
  #contentBounds(): Rect | null {
    const scene = this.scene;
    if (!scene) return null;
    const focus = this.focus;
    if (!focus) return frameBounds(scene);
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    const add = (x: number, y: number, rx: number, top: number, bottom: number): void => {
      x0 = Math.min(x0, x - rx);
      x1 = Math.max(x1, x + rx);
      y0 = Math.min(y0, y - top);
      y1 = Math.max(y1, y + bottom);
    };
    // Labels sit centered below their node: leave room for a typical one.
    for (const n of scene.nodes)
      if (focus.nodes[n.index] === 1) add(n.x, n.y, n.r + 48, n.r, n.r + 24);
    for (const g of focus.collapsed) add(g.x, g.y, 48, 12, 12);
    if (!(x0 <= x1)) return frameBounds(scene);
    return padRect({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, 160, 1.12);
  }

  zoom(direction: 1 | -1): void {
    this.noteUserCamera();
    this.#renderer?.camera.zoomBy(direction > 0 ? 1.4 : 1 / 1.4);
  }

  /** Replay: fly to the playing hunk / chapter when it changes and is mostly out of view. */
  #follow(): void {
    const scene = this.scene;
    const clock = this.clock;
    const camera = this.#renderer?.camera;
    if (!scene || !clock || !camera) return;
    const target = clock.activeTarget();
    if (target.index < 0) return;
    const key = `${target.kind}:${target.index}`;
    if (key === this.#followed) return;
    this.#followed = key;
    this.#announceTarget(target.kind, target.index);
    this.#followHunks(
      target.kind === 'chapter'
        ? (scene.timeline.chapters[target.index]?.hunks ?? [])
        : [target.index],
    );
  }

  // ─── Canvas events ────────────────────────────────────────────────────────

  #onHover(pick: PickResult | null): void {
    const node = pick?.type === 'node' ? pick.index : -1;
    const edge = pick?.type === 'edge' ? pick.index : -1;
    const group = pick?.type === 'collapsed' ? pick.index : -1;
    if (node === this.hoverNode && edge === this.hoverEdge && group === this.hoverGroup) return;
    this.hoverNode = node;
    this.hoverEdge = edge;
    this.hoverGroup = group;
    this.#notify('hover');
    this.invalidate();
  }

  /** Clear hover state (pointer left the canvas). */
  clearHover(): void {
    this.#onHover(null);
  }

  #onCanvasClick(pick: PickResult | null): void {
    if (!pick) {
      this.clearSelection();
      return;
    }
    switch (pick.type) {
      case 'node':
        this.selectNode(pick.index, { fly: false });
        break;
      case 'edge': {
        const e = this.scene?.edges[pick.index];
        if (e && e.hunk >= 0) this.selectHunk(e.hunk, { fly: false });
        this.pinnedEdge = pick.index;
        this.invalidate();
        break;
      }
      case 'collapsed':
        this.expandGroup(pick.index);
        break;
      default:
        break;
    }
  }

  #onCanvasDblClick(pick: PickResult | null): void {
    if (pick?.type !== 'node') return;
    const n = this.scene?.nodes[pick.index];
    if (!n) return;
    if (n.hunk >= 0) this.flyToHunk(n.hunk);
    else this.flyToNode(pick.index);
  }

  // ─── Filters, focus ───────────────────────────────────────────────────────

  toggleFamily(family: ChangeFamily): void {
    if (this.families.has(family)) this.families.delete(family);
    else this.families.add(family);
    this.#filtersChanged();
  }

  /** Replace the family filter (empty = all). Setting the current set again clears it. */
  setFamilies(families: readonly ChangeFamily[]): void {
    const same =
      families.length === this.families.size && families.every((f) => this.families.has(f));
    this.families.clear();
    if (!same) for (const f of families) this.families.add(f);
    this.#filtersChanged();
  }

  #filtersChanged(): void {
    if (this.scene) this.list = buildList(this.scene, this.families);
    this.#minimapDirty = true;
    this.#notify('filters');
    this.invalidate();
  }

  setHops(hops: number): void {
    const h = Math.max(0, Math.min(2, Math.round(hops)));
    if (h === this.hops) return;
    this.hops = h;
    this.#updateFocus();
    this.#minimapDirty = true;
    this.#notify('focus');
    this.invalidate();
  }

  /**
   * Expand collapsed group `index` of the current focus: its in-scene members become visible
   * and, for a `changes`-scoped layout, the neighbours left out of the layout are placed with
   * `extendLayout` (nothing already placed moves) and the scene is rebuilt.
   */
  expandGroup(index: number): void {
    const group = this.focus?.collapsed[index];
    const scene = this.scene;
    if (!group || !scene) return;
    const ids: UnionId[] = group.nodes.map((i) => scene.nodes[i]?.id).filter(isString);
    if (!this.canExpand(index)) {
      // Without the layout engine only the members already laid out can be shown.
      if (ids.length > 0) void this.#expandIds(ids, []);
      return;
    }
    const owner = group.id.startsWith('near:')
      ? group.id.slice(5)
      : group.id.startsWith('component:')
        ? group.id.slice(10)
        : null;
    void this.#expandIds(ids, owner !== null ? [owner, ...ids] : ids);
  }

  /**
   * The collapsed group nearest the selection (else the view center), or -1. Groups that can
   * be expanded at least partly come first.
   */
  nearestGroup(): number {
    const groups = this.focus?.collapsed ?? [];
    if (groups.length === 0) return -1;
    const sel = this.#selectionBounds();
    const view = this.#renderer?.camera.viewport();
    const at = sel ?? view ?? this.scene?.bounds;
    const cx = at ? at.x + at.width / 2 : 0;
    const cy = at ? at.y + at.height / 2 : 0;
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    groups.forEach((g, i) => {
      const usable = this.canExpand(i) || g.nodes.length > 0;
      const score = Math.hypot(g.x - cx, g.y - cy) + (usable ? 0 : 1e12);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best;
  }

  /** Expand the group nearest the selection (keyboard `e`); announces what happened. */
  expandNearest(): void {
    const i = this.nearestGroup();
    const group = i >= 0 ? this.focus?.collapsed[i] : undefined;
    if (!group || (!this.canExpand(i) && group.nodes.length === 0)) {
      this.#host.announce(
        translate(this.locale, group ? 'focus.expandUnavailable' : 'announce.nothingHidden'),
      );
      return;
    }
    this.expandGroup(i);
    this.#host.announce(translate(this.locale, 'announce.expanded', { label: group.label }));
  }

  /**
   * Whether collapsed group `index` can be expanded completely: always, unless some members lie
   * outside a `changes`-scoped layout and the layout engine is known to be unavailable
   * (standalone report without the compute add-on).
   */
  canExpand(index: number): boolean {
    const group = this.focus?.collapsed[index];
    if (!group) return false;
    const outside = this.layout?.scope === 'changes' && group.count > group.nodes.length;
    return !outside || computeStatus() !== 'unavailable';
  }

  /**
   * Make `ids` visible, placing those outside the layout, plus the out-of-layout neighbours of
   * `neighboursOf`. Resolves once done (the layout engine may load lazily first).
   */
  #expandIds(ids: readonly UnionId[], neighboursOf: readonly UnionId[]): Promise<void> {
    const data = this.data;
    const layout = this.layout;
    if (!data || !layout) return Promise.resolve();
    for (const id of ids) this.expanded.add(id);
    const missing = new Set<UnionId>();
    if (layout.scope === 'changes') {
      for (const id of ids) if (!layout.positions.has(id)) missing.add(id);
      for (const id of neighboursOf) {
        for (const e of data.diff.index.edgesOf(id)) {
          for (const end of [e.source, e.target, e.sourceBefore, e.targetBefore]) {
            if (end !== undefined && !layout.positions.has(end)) missing.add(end);
          }
        }
      }
    }
    if (missing.size === 0) {
      this.#focusChanged();
      return Promise.resolve();
    }
    const place = (): void => {
      const compute = computeNow();
      const current = this.layout;
      if (!compute || !current || this.data !== data) return;
      const todo = [...missing].filter((id) => !current.positions.has(id));
      if (todo.length > 0) {
        this.layout = compute.extendLayout(data.diff, current, todo, data.layoutOptions);
        for (const id of todo) this.expanded.add(id);
        this.#rebuildScene();
        this.#notify('data', 'selection', 'replay');
      }
      this.#focusChanged();
    };
    if (computeNow()) {
      place();
      return Promise.resolve();
    }
    // Standalone reports load the layout engine on demand.
    return loadCompute().then(place, () => this.#focusChanged());
  }

  #focusChanged(): void {
    this.#updateFocus();
    this.#minimapDirty = true;
    this.#notify('focus');
    this.invalidate();
  }

  /** Bring a union node into the scene and the focus (search results), then select it. */
  revealNode(id: UnionId): Promise<void> {
    if (!this.data || !this.scene) return Promise.resolve();
    const select = (): void => {
      const i = this.scene?.nodeIndex.get(id);
      if (i !== undefined) this.selectNode(i, { fly: true });
    };
    if (this.scene.nodeIndex.has(id) && this.#isVisible(id)) {
      select();
      return Promise.resolve();
    }
    return this.#expandIds([id], []).then(select);
  }

  #isVisible(id: UnionId): boolean {
    const i = this.scene?.nodeIndex.get(id);
    return i !== undefined && (this.focus === null || this.focus.nodes[i] === 1);
  }

  // ─── Replay ───────────────────────────────────────────────────────────────

  play(): void {
    const clock = this.clock;
    if (!clock || this.status !== 'ready') return;
    if (this.mode !== 'replay') this.setMode('replay');
    clock.play();
    this.#followed = '';
    this.#lastTick = 0;
    this.#notify('replay');
    this.invalidate();
  }

  pause(): void {
    if (!this.clock?.playing) return;
    this.clock.pause();
    this.#notify('replay');
    this.invalidate();
  }

  togglePlay(): void {
    if (this.clock?.playing) this.pause();
    else this.play();
  }

  seek(t: number): void {
    const clock = this.clock;
    if (!clock) return;
    clock.seek(t);
    this.#notify('replay');
    this.#follow();
    this.invalidate();
  }

  stepReplay(direction: 1 | -1): void {
    const clock = this.clock;
    if (!clock) return;
    clock.step(direction);
    this.#followed = '';
    // Follow (and announce) the hunk that just completed: stops sit at window ends.
    const w = clock.timeline.windows[clock.position() - 1];
    if (w) {
      if (clock.timeline.mode === 'chapters') this.#announceTarget('chapter', w.chapter);
      else this.#announceTarget('hunk', w.hunk);
      this.#followHunks(
        clock.timeline.mode === 'chapters'
          ? (clock.timeline.chapters[w.chapter]?.hunks ?? [w.hunk])
          : [w.hunk],
      );
    }
    this.#notify('replay');
    this.invalidate();
  }

  restart(): void {
    this.clock?.seek(0);
    this.play();
  }

  cycleSpeed(): void {
    this.clock?.cycleSpeed();
    this.#notify('replay');
  }

  setSpeed(speed: number): void {
    this.clock?.setSpeed(speed);
    this.#notify('replay');
  }

  // ─── Swipe ────────────────────────────────────────────────────────────────

  setSplit(split: number): void {
    const s = Number.isFinite(split) ? Math.min(1, Math.max(0, split)) : 0.5;
    if (s === this.split) return;
    this.split = s;
    this.#notify('swipe');
    if (this.mode === 'swipe') this.invalidate();
  }

  // ─── Review ───────────────────────────────────────────────────────────────

  setReviewed(hunkId: string, reviewed: boolean): void {
    const review = this.#review;
    if (!review?.setReviewed(hunkId, reviewed)) return;
    const progress = review.state();
    this.#notify('review');
    this.#host.review(hunkId, reviewed, progress);
    const text = translate(this.locale, 'review.progress', {
      done: progress.reviewed.length,
      total: progress.total,
    });
    this.#host.announce(
      translate(this.locale, reviewed ? 'announce.reviewed' : 'announce.unreviewed', {
        progress: text,
      }),
    );
  }

  /** Another tab changed review progress (`storage` event): re-read it. */
  syncReview(key: string | null): void {
    if (this.#review?.reload(key)) this.#notify('review');
  }

  toggleReviewed(hunkId?: string): void {
    const id =
      hunkId ?? (this.selectedHunk >= 0 ? this.scene?.hunks[this.selectedHunk]?.id : undefined);
    if (id !== undefined) this.setReviewed(id, !this.isReviewed(id));
  }

  // ─── Appearance ───────────────────────────────────────────────────────────

  #appearance(apply: () => void): void {
    const name = this.themeName;
    const palette = this.palette;
    const locale = this.locale;
    apply();
    const themeChanged = name !== this.themeName || palette !== this.palette;
    const localeChanged = locale !== this.locale;
    if (themeChanged || localeChanged) {
      if (this.data) this.#rebuildScene();
      else this.#renderer?.setTheme(this.theme);
    }
    if (themeChanged) this.#notify('theme');
    if (localeChanged) this.#notify('locale', 'data');
  }

  setThemePreference(pref: ThemePreference): void {
    this.#appearance(() => {
      this.themePreference = toTheme(pref) ?? 'auto';
    });
    this.#notify('theme');
  }

  setPalette(palette: PaletteName): void {
    this.#appearance(() => {
      this.palette = toPalette(palette) ?? 'default';
    });
  }

  setLocale(locale: Locale): void {
    this.#appearance(() => {
      this.locale = toLocale(locale) ?? 'en';
    });
  }

  setSystemDark(dark: boolean): void {
    this.#appearance(() => {
      this.systemDark = dark;
    });
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.invalidate();
  }
}

function isString(x: string | undefined): x is string {
  return x !== undefined;
}

/** Pad a small rect so a node is shown with its neighbourhood. */
function padRect(r: Rect, min = 200, ratio = 1.4): Rect {
  const w = Math.max(min, r.width * ratio);
  const h = Math.max(min, r.height * ratio);
  return { x: r.x + r.width / 2 - w / 2, y: r.y + r.height / 2 - h / 2, width: w, height: h };
}
