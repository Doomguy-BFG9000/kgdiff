import type { Rect } from '@kgdiff/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ChromeLayout,
  chromeInsets,
  FRAME_PADDING,
  fitZoom,
  frameTarget,
  freeView,
  type Insets,
  zoomFit,
} from '../src/framing.js';

/** Screen rect of world `r` under camera `t` in a `w` × `h` canvas. */
function onScreen(r: Rect, t: { x: number; y: number; k: number }, w: number, h: number): Rect {
  return {
    x: (r.x - t.x) * t.k + w / 2,
    y: (r.y - t.y) * t.k + h / 2,
    width: r.width * t.k,
    height: r.height * t.k,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The lead's case: an 800 × 600 pane, sidebar open → a 440 × 461 canvas. */
const legend: Rect = { x: 16, y: 413, width: 64, height: 32 };
const minimap: Rect = { x: 197, y: 317, width: 227, height: 128 };
const canvas: ChromeLayout = { width: 440, height: 461, obstacles: [legend, minimap] };
const hunk: Rect = { x: -156.87, y: -49.67, width: 174.76, height: 160 };

describe('chromeInsets / frameTarget', () => {
  it('centers a hunk in the free canvas, clear of the legend and minimap, never clipped', () => {
    const insets = chromeInsets(hunk, canvas, FRAME_PADDING, 1.8);
    const t = frameTarget(hunk, canvas.width, canvas.height, insets, 0.05, 1.8);
    const s = onScreen(hunk, t, canvas.width, canvas.height);
    // Fully inside the canvas.
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(s.y).toBeGreaterThanOrEqual(0);
    expect(s.x + s.width).toBeLessThanOrEqual(canvas.width);
    expect(s.y + s.height).toBeLessThanOrEqual(canvas.height);
    // Clear of the chrome.
    expect(overlaps(s, legend)).toBe(false);
    expect(overlaps(s, minimap)).toBe(false);
    // Centered in the free region, and much larger than with fixed 56 / 160 + 48 px insets.
    const freeCx = insets.left + (canvas.width - insets.left - insets.right) / 2;
    const freeCy = insets.top + (canvas.height - insets.top - insets.bottom) / 2;
    expect(s.x + s.width / 2).toBeCloseTo(freeCx, 6);
    expect(s.y + s.height / 2).toBeCloseTo(freeCy, 6);
    const fixed = fitZoom(hunk, canvas.width, canvas.height, {
      top: 104,
      right: 64,
      bottom: 208,
      left: 64,
    });
    expect(t.k).toBeGreaterThan(fixed * 1.5);
  });

  it('uses the whole canvas, evenly padded, when nothing floats over it', () => {
    const insets = chromeInsets(hunk, { width: 800, height: 600, obstacles: [] });
    expect(insets).toEqual({ top: 24, right: 24, bottom: 24, left: 24 });
    const t = frameTarget(hunk, 800, 600, insets, 0.05, 6);
    const s = onScreen(hunk, t, 800, 600);
    expect(s.x + s.width / 2).toBeCloseTo(400, 6);
    expect(s.y + s.height / 2).toBeCloseTo(300, 6);
  });

  it('prefers the more centered region when both show the target equally large', () => {
    // A small target hits the zoom cap either way: avoid a bottom-right card from below.
    const small: Rect = { x: 0, y: 0, width: 40, height: 40 };
    const card: Rect = { x: 600, y: 480, width: 184, height: 104 };
    const insets = chromeInsets(small, { width: 800, height: 600, obstacles: [card] }, 24, 1.8);
    expect(insets.right).toBe(24);
    expect(insets.bottom).toBe(600 - 480 + 8);
  });

  it('ignores chrome outside the canvas', () => {
    const insets = chromeInsets(hunk, {
      width: 400,
      height: 300,
      obstacles: [{ x: 500, y: 0, width: 50, height: 50 }],
    });
    expect(insets).toEqual({ top: 24, right: 24, bottom: 24, left: 24 });
  });

  it('keeps any target clear of any two corner cards (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 360, max: 1600 }),
        fc.integer({ min: 300, max: 1000 }),
        fc.double({ min: 10, max: 2000, noNaN: true }),
        fc.double({ min: 10, max: 2000, noNaN: true }),
        (w, h, bw, bh) => {
          const obstacles: Rect[] = [
            { x: 16, y: h - 16 - 150, width: 140, height: 150 },
            { x: w - 16 - 230, y: h - 16 - 128, width: 230, height: 128 },
          ];
          const bounds: Rect = { x: -bw / 2, y: -bh / 2, width: bw, height: bh };
          const insets = chromeInsets(bounds, { width: w, height: h, obstacles }, 24, 2.5);
          const t = frameTarget(bounds, w, h, insets, 0.01, 2.5);
          const s = onScreen(bounds, t, w, h);
          for (const o of obstacles) expect(overlaps(s, o)).toBe(false);
          expect(s.x).toBeGreaterThan(-1e-6);
          expect(s.x + s.width).toBeLessThan(w + 1e-6);
        },
      ),
    );
  });

  it('computes the free part of a world viewport', () => {
    const view = freeView({ x: 0, y: 0, width: 400, height: 300 }, 2, {
      top: 20,
      right: 40,
      bottom: 60,
      left: 80,
    });
    expect(view).toEqual({ x: 40, y: 10, width: 340, height: 260 });
  });
});

/** A node with a label block centred below it (px), shown from `minZoom`. */
interface Labelled {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly label: { width: number; height: number; minZoom: number } | null;
}

/** World extent of `nodes` with their labels drawn at zoom `k` (`Infinity`: discs alone). */
function extentOf(nodes: readonly Labelled[]): (k: number) => Rect | null {
  return (k) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const n of nodes) {
      x0 = Math.min(x0, n.x - n.r);
      x1 = Math.max(x1, n.x + n.r);
      y0 = Math.min(y0, n.y - n.r);
      y1 = Math.max(y1, n.y + n.r);
      const l = n.label;
      if (!Number.isFinite(k) || !l || k < l.minZoom) continue;
      x0 = Math.min(x0, n.x - l.width / 2 / k);
      x1 = Math.max(x1, n.x + l.width / 2 / k);
      y1 = Math.max(y1, n.y + n.r + (5 + l.height) / k);
    }
    return x0 <= x1 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
  };
}

const label = (width: number, minZoom = 0.2) => ({ width, height: 16, minZoom });
const even = (p: number): Insets => ({ top: p, right: p, bottom: p, left: p });

describe('zoomFit', () => {
  it('keeps the outermost labels on an 800 × 320 canvas (a looping replay embed)', () => {
    // The leftmost node carries the longest name, as `listed_top10_holder` does.
    const extent = extentOf([
      { x: -900, y: 40, r: 9, label: label(124) },
      { x: -300, y: -260, r: 12, label: label(48) },
      { x: 200, y: 0, r: 14, label: label(36) },
      { x: 700, y: 250, r: 9, label: label(96) },
    ]);
    const [w, h] = [800, 320];
    const insets = even(FRAME_PADDING);
    const fit = zoomFit(extent, w, h, insets, 2.5);
    if (!fit) throw new Error('no fit');
    const t = frameTarget(fit.bounds, w, h, insets, 0.05, 2.5);
    // It lands exactly on the zoom it solved for, where the labels are as measured.
    expect(t.k).toBeCloseTo(fit.k, 9);
    const s = onScreen(extent(t.k) as Rect, t, w, h);
    expect(s.x).toBeGreaterThanOrEqual(FRAME_PADDING - 1e-6);
    expect(s.y).toBeGreaterThanOrEqual(FRAME_PADDING - 1e-6);
    expect(s.x + s.width).toBeLessThanOrEqual(w - FRAME_PADDING + 1e-6);
    expect(s.y + s.height).toBeLessThanOrEqual(h - FRAME_PADDING + 1e-6);
    // As large as it gets: a percent more and the labels no longer fit.
    const more = extent(fit.k * 1.01) as Rect;
    expect(fitZoom(more, w, h, insets)).toBeLessThan(fit.k * 1.01);
    // Fitting the discs alone clips that name.
    const discs = extent(Infinity) as Rect;
    const naive = frameTarget(discs, w, h, insets, 0.05, 2.5);
    expect(onScreen(extent(naive.k) as Rect, naive, w, h).x).toBeLessThan(0);
  });

  it('stops at maxZoom and falls back to the discs when no zoom has room', () => {
    const small = extentOf([{ x: 0, y: 0, r: 10, label: label(40, 0) }]);
    expect(zoomFit(small, 800, 600, even(24), 2.5)?.k).toBe(2.5);
    // A label wider than the canvas at every zoom: fit the discs as before.
    const wide = extentOf([
      { x: 0, y: 0, r: 10, label: label(900, 0) },
      { x: 100, y: 0, r: 10, label: null },
    ]);
    const fit = zoomFit(wide, 400, 300, even(24), 2.5);
    expect(fit?.bounds).toEqual({ x: -10, y: -10, width: 120, height: 20 });
    expect(zoomFit(() => null, 400, 300, even(24), 2.5)).toBeNull();
  });

  it('shows every label it can, inside any canvas (property)', () => {
    const node = fc.record({
      x: fc.double({ min: -2000, max: 2000, noNaN: true }),
      y: fc.double({ min: -2000, max: 2000, noNaN: true }),
      r: fc.double({ min: 2, max: 30, noNaN: true }),
      label: fc.option(
        fc.record({
          width: fc.integer({ min: 4, max: 240 }),
          height: fc.constantFrom(16, 31),
          minZoom: fc.constantFrom(0, 0.18, 0.45),
        }),
      ),
    });
    fc.assert(
      fc.property(
        fc.array(node, { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 300, max: 1400 }),
        fc.integer({ min: 200, max: 900 }),
        fc.integer({ min: 0, max: 40 }),
        (nodes, w, h, pad) => {
          const extent = extentOf(nodes);
          const insets = even(pad);
          const fit = zoomFit(extent, w, h, insets, 2.5);
          if (!fit) throw new Error('no fit');
          const t = frameTarget(fit.bounds, w, h, insets, 0.05, 2.5);
          // Labels wider than the canvas can only be shown by hiding them (zooming out).
          if (fit.bounds === fit.content) return;
          expect(t.k).toBeCloseTo(fit.k, 6);
          const s = onScreen(extent(t.k) as Rect, t, w, h);
          expect(s.x).toBeGreaterThanOrEqual(pad - 1e-6);
          expect(s.y).toBeGreaterThanOrEqual(pad - 1e-6);
          expect(s.x + s.width).toBeLessThanOrEqual(w - pad + 1e-6);
          expect(s.y + s.height).toBeLessThanOrEqual(h - pad + 1e-6);
        },
      ),
    );
  });
});
