/**
 * Pointer, wheel, touch and Safari gesture handling.
 *
 * - Drag (mouse / pen / one finger) pans with inertia; a press that moves less than
 *   `DRAG_THRESHOLD` px is a click.
 * - Two pointers pinch-zoom around their centroid and pan with it.
 * - Wheel: ctrl/meta + wheel or trackpad pinch → zoom at the cursor; two-finger trackpad
 *   scroll → pan; mouse wheel notches → smooth zoom at the cursor.
 */
import type { CameraController } from './camera.js';
import { clamp } from './math.js';

/** A press that moves less than this (px) is a click, not a drag. */
export const DRAG_THRESHOLD = 4;
/** Wheel events closer than this (ms) belong to one gesture and keep its classification. */
export const WHEEL_GESTURE_GAP = 160;
/** Minimum release speed (px/ms) that starts an inertial glide. */
export const GLIDE_START_SPEED = 0.1;
/** Release speeds are capped (px/ms) so a jittery flick cannot fling the graph away. */
export const GLIDE_MAX_SPEED = 6;
/** macOS mouse wheels report multiples of this delta (with acceleration). */
const MAC_WHEEL_STEP = 4.000244140625;

export type WheelIntent = 'pinch' | 'notch' | 'pan';

export interface WheelLike {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  /** Non-standard (Blink / WebKit); trackpads report exactly −3 × deltaY. */
  readonly wheelDeltaY?: number | undefined;
}

export interface WheelMemory {
  last: number;
  intent: WheelIntent | null;
}

export function createWheelMemory(): WheelMemory {
  return { last: Number.NEGATIVE_INFINITY, intent: null };
}

function isMacWheelStep(a: number): boolean {
  const n = a / MAC_WHEEL_STEP;
  return n >= 1 && Math.abs(n - Math.round(n)) < 1e-6;
}

/** Whether a vertical pixel delta looks like a discrete mouse-wheel notch. */
export function isNotchDelta(deltaY: number): boolean {
  const a = Math.abs(deltaY);
  if (a === 0) return false;
  return isMacWheelStep(a) || (a >= 50 && Number.isInteger(a));
}

/**
 * Classify a wheel event. Events of one gesture keep the first event's intent, because a
 * fast trackpad flick can produce large integer deltas that look like a mouse notch.
 */
export function classifyWheel(e: WheelLike, memory: WheelMemory, now: number): WheelIntent {
  let intent: WheelIntent;
  if (e.ctrlKey || e.metaKey) {
    intent = e.deltaMode !== 0 || isNotchDelta(e.deltaY) ? 'notch' : 'pinch';
  } else if (
    memory.intent !== null &&
    memory.intent !== 'pinch' &&
    now - memory.last < WHEEL_GESTURE_GAP
  ) {
    intent = memory.intent;
  } else if (e.deltaMode !== 0) {
    intent = 'notch';
  } else if (e.deltaX !== 0) {
    intent = 'pan';
  } else if (e.wheelDeltaY !== undefined && e.wheelDeltaY !== 0) {
    intent = e.wheelDeltaY === -3 * e.deltaY ? 'pan' : 'notch';
  } else {
    intent = isNotchDelta(e.deltaY) ? 'notch' : 'pan';
  }
  memory.last = now;
  memory.intent = intent;
  return intent;
}

/** Wheel deltas in css px (line and page modes converted). */
export function wheelPixels(e: WheelLike, pageHeight: number): { x: number; y: number } {
  const m = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? Math.max(pageHeight, 1) : 1;
  return { x: e.deltaX * m, y: e.deltaY * m };
}

/**
 * Zoom factor for a vertical wheel delta (px). Pinch deltas follow the native pinch scale
 * (`exp(−dy / 100)`); notches zoom ≈ 1.33× per 100 px notch, macOS steps ≈ 1.1× each.
 */
export function wheelZoomFactor(intent: 'pinch' | 'notch', deltaY: number): number {
  if (intent === 'pinch') return Math.exp(-clamp(deltaY, -50, 50) / 100);
  const a = Math.abs(deltaY);
  const dy = isMacWheelStep(a) ? Math.sign(deltaY) * Math.round(a / MAC_WHEEL_STEP) * 33 : deltaY;
  return 2 ** (-clamp(dy, -240, 240) / 240);
}

/** Release velocity from the last ~100 ms of pointer samples (ring buffer, allocation-free). */
export class VelocityTracker {
  private readonly t = new Float64Array(8);
  private readonly x = new Float64Array(8);
  private readonly y = new Float64Array(8);
  private n = 0;
  private head = 0;

  reset(): void {
    this.n = 0;
    this.head = 0;
  }

  add(t: number, x: number, y: number): void {
    this.t[this.head] = t;
    this.x[this.head] = x;
    this.y[this.head] = y;
    this.head = (this.head + 1) % 8;
    if (this.n < 8) this.n++;
  }

  /** px/ms; zero when the pointer rested for more than 50 ms before `now`. */
  velocity(now: number, window = 100): { x: number; y: number } {
    if (this.n < 2) return { x: 0, y: 0 };
    const newest = (this.head + 7) % 8;
    const tn = this.t[newest] ?? 0;
    if (now - tn > 50) return { x: 0, y: 0 };
    let oldest = newest;
    for (let i = 1; i < this.n; i++) {
      const j = (newest - i + 8) % 8;
      if (tn - (this.t[j] ?? 0) > window) break;
      oldest = j;
    }
    const dt = tn - (this.t[oldest] ?? 0);
    if (dt <= 0) return { x: 0, y: 0 };
    let vx = ((this.x[newest] ?? 0) - (this.x[oldest] ?? 0)) / dt;
    let vy = ((this.y[newest] ?? 0) - (this.y[oldest] ?? 0)) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed > GLIDE_MAX_SPEED) {
      vx *= GLIDE_MAX_SPEED / speed;
      vy *= GLIDE_MAX_SPEED / speed;
    }
    return { x: vx, y: vy };
  }
}

export interface InputHost {
  readonly camera: CameraController;
  /** Pointer moved over the canvas with no button pressed (css px, canvas-relative). */
  hover(x: number, y: number): void;
  /** Pointer left the canvas. */
  leave(): void;
  click(x: number, y: number, event: PointerEvent): void;
  dblclick(x: number, y: number, event: MouseEvent): void;
  /** A drag started / ended (cursor feedback). */
  dragging(active: boolean): void;
  /** Monotonic clock (ms). */
  now(): number;
}

interface GestureEventLike extends Event {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** Wire input listeners on `el`; returns a function that removes all of them. */
export function attachInput(el: HTMLElement, host: InputHost): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  const tracker = new VelocityTracker();
  const wheelMemory = createWheelMemory();
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let dragging = false;
  /** The gesture involved two pointers: never a click, no inertia. */
  let multi = false;
  let pinchX = 0;
  let pinchY = 0;
  let pinchD = 0;
  let gesture = false;
  let gestureScale = 1;

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const pinchState = (): [number, number, number] => {
    const it = pointers.values();
    const a = it.next().value;
    const b = it.next().value;
    if (!a || !b) return [0, 0, 0];
    return [(a.x + b.x) / 2, (a.y + b.y) / 2, Math.hypot(a.x - b.x, a.y - b.y)];
  };

  const beginPinch = (): void => {
    [pinchX, pinchY, pinchD] = pinchState();
  };

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault();
    const [x, y] = local(e);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best effort (synthetic events, detached elements).
    }
    pointers.set(e.pointerId, { x, y });
    host.camera.interrupt();
    if (pointers.size === 1) {
      downX = lastX = x;
      downY = lastY = y;
      dragging = false;
      multi = false;
      tracker.reset();
      tracker.add(host.now(), x, y);
    } else {
      multi = true;
      beginPinch();
    }
  };

  const onMove = (e: PointerEvent): void => {
    const [x, y] = local(e);
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (pointers.size === 0) host.hover(x, y);
      return;
    }
    p.x = x;
    p.y = y;
    if (pointers.size >= 2) {
      const [cx, cy, d] = pinchState();
      if (pinchD > 0 && d > 0) host.camera.zoomNow(d / pinchD, cx, cy);
      host.camera.panNow(cx - pinchX, cy - pinchY);
      pinchX = cx;
      pinchY = cy;
      pinchD = d;
      return;
    }
    if (!dragging) {
      if (Math.hypot(x - downX, y - downY) < DRAG_THRESHOLD) return;
      dragging = true;
      host.dragging(true);
    }
    host.camera.panNow(x - lastX, y - lastY);
    lastX = x;
    lastY = y;
    tracker.add(host.now(), x, y);
  };

  const onUp = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    const [x, y] = local(e);
    if (pointers.size === 1) {
      // Pinch → one finger left: keep panning with it from where it is.
      const rest = pointers.values().next().value;
      if (rest) {
        lastX = rest.x;
        lastY = rest.y;
      }
      tracker.reset();
      if (!dragging) {
        dragging = true;
        host.dragging(true);
      }
      return;
    }
    if (pointers.size > 1) {
      beginPinch();
      return;
    }
    const cancelled = e.type === 'pointercancel';
    if (dragging) {
      host.dragging(false);
      if (!cancelled && !multi) {
        const v = tracker.velocity(host.now());
        if (Math.hypot(v.x, v.y) > GLIDE_START_SPEED) host.camera.glide(v.x, v.y);
      }
    } else if (!multi && !cancelled) {
      host.click(x, y, e);
    }
    dragging = false;
    multi = false;
  };

  const onLeave = (): void => {
    if (pointers.size === 0) host.leave();
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (gesture && e.ctrlKey) return; // Safari also reports the pinch as gesture events.
    let [x, y] = local(e);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      x = el.clientWidth / 2;
      y = el.clientHeight / 2;
    }
    const sample: WheelLike = {
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaMode: e.deltaMode,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      wheelDeltaY: 'wheelDeltaY' in e ? Number(e.wheelDeltaY) : undefined,
    };
    const intent = classifyWheel(sample, wheelMemory, host.now());
    const d = wheelPixels(sample, el.clientHeight);
    if (intent === 'pan') {
      host.camera.interrupt();
      host.camera.panNow(-d.x, -d.y);
    } else if (intent === 'pinch') {
      host.camera.interrupt();
      host.camera.zoomNow(wheelZoomFactor('pinch', d.y), x, y);
    } else {
      host.camera.touched = true;
      host.camera.zoomSmooth(wheelZoomFactor('notch', d.y), x, y);
    }
  };

  const onDblClick = (e: MouseEvent): void => {
    const [x, y] = local(e);
    host.dblclick(x, y, e);
  };

  const onGestureStart = (e: Event): void => {
    e.preventDefault();
    if (pointers.size >= 2) return; // Touch pinch is handled through pointer events.
    gesture = true;
    gestureScale = 1;
    host.camera.interrupt();
  };

  const onGestureChange = (e: Event): void => {
    e.preventDefault();
    if (!gesture || pointers.size >= 2) return;
    const g = e as GestureEventLike;
    if (!(g.scale > 0)) return;
    const [x, y] = local(g);
    host.camera.zoomNow(g.scale / gestureScale, x, y);
    gestureScale = g.scale;
  };

  const onGestureEnd = (e: Event): void => {
    e.preventDefault();
    gesture = false;
  };

  const listeners: [string, EventListener, AddEventListenerOptions?][] = [
    ['pointerdown', onDown as EventListener],
    ['pointermove', onMove as EventListener],
    ['pointerup', onUp as EventListener],
    ['pointercancel', onUp as EventListener],
    ['pointerleave', onLeave],
    ['wheel', onWheel as EventListener, { passive: false }],
    ['dblclick', onDblClick as EventListener],
    ['gesturestart', onGestureStart, { passive: false }],
    ['gesturechange', onGestureChange, { passive: false }],
    ['gestureend', onGestureEnd, { passive: false }],
  ];
  for (const [type, fn, opts] of listeners) el.addEventListener(type, fn, opts);
  return () => {
    for (const [type, fn, opts] of listeners) el.removeEventListener(type, fn, opts);
    pointers.clear();
  };
}
