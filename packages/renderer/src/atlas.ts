/**
 * Label atlas: every label (text + background halo + strike) is rasterized once into a shared
 * offscreen surface and blitted with `drawImage` afterwards. Labels are screen-sized, so
 * panning and zooming never re-rasterize text; `strokeText` halos are expensive and this keeps
 * them off the per-frame path. Shelf packing; the atlas is wiped when full (rare, amortized).
 */
import type { Ctx2D, Surface, SurfaceFactory } from './ctx.js';

/** css px of transparent margin around each entry (the 3 px halo needs 1.5 px + AA). */
export const ATLAS_PAD = 2;
export const TEXT_HALO_WIDTH = 3;
export const TEXT_HALO_ALPHA = 0.9;

export interface AtlasEntry {
  /** Source rectangle in the atlas (device px). */
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

/** Draw one label line (halo, fill, strike) with its box's top-left at (x, y). */
export function drawTextLine(
  ctx: Ctx2D,
  text: string,
  font: string,
  color: string,
  halo: string,
  strike: boolean,
  x: number,
  y: number,
  width: number,
  height: number,
  alpha: number,
): void {
  const cy = y + height / 2;
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = alpha * TEXT_HALO_ALPHA;
  ctx.strokeStyle = halo;
  ctx.lineWidth = TEXT_HALO_WIDTH;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeText(text, x, cy);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillText(text, x, cy);
  if (strike) {
    const t = Math.max(1, height / 14);
    ctx.fillRect(x - 1, cy - t / 2 + 0.5, width + 2, t);
  }
}

export class LabelAtlas {
  private surface: Surface | null = null;
  private size = 0;
  private dpr = 1;
  private halo = '#000';
  private shelfX = 0;
  private shelfY = 0;
  private shelfH = 0;
  /** strike → font → color → text → entry */
  private readonly maps: [
    Map<string, Map<string, Map<string, AtlasEntry>>>,
    Map<string, Map<string, Map<string, AtlasEntry>>>,
  ] = [new Map(), new Map()];
  /** Bumped every time the atlas is wiped (tests, diagnostics). */
  generation = 0;
  /**
   * New entries allowed until the next `beginFrame` (rasterizing is the expensive part:
   * a zoom that reveals thousands of labels spreads them over a few frames instead of one).
   */
  private budget = Number.POSITIVE_INFINITY;
  /** Lookups refused this frame because the budget ran out. */
  deferred = 0;

  constructor(private readonly factory: SurfaceFactory) {}

  get canvas(): Surface['canvas'] | null {
    return this.surface?.canvas ?? null;
  }

  /** Re-key the atlas for a pixel ratio and halo color; wipes it when either changed. */
  configure(dpr: number, halo: string): void {
    if (dpr === this.dpr && halo === this.halo && this.surface) return;
    this.dpr = dpr;
    this.halo = halo;
    const size = Math.min(4096, Math.ceil(1024 * Math.max(1, dpr)));
    if (!this.surface || this.size !== size) {
      this.surface = this.factory(size, size);
      this.size = size;
    }
    this.wipe();
  }

  /** Start a frame with room for `budget` new entries. */
  beginFrame(budget: number): void {
    this.budget = budget;
    this.deferred = 0;
  }

  /** Forget every entry (fonts loaded, theme changed). */
  wipe(): void {
    this.maps[0].clear();
    this.maps[1].clear();
    this.shelfX = 0;
    this.shelfY = 0;
    this.shelfH = 0;
    this.generation++;
    this.surface?.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.surface?.ctx.clearRect(0, 0, this.size, this.size);
  }

  /**
   * The entry for a label line, rasterizing it on first use. Returns null when it cannot be
   * cached (too large, no surface) and `undefined` when this frame's budget is spent.
   */
  get(
    text: string,
    font: string,
    color: string,
    strike: boolean,
    width: number,
    height: number,
  ): AtlasEntry | null | undefined {
    const surface = this.surface;
    if (!surface) return null;
    const byFont = this.maps[strike ? 1 : 0];
    let byColor = byFont.get(font);
    if (!byColor) {
      byColor = new Map();
      byFont.set(font, byColor);
    }
    let byText = byColor.get(color);
    if (!byText) {
      byText = new Map();
      byColor.set(color, byText);
    }
    const hit = byText.get(text);
    if (hit) return hit;
    if (this.budget <= 0) {
      this.deferred++;
      return undefined;
    }

    const dpr = this.dpr;
    const sw = Math.ceil((width + 2 * ATLAS_PAD) * dpr);
    const sh = Math.ceil((height + 2 * ATLAS_PAD) * dpr);
    if (sw > this.size || sh > this.size) return null;
    if (this.shelfX + sw > this.size) {
      this.shelfY += this.shelfH + 1;
      this.shelfX = 0;
      this.shelfH = 0;
    }
    if (this.shelfY + sh > this.size) {
      this.wipe();
      return this.get(text, font, color, strike, width, height);
    }
    this.budget--;
    const entry: AtlasEntry = { sx: this.shelfX, sy: this.shelfY, sw, sh };
    const ctx = surface.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, this.shelfX, this.shelfY);
    drawTextLine(ctx, text, font, color, this.halo, strike, ATLAS_PAD, ATLAS_PAD, width, height, 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.shelfX += sw + 1;
    this.shelfH = Math.max(this.shelfH, sh);
    byText.set(text, entry);
    return entry;
  }
}
