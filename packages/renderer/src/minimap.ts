/**
 * Minimap (docs/visual-language.md §Minimap): a 184 × 128 floating card with the graph's edges
 * as faint hairlines (below 3k edges), neutral nodes as small dots, changed nodes as outlined
 * dots in their family color, and the viewport as an accent rectangle. Click or drag to navigate.
 *
 * The world window is centred on the content and grows just enough to contain the viewport, so
 * the rectangle is always fully visible while the content stays centred and as large as possible.
 * The window shrinks at once when the viewport needs room and grows back eased, with hysteresis,
 * so panning never makes it jitter. Marks are rasterized into an offscreen layer whenever the
 * window or the frame changes; camera moves otherwise only blit that layer and the rectangle.
 */
import type { Rect } from '@kgdiff/core';
import { KgdiffError } from '@kgdiff/core';
import type { CollapsedGroup, FrameVisuals, NodeVisual, Theme } from '@kgdiff/scene';
import { type Ctx2D, domSurfaceFactory, type Surface, type SurfaceFactory } from './ctx.js';
import { roundRectPath } from './draw/shapes.js';
import type { Minimap, MinimapOptions, Renderer } from './index.js';
import { clamp, TAU } from './math.js';
import { internals } from './renderer.js';

const PAD = 8;
const RADIUS = 12;
/** Neutral dot size (css px) and alpha. */
const NEUTRAL_DOT = 1.5;
const NEUTRAL_ALPHA = 0.45;
/** Changed dot diameter and background outline (css px). */
const CHANGE_DOT = 2.5;
const CHANGE_OUTLINE = 1;
/** Edges are drawn below this count, as hairlines. */
const EDGE_LIMIT = 3000;
const EDGE_WIDTH = 0.5;
const EDGE_ALPHA = 0.12;
/** Window growth time constant (ms): settles in ~150 ms. */
const GROW_TAU = 50;
/** The window grows back only once it is this much smaller than needed (hysteresis). */
const GROW_SLACK = 0.8;

export interface MinimapDeps {
  readonly context?: Ctx2D | null;
  readonly surfaceFactory?: SurfaceFactory;
}

/** The family color of a change mark, or null for neutral context (by `NodeVisual.family`). */
export function markColor(n: NodeVisual, theme: Theme): string | null {
  const f = n.family;
  if (f === 'neutral') return null;
  return theme.family[f]?.base ?? null;
}

/**
 * The minimap's world window: centred on the content, covering the content and the viewport.
 * Extending symmetrically keeps the content centred; the viewport always fits inside.
 */
export function minimapWindow(content: Rect, viewport: Rect | null): Rect {
  const cx = content.x + content.width / 2;
  const cy = content.y + content.height / 2;
  let hw = Math.max(content.width / 2, 1);
  let hh = Math.max(content.height / 2, 1);
  if (
    viewport &&
    Number.isFinite(viewport.x + viewport.y + viewport.width + viewport.height) &&
    viewport.width > 0 &&
    viewport.height > 0
  ) {
    hw = Math.max(hw, cx - viewport.x, viewport.x + viewport.width - cx);
    hh = Math.max(hh, cy - viewport.y, viewport.y + viewport.height - cy);
  }
  return { x: cx - hw, y: cy - hh, width: 2 * hw, height: 2 * hh };
}

/**
 * Minimap zoom (px per world unit) with asymmetric smoothing: shrinks at once (the viewport
 * must stay visible), grows back eased and only once it has `GROW_SLACK` room (no jitter).
 */
export class WindowScale {
  value = 0;
  target = 0;
  growing = false;

  /** Set the scale the window needs now; returns whether `value` changed. */
  retarget(target: number): boolean {
    if (!(target > 0) || !Number.isFinite(target)) return false;
    this.target = target;
    if (!(this.value > 0) || target <= this.value) {
      const changed = target !== this.value;
      this.value = target;
      this.growing = false;
      return changed;
    }
    if (!this.growing && this.value < target * GROW_SLACK) this.growing = true;
    return false;
  }

  /** Advance the eased growth by `dt` ms; returns whether it is still growing. */
  step(dt: number): boolean {
    if (!this.growing) return false;
    this.value += (this.target - this.value) * (1 - Math.exp(-Math.max(0, dt) / GROW_TAU));
    if (Math.abs(this.target - this.value) <= this.target * 0.002) {
      this.value = this.target;
      this.growing = false;
    }
    return this.growing;
  }
}

/** Uniform scale + offset that fits `bounds` into a w × h box with padding, centred. */
export function fitTransform(
  bounds: Rect,
  w: number,
  h: number,
  pad: number,
): { s: number; ox: number; oy: number } {
  const aw = Math.max(1, w - 2 * pad);
  const ah = Math.max(1, h - 2 * pad);
  const bw = Math.max(bounds.width, 1e-9);
  const bh = Math.max(bounds.height, 1e-9);
  const s = Math.min(aw / bw, ah / bh);
  return { s, ox: (w - bw * s) / 2 - bounds.x * s, oy: (h - bh * s) / 2 - bounds.y * s };
}

/** The minimap plus internals tests and the dev harness inspect. */
export interface MinimapImpl extends Minimap {
  /** Current world → minimap transform (css px), or null without content. */
  transform(): { readonly s: number; readonly ox: number; readonly oy: number } | null;
}

class CanvasMinimap implements MinimapImpl {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: Ctx2D | null;
  private readonly factory: SurfaceFactory;
  private readonly width: number;
  private readonly height: number;
  private theme: Theme;
  private dpr = 1;
  private layer: Surface | null = null;
  private frame: FrameVisuals | null = null;
  private collapsed: readonly CollapsedGroup[] = [];
  private fit: { s: number; ox: number; oy: number } | null = null;
  private content: Rect | null = null;
  private readonly scale = new WindowScale();
  private rafId = 0;
  private lastTick = -1;
  private readonly cleanup: (() => void)[] = [];
  private drag: { id: number; dx: number; dy: number } | null = null;
  private destroyed = false;

  constructor(
    container: HTMLElement,
    private readonly renderer: Renderer,
    options: MinimapOptions,
    deps: MinimapDeps,
  ) {
    const host = internals.get(renderer);
    if (!host) {
      throw new KgdiffError(
        'invalid-input',
        'createMinimap: renderer is destroyed or was not created by createRenderer',
      );
    }
    this.width = Math.max(16, Math.round(options.width ?? 184));
    this.height = Math.max(16, Math.round(options.height ?? 128));
    this.theme = host.theme();
    this.factory = deps.surfaceFactory ?? domSurfaceFactory;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const st = canvas.style;
    st.display = 'block';
    st.width = `${this.width}px`;
    st.height = `${this.height}px`;
    st.borderRadius = `${RADIUS}px`;
    st.touchAction = 'none';
    st.cursor = 'pointer';
    st.setProperty('-webkit-tap-highlight-color', 'transparent');
    container.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = deps.context !== undefined ? deps.context : canvas.getContext('2d');
    this.style();
    this.resizeBuffer(host.pixelRatio());

    this.cleanup.push(
      renderer.on('camera', () => {
        this.refit(false);
        this.redraw();
      }),
    );
    this.cleanup.push(
      host.onTheme((theme) => {
        this.theme = theme;
        this.style();
        this.rasterize();
        this.redraw();
      }),
    );
    const listen = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
    ): void => {
      canvas.addEventListener(type, fn);
      this.cleanup.push(() => canvas.removeEventListener(type, fn));
    };
    listen('pointerdown', (e) => this.onDown(e));
    listen('pointermove', (e) => this.onMove(e));
    listen('pointerup', (e) => this.onUp(e));
    listen('pointercancel', (e) => this.onUp(e));
    this.redraw();
  }

  update(frame: FrameVisuals, collapsed?: readonly CollapsedGroup[]): void {
    if (this.destroyed) return;
    this.frame = frame;
    this.collapsed = collapsed ?? frame.collapsed;
    const host = internals.get(this.renderer);
    if (host && host.pixelRatio() !== this.dpr) this.resizeBuffer(host.pixelRatio());
    const first = this.content === null;
    this.content = this.bounds();
    this.refit(first);
    this.rasterize();
    this.redraw();
  }

  transform(): { readonly s: number; readonly ox: number; readonly oy: number } | null {
    return this.fit;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId) internals.get(this.renderer)?.cancelFrame(this.rafId);
    this.rafId = 0;
    for (const fn of this.cleanup.splice(0)) fn();
    this.canvas.remove();
    this.layer = null;
    this.frame = null;
  }

  private style(): void {
    const st = this.canvas.style;
    st.background = this.theme.surface.overlay;
    st.boxShadow = this.theme.surface.shadow;
    st.setProperty('backdrop-filter', 'blur(16px)');
    st.setProperty('-webkit-backdrop-filter', 'blur(16px)');
  }

  /**
   * Recompute the window for the current content and viewport. Frozen while dragging on the
   * minimap, so the world point under the pointer does not move. `reset` jumps to the target.
   */
  private refit(reset: boolean): void {
    const content = this.content;
    if (!content) {
      this.fit = null;
      return;
    }
    if (this.drag && !reset) return;
    const viewport = this.renderer.camera.viewport();
    const target = fitTransform(minimapWindow(content, viewport), this.width, this.height, PAD).s;
    if (reset) this.scale.value = 0;
    const jumped = this.scale.retarget(target);
    this.applyScale();
    if (jumped && !reset) this.rasterize();
    if (this.scale.growing) this.schedule();
  }

  private applyScale(): void {
    const content = this.content;
    const s = this.scale.value;
    if (!content || !(s > 0)) {
      this.fit = null;
      return;
    }
    const cx = content.x + content.width / 2;
    const cy = content.y + content.height / 2;
    this.fit = { s, ox: this.width / 2 - cx * s, oy: this.height / 2 - cy * s };
  }

  private schedule(): void {
    if (this.rafId || this.destroyed) return;
    const host = internals.get(this.renderer);
    if (!host) return;
    this.rafId = host.requestFrame(this.tick) || 0;
  }

  private readonly tick = (time: number): void => {
    this.rafId = 0;
    if (this.destroyed) return;
    const dt = this.lastTick < 0 ? 16 : Math.min(64, time - this.lastTick);
    const growing = this.scale.step(dt);
    this.lastTick = growing ? time : -1;
    this.applyScale();
    this.rasterize();
    this.redraw();
    if (growing) this.schedule();
  };

  private resizeBuffer(dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.layer = this.factory(this.canvas.width, this.canvas.height);
    this.rasterize();
  }

  private bounds(): Rect | null {
    const frame = this.frame;
    if (!frame) return null;
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const n of frame.nodes) {
      if (!n.visible || !Number.isFinite(n.x + n.y)) continue;
      if (n.x < x0) x0 = n.x;
      if (n.y < y0) y0 = n.y;
      if (n.x > x1) x1 = n.x;
      if (n.y > y1) y1 = n.y;
    }
    for (const g of this.collapsed) {
      if (!Number.isFinite(g.x + g.y)) continue;
      x0 = Math.min(x0, g.x);
      y0 = Math.min(y0, g.y);
      x1 = Math.max(x1, g.x);
      y1 = Math.max(y1, g.y);
    }
    return x0 <= x1 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
  }

  /** Rasterize the marks into the offscreen layer (device px, snapped squares). */
  private rasterize(): void {
    const target = this.layer?.ctx ?? null;
    if (!target) return;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawMarks(target);
  }

  private drawMarks(ctx: Ctx2D): void {
    const frame = this.frame;
    const fit = this.fit;
    if (!frame || !fit) return;
    const theme = this.theme;
    const dpr = this.dpr;
    const sx = (wx: number): number => (wx * fit.s + fit.ox) * dpr;
    const sy = (wy: number): number => (wy * fit.s + fit.oy) * dpr;
    const neutral = theme.name === 'light' ? theme.neutral.nodeStroke : theme.neutral.node;

    // Structure: edges as device-pixel hairlines (cheap below a few thousand).
    if (frame.edges.length > 0 && frame.edges.length < EDGE_LIMIT) {
      ctx.globalAlpha = EDGE_ALPHA;
      ctx.strokeStyle = neutral;
      ctx.lineWidth = Math.max(1, EDGE_WIDTH * dpr);
      ctx.setLineDash([]);
      ctx.beginPath();
      for (const e of frame.edges) {
        if (!e.visible || !Number.isFinite(e.x1 + e.y1 + e.x2 + e.y2)) continue;
        ctx.moveTo(sx(e.x1), sy(e.y1));
        ctx.lineTo(sx(e.x2), sy(e.y2));
      }
      ctx.stroke();
    }

    // Neutral context: small squares on the device-pixel grid.
    const small = Math.max(1, Math.round(NEUTRAL_DOT * dpr));
    const changed = new Map<string, number[]>();
    ctx.globalAlpha = NEUTRAL_ALPHA;
    ctx.fillStyle = neutral;
    ctx.beginPath();
    for (let i = 0; i < frame.nodes.length; i++) {
      const n = frame.nodes[i]!;
      if (!n.visible || !Number.isFinite(n.x + n.y)) continue;
      const color = markColor(n, theme);
      if (color !== null) {
        let list = changed.get(color);
        if (!list) {
          list = [];
          changed.set(color, list);
        }
        list.push(i);
        continue;
      }
      ctx.rect(Math.round(sx(n.x) - small / 2), Math.round(sy(n.y) - small / 2), small, small);
    }
    ctx.fill();

    const r = (CHANGE_DOT / 2) * dpr;
    const outline = r + CHANGE_OUTLINE * dpr;
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = theme.text.muted;
    ctx.beginPath();
    for (const g of this.collapsed) {
      if (!Number.isFinite(g.x + g.y)) continue;
      ctx.rect(
        Math.round(sx(g.x) - r),
        Math.round(sy(g.y) - r),
        Math.round(2 * r),
        Math.round(2 * r),
      );
    }
    ctx.fill();

    // Changes: dots in family color over a background-colored outline, so they pop.
    if (changed.size === 0) return;
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.canvas.background;
    ctx.beginPath();
    for (const list of changed.values()) {
      for (const i of list) {
        const n = frame.nodes[i]!;
        ctx.moveTo(sx(n.x) + outline, sy(n.y));
        ctx.arc(sx(n.x), sy(n.y), outline, 0, TAU);
      }
    }
    ctx.fill();
    for (const [color, list] of changed) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const i of list) {
        const n = frame.nodes[i]!;
        ctx.moveTo(sx(n.x) + r, sy(n.y));
        ctx.arc(sx(n.x), sy(n.y), r, 0, TAU);
      }
      ctx.fill();
    }
  }

  /** Blit the marks, then draw the viewport rectangle and the card border. */
  private redraw(): void {
    const ctx = this.ctx;
    if (!ctx || this.destroyed) return;
    const ratio = internals.get(this.renderer)?.pixelRatio();
    if (ratio !== undefined && ratio !== this.dpr) this.resizeBuffer(ratio);
    const dpr = this.dpr;
    const w = this.width;
    const h = this.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    roundRectPath(ctx, 0, 0, w, h, RADIUS);
    ctx.clip();
    if (this.layer) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.layer.canvas, 0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.drawMarks(ctx);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const fit = this.fit;
    if (fit) {
      const vp = this.renderer.camera.viewport();
      const x0 = clamp(vp.x * fit.s + fit.ox, -2, w + 2);
      const y0 = clamp(vp.y * fit.s + fit.oy, -2, h + 2);
      const x1 = clamp((vp.x + vp.width) * fit.s + fit.ox, -2, w + 2);
      const y1 = clamp((vp.y + vp.height) * fit.s + fit.oy, -2, h + 2);
      if (x1 - x0 > 0.5 && y1 - y0 > 0.5) {
        const snapPx = (v: number): number => Math.round(v * dpr) / dpr;
        const rx = snapPx(x0);
        const ry = snapPx(y0);
        const rw = Math.max(2, snapPx(x1) - rx);
        const rh = Math.max(2, snapPx(y1) - ry);
        ctx.globalAlpha = 1;
        ctx.fillStyle = this.theme.accent.soft;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = this.theme.accent.base;
        ctx.lineWidth = 1.25;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.rect(rx + 0.625, ry + 0.625, rw - 1.25, rh - 1.25);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.theme.surface.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    roundRectPath(ctx, 0.5, 0.5, w - 1, h - 1, RADIUS - 0.5);
    ctx.stroke();
  }

  private toWorld(e: PointerEvent): { x: number; y: number } | null {
    const fit = this.fit;
    if (!fit) return null;
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    return { x: (mx - fit.ox) / fit.s, y: (my - fit.oy) / fit.s };
  }

  private onDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = this.toWorld(e);
    if (!p) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Best effort.
    }
    const cam = this.renderer.camera;
    const s = cam.get();
    const vp = cam.viewport();
    const inside = p.x >= vp.x && p.x <= vp.x + vp.width && p.y >= vp.y && p.y <= vp.y + vp.height;
    // Grabbing the rectangle keeps the grab offset; clicking elsewhere centres the view there.
    this.drag = inside
      ? { id: e.pointerId, dx: s.x - p.x, dy: s.y - p.y }
      : { id: e.pointerId, dx: 0, dy: 0 };
    if (!inside) this.move({ x: p.x, y: p.y, k: s.k });
  }

  /** Navigate on the user's behalf (the `camera` event reports source 'user'). */
  private move(state: { x: number; y: number; k: number }): void {
    const host = internals.get(this.renderer);
    if (host) host.userSet(state);
    else this.renderer.camera.set(state);
  }

  private onMove(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.id !== e.pointerId) return;
    const p = this.toWorld(e);
    if (!p) return;
    this.move({ x: p.x + drag.dx, y: p.y + drag.dy, k: this.renderer.camera.get().k });
  }

  private onUp(e: PointerEvent): void {
    if (this.drag?.id !== e.pointerId) return;
    this.drag = null;
    // The window was frozen during the drag: catch up with the viewport now.
    this.refit(false);
    this.redraw();
  }
}

export function createMinimapImpl(
  container: HTMLElement,
  renderer: Renderer,
  options: MinimapOptions = {},
  deps: MinimapDeps = {},
): MinimapImpl {
  return new CanvasMinimap(container, renderer, options, deps);
}
