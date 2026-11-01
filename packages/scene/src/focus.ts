/**
 * Changes-only visibility (docs/algorithms.md §11).
 */
import { KgdiffError, type Locale } from '@kgdiff/core';
import type { CollapsedGroup, FocusState, Scene } from './types.js';

/** Undirected adjacency over every drawn form (after s–t and before sb–tb), CSR layout. */
interface Adjacency {
  readonly start: Int32Array;
  readonly list: Int32Array;
}

const adjacencyCache = new WeakMap<Scene, Adjacency>();

function adjacency(scene: Scene): Adjacency {
  const cached = adjacencyCache.get(scene);
  if (cached !== undefined) return cached;
  const N = scene.nodes.length;
  const deg = new Int32Array(N + 1);
  const pairs: number[] = [];
  const add = (a: number, b: number): void => {
    if (a === b) return;
    pairs.push(a, b);
    deg[a + 1] = (deg[a + 1] as number) + 1;
    deg[b + 1] = (deg[b + 1] as number) + 1;
  };
  for (const e of scene.edges) {
    add(e.s, e.t);
    if (e.sb !== e.s || e.tb !== e.t) add(e.sb, e.tb);
  }
  for (let i = 0; i < N; i++) deg[i + 1] = (deg[i + 1] as number) + (deg[i] as number);
  const fill = deg.slice(0, N);
  const list = new Int32Array(pairs.length);
  for (let k = 0; k < pairs.length; k += 2) {
    const a = pairs[k] as number;
    const b = pairs[k + 1] as number;
    list[fill[a] as number] = b;
    fill[a] = (fill[a] as number) + 1;
    list[fill[b] as number] = a;
    fill[b] = (fill[b] as number) + 1;
  }
  // Sorted neighbour lists make every traversal below independent of edge order.
  for (let i = 0; i < N; i++) list.subarray(deg[i] as number, deg[i + 1] as number).sort();
  const adj = { start: deg, list };
  adjacencyCache.set(scene, adj);
  return adj;
}

const numberFormats = new Map<Locale, Intl.NumberFormat>();

/** “+38 unchanged” / “+38 个未变节点”; “hidden” when the pill also hides changed nodes. */
export function pillLabel(count: number, unchangedOnly: boolean, locale: Locale): string {
  let nf = numberFormats.get(locale);
  if (nf === undefined) {
    nf = new Intl.NumberFormat(locale);
    numberFormats.set(locale, nf);
  }
  const n = nf.format(count);
  if (locale === 'zh-CN') return unchangedOnly ? `+${n} 个未变节点` : `+${n} 个隐藏节点`;
  return unchangedOnly ? `+${n} unchanged` : `+${n} hidden`;
}

/** World-unit distance of a pill that has no in-scene member from its node's boundary. */
const PILL_OFFSET = 28;

/** Default hub threshold, as in layout's `changes` scope (docs/algorithms.md §12). */
export const DEFAULT_HUB_DEGREE = 40;

/**
 * Changes-only visibility: every changed element plus context, with the same rule as the layout's
 * `changes` scope (docs/algorithms.md §12), so the changes-only view and a `changes` layout agree:
 *
 * - Changed nodes are visible (distance 0); both versions' endpoints of every changed edge are
 *   visible at distance 1 (needed to draw the edge), even with `hops: 0`.
 * - Context is a breadth-first search over both versions' edges from the changed nodes, `hops`
 *   deep (default 1; edge endpoints continue from hop 1), that never expands **from** a hub — a
 *   node whose degree (max over both versions) exceeds `hubDegree` (default 40; `Infinity`
 *   disables). A hub is shown when it is changed or reached; its skipped neighbours collapse.
 * - `expanded` nodes are added (not expanded from). With `hunk`, the hunk's nodes and edges are
 *   the changes.
 * - `context` marks visible nodes outside the change set (rendered quieter).
 * - Hidden nodes are grouped: next to a visible hub that was not expanded from (its skipped
 *   neighbours), else next to the lowest-index visible neighbour; nodes further out join the
 *   group of the frontier node that reaches them first (BFS through hidden nodes); hidden
 *   components touching nothing visible form one group each. Ids are stable across rebuilds:
 *   `near:<union id>` / `component:<smallest union id>`.
 * - `count` also includes neighbours left out of the layout (`SceneNode.hidden`, scope
 *   `changes`); `nodes` lists only in-scene members. A group with no in-scene member sits
 *   just outside its node, away from its visible neighbours.
 * - `label` is the localized pill text in `scene.locale` (“+38 unchanged”, “+38 个未变节点”;
 *   “hidden” instead of “unchanged” when a hunk-restricted focus hides changed nodes too).
 *
 * O(N + E).
 *
 * @throws KgdiffError(`invalid-input`) for a negative / non-finite `hops`, a negative / NaN
 *   `hubDegree` or an unknown hunk.
 */
export function computeFocus(
  scene: Scene,
  options: {
    readonly hops?: number;
    readonly hunk?: number;
    readonly expanded?: ReadonlySet<number>;
    readonly hubDegree?: number;
  } = {},
): FocusState {
  const hops = options.hops ?? 1;
  if (!(Number.isFinite(hops) && hops >= 0)) {
    throw new KgdiffError(
      'invalid-input',
      `computeFocus: hops must be a finite number ≥ 0, got ${hops}.`,
    );
  }
  const hubDegree = options.hubDegree ?? DEFAULT_HUB_DEGREE;
  if (!(hubDegree >= 0)) {
    throw new KgdiffError(
      'invalid-input',
      `computeFocus: hubDegree must be a number ≥ 0 (Infinity disables), got ${hubDegree}.`,
    );
  }
  const hunk = options.hunk;
  if (hunk !== undefined && !(Number.isInteger(hunk) && hunk >= 0 && hunk < scene.hunks.length)) {
    throw new KgdiffError(
      'invalid-input',
      `computeFocus: hunk ${hunk} is out of range [0, ${scene.hunks.length}).`,
    );
  }
  const N = scene.nodes.length;
  const M = scene.edges.length;
  const { start, list } = adjacency(scene);
  const visible = new Uint8Array(N);
  const primary = new Uint8Array(N);
  const dist = new Int32Array(N).fill(-1);
  const queue = new Int32Array(N);
  let qHead = 0;
  let qTail = 0;
  const reach = (i: number, d: number): void => {
    if (i < 0 || i >= N || dist[i] !== -1) return;
    dist[i] = d;
    visible[i] = 1;
    queue[qTail++] = i;
  };

  // Distance 0 first, then distance 1, so the FIFO queue stays ordered by distance.
  const changedEdges: number[] = [];
  if (hunk !== undefined) {
    const h = scene.hunks[hunk];
    for (const i of h?.nodes ?? []) {
      primary[i] = 1;
      reach(i, 0);
    }
    for (const j of h?.edges ?? []) changedEdges.push(j);
  } else {
    for (const n of scene.nodes) {
      if (n.status === 'unchanged') continue;
      primary[n.index] = 1;
      reach(n.index, 0);
    }
    for (const e of scene.edges) if (e.status !== 'unchanged') changedEdges.push(e.index);
  }
  for (const j of changedEdges) {
    const e = scene.edges[j];
    if (e === undefined) continue;
    reach(e.s, 1);
    reach(e.t, 1);
    reach(e.sb, 1);
    reach(e.tb, 1);
  }
  // Context: breadth-first within `hops`, never expanding from a hub.
  const maxHops = Math.floor(hops);
  const skippedHub = new Uint8Array(N);
  while (qHead < qTail) {
    const i = queue[qHead++] as number;
    const d = dist[i] as number;
    if (d >= maxHops) continue;
    if ((scene.nodes[i]?.degree ?? 0) > hubDegree) {
      skippedHub[i] = 1;
      continue;
    }
    for (let k = start[i] as number; k < (start[i + 1] as number); k++) {
      reach(list[k] as number, d + 1);
    }
  }
  for (const i of options.expanded ?? []) if (i >= 0 && i < N) visible[i] = 1;

  const context = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (visible[i] === 1 && primary[i] === 0) context[i] = 1;
  const edges = new Uint8Array(M);
  for (let j = 0; j < M; j++) {
    const e = scene.edges[j];
    if (e !== undefined && visible[e.s] === 1 && visible[e.t] === 1) edges[j] = 1;
  }
  return {
    nodes: visible,
    edges,
    context,
    collapsed: collapse(scene, visible, skippedHub, start, list),
  };
}

function collapse(
  scene: Scene,
  visible: Uint8Array,
  skippedHub: Uint8Array,
  start: Int32Array,
  list: Int32Array,
): CollapsedGroup[] {
  const N = scene.nodes.length;
  // owner[i] = the node whose group i joins: a visible frontier node, or a component root.
  const owner = new Int32Array(N).fill(-1);
  const queue = new Int32Array(N);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < N; i++) {
    if (visible[i] === 1) continue;
    // A hub that was not expanded from claims its skipped neighbours; else the lowest index.
    let first = -1;
    let hub = -1;
    for (let k = start[i] as number; k < (start[i + 1] as number); k++) {
      const n = list[k] as number;
      if (visible[n] !== 1) continue;
      if (first < 0) first = n;
      if (skippedHub[n] === 1) {
        hub = n;
        break;
      }
    }
    if (first >= 0) {
      owner[i] = hub >= 0 ? hub : first;
      queue[tail++] = i;
    }
  }
  const spread = (): void => {
    while (head < tail) {
      const i = queue[head++] as number;
      for (let k = start[i] as number; k < (start[i + 1] as number); k++) {
        const n = list[k] as number;
        if (visible[n] === 1 || owner[n] !== -1) continue;
        owner[n] = owner[i] as number;
        queue[tail++] = n;
      }
    }
  };
  spread();
  const isComponent = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (visible[i] === 1 || owner[i] !== -1) continue;
    owner[i] = i;
    isComponent[i] = 1;
    queue[tail++] = i;
    spread();
  }

  interface Acc {
    readonly owner: number;
    readonly members: number[];
    extra: number;
    changed: boolean;
    sx: number;
    sy: number;
  }
  const groups = new Map<number, Acc>();
  const acc = (o: number): Acc => {
    let g = groups.get(o);
    if (g === undefined) {
      g = { owner: o, members: [], extra: 0, changed: false, sx: 0, sy: 0 };
      groups.set(o, g);
    }
    return g;
  };
  for (let i = 0; i < N; i++) {
    if (visible[i] === 1) continue;
    const g = acc(owner[i] as number);
    const n = scene.nodes[i];
    g.members.push(i);
    if (n !== undefined && n.status !== 'unchanged') g.changed = true;
    g.sx += n?.x ?? 0;
    g.sy += n?.y ?? 0;
  }
  // Neighbours outside the layout belong behind the node that has them.
  for (const n of scene.nodes) {
    if (n.hidden <= 0) continue;
    acc(visible[n.index] === 1 ? n.index : (owner[n.index] as number)).extra += n.hidden;
  }

  const out: CollapsedGroup[] = [];
  for (const g of groups.values()) {
    const ownerNode = scene.nodes[g.owner];
    if (ownerNode === undefined) continue;
    const count = g.members.length + g.extra;
    if (count === 0) continue;
    let x: number;
    let y: number;
    if (g.members.length > 0) {
      x = g.sx / g.members.length;
      y = g.sy / g.members.length;
    } else {
      // Outside the node, away from the centroid of its visible neighbours.
      let mx = 0;
      let my = 0;
      let k0 = 0;
      for (let k = start[g.owner] as number; k < (start[g.owner + 1] as number); k++) {
        const n = scene.nodes[list[k] as number];
        if (n === undefined || visible[n.index] !== 1) continue;
        mx += n.x;
        my += n.y;
        k0++;
      }
      let dx = 0;
      let dy = -1;
      if (k0 > 0) {
        const vx = ownerNode.x - mx / k0;
        const vy = ownerNode.y - my / k0;
        const len = Math.hypot(vx, vy);
        if (len > 1e-9) {
          dx = vx / len;
          dy = vy / len;
        }
      }
      const d = ownerNode.r + PILL_OFFSET;
      x = ownerNode.x + dx * d;
      y = ownerNode.y + dy * d;
    }
    out.push({
      id: isComponent[g.owner] === 1 ? `component:${ownerNode.id}` : `near:${ownerNode.id}`,
      x,
      y,
      count,
      nodes: g.members,
      label: pillLabel(count, !g.changed, scene.locale),
    });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
