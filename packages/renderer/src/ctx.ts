/**
 * The slice of `CanvasRenderingContext2D` the renderer draws through.
 *
 * Every pass talks to this interface only, so drawing is testable with a recording mock
 * (happy-dom has no 2D context) and works unchanged on `OffscreenCanvasRenderingContext2D`.
 */
export interface Ctx2D {
  globalAlpha: number;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
  lineDashOffset: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  imageSmoothingEnabled: boolean;
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  setLineDash(segments: readonly number[]): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): { readonly width: number };
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradient;
  createPattern(image: CanvasImageSource, repetition: string | null): CanvasPattern | null;
}

/** An offscreen drawing surface (sprites, label atlas, grid tiles, exports). */
export interface Surface {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly ctx: Ctx2D;
}

/** Creates offscreen surfaces; returns null where 2D canvases are unavailable. */
export type SurfaceFactory = (width: number, height: number) => Surface | null;

/** OffscreenCanvas when it works, else a detached `<canvas>`, else null. */
export const domSurfaceFactory: SurfaceFactory = (width, height) => {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  if (typeof OffscreenCanvas === 'function') {
    try {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (ctx) return { canvas, ctx };
    } catch {
      // Fall through to a DOM canvas.
    }
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) return { canvas, ctx };
  }
  return null;
};

/** Shared empty dash pattern (solid line) so passes never allocate one. */
export const NO_DASH: readonly number[] = Object.freeze([]);
