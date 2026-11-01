/**
 * Camera: world ↔ screen transforms, fitting, and the motions that move it (van Wijk–Nuij
 * flights, cursor-anchored smooth wheel zoom, inertial glide).
 *
 * The camera never schedules frames itself: it reports changes through `CameraHost.invalidate`
 * and is advanced by the renderer's single animation-frame loop (`tick`).
 */
import type { Point, Rect } from '@kgdiff/core';
import type { Camera, CameraState, CameraTransitionOptions } from './index.js';
import { clamp, easeInOutCubic } from './math.js';
import { smoothZoom, type ZoomPath } from './smooth-zoom.js';

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const NO_INSETS: Insets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** Default fit padding (px). */
export const DEFAULT_PADDING = 48;
/** `flyTo` / `fit` never zoom in beyond this unless `maxZoom` says otherwise. */
export const DEFAULT_FLY_MAX_ZOOM = 2.5;
/** van Wijk–Nuij ρ (docs/visual-language.md §Replay). */
export const FLY_RHO = Math.SQRT2;
/** Time constant (ms) of the exponential approach used by animated wheel / button zoom. */
export const ZOOM_TAU = 80;
/** Time constant (ms) of the inertial glide after a drag. */
export const GLIDE_TAU = 325;
/** Glide stops below this speed (px/ms). */
export const GLIDE_MIN_SPEED = 0.02;

// ─── Pure math ───────────────────────────────────────────────────────────────

export function worldToScreen(s: CameraState, size: Size, p: Point): Point {
  return { x: (p.x - s.x) * s.k + size.width / 2, y: (p.y - s.y) * s.k + size.height / 2 };
}

export function screenToWorld(s: CameraState, size: Size, p: Point): Point {
  return { x: (p.x - size.width / 2) / s.k + s.x, y: (p.y - size.height / 2) / s.k + s.y };
}

export function viewportRect(s: CameraState, size: Size): Rect {
  const w = size.width / s.k;
  const h = size.height / s.k;
  return { x: s.x - w / 2, y: s.y - h / 2, width: w, height: h };
}

/** The state at zoom `k` that keeps the world point under screen point (sx, sy) in place. */
export function zoomAround(
  s: CameraState,
  size: Size,
  k: number,
  sx: number,
  sy: number,
): CameraState {
  const wx = (sx - size.width / 2) / s.k + s.x;
  const wy = (sy - size.height / 2) / s.k + s.y;
  return { x: wx - (sx - size.width / 2) / k, y: wy - (sy - size.height / 2) / k, k };
}

export function resolvePadding(padding: CameraTransitionOptions['padding']): Insets {
  if (padding === undefined) {
    return {
      top: DEFAULT_PADDING,
      right: DEFAULT_PADDING,
      bottom: DEFAULT_PADDING,
      left: DEFAULT_PADDING,
    };
  }
  if (typeof padding === 'number') {
    const p = Number.isFinite(padding) ? Math.max(0, padding) : DEFAULT_PADDING;
    return { top: p, right: p, bottom: p, left: p };
  }
  return padding;
}

/**
 * Camera state that shows `bounds` inside the viewport minus `safe` (floating chrome) and
 * `padding`, centred in that free region. Degenerate bounds (a single point) zoom to `maxK`.
 * When insets leave no room they are dropped (safe area first, then padding).
 */
export function fitState(
  bounds: Rect,
  size: Size,
  padding: Insets,
  safe: Insets,
  minK: number,
  maxK: number,
): CameraState {
  const attempts: readonly (readonly [Insets, Insets])[] = [
    [safe, padding],
    [NO_INSETS, padding],
    [NO_INSETS, NO_INSETS],
  ];
  let left = 0;
  let top = 0;
  let availW = size.width;
  let availH = size.height;
  for (const [s, p] of attempts) {
    left = s.left + p.left;
    top = s.top + p.top;
    availW = size.width - left - s.right - p.right;
    availH = size.height - top - s.bottom - p.bottom;
    if (availW >= 8 && availH >= 8) break;
  }
  availW = Math.max(availW, 1);
  availH = Math.max(availH, 1);
  const bw = Math.max(bounds.width, 0);
  const bh = Math.max(bounds.height, 0);
  let k = Math.min(
    bw > 0 ? availW / bw : Number.POSITIVE_INFINITY,
    bh > 0 ? availH / bh : Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(k)) k = maxK;
  k = clamp(k, minK, maxK);
  const cx = bounds.x + bw / 2;
  const cy = bounds.y + bh / 2;
  const sx = left + availW / 2;
  const sy = top + availH / 2;
  return { x: cx - (sx - size.width / 2) / k, y: cy - (sy - size.height / 2) / k, k };
}

/** Flight duration: `clamp(S · 620 ms, 350, 1100)`. */
export function flyDuration(S: number): number {
  return clamp(Math.abs(S) * 620, 350, 1100);
}

/** Exponential velocity decay over `dt` ms. */
export function decay(v: number, dt: number, tau: number = GLIDE_TAU): number {
  return v * Math.exp(-dt / tau);
}

// ─── Controller ──────────────────────────────────────────────────────────────

/** Who moved the camera: input (pointer, wheel, pinch, inertia, minimap) or an API call. */
export type CameraSource = 'user' | 'program';

export interface CameraHost {
  /** Viewport size in css px. */
  size(): Size;
  safeArea(): Insets;
  /** Bounds of everything drawn, or null when the frame is empty. */
  contentBounds(): Rect | null;
  reducedMotion(): boolean;
  /** The state changed or a motion started: schedule a frame. */
  invalidate(): void;
}

type Motion =
  | {
      readonly type: 'fly';
      readonly path: ZoomPath;
      /** Viewport extent used to convert zoom ↔ visible width. */
      readonly ref: number;
      readonly duration: number;
      start: number;
      readonly target: CameraState;
      readonly resolve: () => void;
    }
  | {
      readonly type: 'zoom';
      source: CameraSource;
      ax: number;
      ay: number;
      wx: number;
      wy: number;
      kTarget: number;
      last: number;
    }
  | { readonly type: 'glide'; vx: number; vy: number; last: number };

interface PendingFly {
  readonly bounds: Rect;
  readonly options: CameraTransitionOptions;
  readonly resolve: () => void;
}

function validRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height) &&
    r.width >= 0 &&
    r.height >= 0
  );
}

/** The renderer's camera. Public methods implement `Camera`; the rest is driven by input. */
export class CameraController implements Camera {
  x = 0;
  y = 0;
  k = 1;
  /** Set by any explicit camera call or user input; disables the automatic first fit. */
  touched = false;
  private motion: Motion | null = null;
  private pending: PendingFly | null = null;
  /** A user-driven change happened since the last `takeSource`. */
  private userChanged = false;

  constructor(
    private readonly host: CameraHost,
    readonly minK: number,
    readonly maxK: number,
  ) {}

  get(): CameraState {
    return { x: this.x, y: this.y, k: this.k };
  }

  set(state: CameraState, source: CameraSource = 'program'): void {
    this.touched = true;
    this.stop();
    this.apply(state.x, state.y, state.k, source);
  }

  flyTo(bounds: Rect, options: CameraTransitionOptions = {}): Promise<void> {
    this.touched = true;
    this.stop();
    if (!validRect(bounds)) return Promise.resolve();
    const size = this.host.size();
    if (size.width <= 0 || size.height <= 0) {
      // Not laid out yet: apply (as a jump) on the first real size.
      return new Promise((resolve) => {
        this.pending = { bounds, options, resolve };
      });
    }
    const target = this.targetFor(bounds, options, size);
    const animate = (options.animate ?? true) && !this.host.reducedMotion();
    const ref = Math.max(size.width, size.height);
    const path = smoothZoom(
      { x: this.x, y: this.y, w: ref / this.k },
      { x: target.x, y: target.y, w: ref / target.k },
      FLY_RHO,
    );
    const duration = options.duration ?? flyDuration(path.S);
    const still =
      Math.abs(target.k / this.k - 1) < 1e-6 &&
      Math.hypot(target.x - this.x, target.y - this.y) * this.k < 0.5;
    if (!animate || !(duration > 0) || still) {
      this.apply(target.x, target.y, target.k, 'program');
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.motion = { type: 'fly', path, ref, duration, start: -1, target, resolve };
      this.host.invalidate();
    });
  }

  fit(bounds?: Rect, options?: CameraTransitionOptions): Promise<void> {
    const b = bounds ?? this.host.contentBounds();
    if (!b) {
      this.touched = true;
      this.stop();
      return Promise.resolve();
    }
    return this.flyTo(b, options);
  }

  zoomBy(factor: number, around?: Point, options?: { readonly animate?: boolean }): void {
    this.touched = true;
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    const size = this.host.size();
    const ax = around?.x ?? size.width / 2;
    const ay = around?.y ?? size.height / 2;
    const animate = (options?.animate ?? true) && !this.host.reducedMotion();
    if (animate) this.zoomSmooth(factor, ax, ay, 'program');
    else {
      this.stop();
      this.zoomNow(factor, ax, ay, 'program');
    }
  }

  panBy(dx: number, dy: number): void {
    this.touched = true;
    this.stop();
    this.panNow(dx, dy, 'program');
  }

  worldToScreen(p: Point): Point {
    return worldToScreen(this, this.host.size(), p);
  }

  screenToWorld(p: Point): Point {
    return screenToWorld(this, this.host.size(), p);
  }

  viewport(): Rect {
    return viewportRect(this, this.host.size());
  }

  // ─── Internal API (renderer, input) ───────────────────────────────────────

  /** Whether a motion is running (the frame loop must keep ticking). */
  get animating(): boolean {
    return this.motion !== null;
  }

  /** User input started: stop every motion (resolving a pending flight). */
  interrupt(): void {
    this.touched = true;
    this.stop();
  }

  /** Jump without marking the camera as touched (automatic first fit). */
  jump(state: CameraState): void {
    this.stop();
    this.apply(state.x, state.y, state.k, 'program');
  }

  /** The state `fit` would end in (no motion). */
  targetFor(bounds: Rect, options: CameraTransitionOptions, size: Size): CameraState {
    const maxK = Math.min(this.maxK, options.maxZoom ?? DEFAULT_FLY_MAX_ZOOM);
    return fitState(
      bounds,
      size,
      resolvePadding(options.padding),
      this.host.safeArea(),
      this.minK,
      Math.max(this.minK, maxK),
    );
  }

  /** Move the content by (dx, dy) screen px immediately (input unless told otherwise). */
  panNow(dx: number, dy: number, source: CameraSource = 'user'): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.apply(this.x - dx / this.k, this.y - dy / this.k, this.k, source);
  }

  /** Zoom by `factor` around screen point (ax, ay) immediately (pinch). */
  zoomNow(factor: number, ax: number, ay: number, source: CameraSource = 'user'): void {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    if (this.motion?.type === 'zoom') this.motion = null;
    const k = clamp(this.k * factor, this.minK, this.maxK);
    const s = zoomAround(this, this.host.size(), k, ax, ay);
    this.apply(s.x, s.y, s.k, source);
  }

  /** Animated zoom toward `factor ×` the current target, anchored at (ax, ay) (wheel notches). */
  zoomSmooth(factor: number, ax: number, ay: number, source: CameraSource = 'user'): void {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    const size = this.host.size();
    const wx = (ax - size.width / 2) / this.k + this.x;
    const wy = (ay - size.height / 2) / this.k + this.y;
    const m = this.motion;
    if (m?.type === 'zoom') {
      m.kTarget = clamp(m.kTarget * factor, this.minK, this.maxK);
      m.source = source;
      m.ax = ax;
      m.ay = ay;
      m.wx = wx;
      m.wy = wy;
    } else {
      this.stop();
      this.motion = {
        type: 'zoom',
        source,
        ax,
        ay,
        wx,
        wy,
        kTarget: clamp(this.k * factor, this.minK, this.maxK),
        last: -1,
      };
    }
    this.host.invalidate();
  }

  /** Inertial glide with initial velocity (px/ms, content direction). */
  glide(vx: number, vy: number): void {
    this.stop();
    if (!(Math.hypot(vx, vy) > GLIDE_MIN_SPEED)) return;
    this.motion = { type: 'glide', vx, vy, last: -1 };
    this.host.invalidate();
  }

  /** The viewport size became valid: run a flight requested before layout (as a jump). */
  resized(): void {
    const p = this.pending;
    if (!p) return;
    const size = this.host.size();
    if (size.width <= 0 || size.height <= 0) return;
    this.pending = null;
    const t = this.targetFor(p.bounds, p.options, size);
    this.apply(t.x, t.y, t.k, 'program');
    p.resolve();
  }

  /** Advance the running motion to time `now` (ms). Returns whether it is still running. */
  tick(now: number): boolean {
    const m = this.motion;
    if (!m) return false;
    switch (m.type) {
      case 'fly': {
        if (m.start < 0) m.start = now;
        const t = clamp((now - m.start) / m.duration, 0, 1);
        if (t >= 1) {
          this.motion = null;
          this.apply(m.target.x, m.target.y, m.target.k, 'program');
          m.resolve();
          return false;
        }
        const v = m.path.at(easeInOutCubic(t));
        this.apply(v.x, v.y, m.ref / v.w, 'program');
        return true;
      }
      case 'zoom': {
        const dt = m.last < 0 ? 16 : clamp(now - m.last, 0, 64);
        m.last = now;
        const lk = Math.log(this.k);
        const lt = Math.log(m.kTarget);
        const done = Math.abs(lt - lk) < 1e-3;
        const k = done ? m.kTarget : Math.exp(lk + (lt - lk) * (1 - Math.exp(-dt / ZOOM_TAU)));
        const size = this.host.size();
        const kk = clamp(k, this.minK, this.maxK);
        this.apply(
          m.wx - (m.ax - size.width / 2) / kk,
          m.wy - (m.ay - size.height / 2) / kk,
          kk,
          m.source,
        );
        if (done) this.motion = null;
        return !done;
      }
      case 'glide': {
        const dt = m.last < 0 ? 16 : clamp(now - m.last, 0, 64);
        m.last = now;
        this.panNow(m.vx * dt, m.vy * dt, 'user');
        m.vx = decay(m.vx, dt);
        m.vy = decay(m.vy, dt);
        if (Math.hypot(m.vx, m.vy) < GLIDE_MIN_SPEED) {
          this.motion = null;
          return false;
        }
        return true;
      }
      default: {
        const never: never = m;
        return never;
      }
    }
  }

  /** Stop the running motion and any pending flight, resolving their promises. */
  stop(): void {
    const m = this.motion;
    this.motion = null;
    if (m?.type === 'fly') m.resolve();
    const p = this.pending;
    this.pending = null;
    p?.resolve();
  }

  /**
   * Source of the changes since the last call: 'user' if any of them came from input. The
   * renderer reads it once per `camera` event (events are coalesced per frame).
   */
  takeSource(): CameraSource {
    const source = this.userChanged ? 'user' : 'program';
    this.userChanged = false;
    return source;
  }

  private apply(x: number, y: number, k: number, source: CameraSource): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(k) || k <= 0) return;
    const kk = clamp(k, this.minK, this.maxK);
    if (x === this.x && y === this.y && kk === this.k) return;
    this.x = x;
    this.y = y;
    this.k = kk;
    if (source === 'user') this.userChanged = true;
    this.host.invalidate();
  }
}
