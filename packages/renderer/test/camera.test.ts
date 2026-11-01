import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CameraController,
  type CameraHost,
  decay,
  fitState,
  GLIDE_TAU,
  type Insets,
  NO_INSETS,
  resolvePadding,
  screenToWorld,
  viewportRect,
  worldToScreen,
  zoomAround,
} from '../src/camera.js';

const size = { width: 800, height: 600 };

function host(
  o: Partial<CameraHost> & { safe?: Insets } = {},
): CameraHost & { invalidations: number } {
  const h = {
    invalidations: 0,
    size: () => size,
    safeArea: () => o.safe ?? NO_INSETS,
    contentBounds: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    reducedMotion: () => false,
    invalidate: () => {
      h.invalidations++;
    },
    ...o,
  };
  return h;
}

function run(cam: CameraController, from: number, to: number, step = 16): number {
  let t = from;
  while (t <= to && cam.tick(t)) t += step;
  return t;
}

describe('camera transforms', () => {
  const state = fc.record({
    x: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
    y: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
    k: fc.double({ min: 0.05, max: 6, noNaN: true }),
  });
  const point = fc.record({
    x: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
    y: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
  });

  it('round-trips world → screen → world', () => {
    fc.assert(
      fc.property(state, point, (s, p) => {
        const back = screenToWorld(s, size, worldToScreen(s, size, p));
        return (
          Math.abs(back.x - p.x) < 1e-6 * (1 + Math.abs(p.x)) &&
          Math.abs(back.y - p.y) < 1e-6 * (1 + Math.abs(p.y))
        );
      }),
    );
  });

  it('maps the camera centre to the viewport centre', () => {
    expect(worldToScreen({ x: 10, y: 20, k: 2 }, size, { x: 10, y: 20 })).toEqual({
      x: 400,
      y: 300,
    });
  });

  it('keeps the world point under the cursor fixed when zooming', () => {
    fc.assert(
      fc.property(
        state,
        fc.double({ min: 0.05, max: 6, noNaN: true }),
        fc.integer({ min: 0, max: 800 }),
        fc.integer({ min: 0, max: 600 }),
        (s, k, sx, sy) => {
          const before = screenToWorld(s, size, { x: sx, y: sy });
          const next = zoomAround(s, size, k, sx, sy);
          const after = screenToWorld(next, size, { x: sx, y: sy });
          return (
            Math.abs(after.x - before.x) < 1e-6 * (1 + Math.abs(before.x)) &&
            Math.abs(after.y - before.y) < 1e-6 * (1 + Math.abs(before.y))
          );
        },
      ),
    );
  });

  it('reports the visible world rectangle', () => {
    expect(viewportRect({ x: 0, y: 0, k: 2 }, size)).toEqual({
      x: -200,
      y: -150,
      width: 400,
      height: 300,
    });
  });
});

describe('fitState', () => {
  const pad = resolvePadding(48);

  it('fits bounds inside the padded viewport, centred', () => {
    const s = fitState({ x: 0, y: 0, width: 704, height: 100 }, size, pad, NO_INSETS, 0.05, 6);
    expect(s.k).toBeCloseTo(1, 9);
    expect(s.x).toBeCloseTo(352, 9);
    expect(s.y).toBeCloseTo(50, 9);
  });

  it('honours per-side padding and the safe area', () => {
    const safe = { top: 0, right: 200, bottom: 100, left: 0 };
    const p = { top: 10, right: 10, bottom: 10, left: 10 };
    const b = { x: 0, y: 0, width: 580, height: 100 };
    const s = fitState(b, size, p, safe, 0.05, 6);
    expect(s.k).toBeCloseTo(1, 9);
    // The bounds' centre lands in the middle of the free region (x 10…590, y 10…490).
    const c = worldToScreen(s, size, { x: 290, y: 50 });
    expect(c.x).toBeCloseTo(300, 9);
    expect(c.y).toBeCloseTo(250, 9);
    // Every corner stays inside the free region.
    const tl = worldToScreen(s, size, { x: 0, y: 0 });
    const br = worldToScreen(s, size, { x: 580, y: 100 });
    expect(tl.x).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(br.x).toBeLessThanOrEqual(590 + 1e-9);
  });

  it('zooms a single point to the maximum zoom', () => {
    const s = fitState({ x: 5, y: 7, width: 0, height: 0 }, size, pad, NO_INSETS, 0.05, 2.5);
    expect(s).toEqual({ x: 5, y: 7, k: 2.5 });
  });

  it('clamps to the minimum zoom for huge bounds', () => {
    expect(fitState({ x: 0, y: 0, width: 1e9, height: 1e9 }, size, pad, NO_INSETS, 0.05, 6).k).toBe(
      0.05,
    );
  });

  it('drops insets that leave no room instead of producing nonsense', () => {
    const safe = { top: 400, right: 500, bottom: 400, left: 500 };
    const s = fitState({ x: 0, y: 0, width: 100, height: 100 }, size, pad, safe, 0.05, 6);
    expect(Number.isFinite(s.k) && s.k > 0).toBe(true);
    expect(s.x).toBeCloseTo(50, 9);
  });
});

describe('CameraController', () => {
  it('clamps zoom to its limits', () => {
    const cam = new CameraController(host(), 0.1, 4);
    cam.set({ x: 0, y: 0, k: 100 });
    expect(cam.k).toBe(4);
    cam.zoomBy(1e-6, undefined, { animate: false });
    expect(cam.k).toBe(0.1);
  });

  it('flies to the fitted target and resolves at the end', async () => {
    const cam = new CameraController(host(), 0.05, 6);
    let done = false;
    const p = cam.flyTo({ x: 1000, y: 1000, width: 200, height: 200 }).then(() => {
      done = true;
    });
    expect(cam.animating).toBe(true);
    cam.tick(0);
    expect(cam.x).toBe(0); // first tick starts the clock
    const end = run(cam, 0, 5000);
    expect(end).toBeLessThanOrEqual(1100 + 16);
    await p;
    expect(done).toBe(true);
    const target = fitState(
      { x: 1000, y: 1000, width: 200, height: 200 },
      size,
      resolvePadding(undefined),
      NO_INSETS,
      0.05,
      2.5,
    );
    expect(cam.get()).toEqual(target);
  });

  it('never zooms beyond maxZoom (default 2.5) when flying', async () => {
    const cam = new CameraController(host(), 0.05, 6);
    const p = cam.flyTo({ x: 0, y: 0, width: 1, height: 1 }, { animate: false });
    await p;
    expect(cam.k).toBe(2.5);
    await cam.flyTo({ x: 0, y: 0, width: 1, height: 1 }, { animate: false, maxZoom: 5 });
    expect(cam.k).toBe(5);
  });

  it('jumps instead of flying under reduced motion', async () => {
    const cam = new CameraController(host({ reducedMotion: () => true }), 0.05, 6);
    await cam.flyTo({ x: 500, y: 0, width: 100, height: 100 });
    expect(cam.animating).toBe(false);
    expect(cam.x).toBeCloseTo(550, 9);
  });

  it('uses the duration override', () => {
    const cam = new CameraController(host(), 0.05, 6);
    void cam.flyTo({ x: 5000, y: 0, width: 100, height: 100 }, { duration: 100 });
    cam.tick(0);
    expect(cam.tick(50)).toBe(true);
    expect(cam.tick(100)).toBe(false);
  });

  it('resolves a flight cancelled by a new flight or by input', async () => {
    const cam = new CameraController(host(), 0.05, 6);
    const order: string[] = [];
    const a = cam.flyTo({ x: 5000, y: 0, width: 100, height: 100 }).then(() => order.push('a'));
    cam.tick(0);
    cam.tick(100);
    const b = cam.flyTo({ x: -5000, y: 0, width: 100, height: 100 }).then(() => order.push('b'));
    await a;
    expect(order).toEqual(['a']);
    cam.tick(200);
    cam.interrupt();
    await b;
    expect(order).toEqual(['a', 'b']);
    expect(cam.animating).toBe(false);
  });

  it('defers a fit requested before layout and applies it on the first size', async () => {
    let s = { width: 0, height: 0 };
    const h = host({ size: () => s });
    const cam = new CameraController(h, 0.05, 6);
    let done = false;
    const p = cam.fit({ x: 0, y: 0, width: 100, height: 100 }).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    s = size;
    cam.resized();
    await p;
    expect(cam.get()).toEqual(
      fitState(
        { x: 0, y: 0, width: 100, height: 100 },
        size,
        resolvePadding(undefined),
        NO_INSETS,
        0.05,
        2.5,
      ),
    );
  });

  it('fits the content bounds by default and does nothing without content', async () => {
    const cam = new CameraController(host({ contentBounds: () => null }), 0.05, 6);
    await cam.fit();
    expect(cam.get()).toEqual({ x: 0, y: 0, k: 1 });
    const cam2 = new CameraController(host(), 0.05, 6);
    await cam2.fit(undefined, { animate: false });
    expect(cam2.x).toBeCloseTo(50, 9);
  });

  it('pans in screen pixels', () => {
    const cam = new CameraController(host(), 0.05, 6);
    cam.set({ x: 0, y: 0, k: 2 });
    cam.panBy(100, -50);
    expect(cam.get()).toEqual({ x: -50, y: 25, k: 2 });
  });

  it('animates zoomBy toward a compounded target anchored at the point', () => {
    const cam = new CameraController(host(), 0.05, 6);
    const anchor = { x: 100, y: 100 };
    const world = cam.screenToWorld(anchor);
    cam.zoomBy(2, anchor);
    cam.zoomBy(2, anchor);
    run(cam, 0, 3000);
    expect(cam.k).toBeCloseTo(4, 6);
    const after = cam.screenToWorld(anchor);
    expect(after.x).toBeCloseTo(world.x, 6);
    expect(after.y).toBeCloseTo(world.y, 6);
  });

  it('glides with exponentially decaying velocity and stops', () => {
    const cam = new CameraController(host(), 0.05, 6);
    cam.glide(2, 0); // px/ms
    const x0 = cam.x;
    let t = 0;
    while (cam.tick(t)) t += 16;
    const travelled = (x0 - cam.x) * cam.k;
    // Continuous limit: v0 · τ; the discrete sum is within a few percent.
    expect(travelled).toBeGreaterThan(2 * GLIDE_TAU * 0.9);
    expect(travelled).toBeLessThan(2 * GLIDE_TAU * 1.1);
    expect(t).toBeLessThan(3000);
  });

  it('does not glide below the minimum speed', () => {
    const cam = new CameraController(host(), 0.05, 6);
    cam.glide(0.001, 0);
    expect(cam.animating).toBe(false);
  });

  it('decays velocity exponentially', () => {
    expect(decay(1, GLIDE_TAU)).toBeCloseTo(Math.exp(-1), 12);
    expect(decay(1, 0)).toBe(1);
  });

  it('ignores non-finite input and reports changes through invalidate', () => {
    const h = host();
    const cam = new CameraController(h, 0.05, 6);
    cam.set({ x: Number.NaN, y: 0, k: 1 });
    expect(cam.get()).toEqual({ x: 0, y: 0, k: 1 });
    expect(h.invalidations).toBe(0);
    cam.panBy(1, 0);
    expect(h.invalidations).toBe(1);
  });

  it('exposes the viewport and transforms through the Camera interface', () => {
    const cam = new CameraController(host(), 0.05, 6);
    cam.set({ x: 100, y: 50, k: 0.5 });
    expect(cam.viewport()).toEqual({ x: -700, y: -550, width: 1600, height: 1200 });
    expect(cam.worldToScreen({ x: 100, y: 50 })).toEqual({ x: 400, y: 300 });
    expect(cam.screenToWorld({ x: 400, y: 300 })).toEqual({ x: 100, y: 50 });
  });
});
