import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CollisionGrid,
  createRequest,
  type LabelClip,
  type LabelRequest,
  MODE_NODE,
  MODE_POINT,
  placeLabels,
  SIDE_ABOVE,
  SIDE_BELOW,
  SIDE_CENTER,
  SIDE_LEFT,
  SIDE_RIGHT,
} from '../src/labels.js';
import { rectsOverlap } from '../src/math.js';

const clip: LabelClip = { x0: 0, y0: 0, x1: 1000, y1: 800, strictX: false };

function req(x: number, y: number, o: Partial<LabelRequest> = {}): LabelRequest {
  return Object.assign(
    createRequest(),
    { x, y, r: 6, w: 60, h: 16, offset: 5, priority: 0.5, mode: MODE_NODE },
    o,
  );
}

function grid(): CollisionGrid {
  const g = new CollisionGrid();
  g.reset(-200, -200, 1400, 1200);
  return g;
}

describe('label placement', () => {
  it('places an unobstructed node label centred below the node', () => {
    const r = req(100, 100);
    expect(placeLabels([r], grid(), clip)).toBe(1);
    expect(r.side).toBe(SIDE_BELOW);
    expect(r.bx).toBe(70);
    expect(r.by).toBe(111); // 100 + r 6 + offset 5
  });

  it('falls back to right, above, then left', () => {
    const g = grid();
    const a = req(100, 100, { priority: 1, order: 0 });
    const b = req(100, 100, { priority: 0.9, order: 1 });
    const c = req(100, 100, { priority: 0.8, order: 2 });
    const d = req(100, 100, { priority: 0.7, order: 3 });
    const e = req(100, 100, { priority: 0.6, order: 4 });
    placeLabels([e, d, c, b, a], g, clip);
    expect([a.side, b.side, c.side, d.side]).toEqual([
      SIDE_BELOW,
      SIDE_RIGHT,
      SIDE_ABOVE,
      SIDE_LEFT,
    ]);
    expect(e.placed).toBe(false);
  });

  it('lets the higher priority label win a contested spot', () => {
    const low = req(100, 100, { priority: 0.2, order: 0 });
    const high = req(104, 100, { priority: 0.9, order: 1 });
    placeLabels([low, high], grid(), clip);
    expect(high.side).toBe(SIDE_BELOW);
    expect(low.side).not.toBe(SIDE_BELOW);
  });

  it('respects obstacles already in the grid', () => {
    const g = grid();
    g.insert(60, 109, 80, 30); // a badge right under the node
    const r = req(100, 100);
    placeLabels([r], g, clip);
    expect(r.side).toBe(SIDE_RIGHT);
  });

  it('skips labels entirely outside the clip region', () => {
    const r = req(-500, -500);
    expect(placeLabels([r], grid(), clip)).toBe(0);
    expect(r.placed).toBe(false);
  });

  it('keeps labels from crossing a swipe divider when strictX', () => {
    const r = req(495, 100, { w: 80 });
    placeLabels([r], grid(), { x0: 0, y0: 0, x1: 500, y1: 800, strictX: true });
    expect(r.placed).toBe(true);
    expect(r.side).toBe(SIDE_LEFT);
    expect(r.bx + r.w).toBeLessThanOrEqual(500);
  });

  it('centres point labels (edges) on their anchor', () => {
    const a = req(300, 300, { mode: MODE_POINT, r: 0 });
    placeLabels([a], grid(), clip);
    expect(a.side).toBe(SIDE_CENTER);
    expect(a.bx).toBe(270);
    expect(a.by).toBe(292);
  });

  it('moves point labels above, then below the line when the centre is taken', () => {
    const g = grid();
    g.insert(250, 297, 100, 6); // something on the line itself
    const a = req(300, 300, { mode: MODE_POINT, r: 0, priority: 1, order: 0 });
    const b = req(300, 300, { mode: MODE_POINT, r: 0, priority: 0.5, order: 1 });
    const c = req(300, 300, { mode: MODE_POINT, r: 0, priority: 0.4, order: 2 });
    placeLabels([a, b, c], g, clip);
    expect(a.side).toBe(SIDE_ABOVE);
    expect(a.by + a.h).toBeLessThanOrEqual(297);
    expect(b.side).toBe(SIDE_BELOW);
    expect(b.by).toBeGreaterThanOrEqual(303);
    expect(c.placed).toBe(false);
  });

  it('never produces overlapping labels and is deterministic', () => {
    const arb = fc.array(
      fc.record({
        x: fc.integer({ min: 0, max: 1000 }),
        y: fc.integer({ min: 0, max: 800 }),
        w: fc.integer({ min: 10, max: 200 }),
        p: fc.double({ min: 0, max: 1, noNaN: true }),
      }),
      { maxLength: 150 },
    );
    fc.assert(
      fc.property(arb, (items) => {
        const make = () =>
          items.map((it, i) => req(it.x, it.y, { w: it.w, priority: it.p, order: i }));
        const a = make();
        placeLabels(a, grid(), clip);
        const placed = a.filter((r) => r.placed);
        for (let i = 0; i < placed.length; i++) {
          for (let j = i + 1; j < placed.length; j++) {
            const p = placed[i]!;
            const q = placed[j]!;
            if (rectsOverlap(p.bx, p.by, p.w, p.h, q.bx, q.by, q.w, q.h)) return false;
          }
        }
        // Same input in another order → same placement.
        const b = make().reverse();
        placeLabels(b, grid(), clip);
        const key = (rs: LabelRequest[]) =>
          rs
            .map((r) => `${r.order}:${r.placed}:${r.side}:${r.bx}:${r.by}`)
            .sort()
            .join('|');
        return key(a) === key(b);
      }),
    );
  });

  it('a higher-priority label is never displaced by a lower one', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: 20 }), (dx, dy) => {
        const hi = req(400, 400, { priority: 0.9, order: 5 });
        const lo = req(400 + dx, 400 + dy, { priority: 0.1, order: 0 });
        placeLabels([lo, hi], grid(), clip);
        return hi.placed && hi.side === SIDE_BELOW;
      }),
    );
  });

  it('scales linearly: 5,000 labels place in well under a frame budget', () => {
    const items: LabelRequest[] = [];
    for (let i = 0; i < 5000; i++)
      items.push(req((i * 37) % 1000, (i * 53) % 800, { order: i, priority: (i % 7) / 7 }));
    const t0 = performance.now();
    placeLabels(items, grid(), clip);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(60);
  });
});

describe('CollisionGrid', () => {
  it('finds overlaps across cells and forgets them on reset', () => {
    const g = new CollisionGrid();
    g.reset(0, 0, 500, 500, 32);
    g.insert(10, 10, 200, 20);
    expect(g.overlaps(150, 15, 10, 10)).toBe(true);
    expect(g.overlaps(150, 40, 10, 10)).toBe(false);
    g.reset(0, 0, 500, 500, 32);
    expect(g.overlaps(150, 15, 10, 10)).toBe(false);
    expect(g.count).toBe(0);
  });

  it('handles rectangles outside the covered area', () => {
    const g = new CollisionGrid();
    g.reset(0, 0, 100, 100);
    g.insert(-500, -500, 20, 20);
    expect(g.overlaps(-495, -495, 2, 2)).toBe(true);
    expect(g.overlaps(50, 50, 2, 2)).toBe(false);
  });
});
