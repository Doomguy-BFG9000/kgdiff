import type { FrameVisuals } from '@kgdiff/scene';
import { describe, expect, it } from 'vitest';
import { darkTheme } from '../dev/theme.js';
import { FrameCache, Interner } from '../src/frame-cache.js';
import { pickAt } from '../src/pick.js';
import { Fonts, TextMeasurer } from '../src/text.js';
import { edge, frameOf, group, node, RecordingContext } from './helpers/recording-ctx.js';

const fonts = new Fonts(darkTheme);
const measurer = new TextMeasurer(new RecordingContext());

/** Pick with the camera at world origin, zoom k, on an 800 × 600 viewport. */
function pick(frame: FrameVisuals, sx: number, sy: number, k = 1) {
  const cache = new FrameCache();
  cache.sync(frame, 1, new Interner());
  return pickAt(frame, cache, { k, ox: 400, oy: 300, dpr: 1 }, sx, sy, fonts, measurer);
}

describe('picking', () => {
  it('picks a node under the pointer and nothing on empty canvas', () => {
    const f = frameOf([node(0, 0), node(100, 0)]);
    expect(pick(f, 402, 301)).toEqual({ type: 'node', index: 0 });
    expect(pick(f, 500, 300)).toEqual({ type: 'node', index: 1 });
    expect(pick(f, 450, 380)).toBeNull();
  });

  it('prefers the topmost (higher z) of overlapping nodes', () => {
    const f = frameOf([node(0, 0, { z: 2 }), node(3, 0, { z: 0 })]);
    expect(pick(f, 402, 300)).toEqual({ type: 'node', index: 0 });
    const g = frameOf([node(0, 0, { z: 0 }), node(3, 0, { z: 2 })]);
    expect(pick(g, 402, 300)).toEqual({ type: 'node', index: 1 });
  });

  it('prefers a node containing the point over a near miss', () => {
    const f = frameOf([node(0, 0, { r: 6, z: 5 }), node(14, 0, { r: 6 })]);
    // x = 409: 9 px from node 0 (outside, within tolerance), 5 px from node 1 (inside).
    expect(pick(f, 409, 300)).toEqual({ type: 'node', index: 1 });
  });

  it('keeps tiny nodes pickable at far zoom', () => {
    const f = frameOf([node(0, 0, { r: 4 })]);
    // At k = 0.05 the node is 0.2 px; the minimum radius and tolerance still catch it.
    expect(pick(f, 403, 300, 0.05)).toEqual({ type: 'node', index: 0 });
  });

  it('skips invisible and transparent nodes', () => {
    const f = frameOf([node(0, 0, { visible: false }), node(0, 0, { alpha: 0 })]);
    expect(pick(f, 400, 300)).toBeNull();
  });

  it('picks straight edges within tolerance, nodes first', () => {
    const a = node(0, 0);
    const b = node(200, 0);
    const f = frameOf([a, b], [edge(a, b)]);
    expect(pick(f, 500, 303)).toEqual({ type: 'edge', index: 0 });
    expect(pick(f, 500, 310)).toBeNull();
    expect(pick(f, 400, 300)).toEqual({ type: 'node', index: 0 });
  });

  it('picks curved edges along the curve, not the chord', () => {
    const a = node(0, 0);
    const b = node(200, 0);
    // Control point 0.2 · 200 = 40 below the chord midpoint: the apex is at y = 20.
    const f = frameOf([a, b], [edge(a, b, { curvature: 0.2 })]);
    expect(pick(f, 500, 320)).toEqual({ type: 'edge', index: 0 });
    expect(pick(f, 500, 300)).toBeNull();
  });

  it('picks the topmost of overlapping edges', () => {
    const a = node(0, 0);
    const b = node(200, 0);
    const f = frameOf([a, b], [edge(a, b, { z: 3, color: '#f00' }), edge(a, b, { z: 1 })]);
    expect(pick(f, 500, 300)).toEqual({ type: 'edge', index: 0 });
  });

  it('picks self-loops on their circle', () => {
    const a = node(0, 0, { r: 10 });
    const f = frameOf([a], [edge(a, a)]);
    // r = 10 px → loop radius 8, centre 14 px above the node centre: top of the loop at y = −22.
    expect(pick(f, 400, 278)).toEqual({ type: 'edge', index: 0 });
  });

  it('picks collapsed pills by their rectangle', () => {
    const f = frameOf([], [], { collapsed: [group(100, 100, 38)] });
    expect(pick(f, 500, 400)).toEqual({ type: 'collapsed', index: 0 });
    expect(pick(f, 500, 420)).toBeNull();
  });
});
