import type { EdgeData, ID, NodeData } from '@antv/g6';
import { describe, expect, it } from 'vitest';
import { type Datum, deepEqual, diffData } from '../src/patch.js';

const node = (id: string, style: Record<string, unknown>, data = {}): NodeData => ({
  id,
  style,
  data,
});
const edge = (
  id: string,
  source: string,
  target: string,
  style: Record<string, unknown>,
): EdgeData => ({
  id,
  source,
  target,
  type: 'line',
  style,
  data: {},
});

function index(...items: Datum[]): Map<ID, Datum> {
  return new Map(items.map((d) => [d.id as ID, d]));
}

describe('diffData', () => {
  it('adds new elements, removes missing ones and leaves unchanged ones alone', () => {
    const prev = index(
      node('a', { x: 1 }),
      node('b', { x: 2 }),
      edge('e', 'a', 'b', { zIndex: 10 }),
    );
    const patch = diffData(prev, {
      nodes: [node('a', { x: 1 }), node('c', { x: 3 })],
      edges: [],
    });
    expect(patch.add.nodes.map((n) => n.id)).toEqual(['c']);
    expect(patch.remove).toEqual({ nodes: ['b'], edges: ['e'] });
    expect(patch.update).toEqual({ nodes: [], edges: [] });
    expect(patch.size).toBe(3);
  });

  it('updates only the changed keys, structurally compared', () => {
    const prev = index(node('a', { x: 1, lineDash: [3, 2], badges: [{ text: '+1' }], opacity: 1 }));
    const patch = diffData(prev, {
      nodes: [node('a', { x: 1, lineDash: [3, 2], badges: [{ text: '+1' }], opacity: 0.18 })],
      edges: [],
    });
    expect(patch.update.nodes).toEqual([{ id: 'a', style: { opacity: 0.18 } }]);
  });

  it('sends changed data and type, and always an edge zIndex with its ends', () => {
    const prev = index(
      node('a', {}),
      node('b', {}),
      node('c', {}),
      edge('e', 'a', 'b', { zIndex: 11, stroke: 'red' }),
    );
    const moved = { ...edge('e', 'a', 'c', { zIndex: 11, stroke: 'blue' }), type: 'quadratic' };
    const patch = diffData(prev, {
      nodes: [node('a', {}), node('b', {}, { hunk: 2 }), node('c', {})],
      edges: [moved],
    });
    expect(patch.update.nodes).toEqual([{ id: 'b', data: { hunk: 2 } }]);
    expect(patch.update.edges).toEqual([
      {
        id: 'e',
        source: 'a',
        target: 'c',
        type: 'quadratic',
        style: { stroke: 'blue', zIndex: 11 },
      },
    ]);
  });

  it('re-adds an id that switched between node and edge after removing it', () => {
    const prev = index(node('a', {}), node('b', {}), node('x', {}));
    const patch = diffData(prev, {
      nodes: [node('a', {}), node('b', {})],
      edges: [edge('x', 'a', 'b', {})],
    });
    expect(patch.remove.nodes).toEqual(['x']);
    expect(patch.readd.edges.map((e) => e.id)).toEqual(['x']);
    expect(patch.add.edges).toEqual([]);
  });

  it('compares nested values structurally', () => {
    expect(deepEqual([1, [2, { a: 3 }]], [1, [2, { a: 3 }]])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual({ a: 1 }, [1])).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});
