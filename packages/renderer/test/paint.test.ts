import type { FrameVisuals, GlyphKind, Theme } from '@kgdiff/scene';
import { describe, expect, it } from 'vitest';
import { createSynthetic } from '../dev/synthetic.js';
import { darkTheme, lightTheme } from '../dev/theme.js';
import type { SurfaceFactory } from '../src/ctx.js';
import { gridLevels } from '../src/draw/background.js';
import { lodAlpha } from '../src/draw/labels.js';
import { evenCircleDash } from '../src/draw/nodes.js';
import { FrameCache } from '../src/frame-cache.js';
import type { CameraState, SplitFrame } from '../src/index.js';
import { Painter, Resources } from '../src/paint.js';
import {
  edge,
  frameOf,
  glyph,
  group,
  lbl,
  node,
  noSurfaces,
  RecordingContext,
  recordingFactory,
} from './helpers/recording-ctx.js';

interface Setup {
  ctx: RecordingContext;
  paint: (
    frame: FrameVisuals | SplitFrame | null,
    cam?: CameraState,
    version?: number,
  ) => ReturnType<Painter['paint']>;
  res: Resources;
}

function setup(
  o: {
    theme?: Theme;
    factory?: SurfaceFactory;
    grid?: boolean;
    width?: number;
    height?: number;
    dpr?: number;
  } = {},
): Setup {
  const ctx = new RecordingContext();
  const theme = o.theme ?? darkTheme;
  const res = new Resources(o.factory ?? noSurfaces, theme, ctx);
  const painter = new Painter(res);
  const caches = { main: new FrameCache(), before: new FrameCache(), after: new FrameCache() };
  let v = 0;
  return {
    ctx,
    res,
    paint: (frame, cam = { x: 0, y: 0, k: 1 }, version) => {
      ctx.clear();
      return painter.paint(
        { ctx, width: o.width ?? 800, height: o.height ?? 600, dpr: o.dpr ?? 1 },
        cam,
        frame,
        caches,
        version ?? ++v,
        theme,
        o.grid ?? false,
      );
    },
  };
}

const strokesWith = (ctx: RecordingContext, color: string) =>
  ctx.calls('stroke').filter((op) => op.style.strokeStyle === color);

describe('paint: order and batching', () => {
  it('draws passes in the documented order', () => {
    const { paint } = setup();
    const stats = paint(frameOf([node(0, 0)]));
    expect(stats.phases).toEqual([
      'background',
      'collapsed',
      'edges',
      'glyphs',
      'halos',
      'nodes',
      'pivots',
      'badges',
      'labels',
    ]);
  });

  it('fills the background first, even for an empty renderer', () => {
    const { ctx, paint } = setup();
    paint(null);
    const first = ctx.calls('fillRect')[0]!;
    expect(first.style.fillStyle).toBe(darkTheme.canvas.background);
    expect(first.args).toEqual([0, 0, 800, 600]);
  });

  it('issues exactly one stroke per edge style bucket', () => {
    const { ctx, paint } = setup();
    const nodes = Array.from({ length: 50 }, (_, i) =>
      node((i % 10) * 40 - 200, Math.floor(i / 10) * 40 - 100),
    );
    const edges = [];
    for (let i = 1; i < nodes.length; i++) {
      edges.push(
        edge(nodes[i - 1]!, nodes[i]!, i % 3 === 0 ? { color: '#34D399', width: 1.75, z: 1 } : {}),
      );
    }
    const stats = paint(frameOf(nodes, edges));
    expect(stats.edgeStrokes).toBe(2);
    expect(strokesWith(ctx, '#323A4A')).toHaveLength(1);
    expect(strokesWith(ctx, '#34D399')).toHaveLength(1);
    // The changed bucket (z = 1) is stroked after the neutral one (z = 0).
    const order = ctx.calls('stroke').map((op) => op.style.strokeStyle);
    expect(order.indexOf('#34D399')).toBeGreaterThan(order.indexOf('#323A4A'));
  });

  it('batches all same-style nodes into one fill', () => {
    const { ctx, paint } = setup();
    const nodes = Array.from({ length: 200 }, (_, i) =>
      node((i % 20) * 20 - 200, Math.floor(i / 20) * 20 - 100),
    );
    paint(frameOf(nodes));
    const fills = ctx.calls('fill').filter((op) => op.style.fillStyle === '#4B5568');
    expect(fills).toHaveLength(1);
    expect(ctx.count('arc')).toBe(200);
  });

  it('applies bucket dash, dash offset, width, cap and alpha to the stroke', () => {
    const { ctx, paint } = setup();
    const a = node(-100, 0);
    const b = node(100, 0);
    paint(
      frameOf(
        [a, b],
        [edge(a, b, { dash: [4, 3], dashOffset: 2, width: 1.75, alpha: 0.45, color: '#F87171' })],
      ),
    );
    const s = strokesWith(ctx, '#F87171')[0]!;
    expect(s.style.dash).toEqual([4, 3]);
    expect(s.style.lineDashOffset).toBe(2);
    expect(s.style.lineWidth).toBe(1.75);
    expect(s.style.globalAlpha).toBeCloseTo(0.45, 1);
    expect(s.style.lineCap).toBe('butt');
  });

  it('draws z levels of nodes in order, with rings right above their level', () => {
    const { ctx, paint } = setup();
    const ring = { color: '#FBBF24', width: 1.5, gap: 3.5, alpha: 1 };
    paint(
      frameOf([
        node(0, 0, { z: 1, fill: '#FBBF24', ring }),
        node(50, 0, { z: 0 }),
        node(100, 0, { z: 2, fill: '#A78BFA' }),
      ]),
    );
    const seq = ctx.ops
      .filter((op) => op.name === 'fill' || op.name === 'stroke')
      .map((op) =>
        op.name === 'fill' ? `fill:${op.style.fillStyle}` : `stroke:${op.style.strokeStyle}`,
      );
    const i0 = seq.indexOf('fill:#4B5568');
    const i1 = seq.indexOf('fill:#FBBF24');
    const iRing = seq.indexOf('stroke:#FBBF24');
    const i2 = seq.indexOf('fill:#A78BFA');
    expect(i0).toBeLessThan(i1);
    expect(i1).toBeLessThan(iRing);
    expect(iRing).toBeLessThan(i2);
  });
});

describe('paint: edges geometry', () => {
  it('trims straight edges at the node radii', () => {
    const { ctx, paint } = setup();
    const a = node(-100, 0, { r: 10 });
    const b = node(100, 0, { r: 20 });
    paint(frameOf([a, b], [edge(a, b)]));
    const strokeAt = ctx.ops.findIndex((op) => op.name === 'stroke');
    const moves = ctx.ops
      .slice(0, strokeAt)
      .filter((op) => op.name === 'moveTo' || op.name === 'lineTo');
    expect(moves.at(-2)!.args).toEqual([310, 300]);
    expect(moves.at(-1)!.args).toEqual([480, 300]);
  });

  it('draws partial edges from the source, or from the target', () => {
    const { ctx, paint } = setup();
    const a = node(-100, 0, { r: 0 });
    const b = node(100, 0, { r: 0 });
    paint(frameOf([a, b], [edge(a, b, { progress: 0.25 })]));
    const line = () => {
      const i = ctx.ops.findIndex((op) => op.name === 'stroke');
      return ctx.ops
        .slice(0, i)
        .filter((op) => op.name === 'moveTo' || op.name === 'lineTo')
        .slice(-2)
        .map((op) => op.args[0]);
    };
    // Radii below 1 px are drawn (and trimmed) at the 1 px minimum.
    expect(line()).toEqual([301, 350.5]);
    paint(frameOf([a, b], [edge(a, b, { progress: 0.25, fromTarget: true })]));
    expect(line()).toEqual([449.5, 499]);
  });

  it('draws curved edges as quadratics and arrowheads as one fill per bucket', () => {
    const { ctx, paint } = setup();
    const a = node(-100, 0);
    const b = node(100, 0);
    const c = node(0, 100);
    paint(
      frameOf(
        [a, b, c],
        [
          edge(a, b, { curvature: 0.18, arrow: true, width: 1.75 }),
          edge(a, c, { arrow: true, width: 1.75 }),
        ],
      ),
    );
    expect(ctx.count('quadraticCurveTo')).toBe(1);
    const arrowFills = ctx.calls('fill').filter((op) => op.style.fillStyle === '#323A4A');
    expect(arrowFills).toHaveLength(1);
    expect(ctx.count('closePath')).toBeGreaterThanOrEqual(2);
  });

  it('shows arrowheads from the edge arrowMinZoom on', () => {
    const a = node(-100, 0);
    const b = node(100, 0);
    const f = frameOf([a, b], [edge(a, b, { arrow: true, arrowMinZoom: 1.2 })]);
    const { ctx, paint } = setup();
    paint(f, { x: 0, y: 0, k: 1 });
    expect(ctx.calls('fill').filter((op) => op.style.fillStyle === '#323A4A')).toHaveLength(0);
    paint(f, { x: 0, y: 0, k: 1.2 });
    expect(ctx.calls('fill').filter((op) => op.style.fillStyle === '#323A4A')).toHaveLength(1);
  });

  it('culls edges and nodes outside the viewport', () => {
    const { paint } = setup();
    const near = node(0, 0);
    const far1 = node(5000, 5000);
    const far2 = node(6000, 5000);
    const crossing1 = node(-3000, 0);
    const crossing2 = node(3000, 0);
    const stats = paint(
      frameOf(
        [near, far1, far2, crossing1, crossing2],
        [edge(far1, far2), edge(crossing1, crossing2), edge(near, far1)],
      ),
    );
    expect(stats.culledEdges).toBe(1);
    expect(stats.edges).toBe(2);
    expect(stats.nodes).toBe(1);
    expect(stats.culledNodes).toBe(4);
  });
});

describe('paint: nodes, halos, badges, labels', () => {
  it('fills hollow ghosts with the background and dashes them evenly', () => {
    const { ctx, paint } = setup();
    paint(frameOf([node(0, 0, { fill: null, stroke: '#F87171', dash: [3, 2.5], r: 10 })]));
    // fillRect paints the canvas background; the ghost body is a background-colored fill().
    expect(ctx.calls('fill').some((op) => op.style.fillStyle === darkTheme.canvas.background)).toBe(
      true,
    );
    const stroke = strokesWith(ctx, '#F87171')[0]!;
    const period = stroke.style.dash[0]! + stroke.style.dash[1]!;
    const circumference = 2 * Math.PI * 10;
    expect(circumference / period).toBeCloseTo(Math.round(circumference / period), 9);
  });

  it('stretches circle dashes to a whole number of periods', () => {
    const out: number[] = [];
    evenCircleDash([3, 2.5], 7, out);
    const n = (2 * Math.PI * 7) / (out[0]! + out[1]!);
    expect(n).toBeCloseTo(Math.round(n), 9);
    expect(out[0]! / out[1]!).toBeCloseTo(3 / 2.5, 9);
  });

  it('draws dark halos from one cached sprite per color', () => {
    const { factory, surfaces } = recordingFactory();
    const { ctx, paint } = setup({ factory });
    const halo = { color: '#34D399', radius: 20, alpha: 0.32 };
    paint(
      frameOf([
        node(0, 0, { halo }),
        node(60, 0, { halo }),
        node(120, 0, { halo: { ...halo, color: '#A78BFA' } }),
      ]),
    );
    const sprites = ctx.calls('drawImage').filter((op) => op.args.length === 5);
    expect(sprites).toHaveLength(3);
    expect(sprites[0]!.style.globalAlpha).toBeCloseTo(0.32, 9);
    expect(sprites[0]!.args.slice(1)).toEqual([380, 280, 40, 40]);
    expect(sprites[0]!.args[0]).toBe(sprites[1]!.args[0]);
    expect(sprites[2]!.args[0]).not.toBe(sprites[0]!.args[0]);
    paint(frameOf([node(0, 0, { halo })]));
    const gradients = surfaces.filter(
      (s) => s.count('fillRect') > 0 && s.calls('fillRect')[0]!.style.fillStyle !== '#000',
    );
    expect(gradients.length).toBe(2); // still two sprites: cached across frames
  });

  it('draws light halos as offset rings', () => {
    const { ctx, paint } = setup({ theme: lightTheme });
    paint(frameOf([node(0, 0, { r: 6, halo: { color: '#16A34A', radius: 6, alpha: 0.35 } })]));
    const ring = strokesWith(ctx, '#16A34A')[0]!;
    expect(ring.style.lineWidth).toBe(2);
    const arc = ctx.calls('arc').find((op) => op.args[2] === 11);
    expect(arc).toBeDefined();
  });

  it('draws pulses as a fading expanding ring', () => {
    const { ctx, paint } = setup();
    paint(frameOf([node(0, 0, { pulse: 0.5, fill: '#38BDF8' })]));
    const pulse = strokesWith(ctx, '#38BDF8')[0]!;
    expect(pulse.style.globalAlpha).toBeCloseTo(0.25 * 0.85, 9);
    paint(frameOf([node(0, 0, { pulse: 0, fill: '#38BDF8' })]));
    expect(strokesWith(ctx, '#38BDF8')).toHaveLength(0);
  });

  it('shows badges only from their minimum zoom', () => {
    const badge = {
      text: '+2 −1 ~1',
      color: '#FCD34D',
      background: 'rgba(251,191,36,0.15)',
      minZoom: 1.2,
    };
    const f = frameOf([node(0, 0, { badge })]);
    const { ctx, paint } = setup();
    paint(f, { x: 0, y: 0, k: 1 });
    expect(ctx.calls('fillText').map((op) => op.args[0])).not.toContain('+2 −1 ~1');
    paint(f, { x: 0, y: 0, k: 1.5 });
    expect(ctx.calls('fillText').map((op) => op.args[0])).toContain('+2 −1 ~1');
  });

  it('respects label LOD, draws a background halo first, and strikes through', () => {
    const f = frameOf([node(0, 0, { label: lbl('renamed', { minZoom: 0.35, strike: true }) })]);
    const { ctx, paint } = setup();
    paint(f, { x: 0, y: 0, k: 0.3 });
    expect(ctx.count('fillText')).toBe(0);
    paint(f, { x: 0, y: 0, k: 0.5 });
    const halo = ctx.calls('strokeText')[0]!;
    const text = ctx.calls('fillText')[0]!;
    expect(halo.args[0]).toBe('renamed');
    expect(halo.style.strokeStyle).toBe(darkTheme.canvas.background);
    expect(halo.style.lineWidth).toBe(3);
    expect(halo.style.globalAlpha).toBeCloseTo(0.9, 9);
    expect(ctx.ops.indexOf(halo)).toBeLessThan(ctx.ops.indexOf(text));
    const strike = ctx.calls('fillRect').at(-1)!;
    expect(strike.style.fillStyle).toBe('#fff');
  });

  it('fades labels in just below their minimum zoom instead of popping', () => {
    expect(lodAlpha(0.35, 0.35)).toBe(1);
    expect(lodAlpha(0.35, 2)).toBe(1);
    expect(lodAlpha(0.35, 0.3)).toBe(0);
    expect(lodAlpha(0.35, 0.3325)).toBeCloseTo(0.5, 9);
    expect(lodAlpha(0, 0.01)).toBe(1);
  });

  it('pushes the light halo ring outside a concentric ring', () => {
    const { ctx, paint } = setup({ theme: lightTheme });
    const ring = { color: '#7C3AED', width: 1.5, gap: 3.5, alpha: 1 };
    paint(
      frameOf([node(0, 0, { r: 6, ring, halo: { color: '#7C3AED', radius: 6, alpha: 0.35 } })]),
    );
    const halo = ctx.calls('stroke').find((op) => op.style.lineWidth === 2)!;
    const idx = ctx.ops.indexOf(halo);
    const arc = ctx.ops
      .slice(0, idx)
      .filter((op) => op.name === 'arc')
      .at(-1)!;
    // ring outer edge at 6 + 3.5 + 0.75 = 10.25 px; halo centre 1.5 + 1 px further out.
    expect(arc.args[2]).toBeCloseTo(12.75, 9);
  });

  it('multiplies label alpha by the owner alpha', () => {
    const { ctx, paint } = setup();
    paint(frameOf([node(0, 0, { alpha: 0.5, label: lbl('x', { alpha: 0.5 }) })]));
    expect(ctx.calls('fillText')[0]!.style.globalAlpha).toBeCloseTo(0.25, 9);
  });

  it('puts the secondary (old) label under the primary', () => {
    const { ctx, paint } = setup();
    paint(
      frameOf([
        node(0, 0, {
          r: 6,
          label: lbl('new'),
          secondaryLabel: lbl('old', { size: 11, strike: true, offset: 19 }),
        }),
      ]),
    );
    const texts = ctx.calls('fillText');
    const newY = texts.find((op) => op.args[0] === 'new')!.args[2] as number;
    const oldY = texts.find((op) => op.args[0] === 'old')!.args[2] as number;
    expect(oldY - newY).toBeGreaterThanOrEqual(13);
  });

  it('blits labels from the atlas when offscreen surfaces exist', () => {
    const { factory } = recordingFactory();
    const { ctx, paint } = setup({ factory });
    paint(frameOf([node(0, 0, { label: lbl('cached') }), node(200, 0, { label: lbl('cached') })]));
    expect(ctx.count('fillText')).toBe(0);
    const blits = ctx.calls('drawImage').filter((op) => op.args.length === 9);
    expect(blits).toHaveLength(2);
    // Same text, font and color: the same atlas entry.
    expect(blits[0]!.args.slice(1, 5)).toEqual(blits[1]!.args.slice(1, 5));
  });

  it('spreads label rasterization over frames with a per-frame budget', () => {
    const { factory } = recordingFactory();
    const ctx = new RecordingContext();
    const res = new Resources(factory, darkTheme, ctx);
    const painter = new Painter(res);
    painter.rasterBudget = 2;
    const caches = { main: new FrameCache(), before: new FrameCache(), after: new FrameCache() };
    const f = frameOf(
      [0, 1, 2, 3, 4].map((i) => node(i * 120 - 240, 0, { label: lbl(`label ${i}`) })),
    );
    const paintOnce = () => {
      ctx.clear();
      const stats = painter.paint(
        { ctx, width: 800, height: 600, dpr: 1 },
        { x: 0, y: 0, k: 1 },
        f,
        caches,
        1,
        darkTheme,
        false,
      );
      return {
        blits: ctx.calls('drawImage').filter((op) => op.args.length === 9).length,
        deferred: stats.deferredLabels,
      };
    };
    expect(paintOnce()).toEqual({ blits: 2, deferred: 3 });
    expect(paintOnce()).toEqual({ blits: 4, deferred: 1 });
    expect(paintOnce()).toEqual({ blits: 5, deferred: 0 });
  });

  it('draws edge labels at the curve midpoint only from their minimum zoom', () => {
    const a = node(-100, 0);
    const b = node(100, 0);
    const f = frameOf(
      [a, b],
      [edge(a, b, { curvature: 0.2, label: lbl('part of', { minZoom: 1.1, size: 10.5 }) })],
    );
    const { ctx, paint } = setup();
    paint(f, { x: 0, y: 0, k: 0.95 });
    expect(ctx.count('fillText')).toBe(0);
    paint(f, { x: 0, y: 0, k: 1.1 });
    const t = ctx.calls('fillText')[0]!;
    // Curve apex: chord midpoint + curvature · length / 2 = 20 · 1.1 px below the chord.
    expect(t.args[2] as number).toBeCloseTo(300 + 22, 0);
  });
});

describe('paint: glyphs, pills, grid', () => {
  it('draws merge arcs trimmed at r2, with an arrowhead', () => {
    const { ctx, paint } = setup();
    const f = frameOf([node(-100, 0, { r: 8 }), node(100, 0, { r: 8 })], [], {
      glyphs: [glyph('merge-arrow', { x1: -100, x2: 100, r1: 10, r2: 10 })],
    });
    paint(f);
    const arrow = ctx.calls('fill').find((op) => op.style.fillStyle === '#A78BFA');
    expect(arrow).toBeDefined();
    const tip = ctx.ops[ctx.ops.indexOf(arrow!) - 4]!; // moveTo(tip) of the arrow path
    expect(tip.name).toBe('moveTo');
    expect(tip.args[0] as number).toBeCloseTo(500 - 10 - 1.5, 9);
    const start = ctx.calls('moveTo').find((op) => op.style.strokeStyle === '#A78BFA')!;
    expect(start.args[0] as number).toBeCloseTo(300 + 10, 9);
  });

  it('draws replacement arrows like merge arrows and edge ghosts like edges, with arrowheads', () => {
    const { ctx, paint } = setup();
    const f = frameOf([], [], {
      glyphs: [
        glyph('replacement-arrow' as GlyphKind, { x1: -200, x2: 0, color: '#FBBF24' }),
        glyph('edge-ghost' as GlyphKind, {
          x1: 0,
          y1: 50,
          x2: 200,
          y2: 50,
          color: '#F87171',
          width: 1.75,
          dash: [4, 3],
          r1: 6,
          r2: 6,
        }),
        // Crossfading in replay: the scene sends a solid ghost.
        glyph('edge-ghost' as GlyphKind, { x1: 0, y1: 120, x2: 200, y2: 120, color: '#7DD3FC' }),
      ],
    });
    paint(f);
    expect(ctx.calls('fill').some((op) => op.style.fillStyle === '#FBBF24')).toBe(true);
    const ghost = strokesWith(ctx, '#F87171')[0]!;
    expect(ghost.style.dash).toEqual([4, 3]);
    expect(ghost.style.lineCap).toBe('butt');
    // Edge-sized arrowhead: tip trimmed at r2 + the arrow gap, 7 px long.
    const arrow = ctx.calls('fill').find((op) => op.style.fillStyle === '#F87171')!;
    const at = ctx.ops.indexOf(arrow);
    const [tipOp, baseA] = ctx.ops.slice(at - 4, at - 2);
    expect(tipOp!.args[0] as number).toBeCloseTo(600 - 6 - 1.5, 9);
    expect(baseA!.args[0] as number).toBeCloseTo(600 - 6 - 1.5 - 7, 9);
    const solid = strokesWith(ctx, '#7DD3FC')[0]!;
    expect(solid.style.dash).toEqual([]);
    expect(ctx.calls('fill').some((op) => op.style.fillStyle === '#7DD3FC')).toBe(true);
  });

  it('honours an explicit arrow flag and degrades unknown glyph kinds to a plain line', () => {
    const { ctx, paint } = setup();
    const withoutArrow = {
      ...glyph('edge-ghost' as GlyphKind, { x1: 0, x2: 200, color: '#38BDF8' }),
      arrow: false,
    };
    paint(
      frameOf([], [], {
        glyphs: [
          withoutArrow,
          glyph('future-kind' as GlyphKind, {
            x1: -300,
            y1: 80,
            x2: 100,
            y2: 80,
            color: '#34D399',
          }),
        ],
      }),
    );
    expect(ctx.calls('fill').some((op) => op.style.fillStyle === '#38BDF8')).toBe(false);
    expect(strokesWith(ctx, '#38BDF8')).toHaveLength(1);
    const plain = strokesWith(ctx, '#34D399')[0]!;
    expect(plain.style.dash).toEqual([]);
    expect(ctx.calls('fill').some((op) => op.style.fillStyle === '#34D399')).toBe(false);
  });

  it('draws suggestions dotted with a ? mark, and pivots above nodes', () => {
    const { ctx, paint } = setup();
    const f = frameOf([node(-200, 0), node(200, 0)], [], {
      glyphs: [
        glyph('suggestion', { x1: -200, x2: 200, width: 1.75, r1: 6, r2: 6 }),
        glyph('pivot', { x1: -200, x2: -200, color: '#38BDF8', width: 6 }),
      ],
    });
    const stats = paint(f);
    const dotted = strokesWith(ctx, '#A78BFA')[0]!;
    expect(dotted.style.dash[0]).toBeLessThan(0.5);
    expect(dotted.style.lineCap).toBe('round');
    expect(ctx.calls('fillText').map((op) => op.args[0])).toContain('?');
    const pivot = ctx.calls('fill').find((op) => op.style.fillStyle === '#38BDF8')!;
    const nodeFill = ctx.calls('fill').find((op) => op.style.fillStyle === '#4B5568')!;
    expect(ctx.ops.indexOf(pivot)).toBeGreaterThan(ctx.ops.indexOf(nodeFill));
    // Diameter = width px.
    const dot = ctx.ops
      .slice(0, ctx.ops.indexOf(pivot))
      .filter((op) => op.name === 'arc')
      .at(-1)!;
    expect(dot.args[2]).toBe(3);
    expect(stats.phases.indexOf('pivots')).toBeGreaterThan(stats.phases.indexOf('nodes'));
  });

  it('draws collapsed pills with the localized label, falling back to +N', () => {
    const { ctx, paint } = setup();
    paint(frameOf([], [], { collapsed: [group(0, 0, 38, '+38 个未变节点'), group(0, 100, 1234)] }));
    const texts = ctx.calls('fillText').map((op) => op.args[0]);
    expect(texts).toContain('+38 个未变节点');
    expect(texts).toContain('+1,234');
  });

  it('hides a collapsed pill that overlaps another pill, and shows both once zoomed apart', () => {
    const { ctx, paint } = setup();
    // “+38” pills are 36 px wide: 20 world units apart they overlap at zoom 1.
    const f = frameOf([], [], { collapsed: [group(0, 0, 38), group(20, 0, 38, '+38 b')] });
    paint(f, { x: 0, y: 0, k: 1 });
    const pills = () => ctx.calls('fillText').map((op) => op.args[0]);
    expect(pills()).toEqual(['+38']); // equal priority: the first group keeps its spot
    paint(f, { x: 0, y: 0, k: 4 });
    expect(pills()).toEqual(['+38', '+38 b']);
  });

  it('ranks pills below changed-node labels and above neutral ones', () => {
    const { ctx, paint } = setup();
    // A label centred under the node at (0, 0) and a pill right where that label wants to go.
    const pill = group(0, 20, 38);
    const changed = node(0, 0, { label: lbl('changed label', { priority: 1.6 }) });
    paint(frameOf([changed], [], { collapsed: [pill] }));
    let texts = ctx.calls('fillText').map((op) => op.args[0]);
    expect(texts).toContain('changed label');
    expect(texts).not.toContain('+38');
    const neutralNode = node(0, 0, { label: lbl('neutral label', { priority: 0.5 }) });
    paint(frameOf([neutralNode], [], { collapsed: [pill] }));
    texts = ctx.calls('fillText').map((op) => op.args[0]);
    expect(texts).toContain('+38');
    // The neutral label moved out of the pill's way instead of disappearing.
    const label = ctx.calls('fillText').find((op) => op.args[0] === 'neutral label')!;
    // Not in its preferred spot below the node (centre ≈ 318 px), which the pill holds.
    expect(label.args[2] as number).toBeLessThan(310);
  });

  it('draws the dot grid as one pattern fill per level', () => {
    const { factory } = recordingFactory();
    const { ctx, paint } = setup({ factory, grid: true });
    paint(frameOf([]), { x: 0, y: 0, k: 1 });
    expect(ctx.count('createPattern')).toBe(1);
    expect(
      ctx.calls('fillRect').filter((op) => typeof op.style.fillStyle === 'object'),
    ).toHaveLength(1);
    paint(frameOf([]), { x: 0, y: 0, k: 1 });
    expect(ctx.count('createPattern')).toBe(0); // tile reused while the spacing is unchanged
    paint(frameOf([]), { x: 0, y: 0, k: 0.5 });
    expect(
      ctx.calls('fillRect').filter((op) => typeof op.style.fillStyle === 'object'),
    ).toHaveLength(2);
  });

  it('switches grid levels so dots never get denser than 9.6 px', () => {
    for (const k of [0.05, 0.1, 0.2, 0.39, 0.4, 0.5, 0.6, 1, 6]) {
      for (const level of gridLevels(k))
        expect(level.spacing * k).toBeGreaterThanOrEqual(9.6 - 1e-9);
    }
    expect(gridLevels(1)).toEqual([{ spacing: 24, alpha: 1, nested: false }]);
    const crossfade = gridLevels(0.5);
    expect(crossfade[0]).toEqual({ spacing: 96, alpha: 1, nested: false });
    expect(crossfade[1]!.spacing).toBe(24);
    expect(crossfade[1]!.alpha).toBeGreaterThan(0);
    expect(crossfade[1]!.alpha).toBeLessThan(1);
    expect(gridLevels(0.39)).toEqual([{ spacing: 96, alpha: 1, nested: false }]);
  });
});

describe('paint: swipe', () => {
  it('clips before to the left and after to the right of the divider, with labels per side', () => {
    const { ctx, paint } = setup();
    const before = frameOf([
      node(-300, 0, { fill: '#F87171', label: lbl('left') }),
      node(-220, 0, { fill: '#F87171', label: lbl('crossing') }),
    ]);
    const after = frameOf([node(100, 0, { fill: '#34D399', label: lbl('right') })]);
    const stats = paint({ split: 0.25, before, after });
    const rects = ctx.calls('rect').filter((op) => op.args[3] === 600);
    expect(rects.map((op) => op.args)).toEqual([
      [0, 0, 200, 600],
      [200, 0, 600, 600],
    ]);
    expect(ctx.count('clip')).toBe(2);
    expect(stats.phases.filter((p) => p === 'labels')).toHaveLength(2);
    const texts = ctx.calls('fillText');
    expect(texts.map((op) => op.args[0]).sort()).toEqual(['crossing', 'left', 'right']);
    // “crossing” sits 20 px left of the divider: centred below it would cross, so it moves left.
    const crossing = texts.find((op) => op.args[0] === 'crossing')!;
    expect((crossing.args[1] as number) + 'crossing'.length * 7.2).toBeLessThanOrEqual(200);
    expect(ctx.calls('fill').some((op) => op.style.fillStyle === '#F87171')).toBe(true);
    // The after-side node is drawn inside the right clip only.
    expect(ctx.calls('fill').some((op) => op.style.fillStyle === '#34D399')).toBe(true);
    // The divider line is drawn last.
    const divider = ctx.calls('fillRect').at(-1)!;
    expect(divider.style.fillStyle).toBe(darkTheme.surface.borderStrong);
  });
});

describe('paint: the synthetic 2k frame', () => {
  it('exercises every pass with few strokes', () => {
    const { factory } = recordingFactory();
    const { paint } = setup({ factory, grid: true });
    const syn = createSynthetic(darkTheme, 2000);
    const stats = paint(syn.frame, { x: 0, y: 0, k: 0.12 }, 1);
    expect(stats.nodes + stats.culledNodes).toBeGreaterThan(1900);
    expect(stats.edgeStrokes).toBeLessThan(40);
    const close = paint(syn.frame, { x: 0, y: 0, k: 1.5 }, 1);
    expect(close.labels).toBeGreaterThan(0);
    expect(close.culledNodes).toBeGreaterThan(1500);
  });
});
