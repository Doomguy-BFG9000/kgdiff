/**
 * Layout scope: which union nodes get a position (docs/algorithms.md §12 "Scope").
 */
import type { UnionId } from '@kgdiff/core';
import type { LayoutScope } from './index.js';
import type { UnionGraph } from './union.js';

export interface ScopeSelection {
  /** 1 = node gets a position, by union index. */
  readonly visible: Uint8Array;
  /** Visible node → number of neighbours left out (only entries > 0), in id order. */
  readonly hidden: ReadonlyMap<UnionId, number>;
}

/**
 * - `all`: every node.
 * - `changes` (docs/algorithms.md §12): changed nodes (distance 0); the unchanged endpoints of
 *   changed edges in either version (distance 1, so a relation-only change between two unchanged
 *   nodes stays readable); and the nodes within `contextHops` of a changed node, by a
 *   multi-source BFS that never expands from a hub (max degree over both versions >
 *   `hubDegree`): a hub is visible when reached, but neighbours that could only be reached
 *   through it stay out and are counted in `hidden`.
 */
export function selectScope(
  graph: UnionGraph,
  scope: LayoutScope,
  contextHops: number,
  hubDegree: number,
): ScopeSelection {
  const n = graph.nodes.length;
  const visible = new Uint8Array(n);
  if (scope === 'all') {
    visible.fill(1);
    return { visible, hidden: new Map() };
  }

  // Distance 0: changed nodes. Distance 1: unchanged endpoints of changed edges (they are
  // needed to draw those edges and are context of them, like any neighbour of a changed node).
  const distance = new Int32Array(n).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    if (graph.nodes[i]!.status !== 'unchanged') {
      distance[i] = 0;
      frontier.push(i);
    }
  }
  const touched: number[] = [];
  for (let i = 0; i < n; i++) {
    if (graph.changed[i] && distance[i] === -1) {
      distance[i] = 1;
      touched.push(i);
    }
  }
  for (let hop = 0; hop < contextHops; hop++) {
    const next: number[] = hop === 0 ? [...touched] : [];
    for (const u of frontier) {
      const { degree } = graph.nodes[u]!;
      if (Math.max(degree.before, degree.after) > hubDegree) continue;
      for (let k = graph.offsets[u]!; k < graph.offsets[u + 1]!; k++) {
        const v = graph.adjacency[k]!;
        if (distance[v] === -1) {
          distance[v] = hop + 1;
          next.push(v);
        }
      }
    }
    frontier = next.sort((a, b) => a - b);
  }
  for (let i = 0; i < n; i++) if (distance[i]! >= 0) visible[i] = 1;

  return { visible, hidden: countHidden(graph, visible) };
}

/** For every visible node, the number of distinct neighbours that are not visible. */
export function countHidden(graph: UnionGraph, visible: Uint8Array): ReadonlyMap<UnionId, number> {
  const hidden = new Map<UnionId, number>();
  for (let u = 0; u < graph.nodes.length; u++) {
    if (!visible[u]) continue;
    let count = 0;
    for (let k = graph.offsets[u]!; k < graph.offsets[u + 1]!; k++) {
      if (!visible[graph.adjacency[k]!]) count++;
    }
    if (count > 0) hidden.set(graph.nodes[u]!.id, count);
  }
  return hidden;
}
