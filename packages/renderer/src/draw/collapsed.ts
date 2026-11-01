/** Collapsed-group pills (“+38 unchanged”): hidden nodes summarized at their centroid. */
import type { CollapsedGroup, Theme } from '@kgdiff/scene';
import type { Ctx2D } from '../ctx.js';
import { crispOffset, snap } from '../math.js';
import type { Fonts, TextMeasurer } from '../text.js';
import { roundRectPath } from './shapes.js';
import type { View } from './view.js';

export const PILL_HEIGHT = 20;
export const PILL_PAD_X = 8;
export const PILL_FONT_SIZE = 11;

const texts = new Map<number, string>();

/** Pill text: the scene's localized `label`, else `+N` (cached per count). */
export function pillText(g: CollapsedGroup): string {
  if (typeof g.label === 'string' && g.label.length > 0) return g.label;
  const count = g.count;
  let t = texts.get(count);
  if (t === undefined) {
    t = `+${count.toLocaleString('en-US')}`;
    if (texts.size > 4096) texts.clear();
    texts.set(count, t);
  }
  return t;
}

/** Screen rectangle of a group's pill: [x, y, w, h] written into `out`. */
export function pillRect(
  g: CollapsedGroup,
  v: Pick<View, 'k' | 'ox' | 'oy' | 'dpr'>,
  fonts: Fonts,
  measurer: TextMeasurer,
  out: Float64Array,
): Float64Array {
  const w = Math.ceil(measurer.width(fonts.get(PILL_FONT_SIZE, 500), pillText(g))) + 2 * PILL_PAD_X;
  out[0] = snap(g.x * v.k + v.ox - w / 2, v.dpr);
  out[1] = snap(g.y * v.k + v.oy - PILL_HEIGHT / 2, v.dpr);
  out[2] = w;
  out[3] = PILL_HEIGHT;
  return out;
}

const rect = new Float64Array(4);

/** Draw the pills that won their spot in label placement (`shown[i] === 1`). */
export function drawCollapsed(
  ctx: Ctx2D,
  groups: readonly CollapsedGroup[],
  shown: Uint8Array,
  v: View,
  theme: Theme,
  fonts: Fonts,
  measurer: TextMeasurer,
): void {
  if (groups.length === 0) return;
  const font = fonts.get(PILL_FONT_SIZE, 500);
  const o = crispOffset(1, v.dpr);
  let styled = false;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    if (shown[i] !== 1) continue;
    pillRect(g, v, fonts, measurer, rect);
    const x = rect[0]!;
    const y = rect[1]!;
    const w = rect[2]!;
    const h = rect[3]!;
    if (x + w < v.x0 || x > v.x1 || y + h < v.y0 || y > v.y1) continue;
    if (!styled) {
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      styled = true;
    }
    ctx.beginPath();
    roundRectPath(ctx, x + o, y + o, w - 2 * o, h - 2 * o, h / 2);
    ctx.fillStyle = theme.surface.raised;
    ctx.fill();
    ctx.strokeStyle = theme.surface.borderStrong;
    ctx.stroke();
    ctx.fillStyle = theme.text.secondary;
    ctx.fillText(pillText(g), x + w / 2, y + h / 2 + 0.5);
  }
}
