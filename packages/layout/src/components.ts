/**
 * Connected components over links AND merge / split partners (a merge source with no edges of
 * its own still belongs next to its target).
 */
import type { LayoutGraph } from './graph.js';

function find(parent: Int32Array, i: number): number {
  let root = i;
  while (parent[root]! !== root) root = parent[root]!;
  let cur = i;
  while (parent[cur]! !== root) {
    const next = parent[cur]!;
    parent[cur] = root;
    cur = next;
  }
  return root;
}

function union(parent: Int32Array, a: number, b: number): void {
  const ra = find(parent, a);
  const rb = find(parent, b);
  // Smaller index becomes the root: the result does not depend on edge order.
  if (ra < rb) parent[rb] = ra;
  else if (rb < ra) parent[ra] = rb;
}

/**
 * Components as ascending index lists, largest first (ties: smallest first index, i.e. id order).
 * `members` restricts the computation to a subset (others are ignored).
 */
export function connectedComponents(graph: LayoutGraph, members?: Uint8Array): number[][] {
  const { n } = graph;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const inSet = (i: number): boolean => members === undefined || members[i] === 1;
  for (let k = 0; k < graph.pairs.length; k += 2) {
    const a = graph.pairs[k]!;
    const b = graph.pairs[k + 1]!;
    if (inSet(a) && inSet(b)) union(parent, a, b);
  }
  for (const { mover, anchor } of graph.partners) {
    if (inSet(mover) && inSet(anchor)) union(parent, mover, anchor);
  }
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (!inSet(i)) continue;
    const root = find(parent, i);
    let list = byRoot.get(root);
    if (list === undefined) {
      list = [];
      byRoot.set(root, list);
    }
    list.push(i);
  }
  return [...byRoot.values()].sort((a, b) => b.length - a.length || a[0]! - b[0]!);
}
