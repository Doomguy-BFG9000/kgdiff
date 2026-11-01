/**
 * `DiffIndex`: O(1) lookups over a diff result. Each map is built on first use, so a diff
 * whose consumer never asks for an index pays nothing for it.
 */
import type { DiffIndex, Hunk, Id, UnionEdge, UnionId, UnionNode } from './types.js';

const NONE: readonly UnionEdge[] = Object.freeze([]);

function lazy<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => {
    value ??= build();
    return value;
  };
}

function indexBy<T>(items: readonly T[], key: (item: T) => string | undefined): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    if (k !== undefined) map.set(k, item);
  }
  return map;
}

export function createDiffIndex(
  nodes: readonly UnionNode[],
  edges: readonly UnionEdge[],
  hunks: readonly Hunk[],
): DiffIndex {
  const byId = lazy(() => indexBy(nodes, (n) => n.id));
  const byBefore = lazy(() => indexBy(nodes, (n) => n.beforeId));
  const byAfter = lazy(() => indexBy(nodes, (n) => n.afterId));
  const edgeById = lazy(() => indexBy(edges, (e) => e.id));
  const hunkById = lazy(() => indexBy(hunks, (h) => h.id));
  const incident = lazy(() => {
    const map = new Map<UnionId, UnionEdge[]>();
    // Edges are sorted by id, so every list comes out sorted too.
    for (const e of edges) {
      const ends = new Set([e.source, e.target]);
      if (e.sourceBefore !== undefined) ends.add(e.sourceBefore);
      if (e.targetBefore !== undefined) ends.add(e.targetBefore);
      for (const u of ends) {
        const list = map.get(u);
        if (list) list.push(e);
        else map.set(u, [e]);
      }
    }
    return map;
  });
  return {
    node: (id: UnionId) => byId().get(id),
    edge: (id: UnionId) => edgeById().get(id),
    hunk: (id: string) => hunkById().get(id),
    nodeByBefore: (id: Id) => byBefore().get(id),
    nodeByAfter: (id: Id) => byAfter().get(id),
    edgesOf: (id: UnionId) => incident().get(id) ?? NONE,
  };
}
