/**
 * Deterministic initial placement (docs/algorithms.md §12 "Simulation").
 *
 * Fresh components start on a phyllotaxis (sunflower) spiral filled in BFS order from the
 * highest-degree node, so graph distance ≈ radial distance and the simulation never starts from
 * a hairball. Each BFS layer occupies a contiguous run of spiral slots; within that annulus the
 * nodes are assigned to slots by angle, aligned with the angle of their BFS parent, so subtrees
 * start in the same sector as their parent and parent–child links start out short and uncrossed.
 *
 * Nodes added around fixed ones start at the barycenter of their placed neighbours (or next to
 * their merge / split partner), and a lone new leaf sprouts on the open side of its neighbour.
 */
import type { LayoutGraph } from './graph.js';
import { pseudoAngle, pseudoAngleDistance } from './math.js';
import { nodeRandom, type Random, randomDirection } from './prng.js';

/** Golden angle π(3 − √5) as exact literals: the spiral is built by rotation, without trig. */
const COS_GOLDEN = -0.7373688780783197;
const SIN_GOLDEN = 0.6754902942615238;
/** Offsets tried when aligning a BFS layer with its parents (more are sampled with a stride). */
const MAX_ALIGN_OFFSETS = 48;

/** Merge / split partners of every node, both directions, ascending. */
export function partnerLists(graph: LayoutGraph): readonly (readonly number[])[] {
  const lists: number[][] = Array.from({ length: graph.n }, () => []);
  for (const { mover, anchor } of graph.partners) {
    lists[mover]!.push(anchor);
    lists[anchor]!.push(mover);
  }
  for (const list of lists) list.sort((a, b) => a - b);
  return lists;
}

function forEachNeighbour(
  graph: LayoutGraph,
  partners: readonly (readonly number[])[],
  u: number,
  visit: (v: number) => void,
): void {
  for (let k = graph.offsets[u]!; k < graph.offsets[u + 1]!; k++) visit(graph.adjacency[k]!);
  for (const v of partners[u]!) visit(v);
}

/**
 * Place one component (ascending indices) on a seeded, BFS-ordered phyllotaxis spiral around the
 * origin. `visited` is shared across components (they are disjoint).
 */
export function placeOnSpiral(
  graph: LayoutGraph,
  partners: readonly (readonly number[])[],
  members: readonly number[],
  spacing: number,
  random: Random,
  visited: Uint8Array,
  x: Float64Array,
  y: Float64Array,
): void {
  let root = members[0];
  if (root === undefined) return;
  for (const m of members) if (graph.degree[m]! > graph.degree[root]!) root = m;

  // The whole spiral is rotated by a seeded angle and each slot jittered a little, so different
  // seeds give different (equally good) layouts.
  const phase = randomDirection(random);
  let c = phase.x;
  let s = phase.y;
  const jitter = spacing * 0.3;
  let slot = 1;

  visited[root] = 1;
  x[root] = 0;
  y[root] = 0;
  let layer = [root];

  while (layer.length > 0) {
    const next: number[] = [];
    const parentAngle: number[] = [];
    for (const u of layer) {
      const children: number[] = [];
      forEachNeighbour(graph, partners, u, (v) => {
        if (!visited[v]) {
          visited[v] = 1;
          children.push(v);
        }
      });
      children.sort((a, b) => graph.degree[b]! - graph.degree[a]! || a - b);
      const angle = pseudoAngle(x[u]!, y[u]!);
      for (const v of children) {
        next.push(v);
        parentAngle.push(angle);
      }
    }
    if (next.length === 0) break;

    const slots: { x: number; y: number; angle: number }[] = [];
    for (let j = 0; j < next.length; j++, slot++) {
      const r = spacing * Math.sqrt(slot);
      slots.push({ x: r * c, y: r * s, angle: pseudoAngle(c, s) });
      const cr = c * COS_GOLDEN - s * SIN_GOLDEN;
      s = c * SIN_GOLDEN + s * COS_GOLDEN;
      c = cr;
    }
    slots.sort((a, b) => a.angle - b.angle);

    const count = next.length;
    const stride = Math.max(1, Math.ceil(count / MAX_ALIGN_OFFSETS));
    let bestOffset = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let o = 0; o < count; o += stride) {
      let cost = 0;
      for (let i = 0; i < count; i++) {
        cost += pseudoAngleDistance(parentAngle[i]!, slots[(i + o) % count]!.angle);
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestOffset = o;
      }
    }
    for (let i = 0; i < count; i++) {
      const v = next[i]!;
      const target = slots[(i + bestOffset) % count]!;
      x[v] = target.x + (random() - 0.5) * jitter;
      y[v] = target.y + (random() - 0.5) * jitter;
    }

    layer = next
      .map((v) => ({ v, angle: pseudoAngle(x[v]!, y[v]!) }))
      .sort((a, b) => a.angle - b.angle || a.v - b.v)
      .map((e) => e.v);
  }
}

/**
 * Give every unplaced node of `members` that is connected to a placed one a start position,
 * layer by layer outwards from the placed set. Within a layer, positions depend only on earlier
 * layers and on the node's own id, never on processing order.
 */
export function placeAroundFixed(
  graph: LayoutGraph,
  partners: readonly (readonly number[])[],
  members: readonly number[],
  placed: Uint8Array,
  x: Float64Array,
  y: Float64Array,
  linkDistance: number,
  seed: number,
): void {
  const hasPlacedNeighbour = (u: number): boolean => {
    let found = false;
    forEachNeighbour(graph, partners, u, (v) => {
      if (placed[v]) found = true;
    });
    return found;
  };
  let layer = members.filter((u) => !placed[u] && hasPlacedNeighbour(u));

  while (layer.length > 0) {
    const starts = layer.map((u) =>
      startNear(graph, partners, u, placed, x, y, linkDistance, seed),
    );
    const queued = new Set<number>();
    for (let i = 0; i < layer.length; i++) {
      const u = layer[i]!;
      const p = starts[i]!;
      x[u] = p.x;
      y[u] = p.y;
      placed[u] = 1;
    }
    for (const u of layer) {
      forEachNeighbour(graph, partners, u, (v) => {
        if (!placed[v]) queued.add(v);
      });
    }
    layer = [...queued].sort((a, b) => a - b);
  }
}

function startNear(
  graph: LayoutGraph,
  partners: readonly (readonly number[])[],
  u: number,
  placed: Uint8Array,
  x: Float64Array,
  y: Float64Array,
  linkDistance: number,
  seed: number,
): { x: number; y: number } {
  const random = nodeRandom(seed, graph.nodes[u]!.id);
  const centroid = (list: readonly number[]): { x: number; y: number } => {
    let sx = 0;
    let sy = 0;
    for (const v of list) {
      sx += x[v]!;
      sy += y[v]!;
    }
    return { x: sx / list.length, y: sy / list.length };
  };

  const placedPartners = partners[u]!.filter((v) => placed[v]);
  if (placedPartners.length > 0) {
    const base = centroid(placedPartners);
    const dir = randomDirection(random);
    return { x: base.x + dir.x * linkDistance * 0.5, y: base.y + dir.y * linkDistance * 0.5 };
  }

  const neighbours: number[] = [];
  for (let k = graph.offsets[u]!; k < graph.offsets[u + 1]!; k++) {
    const v = graph.adjacency[k]!;
    if (placed[v]) neighbours.push(v);
  }
  if (neighbours.length >= 2) {
    const base = centroid(neighbours);
    const dir = randomDirection(random);
    return { x: base.x + dir.x * linkDistance * 0.25, y: base.y + dir.y * linkDistance * 0.25 };
  }

  // A single placed neighbour p: sprout on p's open side (away from p's other placed
  // neighbours), turned by up to ±55° so siblings fan out.
  const p = neighbours[0]!;
  const others: number[] = [];
  for (let k = graph.offsets[p]!; k < graph.offsets[p + 1]!; k++) {
    const v = graph.adjacency[k]!;
    if (v !== u && placed[v]) others.push(v);
  }
  let ax = 0;
  let ay = 0;
  if (others.length > 0) {
    const o = centroid(others);
    ax = x[p]! - o.x;
    ay = y[p]! - o.y;
  }
  const len = Math.sqrt(ax * ax + ay * ay);
  if (len < 1e-9) {
    const dir = randomDirection(random);
    ax = dir.x;
    ay = dir.y;
  } else {
    ax /= len;
    ay /= len;
  }
  const sin = (random() * 2 - 1) * 0.82;
  const cos = Math.sqrt(1 - sin * sin);
  const dx = ax * cos - ay * sin;
  const dy = ax * sin + ay * cos;
  return { x: x[p]! + dx * linkDistance, y: y[p]! + dy * linkDistance };
}
