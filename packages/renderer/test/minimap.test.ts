import type { Rect } from '@kgdiff/core';
import { KgdiffError } from '@kgdiff/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { darkTheme, lightTheme } from '../dev/theme.js';
import type { Renderer } from '../src/index.js';
import {
  createMinimapImpl,
  fitTransform,
  markColor,
  minimapWindow,
  WindowScale,
} from '../src/minimap.js';
import { createRendererImpl } from '../src/renderer.js';
import {
  edge,
  frameOf,
  node,
  RecordingContext,
  recordingFactory,
} from './helpers/recording-ctx.js';

const W = 184;
const H = 128;
const PAD = 8;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function setup() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const queue: ((t: number) => void)[] = [];
  let time = 0;
  const renderer: Renderer = createRendererImpl(
    host,
    { theme: darkTheme, pixelRatio: 2 },
    {
      context: new RecordingContext(),
      surfaceFactory: recordingFactory().factory,
      requestFrame: (cb) => queue.push(cb),
      cancelFrame: () => {},
      now: () => time,
    },
  );
  /** Run animation frames until everything settles (16 ms apart). */
  const flush = () => {
    for (let i = 0; i < 200 && queue.length > 0; i++) {
      time += 16;
      for (const cb of queue.splice(0)) cb(time);
    }
  };
  const mmHost = document.createElement('div');
  document.body.appendChild(mmHost);
  const ctx = new RecordingContext();
  const { factory, surfaces } = recordingFactory();
  const minimap = createMinimapImpl(
    mmHost,
    renderer,
    {},
    { context: ctx, surfaceFactory: factory },
  );
  return { renderer, minimap, ctx, surfaces, flush, mmHost };
}

const neutral = (x: number, y: number) => node(x, y);
const added = (x: number, y: number) =>
  node(x, y, { family: 'added', fill: darkTheme.family.added.base });

/** Where `rect` lands in the minimap for a transform. */
function mapped(t: { s: number; ox: number; oy: number }, r: Rect) {
  return {
    x0: r.x * t.s + t.ox,
    y0: r.y * t.s + t.oy,
    x1: (r.x + r.width) * t.s + t.ox,
    y1: (r.y + r.height) * t.s + t.oy,
  };
}

function expectInside(t: { s: number; ox: number; oy: number }, r: Rect): void {
  const m = mapped(t, r);
  expect(m.x0).toBeGreaterThanOrEqual(PAD - 1e-6);
  expect(m.y0).toBeGreaterThanOrEqual(PAD - 1e-6);
  expect(m.x1).toBeLessThanOrEqual(W - PAD + 1e-6);
  expect(m.y1).toBeLessThanOrEqual(H - PAD + 1e-6);
}

function expectCentred(t: { s: number; ox: number; oy: number }, content: Rect): void {
  expect((content.x + content.width / 2) * t.s + t.ox).toBeCloseTo(W / 2, 9);
  expect((content.y + content.height / 2) * t.s + t.oy).toBeCloseTo(H / 2, 9);
}

describe('minimap window', () => {
  const content = { x: 0, y: 0, width: 1000, height: 600 };

  it('is the content itself when the viewport is inside it', () => {
    const vp = { x: 400, y: 200, width: 200, height: 150 };
    expect(minimapWindow(content, vp)).toEqual(content);
    const t = fitTransform(minimapWindow(content, vp), W, H, PAD);
    expect(t.s).toBeCloseTo(Math.min((W - 2 * PAD) / 1000, (H - 2 * PAD) / 600), 12);
    expectInside(t, vp);
    expectCentred(t, content);
  });

  it('grows around the content centre to contain a larger viewport', () => {
    // A fitted view: wider than the content and off-centre (safe area on the left).
    const vp = { x: -900, y: -100, width: 2200, height: 800 };
    const win = minimapWindow(content, vp);
    expect(win).toEqual({ x: -900, y: -100, width: 2800, height: 800 });
    const t = fitTransform(win, W, H, PAD);
    expectInside(t, vp);
    expectInside(t, content);
    expectCentred(t, content);
  });

  it('extends only as far as needed when the viewport is partly outside', () => {
    const vp = { x: 900, y: 500, width: 400, height: 300 };
    const win = minimapWindow(content, vp);
    // Right edge at 1300 → half-width 800 around x = 500; bottom at 800 → half-height 500.
    expect(win).toEqual({ x: -300, y: -200, width: 1600, height: 1000 });
    const t = fitTransform(win, W, H, PAD);
    expectInside(t, vp);
    expectCentred(t, content);
  });

  it('ignores degenerate viewports and keeps a minimum extent for a single point', () => {
    expect(minimapWindow(content, { x: 0, y: 0, width: 0, height: 0 })).toEqual(content);
    expect(minimapWindow({ x: 5, y: 5, width: 0, height: 0 }, null)).toEqual({
      x: 4,
      y: 4,
      width: 2,
      height: 2,
    });
  });
});

describe('WindowScale', () => {
  it('shrinks at once, so the viewport never leaves the minimap', () => {
    const s = new WindowScale();
    expect(s.retarget(1)).toBe(true);
    expect(s.retarget(0.5)).toBe(true);
    expect(s.value).toBe(0.5);
    expect(s.growing).toBe(false);
  });

  it('does not grow within the hysteresis band (no jitter while panning)', () => {
    const s = new WindowScale();
    s.retarget(1);
    s.retarget(0.9);
    expect(s.retarget(1.1)).toBe(false);
    expect(s.growing).toBe(false);
    expect(s.value).toBe(0.9);
  });

  it('grows back eased, settling in about 150 ms', () => {
    const s = new WindowScale();
    s.retarget(0.5);
    s.retarget(1);
    expect(s.growing).toBe(true);
    s.step(16);
    expect(s.value).toBeGreaterThan(0.5);
    expect(s.value).toBeLessThan(1);
    let t = 16;
    while (s.step(16)) t += 16;
    expect(s.value).toBe(1);
    expect(t).toBeLessThanOrEqual(400);
    expect(t).toBeGreaterThanOrEqual(100);
  });
});

describe('minimap', () => {
  it('is a 184 × 128 css-px card sized in device pixels', () => {
    const { minimap } = setup();
    expect(minimap.canvas.style.width).toBe('184px');
    expect(minimap.canvas.style.height).toBe('128px');
    expect(minimap.canvas.width).toBe(368);
    expect(minimap.canvas.style.borderRadius).toBe('12px');
  });

  it('draws edges as faint hairlines, neutral dots at 45%, changes outlined in family color', () => {
    const { minimap, surfaces } = setup();
    const a = neutral(0, 0);
    const b = neutral(100, 0);
    minimap.update(frameOf([a, b, added(50, 50)], [edge(a, b)]));
    const layer = surfaces.at(-1)!;
    const hair = layer.calls('stroke')[0]!;
    expect(hair.style.globalAlpha).toBe(0.12);
    expect(hair.style.lineWidth).toBe(1); // 0.5 css px at dpr 2
    const fills = layer.calls('fill');
    const neutralFill = fills.find((op) => op.style.globalAlpha === 0.45)!;
    expect(neutralFill.style.fillStyle).toBe(darkTheme.neutral.node);
    const squares = layer.calls('rect').filter((op) => op.args[2] === 3); // 1.5 css px at dpr 2
    expect(squares).toHaveLength(2);
    for (const op of squares)
      expect(Number.isInteger(op.args[0]) && Number.isInteger(op.args[1])).toBe(true);
    const outline = fills.findIndex((op) => op.style.fillStyle === darkTheme.canvas.background);
    const dot = fills.findIndex((op) => op.style.fillStyle === darkTheme.family.added.base);
    expect(outline).toBeGreaterThanOrEqual(0);
    expect(dot).toBeGreaterThan(outline);
    const radii = layer.calls('arc').map((op) => op.args[2]);
    expect(radii).toEqual([4.5, 2.5]); // (1.25 + 1) and 1.25 css px at dpr 2
  });

  it('uses the stroke token for neutral dots in light themes, and skips edges on big graphs', () => {
    const { renderer, minimap, surfaces } = setup();
    renderer.setTheme(lightTheme);
    const nodes = [neutral(0, 0), neutral(10, 0)];
    const edges = Array.from({ length: 3000 }, () => edge(nodes[0]!, nodes[1]!));
    minimap.update(frameOf(nodes, edges));
    const layer = surfaces.at(-1)!;
    expect(layer.calls('fill').find((op) => op.style.globalAlpha === 0.45)!.style.fillStyle).toBe(
      lightTheme.neutral.nodeStroke,
    );
    expect(layer.count('stroke')).toBe(0);
  });

  it('keeps the whole viewport rectangle visible when everything is in view (after fit)', () => {
    const { renderer, minimap, ctx, flush } = setup();
    const frame = frameOf([neutral(0, 0), neutral(1000, 600)]);
    renderer.setFrame(frame);
    minimap.update(frame);
    flush();
    const t = minimap.transform()!;
    const vp = renderer.camera.viewport();
    expect(vp.width).toBeGreaterThan(1000); // the fitted view is larger than the content
    expectInside(t, vp);
    expectCentred(t, { x: 0, y: 0, width: 1000, height: 600 });
    const rect = ctx
      .calls('fillRect')
      .filter((op) => op.style.fillStyle === darkTheme.accent.soft)
      .at(-1)!;
    const [rx, ry, rw, rh] = rect.args as number[];
    expect(rx).toBeGreaterThanOrEqual(PAD - 1);
    expect(ry).toBeGreaterThanOrEqual(PAD - 1);
    expect(rx! + rw!).toBeLessThanOrEqual(W - PAD + 1);
    expect(ry! + rh!).toBeLessThanOrEqual(H - PAD + 1);
  });

  it('follows zoom: shrinks with a growing viewport at once, grows back eased', () => {
    const { renderer, minimap, flush } = setup();
    const content = { x: 0, y: 0, width: 1000, height: 600 };
    const frame = frameOf([neutral(0, 0), neutral(1000, 600)]);
    renderer.setFrame(frame);
    minimap.update(frame);
    flush();
    renderer.camera.set({ x: 500, y: 300, k: 4 }); // viewport well inside the content
    flush();
    const tight = minimap.transform()!;
    expect(tight.s).toBeCloseTo(fitTransform(content, W, H, PAD).s, 6);
    renderer.camera.set({ x: 500, y: 300, k: 0.2 }); // viewport far larger than the content
    flush();
    expectInside(minimap.transform()!, renderer.camera.viewport());
    expectCentred(minimap.transform()!, content);
  });

  it('keeps the viewport inside while panning, without re-fitting on small moves', () => {
    const { renderer, minimap, flush } = setup();
    const frame = frameOf([neutral(0, 0), neutral(1000, 600)]);
    renderer.setFrame(frame);
    minimap.update(frame);
    renderer.camera.set({ x: 500, y: 300, k: 1 });
    flush();
    for (let i = 0; i < 40; i++) {
      renderer.camera.panBy(25, 0); // drift left of the content
      flush();
      expectInside(minimap.transform()!, renderer.camera.viewport());
    }
    const before = minimap.transform()!.s;
    renderer.camera.panBy(-10, 0); // a small move back: within the hysteresis band
    flush();
    expect(minimap.transform()!.s).toBe(before);
  });

  it('reports minimap navigation as user camera changes', () => {
    const { renderer, minimap, flush } = setup();
    const frame = frameOf([neutral(0, 0), neutral(1000, 600)]);
    renderer.setFrame(frame);
    minimap.update(frame);
    renderer.camera.set({ x: 500, y: 300, k: 2 });
    flush();
    const sources: string[] = [];
    renderer.on('camera', (c) => sources.push(c.source));
    const t = minimap.transform()!;
    const ev = (type: string, wx: number, wy: number) =>
      new PointerEvent(type, {
        clientX: wx * t.s + t.ox,
        clientY: wy * t.s + t.oy,
        pointerId: 1,
        button: 0,
        pointerType: 'mouse',
        bubbles: true,
      });
    minimap.canvas.dispatchEvent(ev('pointerdown', 900, 100));
    flush();
    minimap.canvas.dispatchEvent(ev('pointermove', 800, 200));
    flush();
    minimap.canvas.dispatchEvent(ev('pointerup', 800, 200));
    expect(sources.length).toBeGreaterThanOrEqual(2);
    expect(new Set(sources)).toEqual(new Set(['user']));
  });

  it('navigates on click and drag, with the window frozen during the drag', () => {
    const { renderer, minimap, flush } = setup();
    const frame = frameOf([neutral(0, 0), neutral(1000, 600)]);
    renderer.setFrame(frame);
    minimap.update(frame);
    renderer.camera.set({ x: 500, y: 300, k: 2 });
    flush();
    const t = minimap.transform()!;
    const at = (wx: number, wy: number) => ({ clientX: wx * t.s + t.ox, clientY: wy * t.s + t.oy });
    const ev = (type: string, p: { clientX: number; clientY: number }) =>
      new PointerEvent(type, {
        ...p,
        pointerId: 1,
        button: 0,
        pointerType: 'mouse',
        bubbles: true,
      });
    minimap.canvas.dispatchEvent(ev('pointerdown', at(800, 400)));
    expect(renderer.camera.get().x).toBeCloseTo(800, 6);
    expect(renderer.camera.get().y).toBeCloseTo(400, 6);
    expect(renderer.camera.get().k).toBe(2);
    minimap.canvas.dispatchEvent(ev('pointermove', at(1100, 300)));
    flush();
    expect(minimap.transform()).toEqual(t); // frozen: the mapping does not move under the pointer
    expect(renderer.camera.get().x).toBeCloseTo(1100, 6);
    minimap.canvas.dispatchEvent(ev('pointerup', at(1100, 300)));
    flush();
    expectInside(minimap.transform()!, renderer.camera.viewport());
    minimap.canvas.dispatchEvent(ev('pointermove', at(100, 100)));
    expect(renderer.camera.get().x).toBeCloseTo(1100, 6);
  });

  it('restyles on theme change', () => {
    const { renderer, minimap } = setup();
    expect(minimap.canvas.style.background).toContain('17');
    renderer.setTheme(lightTheme);
    expect(minimap.canvas.style.background).toContain('255');
  });

  it('cleans up on destroy and refuses foreign renderers', () => {
    const { minimap, mmHost, renderer } = setup();
    minimap.destroy();
    expect(mmHost.childElementCount).toBe(0);
    renderer.camera.set({ x: 1, y: 1, k: 1 }); // no listener left to throw
    renderer.destroy();
    expect(() => createMinimapImpl(mmHost, renderer)).toThrow(KgdiffError);
  });

  it('colors marks by NodeVisual.family with the theme family base', () => {
    expect(markColor(node(0, 0), darkTheme)).toBeNull();
    expect(
      markColor(node(0, 0, { family: 'removed', fill: null, stroke: '#123' }), darkTheme),
    ).toBe(darkTheme.family.removed.base);
    // Drawn as context (e.g. filtered out): neutral even with a colored fill.
    expect(markColor(node(0, 0, { family: 'neutral', fill: '#FBBF24' }), darkTheme)).toBeNull();
  });

  it('fits content bounds into the card, centred', () => {
    const f = fitTransform({ x: 0, y: 0, width: 100, height: 100 }, W, H, PAD);
    expect(f.s).toBeCloseTo(1.12, 9);
    expect(0 * f.s + f.ox).toBeCloseTo((W - 112) / 2, 9);
    expect(0 * f.s + f.oy).toBeCloseTo(8, 9);
  });
});
