/**
 * Final placement touches that look for free spots instead of pushing.
 *
 * - `dockPartners`: the weak partner springs (docs/algorithms.md §12) bring merge sources towards
 *   their target, but many-body repulsion and label boxes keep the pair roughly an edge length
 *   apart. For replay (sources travel into the target, split targets emerge from their source)
 *   and for reading the overlay (the ghost sits right next to what it became), a mover farther
 *   than `maxDistance` from its anchor moves to the best free spot around the anchor.
 * - `settleOverlapping`: around fixed nodes, a free node can end up wedged where pushing cannot
 *   free it. It moves to the free spot nearest to its neighbours instead.
 *
 * Both test candidate spots (16 directions × a few rings) against the boxes near the searched
 * area, collected once per node; they only run for the few nodes that need them.
 */
import type { SimNode } from '../simulate.js';
import type { CollisionBoxes } from './collide-rect.js';
import type { Spring } from './springs.js';

/** Unit vectors every 22.5°, starting straight down (below the anchor's label), exact literals. */
const C1 = 0.9238795325112867;
const S1 = 0.3826834323650898;
const D = Math.SQRT1_2;
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [S1, C1],
  [D, D],
  [C1, S1],
  [1, 0],
  [C1, -S1],
  [D, -D],
  [S1, -C1],
  [0, -1],
  [-S1, -C1],
  [-D, -D],
  [-C1, -S1],
  [-1, 0],
  [-C1, S1],
  [-D, D],
  [-S1, C1],
];
const DOCK_RINGS = [1, 1.35, 1.7, 2.1, 2.6];
/** Extra score (× maxDistance) charged to a spot that other nodes must vacate. */
const OCCUPIED_PENALTY = 0.4;
/** Square lattice rings searched around a wedged node (ring k at k × step from home). */
const SETTLE_RINGS = 32;

const distance = (ax: number, ay: number, bx: number, by: number): number =>
  Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));

/**
 * The nodes whose boxes could touch node `m`'s box anywhere within `radius` of (cx, cy): the
 * candidate search then only tests these (O(n) once per searched node, not per candidate).
 */
function nearby(
  nodes: readonly SimNode[],
  boxes: CollisionBoxes,
  padding: number,
  m: number,
  cx: number,
  cy: number,
  radius: number,
): SimNode[] {
  const { halfWidth: hw, halfHeight: hh, offsetY: oy } = boxes;
  const out: SimNode[] = [];
  for (const other of nodes) {
    const j = other.index;
    if (j === m) continue;
    if (Math.abs(other.x - cx) > radius + hw[m]! + hw[j]! + padding) continue;
    const dy = other.y + oy[j]! - (cy + oy[m]!);
    if (Math.abs(dy) > radius + hh[m]! + hh[j]! + padding) continue;
    out.push(other);
  }
  return out;
}

/**
 * True when node `m`'s padded box centered at (x, y) overlaps none of `others`' boxes, or (with
 * `blocking`) none for which `blocking(j)` holds.
 */
function isFree(
  others: readonly SimNode[],
  boxes: CollisionBoxes,
  padding: number,
  m: number,
  x: number,
  y: number,
  blocking?: (j: number) => boolean,
): boolean {
  const { halfWidth: hw, halfHeight: hh, offsetY: oy } = boxes;
  const cy = y + oy[m]!;
  for (const other of others) {
    const j = other.index;
    if (j === m || (blocking !== undefined && !blocking(j))) continue;
    if (Math.abs(other.x - x) >= hw[m]! + hw[j]! + padding) continue;
    if (Math.abs(other.y + oy[j]! - cy) >= hh[m]! + hh[j]! + padding) continue;
    return false;
  }
  return true;
}

/**
 * Dock merge sources / split targets (`mover`) farther than `maxDistance` from their partner.
 * Candidate spots touch the anchor's box in 16 directions, on 5 rings; the winner minimizes the
 * distance to the anchor plus 0.3 × the distance travelled (so the mover stays on the side its
 * edges come from). A spot occupied only by movable nodes competes with a penalty of
 * 0.4 × `maxDistance`; when it wins, the caller pushes those nodes aside (`removeOverlaps` with
 * docked pairs pinned). Only spots closer to the anchor than the mover's current position count.
 *
 * Returns the sim indices of docked movers and their anchors (to pin while making room).
 */
export function dockPartners(
  nodes: readonly SimNode[],
  springs: readonly Spring[],
  boxes: CollisionBoxes,
  padding: number,
  maxDistance: number,
): number[] {
  const { halfWidth: hw, halfHeight: hh, offsetY: oy, invMass } = boxes;
  const top = (i: number): number => oy[i]! - hh[i]!;
  const bottom = (i: number): number => oy[i]! + hh[i]!;
  const gap = padding + 0.05;
  const pinned = new Set<number>();
  const immovable = (j: number): boolean => invMass[j] === 0 || pinned.has(j);

  for (const { mover, anchor } of springs) {
    const m = nodes[mover];
    const a = nodes[anchor];
    if (m === undefined || a === undefined || immovable(mover)) continue;
    const current = distance(m.x, m.y, a.x, a.y);
    if (current <= maxDistance) continue;

    const reachX = (hw[anchor]! + hw[mover]! + gap) * DOCK_RINGS[DOCK_RINGS.length - 1]!;
    const reachY =
      (Math.max(bottom(anchor) - top(mover), bottom(mover) - top(anchor)) + gap) *
      DOCK_RINGS[DOCK_RINGS.length - 1]!;
    const others = nearby(nodes, boxes, padding, mover, a.x, a.y, Math.max(reachX, reachY));
    let free: { x: number; y: number; score: number } | undefined;
    let occupied: { x: number; y: number; score: number } | undefined;
    for (const ring of DOCK_RINGS) {
      for (const [ux, uy] of DIRECTIONS) {
        const tx =
          ux === 0 ? Number.POSITIVE_INFINITY : (hw[anchor]! + hw[mover]! + gap) / Math.abs(ux);
        const ty =
          uy === 0
            ? Number.POSITIVE_INFINITY
            : uy > 0
              ? (bottom(anchor) + gap - top(mover)) / uy
              : (bottom(mover) + gap - top(anchor)) / -uy;
        const t = Math.min(tx, ty) * ring;
        const x = a.x + ux * t;
        const y = a.y + uy * t;
        const toAnchor = distance(x, y, a.x, a.y);
        if (toAnchor >= current) continue;
        const score = toAnchor + 0.3 * distance(x, y, m.x, m.y);
        if (isFree(others, boxes, padding, mover, x, y)) {
          if (free === undefined || score < free.score - 1e-9) free = { x, y, score };
        } else if (
          (occupied === undefined || score < occupied.score - 1e-9) &&
          isFree(others, boxes, padding, mover, x, y, immovable)
        ) {
          occupied = { x, y, score };
        }
      }
    }
    // An occupied spot must be clearly better to be worth pushing the neighbours aside.
    const penalty = OCCUPIED_PENALTY * maxDistance;
    const best =
      occupied !== undefined && (free === undefined || occupied.score + penalty < free.score)
        ? occupied
        : free;
    if (best !== undefined) {
      m.x = best.x;
      m.y = best.y;
      m.vx = 0;
      m.vy = 0;
      pinned.add(mover);
      pinned.add(anchor);
    }
  }
  return [...pinned].sort((p, q) => p - q);
}

/**
 * Move every movable node whose box still overlaps another to the free spot nearest to `home(k)`
 * (its neighbours' barycenter). Candidates lie on square rings of a lattice around home (spacing
 * ≈ the node's box height, so gaps between neighbours are found at any radius; exact arithmetic
 * only); the first ring with a free spot wins, and on it the spot closest to home. Nodes are
 * processed in index order.
 */
export function settleOverlapping(
  nodes: readonly SimNode[],
  boxes: CollisionBoxes,
  padding: number,
  home: (index: number) => { readonly x: number; readonly y: number },
): void {
  const { halfHeight: hh, invMass } = boxes;
  for (const node of nodes) {
    const k = node.index;
    if (invMass[k] === 0) continue;
    if (
      isFree(nearby(nodes, boxes, padding, k, node.x, node.y, 0), boxes, padding, k, node.x, node.y)
    ) {
      continue;
    }
    const center = home(k);
    const step = Math.max(12, hh[k]! + padding);
    // Nearby nodes for the next 8 rings at a time, so the search stays local.
    let others: SimNode[] = [];
    for (let ring = 1; ring <= SETTLE_RINGS; ring++) {
      if ((ring - 1) % 8 === 0) {
        others = nearby(
          nodes,
          boxes,
          padding,
          k,
          center.x,
          center.y,
          step * (ring + 7) * Math.SQRT2,
        );
      }
      let best: { x: number; y: number; d: number } | undefined;
      const consider = (x: number, y: number): void => {
        const d = distance(x, y, center.x, center.y);
        if (best !== undefined && d >= best.d - 1e-9) return;
        if (isFree(others, boxes, padding, k, x, y)) best = { x, y, d };
      };
      const r = ring * step;
      for (let i = -ring; i <= ring; i++) {
        consider(center.x + i * step, center.y - r);
        consider(center.x + i * step, center.y + r);
      }
      for (let j = 1 - ring; j < ring; j++) {
        consider(center.x - r, center.y + j * step);
        consider(center.x + r, center.y + j * step);
      }
      if (best !== undefined) {
        node.x = best.x;
        node.y = best.y;
        break;
      }
    }
  }
}
