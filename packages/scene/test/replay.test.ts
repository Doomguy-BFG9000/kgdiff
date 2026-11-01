import { describe, expect, it, vi } from 'vitest';
import {
  buildScene,
  createViewState,
  createVisualResolver,
  type EdgeVisual,
  type FrameVisuals,
  type GlyphVisual,
  getTheme,
  type LabelVisual,
  type NodeVisual,
  type Scene,
  type ViewState,
  type VisualResolver,
} from '../src/index.js';
import { IDS, kitchenSink, makeLayout, POSITIONS } from './fixtures.js';

vi.mock('@kgdiff/core', async (orig) => ({
  ...(await orig<object>()),
  formatHunk: (await import('./mock-core.js')).fakeFormatHunk,
}));

const F = getTheme('dark').family;
const diff = kitchenSink();
const scene = buildScene(diff, makeLayout(diff, POSITIONS));
const resolver = createVisualResolver(scene);

const ni = (id: string): number => scene.nodeIndex.get(id) ?? -1;
const ei = (id: string): number => scene.edgeIndex.get(id) ?? -1;
const node = (id: string) => scene.nodes[ni(id)] as Scene['nodes'][number];
const nv = (f: FrameVisuals, id: string): NodeVisual => f.nodes[ni(id)] as NodeVisual;
const ev = (f: FrameVisuals, id: string): EdgeVisual => f.edges[ei(id)] as EdgeVisual;
const glyphs = (f: FrameVisuals, kind: GlyphVisual['kind']) =>
  f.glyphs.filter((g) => g.kind === kind);

/** Time at window fraction `p` of a hunk. */
function at(hunkId: string, p: number, s: Scene = scene): number {
  const h = s.hunkIndex.get(hunkId);
  const w = s.timeline.windows.find((x) => x.hunk === h);
  if (w === undefined) throw new Error(hunkId);
  return w.start + p * (w.end - w.start);
}
/** Time at transform-phase fraction `u` (18–82% of the window). */
const atU = (hunkId: string, u: number, s: Scene = scene): number => at(hunkId, 0.18 + 0.64 * u, s);

const replay = (
  t: number,
  extra: Partial<ViewState> = {},
  r: VisualResolver = resolver,
): FrameVisuals => r.resolve(createViewState({ layer: 'replay', t, ...extra }));
const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

describe('replay endpoints', () => {
  it('shows exactly the before layer before any window', () => {
    expect(replay(-1)).toEqual(resolver.resolve(createViewState({ layer: 'before' })));
  });

  it('shows exactly the after layer once every window has played', () => {
    const end = scene.timeline.duration;
    expect(replay(end)).toEqual(resolver.resolve(createViewState({ layer: 'after' })));
    expect(replay(end + 10_000)).toEqual(replay(end));
  });

  it('treats a non-finite t as 0', () => {
    expect(replay(Number.NaN)).toEqual(replay(0));
  });

  it('plays hunks in order: earlier ones show after, later ones before', () => {
    const f = replay(atU('merge:T', 0.5));
    // remove:R1 already played, add:N1 not yet.
    expect(nv(f, 'R1').visible).toBe(false);
    expect(nv(f, 'N1').visible).toBe(false);
    expect(nv(f, 'M1').label?.text).toBe('Mu old');
  });

  it('holds the before state through the spotlight phase and the after state through settle', () => {
    const spot = replay(at('remove:R1', 0.1));
    expect(nv(spot, 'R1')).toMatchObject({ visible: true, fill: F.removed.base, dash: null });
    const settle = replay(at('remove:R1', 0.9));
    expect(nv(settle, 'R1').visible).toBe(false);
    expect(ev(settle, IDS.removedR1B).visible).toBe(false);
  });
});

describe('choreography', () => {
  it('remove: edges retract toward survivors, the node shrinks into a ghost that lingers then fades', () => {
    const early = replay(atU('remove:R1', 0.2));
    const r1b = ev(early, IDS.removedR1B);
    expect(r1b.progress).toBeGreaterThan(0);
    expect(r1b.progress).toBeLessThan(1);
    expect(r1b.fromTarget).toBe(true); // B survives
    expect(ev(early, IDS.removedR2R1).fromTarget).toBe(false); // both go: toward the source
    const shrink = replay(atU('remove:R1', 0.45));
    const r1 = nv(shrink, 'R1');
    expect(r1.r).toBeLessThan(node('R1').r);
    expect(r1.r).toBeGreaterThan(0.6 * node('R1').r - 1e-9);
    expect(r1.dash).toEqual([3, 2.5]);
    expect(r1.fill).not.toBe(F.removed.base);
    expect(r1.label?.strike).toBe(true);
    expect(ev(shrink, IDS.removedR1B).visible).toBe(false);
    const linger = replay(at('remove:R1', 0.58));
    expect(nv(linger, 'R1')).toMatchObject({ visible: true, alpha: 1, fill: null });
    expect(nv(linger, 'R1').r).toBeCloseTo(0.6 * node('R1').r, 9);
    const fading = nv(replay(at('remove:R1', 0.72)), 'R1');
    expect(fading.alpha).toBeGreaterThan(0);
    expect(fading.alpha).toBeLessThan(1);
  });

  it('add: edges grow from the existing endpoint, then the node pops (1.08 overshoot), then its label fades in', () => {
    const early = replay(atU('add:N1', 0.2));
    expect(nv(early, 'N1').visible).toBe(false);
    const grow = ev(early, IDS.addedN1A);
    expect(grow.visible).toBe(true);
    expect(grow.fromTarget).toBe(true); // grows from A
    expect(grow.progress).toBeGreaterThan(0);
    expect(grow.progress).toBeLessThan(1);
    expect(ev(early, IDS.addedN1N2).visible).toBe(false); // between two new nodes: after the pops
    let peak = 0;
    for (let u = 0.35; u <= 0.75; u += 0.002)
      peak = Math.max(peak, nv(replay(atU('add:N1', u)), 'N1').r);
    expect(peak / node('N1').r).toBeCloseTo(1.08, 2);
    const popped = nv(replay(atU('add:N1', 0.6)), 'N1');
    expect(popped.visible).toBe(true);
    expect(popped.label?.alpha).toBe(0);
    const late = nv(replay(atU('add:N1', 0.95)), 'N1');
    expect(late.label?.alpha).toBeGreaterThan(0);
    expect(late.r).toBeCloseTo(node('N1').r, 1);
  });

  it('merge: sources travel on an arc into the target, edges follow, the badge counts up and the ring flashes', () => {
    const mid = replay(atU('merge:T', 0.3));
    const s1 = nv(mid, 'S1');
    const t = node('T');
    expect(dist(s1.x, s1.y, node('S1').x, node('S1').y)).toBeGreaterThan(1);
    expect(dist(s1.x, s1.y, t.x, t.y)).toBeLessThan(dist(node('S1').x, node('S1').y, t.x, t.y));
    // Off the straight chord: an arc.
    const cross =
      (t.x - node('S1').x) * (s1.y - node('S1').y) - (t.y - node('S1').y) * (s1.x - node('S1').x);
    expect(Math.abs(cross)).toBeGreaterThan(1);
    expect(s1.z).toBe(3);
    const carried = ev(mid, IDS.carriedTD);
    expect([carried.x1, carried.y1]).toEqual([s1.x, s1.y]);
    const collapsed = ev(mid, IDS.collapsedS2A);
    expect([collapsed.x1, collapsed.y1]).toEqual([nv(mid, 'S2').x, nv(mid, 'S2').y]);
    const trail = glyphs(mid, 'merge-arrow');
    expect(trail.length).toBeGreaterThanOrEqual(1);
    for (const g of trail) {
      expect(g.progress).toBeGreaterThan(0);
      expect(g.progress).toBeLessThanOrEqual(1);
    }
    expect(nv(replay(atU('merge:T', 0.5)), 'T').badge).toBeNull();
    expect(nv(replay(atU('merge:T', 0.6)), 'T').badge?.text).toBe('⊕ 1');
    const arrived = nv(replay(atU('merge:T', 0.8)), 'T');
    expect(arrived.badge?.text).toBe('⊕ 2');
    expect(arrived.ring?.width).toBeGreaterThan(1.5);
    expect(nv(replay(atU('merge:T', 0.72)), 'S1').visible).toBe(false);
    // After arrival the carried edge is its after form.
    const late = ev(replay(atU('merge:T', 0.9)), IDS.carriedTD);
    expect([late.x1, late.y1]).toEqual([t.x, t.y]);
  });

  it('split: targets emerge from the source and travel out; carried edges follow', () => {
    const start = replay(atU('split:X', 0.12));
    const y1 = nv(start, 'Y1');
    expect(dist(y1.x, y1.y, node('X').x, node('X').y)).toBeLessThan(
      dist(node('Y1').x, node('Y1').y, node('X').x, node('X').y) / 2,
    );
    expect(y1.alpha).toBeLessThan(1);
    const mid = replay(atU('split:X', 0.45));
    const y1m = nv(mid, 'Y1');
    const carried = ev(mid, IDS.carriedY1C);
    expect([carried.x1, carried.y1]).toEqual([y1m.x, y1m.y]);
    expect(glyphs(mid, 'split-arrow').length).toBeGreaterThanOrEqual(1);
    const end = nv(replay(atU('split:X', 0.95)), 'Y1');
    expect([end.x, end.y]).toEqual([node('Y1').x, node('Y1').y]);
  });

  it('modify: the old label slides up and fades, the new one rises in, the ring flashes, the badge ticks in', () => {
    const f = replay(atU('modify:M1', 0.4));
    const m1 = nv(f, 'M1');
    expect(m1.label?.text).toBe('Mu');
    expect(m1.label?.alpha).toBeGreaterThan(0);
    expect(m1.label?.alpha).toBeLessThan(1);
    expect(m1.label?.offset).toBeGreaterThan(5);
    expect(m1.label?.offset).toBeLessThan(11);
    expect(m1.secondaryLabel?.text).toBe('Mu old');
    expect(m1.secondaryLabel?.strike).toBe(false);
    expect(m1.secondaryLabel?.offset).toBeLessThan(5);
    expect(m1.secondaryLabel?.offset).toBeGreaterThanOrEqual(-1);
    expect(m1.badge).toBeNull();
    const flash = nv(replay(atU('modify:M1', 0.6)), 'M1');
    expect(flash.ring?.width).toBeGreaterThan(1.5);
    expect(nv(replay(atU('modify:M1', 0.65)), 'M1').badge?.text).toBe('+2 −1 ~1');
    expect(ev(replay(atU('modify:M1', 0.25)), IDS.labelM1C).label?.text).toBe('held');
    expect(ev(replay(atU('modify:M1', 0.65)), IDS.labelM1C).label?.text).toBe('owns');
  });

  it('relations / move: the changed end swings around the pivot; the old ghost fades', () => {
    const f = replay(atU('relations:C', 0.45));
    const e = ev(f, IDS.retargetCB);
    const c = node('C');
    expect([e.x1, e.y1]).toEqual([c.x, c.y]);
    // C → D and C → B have the same length: the end stays on that circle.
    expect(dist(e.x2, e.y2, c.x, c.y)).toBeCloseTo(120, 6);
    expect([e.x2, e.y2]).not.toEqual([node('B').x, node('B').y]);
    expect([e.x2, e.y2]).not.toEqual([node('D').x, node('D').y]);
    const ghost = glyphs(f, 'edge-ghost');
    expect(ghost).toHaveLength(1);
    expect(ghost[0]?.alpha).toBeGreaterThan(0);
    expect(ghost[0]?.alpha).toBeLessThan(0.45);
    expect(ghost[0]?.color).toBe(F.removed.base);
    expect(glyphs(f, 'pivot')).toHaveLength(1);
    const settled = replay(at('relations:C', 0.9));
    expect(glyphs(settled, 'edge-ghost')).toHaveLength(0);
    expect(glyphs(settled, 'pivot')).toHaveLength(0);
  });

  it('deprecation: the arc to the replacement grows in, then stays', () => {
    const mid = glyphs(replay(atU('modify:DP', 0.6)), 'replacement-arrow');
    expect(mid).toHaveLength(1);
    expect(mid[0]?.progress).toBeGreaterThan(0);
    expect(mid[0]?.progress).toBeLessThan(1);
    expect(glyphs(replay(at('modify:DP', 0.95)), 'replacement-arrow')[0]?.progress).toBe(1);
    expect(glyphs(replay(at('modify:DP', 0.1)), 'replacement-arrow')).toHaveLength(0);
  });
});

describe('replay spotlight and pulse', () => {
  it('dims the rest to 30% and the context to 70% while a hunk plays, and releases between hunks', () => {
    const f = replay(at('remove:R1', 0.5));
    expect(nv(f, 'R1').alpha).toBe(1);
    expect(nv(f, 'B').alpha).toBeCloseTo(0.7, 9);
    expect(nv(f, 'F').alpha).toBeCloseTo(0.3, 9);
    expect(ev(f, IDS.unchangedCD).alpha).toBeCloseTo(0.3, 9);
    expect(f.spotlight).toBeCloseTo(1, 9);
    const ramp = replay(at('remove:R1', 0.09));
    expect(nv(ramp, 'F').alpha).toBeGreaterThan(0.3);
    expect(nv(ramp, 'F').alpha).toBeLessThan(1);
    const w0 = scene.timeline.windows[0];
    const gap = replay((w0?.end ?? 0) + 80);
    expect(nv(gap, 'F').alpha).toBe(1);
    expect(gap.spotlight).toBe(0);
    expect(ramp.spotlight).toBeGreaterThan(0);
    expect(ramp.spotlight).toBeLessThan(1);
  });

  it('pulses the hunk once during its spotlight phase (its context when nothing exists yet)', () => {
    expect(nv(replay(at('remove:R1', 0.09)), 'R1').pulse).toBeCloseTo(0.5, 6);
    expect(nv(replay(at('remove:R1', 0.5)), 'R1').pulse).toBe(0);
    const add = replay(at('add:N1', 0.09));
    expect(nv(add, 'A').pulse).toBeCloseTo(0.5, 6);
    expect(nv(add, 'N1').visible).toBe(false);
    expect(nv(replay(at('remove:R1', 0.09), { reducedMotion: true }), 'R1').pulse).toBe(0);
  });

  it('keeps the selected hunk emphasized (labels, halos) without overriding the replay spotlight', () => {
    const h = scene.hunkIndex.get('add:N1') as number;
    const f = replay(at('remove:R1', 0.5), { selectedHunk: h });
    expect(nv(f, 'F').alpha).toBeCloseTo(0.3, 9);
    expect(nv(f, 'A').label).not.toBeNull();
  });
});

describe('reduced motion', () => {
  const reduced = (t: number) => replay(t, { reducedMotion: true });

  it('crossfades instead of travelling or growing', () => {
    const merge = reduced(atU('merge:T', 0.3));
    const s1 = nv(merge, 'S1');
    expect([s1.x, s1.y]).toEqual([node('S1').x, node('S1').y]);
    expect(s1.alpha).toBeGreaterThan(0);
    expect(s1.alpha).toBeLessThan(1);
    expect(glyphs(merge, 'merge-arrow')).toHaveLength(0);
    // The carried edge's old form fades out in its before style while the new one fades in.
    const ghost = glyphs(merge, 'edge-ghost')[0];
    expect(ghost).toMatchObject({ dash: null, color: F.identity.base });
    expect(ghost?.alpha).toBeGreaterThan(0);
    expect(ghost?.alpha).toBeLessThan(1);
    const add = reduced(atU('add:N1', 0.3));
    expect(nv(add, 'N1').r).toBe(node('N1').r);
    expect(nv(add, 'N1').alpha).toBeGreaterThan(0);
    expect(ev(add, IDS.addedN1A).progress).toBe(1);
    const swing = reduced(atU('relations:C', 0.45));
    expect([ev(swing, IDS.retargetCB).x2, ev(swing, IDS.retargetCB).y2]).toEqual([
      node('B').x,
      node('B').y,
    ]);
    expect(glyphs(swing, 'pivot')).toHaveLength(0);
    const split = reduced(atU('split:X', 0.3));
    expect([nv(split, 'Y1').x, nv(split, 'Y1').y]).toEqual([node('Y1').x, node('Y1').y]);
  });

  it('crossfades labels in place', () => {
    const m1 = nv(reduced(atU('modify:M1', 0.4)), 'M1');
    expect(m1.label?.offset).toBe(5);
    expect(m1.secondaryLabel?.offset).toBe(5);
    expect((m1.label?.alpha ?? 0) + (m1.secondaryLabel?.alpha ?? 0)).toBeCloseTo(1, 9);
  });
});

describe('chapter mode', () => {
  const chaptered = buildScene(diff, makeLayout(diff, POSITIONS), {
    replay: { chapterThreshold: 3 },
  });
  const r = createVisualResolver(chaptered);

  it('plays the hunks of a phase together', () => {
    const tl = chaptered.timeline;
    expect(tl.mode).toBe('chapters');
    const restructure = tl.chapters.find((c) => c.phase === 'restructure');
    if (restructure === undefined) throw new Error('fixture');
    const ws = tl.windows.filter((w) => restructure.hunks.includes(w.hunk));
    const t = Math.max(...ws.map((w) => w.start)) + 1;
    const active = ws.filter((w) => t >= w.start && t < w.end);
    expect(active.length).toBeGreaterThanOrEqual(2);
    const f = replay(t, {}, r);
    // Every hunk of the chapter is emphasized; the rest is dimmed.
    for (const h of restructure.hunks) {
      for (const i of chaptered.hunks[h]?.nodes ?? []) {
        const v = f.nodes[i] as NodeVisual;
        if (v.visible) expect(v.alpha * 1, chaptered.nodes[i]?.id).toBeGreaterThan(0.3);
      }
    }
    const fIdx = chaptered.nodeIndex.get('F') as number;
    expect((f.nodes[fIdx] as NodeVisual).alpha).toBeLessThan(1);
  });
});

describe('sanity sweep', () => {
  const inUnit = (v: number, what: string): void => {
    if (!(Number.isFinite(v) && v >= -1e-9 && v <= 1 + 1e-9)) throw new Error(`${what} = ${v}`);
  };
  const finite = (v: number, what: string): void => {
    if (!Number.isFinite(v)) throw new Error(`${what} = ${v}`);
  };
  const label = (l: LabelVisual | null, what: string): void => {
    if (l === null) return;
    inUnit(l.alpha, `${what}.alpha`);
    finite(l.offset, `${what}.offset`);
    finite(l.priority, `${what}.priority`);
    finite(l.minZoom, `${what}.minZoom`);
    if (l.text === '') throw new Error(`${what}.text is empty`);
  };
  function check(f: FrameVisuals, where: string): void {
    inUnit(f.spotlight, `${where} spotlight`);
    f.nodes.forEach((n, i) => {
      const w = `${where} node ${scene.nodes[i]?.id ?? i}`;
      if (!n.visible) return;
      inUnit(n.alpha, `${w}.alpha`);
      inUnit(n.pulse, `${w}.pulse`);
      for (const k of ['x', 'y', 'r', 'strokeWidth', 'z'] as const) finite(n[k], `${w}.${k}`);
      if (n.r < 0) throw new Error(`${w}.r < 0`);
      if (n.ring) {
        inUnit(n.ring.alpha, `${w}.ring.alpha`);
        finite(n.ring.width, `${w}.ring.width`);
      }
      if (n.halo) {
        inUnit(n.halo.alpha, `${w}.halo.alpha`);
        finite(n.halo.radius, `${w}.halo.radius`);
      }
      label(n.label, `${w}.label`);
      label(n.secondaryLabel, `${w}.secondaryLabel`);
    });
    f.edges.forEach((e, j) => {
      const w = `${where} edge ${j}`;
      if (!e.visible) return;
      inUnit(e.alpha, `${w}.alpha`);
      inUnit(e.progress, `${w}.progress`);
      for (const k of [
        'x1',
        'y1',
        'x2',
        'y2',
        'r1',
        'r2',
        'curvature',
        'width',
        'arrowMinZoom',
      ] as const)
        finite(e[k], `${w}.${k}`);
      label(e.label, `${w}.label`);
    });
    f.glyphs.forEach((g, k) => {
      const w = `${where} glyph ${k} (${g.kind})`;
      inUnit(g.alpha, `${w}.alpha`);
      inUnit(g.progress, `${w}.progress`);
      for (const key of ['x1', 'y1', 'x2', 'y2', 'r1', 'r2', 'curvature', 'width'] as const)
        finite(g[key], `${w}.${key}`);
      label(g.label, `${w}.label`);
    });
  }

  it.each([
    ['hunks mode', scene],
    [
      'chapter mode',
      buildScene(diff, makeLayout(diff, POSITIONS), { replay: { chapterThreshold: 3 } }),
    ],
    ['light theme', buildScene(diff, makeLayout(diff, POSITIONS), { theme: 'light' })],
  ])('%s: no NaN, alphas and progress in [0, 1] at every t', (_name, s) => {
    const r = createVisualResolver(s);
    const out = r.resolve(createViewState());
    const end = s.timeline.duration;
    for (const reducedMotion of [false, true]) {
      for (let k = 0; k <= 600; k++) {
        const t = -50 + (k / 600) * (end + 100);
        r.resolve(
          createViewState({
            layer: 'replay',
            t,
            reducedMotion,
            selectedHunk: k % 7 === 0 ? 2 : -1,
          }),
          out,
        );
        check(out, `t=${t.toFixed(1)} reduced=${reducedMotion}`);
      }
    }
  });
});

describe('zero allocations in steady state', () => {
  it('reuses the frame, its arrays and every element object', () => {
    const r = createVisualResolver(scene);
    const out = r.resolve(createViewState({ layer: 'replay', t: atU('merge:T', 0.3) }));
    const nodes = out.nodes;
    const edges = out.edges;
    const glyphArray = out.glyphs;
    const nodeObjects = [...out.nodes];
    const edgeObjects = [...out.edges];
    const subObjects = new Set<object>();
    const collect = (f: FrameVisuals) => {
      for (const n of f.nodes)
        for (const o of [n.ring, n.halo, n.label, n.secondaryLabel, n.badge])
          if (o) subObjects.add(o);
      for (const e of f.edges) if (e.label) subObjects.add(e.label);
      for (const g of f.glyphs) {
        subObjects.add(g);
        if (g.label) subObjects.add(g.label);
      }
    };
    collect(out);
    const views: Partial<ViewState>[] = [
      { layer: 'union' },
      { layer: 'before' },
      { layer: 'after', selectedHunk: 3, hoveredNode: 2 },
      { layer: 'union', families: new Set(['added'] as const), hoveredEdge: 4 },
    ];
    for (let k = 0; k <= 200; k++)
      views.push({
        layer: 'replay',
        t: (k / 200) * scene.timeline.duration,
        reducedMotion: k % 2 === 0,
      });
    for (const v of views) {
      const f = r.resolve(createViewState(v), out);
      expect(f).toBe(out);
      expect(f.nodes).toBe(nodes);
      expect(f.edges).toBe(edges);
      expect(f.glyphs).toBe(glyphArray);
      collect(f);
    }
    expect(out.nodes.every((n, i) => n === nodeObjects[i])).toBe(true);
    expect(out.edges.every((e, j) => e === edgeObjects[j])).toBe(true);
    // Every nested object comes from the frame's fixed pool.
    const N = scene.nodes.length;
    const M = scene.edges.length;
    const poolSize = 5 * N + M + 2 * 14;
    expect(subObjects.size).toBeLessThanOrEqual(poolSize);
    // Resolving the same view twice gives identical content.
    const view = createViewState({ layer: 'replay', t: atU('split:X', 0.4) });
    const a = structuredClone(r.resolve(view, out));
    expect(r.resolve(view, out)).toEqual(a);
  });
});
