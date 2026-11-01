import { KgdiffError } from '@kgdiff/core';
import { describe, expect, it, vi } from 'vitest';
import { pillLabel } from '../src/focus.js';
import {
  buildScene,
  computeFocus,
  createViewState,
  frameBounds,
  type Scene,
} from '../src/index.js';
import { kitchenSink, makeDiff, makeLayout, POSITIONS } from './fixtures.js';

vi.mock('@kgdiff/core', async (orig) => ({
  ...(await orig<object>()),
  formatHunk: (await import('./mock-core.js')).fakeFormatHunk,
}));

const diff = kitchenSink();
const scene = buildScene(diff, makeLayout(diff, POSITIONS));
const idx = (s: Scene, id: string): number => s.nodeIndex.get(id) ?? -1;
const ids = (s: Scene, flags: Uint8Array): string[] =>
  [...flags].flatMap((v, i) => (v === 1 ? [s.nodes[i]?.id ?? ''] : []));

/** A chain c — u1 — u2 — u3 plus an isolated pair p — q (all unchanged except c). */
function chain(): Scene {
  const d = makeDiff({
    nodes: [
      {
        id: 'c',
        status: 'modified',
        hunk: 'm',
        facets: [{ kind: 'rename', from: 'c0', to: 'c' }],
        labelBefore: 'c0',
      },
      { id: 'u1', status: 'unchanged' },
      { id: 'u2', status: 'unchanged' },
      { id: 'u3', status: 'unchanged' },
      { id: 'p', status: 'unchanged' },
      { id: 'q', status: 'unchanged' },
    ],
    edges: [
      { source: 'c', target: 'u1', status: 'unchanged' },
      { source: 'u1', target: 'u2', status: 'unchanged' },
      { source: 'u2', target: 'u3', status: 'unchanged' },
      { source: 'p', target: 'q', status: 'unchanged' },
    ],
    hunks: [{ id: 'm', kind: 'modify', phase: 'modify', anchor: 'c', nodes: ['c'] }],
  });
  return buildScene(
    d,
    makeLayout(
      d,
      { c: [0, 0], u1: [50, 0], u2: [100, 0], u3: [150, 0], p: [0, 300], q: [40, 300] },
      { u1: 4 },
    ),
  );
}

describe('computeFocus', () => {
  it('shows every changed element plus one hop of context by default', () => {
    const f = computeFocus(scene);
    for (const n of scene.nodes) {
      if (n.status !== 'unchanged') expect(f.nodes[n.index], n.id).toBe(1);
    }
    for (const e of scene.edges) {
      if (e.status !== 'unchanged') expect(f.edges[e.index], e.id).toBe(1);
      expect(f.edges[e.index]).toBe(f.nodes[e.s] === 1 && f.nodes[e.t] === 1 ? 1 : 0);
    }
    expect(f.nodes[idx(scene, 'F')]).toBe(0);
    expect(ids(scene, f.context).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('expands context by hops', () => {
    const s = chain();
    expect(ids(s, computeFocus(s, { hops: 0 }).nodes)).toEqual(['c']);
    expect(ids(s, computeFocus(s, { hops: 1 }).nodes)).toEqual(['c', 'u1']);
    expect(ids(s, computeFocus(s, { hops: 2 }).nodes)).toEqual(['c', 'u1', 'u2']);
    expect(ids(s, computeFocus(s, { hops: 2 }).context)).toEqual(['u1', 'u2']);
    expect(ids(s, computeFocus(s, { hops: 1.9 }).nodes)).toEqual(['c', 'u1']);
  });

  it('always shows the endpoints of changed edges, even with hops 0', () => {
    const f = computeFocus(scene, { hops: 0 });
    // B → D was added between two unchanged nodes; C → B was retargeted from D.
    for (const id of ['B', 'C', 'D']) expect(f.nodes[idx(scene, id)], id).toBe(1);
    expect(f.context[idx(scene, 'B')]).toBe(1);
  });

  it('treats changed-edge endpoints as distance 1, like the layout scope (§12)', () => {
    // An added edge c → x between a changed node and an unchanged one, with x → y beyond.
    const d = makeDiff({
      nodes: [
        { id: 'a', status: 'unchanged' },
        { id: 'b', status: 'unchanged' },
        { id: 'c', status: 'unchanged' },
      ],
      edges: [
        { source: 'a', target: 'b', predicate: 'new', status: 'added', hunk: 'r' },
        { source: 'b', target: 'c', status: 'unchanged' },
      ],
      hunks: [
        {
          id: 'r',
          kind: 'relations',
          phase: 'restructure',
          anchor: 'a',
          edges: [JSON.stringify(['a', 'new', 'b'])],
        },
      ],
    });
    const s = buildScene(d, makeLayout(d, { a: [0, 0], b: [50, 0], c: [100, 0] }));
    expect(ids(s, computeFocus(s, { hops: 0 }).nodes)).toEqual(['a', 'b']);
    expect(ids(s, computeFocus(s, { hops: 1 }).nodes)).toEqual(['a', 'b']);
    expect(ids(s, computeFocus(s, { hops: 2 }).nodes)).toEqual(['a', 'b', 'c']);
  });

  it('never expands from a hub; the hub keeps its skipped neighbours in its pill', () => {
    // A changed hub h with 5 leaves, plus a changed node m next to leaf l0.
    const leaves = ['l0', 'l1', 'l2', 'l3', 'l4'];
    const d = makeDiff({
      nodes: [
        {
          id: 'h',
          status: 'modified',
          hunk: 'mh',
          labelBefore: 'h0',
          facets: [{ kind: 'rename', from: 'h0', to: 'h' }],
        },
        {
          id: 'm',
          status: 'modified',
          hunk: 'mm',
          labelBefore: 'm0',
          facets: [{ kind: 'rename', from: 'm0', to: 'm' }],
        },
        ...leaves.map((id) => ({ id, status: 'unchanged' as const })),
      ],
      edges: [
        ...leaves.map((l) => ({ source: l, target: 'h', status: 'unchanged' as const })),
        { source: 'm', target: 'l0', status: 'unchanged' },
      ],
      hunks: [
        { id: 'mh', kind: 'modify', phase: 'modify', anchor: 'h', nodes: ['h'] },
        { id: 'mm', kind: 'modify', phase: 'modify', anchor: 'm', nodes: ['m'] },
      ],
    });
    const positions = Object.fromEntries(
      ['h', 'm', ...leaves].map((id, i) => [id, [i * 30, (i % 2) * 30] as [number, number]]),
    );
    const s = buildScene(d, makeLayout(d, positions));
    expect(s.nodes[idx(s, 'h')]?.degree).toBe(5);
    // Default threshold 40: an ordinary node, all leaves visible.
    expect(computeFocus(s).nodes[idx(s, 'l3')]).toBe(1);
    const f = computeFocus(s, { hubDegree: 3 });
    // h is shown (changed) but not expanded from; l0 is reached from m.
    expect(ids(s, f.nodes)).toEqual(['h', 'l0', 'm']);
    const pill = f.collapsed.find((g) => g.id === 'near:h');
    expect(pill?.nodes.map((i) => s.nodes[i]?.id)).toEqual(['l1', 'l2', 'l3', 'l4']);
    expect(pill?.label).toBe('+4 unchanged');
    expect(computeFocus(s, { hubDegree: Number.POSITIVE_INFINITY }).nodes[idx(s, 'l3')]).toBe(1);
    expect(() => computeFocus(s, { hubDegree: Number.NaN })).toThrow(KgdiffError);
    expect(() => computeFocus(s, { hubDegree: -1 })).toThrow(/hubDegree/);
  });

  it('adds expanded nodes', () => {
    const s = chain();
    const f = computeFocus(s, { hops: 0, expanded: new Set([idx(s, 'u3'), 999, -1]) });
    expect(ids(s, f.nodes)).toEqual(['c', 'u3']);
    expect(f.context[idx(s, 'u3')]).toBe(1);
  });

  it('restricts to one hunk', () => {
    const h = scene.hunkIndex.get('add:N1') as number;
    const f = computeFocus(scene, { hunk: h, hops: 0 });
    expect(ids(scene, f.nodes).sort()).toEqual(['A', 'N1', 'N2']);
    expect(ids(scene, f.context)).toEqual(['A']);
    // A is an endpoint of the hunk's edge (distance 1): it expands only from hops 2 (§12).
    expect(computeFocus(scene, { hunk: h, hops: 1 }).nodes[idx(scene, 'DP')]).toBe(0);
    const wider = computeFocus(scene, { hunk: h, hops: 2 });
    // Changed nodes outside the hunk are only context here.
    expect(wider.context[idx(scene, 'DP')]).toBe(1);
  });

  it('collapses hidden nodes next to the visible node they hang off, with stable ids', () => {
    const s = chain();
    const f = computeFocus(s, { hops: 1 });
    expect(f.collapsed.map((g) => g.id)).toEqual(['component:p', 'near:u1']);
    const near = f.collapsed[1];
    // u2 and u3 hide behind u1, plus u1's 4 neighbours outside the layout.
    expect(near?.nodes.map((i) => s.nodes[i]?.id)).toEqual(['u2', 'u3']);
    expect(near?.count).toBe(6);
    expect(near?.x).toBe(125);
    expect(near?.y).toBe(0);
    const comp = f.collapsed[0];
    expect(comp?.count).toBe(2);
    expect([comp?.x, comp?.y]).toEqual([20, 300]);
  });

  it('labels pills in the scene locale', () => {
    const f = computeFocus(chain(), { hops: 1 });
    expect(f.collapsed.map((g) => g.label)).toEqual(['+2 unchanged', '+6 unchanged']);
    const zh = { ...chain(), locale: 'zh-CN' as const };
    expect(computeFocus(zh, { hops: 1 }).collapsed.map((g) => g.label)).toEqual([
      '+2 个未变节点',
      '+6 个未变节点',
    ]);
    expect(pillLabel(12_345, true, 'en')).toBe('+12,345 unchanged');
    // A hunk-restricted focus may hide changed nodes too: the pill says so.
    const h = scene.hunkIndex.get('add:N1') as number;
    const labels = computeFocus(scene, { hunk: h, hops: 0 }).collapsed.map((g) => g.label);
    expect(labels.some((l) => l.endsWith(' hidden'))).toBe(true);
    expect(pillLabel(3, false, 'zh-CN')).toBe('+3 个隐藏节点');
  });

  it('places a pill with only out-of-layout members just outside its node', () => {
    const s = chain();
    const f = computeFocus(s, { hops: 3 });
    const g = f.collapsed.find((x) => x.id === 'near:u1');
    expect(g?.nodes).toEqual([]);
    expect(g?.count).toBe(4);
    // Away from the visible neighbours (c on the left, u2 on the right → straight up).
    const u1 = s.nodes[idx(s, 'u1')];
    expect(g?.x).toBeCloseTo(u1?.x ?? 0, 9);
    expect(g?.y).toBeLessThan(u1?.y ?? 0);
  });

  it('is deterministic and produces scene-sized arrays', () => {
    const a = computeFocus(scene, { hops: 1 });
    const b = computeFocus(scene, { hops: 1 });
    expect(a).toEqual(b);
    expect(a.nodes).toHaveLength(scene.nodes.length);
    expect(a.edges).toHaveLength(scene.edges.length);
    expect(a.context).toHaveLength(scene.nodes.length);
  });

  it('rejects invalid options', () => {
    expect(() => computeFocus(scene, { hops: -1 })).toThrow(KgdiffError);
    expect(() => computeFocus(scene, { hops: Number.POSITIVE_INFINITY })).toThrow(/hops/);
    expect(() => computeFocus(scene, { hunk: scene.hunks.length })).toThrow(/out of range/);
    expect(() => computeFocus(scene, { hunk: 0.5 })).toThrow(KgdiffError);
  });
});

describe('frameBounds', () => {
  it('frames the whole scene by default, padded', () => {
    const r = frameBounds(scene);
    expect(r.x).toBeLessThan(scene.bounds.x);
    expect(r.y).toBeLessThan(scene.bounds.y);
    expect(r.width).toBeGreaterThan(scene.bounds.width);
    expect(frameBounds(scene, [])).toEqual(r);
    expect(frameBounds(scene, [999])).toEqual(r);
  });

  it('frames the union of the given hunks, centred, at least 160 world units', () => {
    const a = scene.hunks[0];
    const b = scene.hunks[1];
    if (a === undefined || b === undefined) throw new Error('fixture');
    const r = frameBounds(scene, [0, 1]);
    for (const h of [a, b]) {
      expect(r.x).toBeLessThanOrEqual(h.bounds.x);
      expect(r.y).toBeLessThanOrEqual(h.bounds.y);
      expect(r.x + r.width).toBeGreaterThanOrEqual(h.bounds.x + h.bounds.width);
      expect(r.y + r.height).toBeGreaterThanOrEqual(h.bounds.y + h.bounds.height);
    }
    const one = frameBounds(scene, [scene.hunkIndex.get('modify:M4') as number]);
    expect(one.width).toBeGreaterThanOrEqual(160);
    expect(one.height).toBeGreaterThanOrEqual(160);
    const hb = scene.hunks[scene.hunkIndex.get('modify:M4') as number]?.bounds;
    if (hb === undefined) throw new Error('fixture');
    expect(one.x + one.width / 2).toBeCloseTo(hb.x + hb.width / 2, 9);
    expect(one.y + one.height / 2).toBeCloseTo(hb.y + hb.height / 2, 9);
  });
});

describe('createViewState', () => {
  it('defaults to the union layer with nothing selected', () => {
    const v = createViewState();
    expect(v).toEqual({
      layer: 'union',
      t: 0,
      selectedHunk: -1,
      hoveredNode: -1,
      hoveredEdge: -1,
      selectedNode: -1,
      focus: null,
      families: new Set(),
      showSuggestions: true,
      reducedMotion: false,
      emphasis: 1,
    });
    expect(Object.isFrozen(v)).toBe(true);
  });

  it('applies overrides and ignores undefined values', () => {
    const families = new Set(['added'] as const);
    const v = createViewState({
      layer: 'replay',
      t: 120,
      families,
      reducedMotion: true,
      selectedHunk: undefined,
    });
    expect(v.layer).toBe('replay');
    expect(v.t).toBe(120);
    expect(v.families).toBe(families);
    expect(v.reducedMotion).toBe(true);
    expect(v.selectedHunk).toBe(-1);
  });
});
