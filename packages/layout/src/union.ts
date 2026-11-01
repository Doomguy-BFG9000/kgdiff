/**
 * The union graph as the layout sees it: nodes in id order, undirected neighbour pairs drawn
 * from BOTH versions of every edge (so neither version is favoured), and merge / split partner
 * pairs. Built once per call in O(N + E).
 */
import type { DiffResult, UnionId, UnionNode } from '@kgdiff/core';

export interface Partner {
  /** The node that should travel little during replay (merge source / split target). */
  readonly mover: number;
  /** Where it travels to / from (merge target / split source). */
  readonly anchor: number;
}

export interface UnionGraph {
  /** Union nodes sorted by id (UTF-16 code unit order). */
  readonly nodes: readonly UnionNode[];
  readonly indexOf: ReadonlyMap<UnionId, number>;
  /** Distinct undirected neighbour pairs [a, b] with a < b, in first-seen edge order. */
  readonly pairs: Int32Array;
  /** CSR adjacency over `pairs`: neighbours of i are `adjacency[offsets[i] .. offsets[i + 1])`, ascending. */
  readonly offsets: Int32Array;
  readonly adjacency: Int32Array;
  readonly partners: readonly Partner[];
  /** 1 for changed nodes and for endpoints (either version) of changed edges. */
  readonly changed: Uint8Array;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function sortedById<T extends { readonly id: string }>(items: readonly T[]): readonly T[] {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const cur = items[i];
    if (prev !== undefined && cur !== undefined && byCodeUnit(prev.id, cur.id) > 0) {
      return [...items].sort((a, b) => byCodeUnit(a.id, b.id));
    }
  }
  return items;
}

/** Build CSR adjacency (ascending neighbour lists) from flat undirected pairs. */
export function buildAdjacency(
  n: number,
  pairs: Int32Array,
): { offsets: Int32Array; adjacency: Int32Array } {
  const offsets = new Int32Array(n + 1);
  for (let k = 0; k < pairs.length; k++) offsets[(pairs[k] ?? 0) + 1]!++;
  for (let i = 0; i < n; i++) offsets[i + 1]! += offsets[i]!;
  const fill = offsets.slice(0, n);
  const adjacency = new Int32Array(pairs.length);
  for (let k = 0; k < pairs.length; k += 2) {
    const a = pairs[k]!;
    const b = pairs[k + 1]!;
    adjacency[fill[a]!++] = b;
    adjacency[fill[b]!++] = a;
  }
  for (let i = 0; i < n; i++) adjacency.subarray(offsets[i]!, offsets[i + 1]!).sort();
  return { offsets, adjacency };
}

export function buildUnionGraph(diff: DiffResult): UnionGraph {
  const nodes = sortedById(diff.nodes);
  const n = nodes.length;
  const indexOf = new Map<UnionId, number>();
  for (let i = 0; i < n; i++) indexOf.set(nodes[i]!.id, i);

  const changed = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (nodes[i]!.status !== 'unchanged') changed[i] = 1;

  const seen = new Set<number>();
  const flat: number[] = [];
  const addPair = (a: number | undefined, b: number | undefined): void => {
    if (a === undefined || b === undefined || a === b) return;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo * n + hi;
    if (seen.has(key)) return;
    seen.add(key);
    flat.push(lo, hi);
  };

  for (const edge of sortedById(diff.edges)) {
    const s = indexOf.get(edge.source);
    const t = indexOf.get(edge.target);
    addPair(s, t);
    const sb = edge.sourceBefore === undefined ? s : indexOf.get(edge.sourceBefore);
    const tb = edge.targetBefore === undefined ? t : indexOf.get(edge.targetBefore);
    if (sb !== s || tb !== t) addPair(sb, tb);
    if (edge.status !== 'unchanged') {
      for (const end of [s, t, sb, tb]) if (end !== undefined) changed[end] = 1;
    }
  }

  const pairs = Int32Array.from(flat);
  const { offsets, adjacency } = buildAdjacency(n, pairs);

  const partners: Partner[] = [];
  const partnerKeys = new Set<number>();
  const addPartner = (mover: number, anchor: number | undefined): void => {
    if (anchor === undefined || anchor === mover) return;
    const key = mover * n + anchor;
    if (partnerKeys.has(key)) return;
    partnerKeys.add(key);
    partners.push({ mover, anchor });
  };
  for (let i = 0; i < n; i++) {
    for (const facet of nodes[i]!.facets) {
      if (facet.kind === 'mergedInto') addPartner(i, indexOf.get(facet.target));
      else if (facet.kind === 'splitFrom') addPartner(i, indexOf.get(facet.source));
      else if (facet.kind === 'mergeTarget') {
        for (const source of facet.sources) {
          const s = indexOf.get(source);
          if (s !== undefined) addPartner(s, i);
        }
      } else if (facet.kind === 'splitInto') {
        for (const target of facet.targets) {
          const t = indexOf.get(target);
          if (t !== undefined) addPartner(t, i);
        }
      }
    }
  }
  partners.sort((a, b) => a.mover - b.mover || a.anchor - b.anchor);

  return { nodes, indexOf, pairs, offsets, adjacency, partners, changed };
}
