/**
 * Frame-to-frame patches. G6's `setData` re-reads and compares the whole graph and merges full
 * styles into every changed element; sending G6 only what changed — new elements, removed ids,
 * and for updated elements just the changed style keys — keeps its data layer proportional to
 * the change. Pure.
 */
import type { EdgeData, ID, NodeData } from '@antv/g6';

export type Datum = NodeData | EdgeData;

export interface Patch {
  readonly add: { nodes: NodeData[]; edges: EdgeData[] };
  /** Partial data: `id` (edges also `source` / `target`), the changed style keys, changed `data`. */
  readonly update: { nodes: NodeData[]; edges: EdgeData[] };
  readonly remove: { nodes: ID[]; edges: ID[] };
  /**
   * Elements whose id switched between node and edge (only possible through id collisions):
   * added after `remove`, since G6 rejects a duplicate id.
   */
  readonly readd: { nodes: NodeData[]; edges: EdgeData[] };
  /** Number of elements added, updated, removed or re-added. */
  readonly size: number;
}

/** Structural equality for style values (primitives, arrays, plain objects such as badges). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return ka.every((k) => deepEqual(ra[k], rb[k]));
}

/** Keys of `next` whose values differ from `prev` (structurally), or null when none do. */
function changedKeys(
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (next === undefined) return null;
  let out: Record<string, unknown> | null = null;
  for (const key of Object.keys(next)) {
    const value = next[key];
    const old = prev?.[key];
    if (old === value || (typeof value === 'object' && deepEqual(old, value))) continue;
    if (out === null) out = {};
    out[key] = value;
  }
  return out;
}

function shallowEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/**
 * The patch turning `prev` (by id) into `next`. Edge updates always carry `zIndex`: without a
 * numeric one, G6's `updateData` recomputes an edge's zIndex from its endpoints. O(elements ×
 * style keys).
 */
export function diffData(
  prev: ReadonlyMap<ID, Datum>,
  next: { readonly nodes: readonly NodeData[]; readonly edges: readonly EdgeData[] },
): Patch {
  const add: Patch['add'] = { nodes: [], edges: [] };
  const update: Patch['update'] = { nodes: [], edges: [] };
  const remove: Patch['remove'] = { nodes: [], edges: [] };
  const readd: Patch['readd'] = { nodes: [], edges: [] };
  const seen = new Set<ID>();
  for (const node of next.nodes) {
    const old = prev.get(node.id);
    if (old === undefined || 'source' in old) {
      if (old === undefined) add.nodes.push(node);
      else readd.nodes.push(node);
      continue;
    }
    seen.add(node.id);
    const style = changedKeys(old.style, node.style);
    const dataChanged = !shallowEqual(old.data, node.data);
    const typeChanged = old.type !== node.type;
    if (style === null && !dataChanged && !typeChanged) continue;
    const patch: NodeData = { id: node.id };
    if (style !== null) patch.style = style;
    if (dataChanged) patch.data = node.data;
    if (typeChanged) patch.type = node.type;
    update.nodes.push(patch);
  }
  for (const edge of next.edges) {
    const id = edge.id as ID;
    const old = prev.get(id);
    if (old === undefined || !('source' in old)) {
      if (old === undefined) add.edges.push(edge);
      else readd.edges.push(edge);
      continue;
    }
    seen.add(id);
    const style = changedKeys(old.style, edge.style);
    const dataChanged = !shallowEqual(old.data, edge.data);
    const typeChanged = old.type !== edge.type;
    const endsChanged = old.source !== edge.source || old.target !== edge.target;
    if (style === null && !dataChanged && !typeChanged && !endsChanged) continue;
    const patch: EdgeData = { id, source: edge.source, target: edge.target };
    patch.style = { ...style, zIndex: edge.style?.zIndex };
    if (dataChanged) patch.data = edge.data;
    if (typeChanged) patch.type = edge.type;
    update.edges.push(patch);
  }
  for (const [id, old] of prev) {
    // Kept elements were marked seen; added ones were not in `prev` at all.
    if (seen.has(id)) continue;
    if ('source' in old) remove.edges.push(id);
    else remove.nodes.push(id);
  }
  const size =
    add.nodes.length +
    add.edges.length +
    update.nodes.length +
    update.edges.length +
    remove.nodes.length +
    remove.edges.length +
    readd.nodes.length +
    readd.edges.length;
  return { add, update, remove, readd, size };
}
