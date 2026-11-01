/**
 * Hunk dependencies and the default review order (docs/algorithms.md §7).
 *
 * Every delta op reads and writes a few resources — a node id (`n`), the edges incident to a
 * node (`i`), an edge identity (`e`). Walking the ops in delta order, an op depends on the
 * last writer of every resource it reads, and a writer also on the readers since that write
 * (read-after-write, write-after-write, write-after-read). Edge removals at one node commute,
 * so `i` only orders a node's removal after the removals of its edges. Lifted to hunks, these give
 * `Hunk.requires`: the hunks whose ops must be applied (or played) first. Any order that
 * respects `requires` applies hunk by hunk, strictly, and ends at the after graph.
 *
 * Dependency cycles between hunks (rare: they need two restructurings that feed each other)
 * are resolved by merging the hunks of the cycle into one.
 */
import { tripleKey } from './canonical.js';
import type { HunkWithoutOps } from './hunks.js';
import type { EdgeRecord, NodeRecord } from './model.js';
import { FACET_ORDER } from './model.js';
import type {
  DeltaOp,
  EdgeIdentity,
  EdgeJSON,
  FacetKind,
  Hunk,
  ReplayPhase,
  UnionId,
} from './types.js';
import { compareStrings, getOrCreate, pushTo } from './util.js';

const PHASE_RANK: Readonly<Record<ReplayPhase, number>> = {
  remove: 0,
  restructure: 1,
  modify: 2,
  add: 3,
};

function edgeResource(edge: EdgeJSON, mode: EdgeIdentity): string {
  return mode === 'id' && edge.id !== undefined
    ? `ei${edge.id}`
    : `et${tripleKey(edge.source, edge.predicate ?? '', edge.target)}`;
}

/** Resources an op reads and writes (docs/delta-format.md preconditions and effects). */
function access(op: DeltaOp, mode: EdgeIdentity): { reads: string[]; writes: string[] } {
  switch (op.op) {
    case 'node.rekey':
      return { reads: [`n${op.from}`, `n${op.to}`], writes: [`n${op.from}`, `n${op.to}`] };
    case 'node.remove':
      return { reads: [`n${op.node.id}`, `i${op.node.id}`], writes: [`n${op.node.id}`] };
    case 'node.add':
      return { reads: [`n${op.node.id}`], writes: [`n${op.node.id}`] };
    case 'node.set':
    case 'node.attr':
      return { reads: [`n${op.id}`], writes: [] };
    case 'edge.remove': {
      const e = edgeResource(op.edge, mode);
      return {
        reads: [`n${op.edge.source}`, `n${op.edge.target}`, e],
        writes: [e, `i${op.edge.source}`, `i${op.edge.target}`],
      };
    }
    case 'edge.add': {
      const e = edgeResource(op.edge, mode);
      return { reads: [`n${op.edge.source}`, `n${op.edge.target}`, e], writes: [e] };
    }
    case 'edge.set':
    case 'edge.attr':
      return {
        reads: [`n${op.edge.source}`, `n${op.edge.target}`, edgeResource(op.edge, mode)],
        writes: [],
      };
    default: {
      const unknown: never = op;
      return unknown;
    }
  }
}

/** `hunk → hunks it requires`, from the op-level dependencies. */
function dependencies(
  ops: readonly DeltaOp[],
  opHunks: readonly (string | undefined)[],
  mode: EdgeIdentity,
): Map<string, Set<string>> {
  const requires = new Map<string, Set<string>>();
  const lastWriter = new Map<string, string | undefined>();
  const readers = new Map<string, Set<string>>();
  /** Edge removals at a node commute with each other; only removing the node waits for them. */
  const removals = new Map<string, Set<string>>();
  const need = (hunk: string | undefined, on: string | undefined): void => {
    if (hunk !== undefined && on !== undefined && on !== hunk) {
      getOrCreate(requires, hunk, () => new Set<string>()).add(on);
    }
  };
  ops.forEach((op, i) => {
    const hunk = opHunks[i];
    const { reads, writes } = access(op, mode);
    for (const r of reads) {
      if (r.charCodeAt(0) === 0x69) {
        // 'i': the node must have lost all its edges.
        for (const h of removals.get(r) ?? []) need(hunk, h);
        continue;
      }
      need(hunk, lastWriter.get(r));
      if (hunk !== undefined) getOrCreate(readers, r, () => new Set<string>()).add(hunk);
    }
    for (const w of writes) {
      if (w.charCodeAt(0) === 0x69) {
        if (hunk !== undefined) getOrCreate(removals, w, () => new Set<string>()).add(hunk);
        continue;
      }
      need(hunk, lastWriter.get(w));
      for (const reader of readers.get(w) ?? []) need(hunk, reader);
      readers.delete(w);
      lastWriter.set(w, hunk);
    }
  });
  return requires;
}

/** Strongly connected components (Tarjan, iterative), visiting ids in sorted order. */
function components(
  ids: readonly string[],
  edges: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;
  for (const root of ids) {
    if (index.has(root)) continue;
    const work: { id: string; next: string[]; at: number }[] = [];
    const enter = (id: string): void => {
      index.set(id, counter);
      low.set(id, counter);
      counter++;
      stack.push(id);
      onStack.add(id);
      work.push({ id, next: [...(edges.get(id) ?? [])].sort(), at: 0 });
    };
    enter(root);
    while (work.length) {
      const frame = work[work.length - 1] as { id: string; next: string[]; at: number };
      if (frame.at < frame.next.length) {
        const w = frame.next[frame.at++] as string;
        if (!index.has(w)) enter(w);
        else if (onStack.has(w))
          low.set(frame.id, Math.min(low.get(frame.id) as number, index.get(w) as number));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent)
        low.set(parent.id, Math.min(low.get(parent.id) as number, low.get(frame.id) as number));
      if (low.get(frame.id) === index.get(frame.id)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop() as string;
          onStack.delete(w);
          component.push(w);
        } while (w !== frame.id);
        result.push(component);
      }
    }
  }
  return result;
}

/** A binary min-heap. */
class Heap<T> {
  private readonly items: T[] = [];

  constructor(private readonly less: (a: T, b: T) => boolean) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    const items = this.items;
    items.push(item);
    for (let i = items.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (!this.less(items[i] as T, items[parent] as T)) break;
      [items[i], items[parent]] = [items[parent] as T, items[i] as T];
      i = parent;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last !== undefined) {
      items[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(items[l] as T, items[m] as T)) m = l;
        if (r < items.length && this.less(items[r] as T, items[m] as T)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m] as T, items[i] as T];
        i = m;
      }
    }
    return top;
  }
}

interface Ordering {
  /** Final hunks, sorted by `order`. */
  readonly hunks: Hunk[];
  /** Hunk id per op (updated when hunks were merged). */
  readonly opHunks: (string | undefined)[];
}

/**
 * Computes `requires`, merges dependency cycles and assigns `order`: a topological order of
 * `requires` that, among the hunks ready at each step, prefers the earlier phase, then the
 * larger hunk, then the anchor label, then the id. Updates `hunk` on merged records.
 */
export function orderHunks(
  drafts: readonly HunkWithoutOps[],
  ops: readonly DeltaOp[],
  opHunks: readonly (string | undefined)[],
  mode: EdgeIdentity,
  nodes: readonly NodeRecord[],
  edges: readonly EdgeRecord[],
): Ordering {
  const byId = new Map(drafts.map((h) => [h.id, h]));
  const labelOf = new Map<UnionId, string>();
  for (const n of nodes) labelOf.set(n.id, n.after?.label ?? n.before?.label ?? n.id);
  const size = (h: HunkWithoutOps): number => h.nodes.length + h.edges.length;
  const rank = (x: HunkWithoutOps, y: HunkWithoutOps): number =>
    PHASE_RANK[x.phase] - PHASE_RANK[y.phase] ||
    size(y) - size(x) ||
    compareStrings(labelOf.get(x.anchor) ?? x.anchor, labelOf.get(y.anchor) ?? y.anchor) ||
    compareStrings(x.id, y.id);

  // Merge dependency cycles into their best-ranked member.
  let requires = dependencies(ops, opHunks, mode);
  const ids = drafts.map((h) => h.id).sort();
  const into = new Map<string, string>();
  for (const component of components(ids, requires)) {
    if (component.length < 2) continue;
    const members = component.map((id) => byId.get(id) as HunkWithoutOps).sort(rank);
    const keep = (members[0] as HunkWithoutOps).id;
    for (const m of members) into.set(m.id, keep);
  }
  let hunks: HunkWithoutOps[] = [...drafts];
  let finalOpHunks = [...opHunks];
  if (into.size > 0) {
    hunks = mergeHunks(drafts, into, nodes, edges);
    finalOpHunks = opHunks.map((h) => (h === undefined ? h : (into.get(h) ?? h)));
    const merged = new Map<string, Set<string>>();
    for (const [h, deps] of requires) {
      const from = into.get(h) ?? h;
      for (const d of deps) {
        const to = into.get(d) ?? d;
        if (to !== from) getOrCreate(merged, from, () => new Set<string>()).add(to);
      }
    }
    requires = merged;
  }

  // Kahn's algorithm, ready hunks taken by rank.
  const blockers = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const h of hunks) {
    const deps = requires.get(h.id) ?? new Set<string>();
    blockers.set(h.id, deps.size);
    for (const d of deps) pushTo(dependents, d, h.id);
  }
  const final = new Map(hunks.map((h) => [h.id, h]));
  const ready = new Heap<HunkWithoutOps>((x, y) => rank(x, y) < 0);
  for (const h of hunks) if (blockers.get(h.id) === 0) ready.push(h);
  const opsByHunk = new Map<string, number[]>();
  finalOpHunks.forEach((h, i) => {
    if (h !== undefined) pushTo(opsByHunk, h, i);
  });
  const ordered: Hunk[] = [];
  while (ready.size) {
    const h = ready.pop() as HunkWithoutOps;
    ordered.push({
      id: h.id,
      kind: h.kind,
      phase: h.phase,
      anchor: h.anchor,
      nodes: h.nodes,
      edges: h.edges,
      context: h.context,
      ops: opsByHunk.get(h.id) ?? [],
      requires: [...(requires.get(h.id) ?? [])].sort(),
      summary: h.summary,
      order: ordered.length,
    });
    for (const next of dependents.get(h.id) ?? []) {
      const left = (blockers.get(next) as number) - 1;
      blockers.set(next, left);
      if (left === 0) ready.push(final.get(next) as HunkWithoutOps);
    }
  }
  return { hunks: ordered, opHunks: finalOpHunks };
}

/** Merges hunks per `into` (member → kept hunk), keeping the kept hunk's identity. */
function mergeHunks(
  drafts: readonly HunkWithoutOps[],
  into: ReadonlyMap<string, string>,
  nodes: readonly NodeRecord[],
  edges: readonly EdgeRecord[],
): HunkWithoutOps[] {
  const groups = new Map<string, HunkWithoutOps[]>();
  for (const h of drafts) pushTo(groups, into.get(h.id) ?? h.id, h);
  for (const n of nodes) if (n.hunk !== undefined && into.has(n.hunk)) n.hunk = into.get(n.hunk);
  for (const e of edges) if (e.hunk !== undefined && into.has(e.hunk)) e.hunk = into.get(e.hunk);
  const result: HunkWithoutOps[] = [];
  for (const [keep, members] of groups) {
    const head = members.find((m) => m.id === keep) as HunkWithoutOps;
    if (members.length === 1) {
      result.push(head);
      continue;
    }
    const owned = new Set(members.flatMap((m) => m.nodes));
    const rest = [...owned].filter((id) => id !== head.anchor).sort();
    const memberNodes = owned.has(head.anchor) ? [head.anchor, ...rest] : rest;
    const memberEdges = [...new Set(members.flatMap((m) => m.edges))].sort();
    const context = [...new Set(members.flatMap((m) => m.context))]
      .filter((id) => !owned.has(id))
      .sort();
    const kinds = new Set<FacetKind>(members.flatMap((m) => m.summary.facets));
    const sum = (pick: (m: HunkWithoutOps) => number): number =>
      members.reduce((total, m) => total + pick(m), 0);
    result.push({
      ...head,
      nodes: memberNodes,
      edges: memberEdges,
      context,
      summary: {
        nodes: {
          added: sum((m) => m.summary.nodes.added),
          removed: sum((m) => m.summary.nodes.removed),
          modified: sum((m) => m.summary.nodes.modified),
        },
        edges: {
          added: sum((m) => m.summary.edges.added),
          removed: sum((m) => m.summary.edges.removed),
          modified: sum((m) => m.summary.edges.modified),
        },
        facets: FACET_ORDER.filter((k) => kinds.has(k)),
      },
    });
  }
  return result;
}
