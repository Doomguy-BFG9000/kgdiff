/**
 * Rectangle-vs-rectangle collision over node + label boxes, accelerated with a quadtree.
 *
 * Every node owns one axis-aligned box (its circle plus the label block centered below it).
 * Overlapping pairs are separated along the axis of least penetration (the minimum translation
 * vector), shared in proportion to inverse mass so hubs and fixed nodes stay put. Wide label
 * boxes therefore slide sideways past each other while stacked nodes separate vertically.
 *
 * Box centers go into a d3 quadtree; every quadtree cell records the largest half extents below
 * it, so a query for box i only descends into cells whose content could reach it. Traversal uses
 * an explicit, reused stack (no per-cell allocation, unlike `quadtree.visit`).
 *
 * Two entry points share the pair search:
 *  - `collideVelocities`: a force acting on predicted positions (x + vx) during the simulation;
 *  - `removeOverlaps`: position-level passes after the simulation until no pair overlaps.
 */
import { type QuadtreeInternalNode, type QuadtreeLeaf, quadtree } from 'd3-quadtree';
import type { SimNode } from '../simulate.js';

export interface CollisionBoxes {
  /** Half extents of each node's box, by `SimNode.index`. */
  readonly halfWidth: Float64Array;
  readonly halfHeight: Float64Array;
  /** Box center minus node center (labels sit below, so usually positive). */
  readonly offsetY: Float64Array;
  /** 0 = immovable (fixed node). */
  readonly invMass: Float64Array;
}

/** Max half extents of the boxes stored below a quadtree cell. */
interface Extents {
  mw: number;
  mh: number;
}
type Leaf = QuadtreeLeaf<number> & Partial<Extents>;
type Cell = (QuadtreeInternalNode<number> | QuadtreeLeaf<number>) & Partial<Extents>;

const isLeaf = (cell: Cell): cell is Leaf => 'data' in cell;

/** Post-order: record max half extents on every cell. */
function prepare(cell: Cell, hw: Float64Array, hh: Float64Array): void {
  let mw = 0;
  let mh = 0;
  if (isLeaf(cell)) {
    let leaf: QuadtreeLeaf<number> | undefined = cell;
    while (leaf !== undefined) {
      mw = Math.max(mw, hw[leaf.data]!);
      mh = Math.max(mh, hh[leaf.data]!);
      leaf = leaf.next;
    }
  } else {
    for (let k = 0; k < 4; k++) {
      const child = cell[k] as Cell | undefined;
      if (child === undefined) continue;
      prepare(child, hw, hh);
      mw = Math.max(mw, child.mw ?? 0);
      mh = Math.max(mh, child.mh ?? 0);
    }
  }
  cell.mw = mw;
  cell.mh = mh;
}

/** A quadtree over box centers with per-cell max half extents (see `prepare`). */
interface BoxIndex {
  readonly root: Cell;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function buildIndex(
  indices: readonly number[],
  cx: Float64Array,
  cy: Float64Array,
  boxes: CollisionBoxes,
): BoxIndex | undefined {
  const tree = quadtree<number>()
    .x((i) => cx[i]!)
    .y((i) => cy[i]!)
    .addAll(indices as number[]);
  const root = tree.root() as Cell | undefined;
  const extent = tree.extent();
  if (root === undefined || extent === undefined) return undefined;
  prepare(root, boxes.halfWidth, boxes.halfHeight);
  return { root, x0: extent[0][0], y0: extent[0][1], x1: extent[1][0], y1: extent[1][1] };
}

/** Reused traversal stacks (no allocation per query). */
const cellStack: Cell[] = [];
const rectStack: number[] = [];

/**
 * Visit every pair (i, j) whose padded boxes overlap, each pair once. Box centers are the
 * current `cx`, `cy`; `index` may have been built from older centers, in which case `slack` must
 * bound how far any center has moved since (it widens the pruning test, so the search stays
 * exact). With `active`, only pairs with at least one active node are visited.
 */
function forEachOverlap(
  index: BoxIndex,
  n: number,
  cx: Float64Array,
  cy: Float64Array,
  boxes: CollisionBoxes,
  padding: number,
  slack: number,
  visit: (i: number, j: number, ox: number, oy: number, dx: number, dy: number) => void,
  active?: Uint8Array,
): void {
  const { halfWidth: hw, halfHeight: hh } = boxes;
  const cells = cellStack;
  const rect = rectStack;
  for (let i = 0; i < n; i++) {
    if (active !== undefined && !active[i]) continue;
    const xi = cx[i]!;
    const yi = cy[i]!;
    const hwi = hw[i]! + padding;
    const hhi = hh[i]! + padding;
    cells.push(index.root);
    rect.push(index.x0, index.y0, index.x1, index.y1);
    while (cells.length > 0) {
      const cell = cells.pop()!;
      const y1 = rect.pop()!;
      const x1 = rect.pop()!;
      const y0 = rect.pop()!;
      const x0 = rect.pop()!;
      if (isLeaf(cell)) {
        let leaf: QuadtreeLeaf<number> | undefined = cell;
        while (leaf !== undefined) {
          const j = leaf.data;
          leaf = leaf.next;
          // Each pair once: from its lower index, or from its only active member.
          if (j === i || (j < i && (active === undefined || active[j]))) continue;
          const dx = cx[j]! - xi;
          const ox = hwi + hw[j]! - Math.abs(dx);
          if (ox <= 0) continue;
          const dy = cy[j]! - yi;
          const oy = hhi + hh[j]! - Math.abs(dy);
          if (oy <= 0) continue;
          visit(i, j, ox, oy, dx, dy);
        }
        continue;
      }
      const rx = hwi + (cell.mw ?? 0) + slack;
      const ry = hhi + (cell.mh ?? 0) + slack;
      if (x0 > xi + rx || x1 < xi - rx || y0 > yi + ry || y1 < yi - ry) continue;
      const xm = (x0 + x1) / 2;
      const ym = (y0 + y1) / 2;
      const c0 = cell[0] as Cell | undefined;
      const c1 = cell[1] as Cell | undefined;
      const c2 = cell[2] as Cell | undefined;
      const c3 = cell[3] as Cell | undefined;
      if (c0 !== undefined) {
        cells.push(c0);
        rect.push(x0, y0, xm, ym);
      }
      if (c1 !== undefined) {
        cells.push(c1);
        rect.push(xm, y0, x1, ym);
      }
      if (c2 !== undefined) {
        cells.push(c2);
        rect.push(x0, ym, xm, y1);
      }
      if (c3 !== undefined) {
        cells.push(c3);
        rect.push(xm, ym, x1, y1);
      }
    }
  }
}

/** Reusable buffers for one node set. */
export interface CollisionScratch {
  readonly indices: readonly number[];
  readonly cx: Float64Array;
  readonly cy: Float64Array;
  readonly posX: Float64Array;
  readonly negX: Float64Array;
  readonly posY: Float64Array;
  readonly negY: Float64Array;
}

export function collisionScratch(n: number): CollisionScratch {
  return {
    indices: Array.from({ length: n }, (_, i) => i),
    cx: new Float64Array(n),
    cy: new Float64Array(n),
    posX: new Float64Array(n),
    negX: new Float64Array(n),
    posY: new Float64Array(n),
    negY: new Float64Array(n),
  };
}

/**
 * Collision as a simulation force: overlapping boxes (at predicted positions x + vx) get their
 * velocities pushed apart by `strength` × the penetration along the separating axis.
 */
export function collideVelocities(
  nodes: readonly SimNode[],
  boxes: CollisionBoxes,
  padding: number,
  strength: number,
  scratch: CollisionScratch = collisionScratch(nodes.length),
): void {
  const { cx, cy } = scratch;
  const { invMass, offsetY } = boxes;
  for (const node of nodes) {
    cx[node.index] = node.x + node.vx;
    cy[node.index] = node.y + node.vy + offsetY[node.index]!;
  }
  const index = buildIndex(scratch.indices, cx, cy, boxes);
  if (index === undefined) return;
  forEachOverlap(index, nodes.length, cx, cy, boxes, padding, 0, (i, j, ox, oy, dx, dy) => {
    const total = invMass[i]! + invMass[j]!;
    if (total === 0) return;
    const shareI = invMass[i]! / total;
    const shareJ = invMass[j]! / total;
    const a = nodes[i]!;
    const b = nodes[j]!;
    // Push along the axis of least penetration; coincident centers: i goes left / up.
    if (ox < oy) {
      const push = (dx < 0 ? -ox : ox) * strength;
      a.vx -= push * shareI;
      b.vx += push * shareJ;
    } else {
      const push = (dy < 0 ? -oy : oy) * strength;
      a.vy -= push * shareI;
      b.vy += push * shareJ;
    }
  });
}

export interface OverlapResult {
  readonly passes: number;
  /** 1 for nodes that took part in an overlap in the last pass. */
  readonly unresolved: Uint8Array;
}

/** Jacobi passes between two checks for a stalled jam. */
const STALL_WINDOW = 8;
/** Passes between two expansions while the jam is heavy. */
const HEAVY_WINDOW = 3;
/** Rebuild the quadtree once some node has drifted this far since the last build. */
const REBUILD_DRIFT = 8;

/**
 * Separate overlapping boxes by moving positions, pass after pass, until none overlap or
 * `maxPasses` is reached. Each pass is a Jacobi step: every node moves by its largest push in
 * each direction (not the sum, which would overshoot when several neighbours push the same way).
 * Only nodes that moved in the previous pass (or `active` ones, initially) are queried; the
 * quadtree is rebuilt only when some node has drifted more than a few units since the last build
 * (the query is widened by that drift), so late passes over a few stubborn pairs are cheap.
 *
 * Local pushes clear scattered overlaps in a few passes but diffuse slowly through a jam (a
 * crowded region that needs more area). When nothing is fixed and the overlap count stalls, the
 * layout is scaled up about its centroid (by 3–15%, more for heavier jams; every 3 passes by up
 * to 25% while more pairs than half the nodes overlap): uniform scaling keeps the picture and
 * frees room everywhere. With fixed nodes, overlaps may remain (a free node wedged between fixed
 * ones is left to the caller).
 *
 * Returns the passes used and the nodes still involved in an overlap (empty when all clear).
 */
export function removeOverlaps(
  nodes: readonly SimNode[],
  boxes: CollisionBoxes,
  padding: number,
  maxPasses: number,
  initiallyActive?: Uint8Array,
): OverlapResult {
  const n = nodes.length;
  const scratch = collisionScratch(n);
  const { cx, cy, posX, negX, posY, negY } = scratch;
  const { invMass, offsetY } = boxes;
  const expandable = invMass.every((m) => m > 0);
  let active: Uint8Array = initiallyActive ?? new Uint8Array(n).fill(1);
  let moved: Uint8Array = new Uint8Array(n);

  const drift = new Float64Array(n);
  let slack = 0;
  let index: BoxIndex | undefined;
  let lastCheck = Number.POSITIVE_INFINITY;
  // A hair more than the overlap, so rounding to 0.01 cannot leave boxes touching.
  const epsilon = 0.02;
  for (let pass = 0; pass < maxPasses; pass++) {
    for (const node of nodes) {
      cx[node.index] = node.x;
      cy[node.index] = node.y + offsetY[node.index]!;
    }
    if (index === undefined || slack > REBUILD_DRIFT) {
      index = buildIndex(scratch.indices, cx, cy, boxes);
      if (index === undefined) return { passes: pass, unresolved: new Uint8Array(n) };
      drift.fill(0);
      slack = 0;
    }
    posX.fill(0);
    negX.fill(0);
    posY.fill(0);
    negY.fill(0);
    let overlaps = 0;
    forEachOverlap(
      index,
      n,
      cx,
      cy,
      boxes,
      padding,
      slack,
      (i, j, ox, oy, dx, dy) => {
        const total = invMass[i]! + invMass[j]!;
        if (total === 0) return;
        overlaps++;
        const shareI = invMass[i]! / total;
        const shareJ = invMass[j]! / total;
        if (ox < oy) {
          const push = ox + epsilon;
          // j right of i (or coincident and i < j): i moves left, j moves right.
          const jRight = dx > 0 || (dx === 0 && i < j);
          const left = jRight ? i : j;
          const right = jRight ? j : i;
          negX[left] = Math.min(negX[left]!, -push * (left === i ? shareI : shareJ));
          posX[right] = Math.max(posX[right]!, push * (right === i ? shareI : shareJ));
        } else {
          const push = oy + epsilon;
          const jDown = dy > 0 || (dy === 0 && i < j);
          const up = jDown ? i : j;
          const down = jDown ? j : i;
          negY[up] = Math.min(negY[up]!, -push * (up === i ? shareI : shareJ));
          posY[down] = Math.max(posY[down]!, push * (down === i ? shareI : shareJ));
        }
      },
      active,
    );
    if (overlaps === 0) return { passes: pass, unresolved: new Uint8Array(n) };
    moved.fill(0);
    for (const node of nodes) {
      const k = node.index;
      // Pushes from opposite sides may cancel: the node is still involved, so it stays active.
      if (posX[k] !== 0 || negX[k] !== 0 || posY[k] !== 0 || negY[k] !== 0) {
        const mx = posX[k]! + negX[k]!;
        const my = posY[k]! + negY[k]!;
        node.x += mx;
        node.y += my;
        moved[k] = 1;
        const d = drift[k]! + Math.max(Math.abs(mx), Math.abs(my));
        drift[k] = d;
        if (d > slack) slack = d;
      }
    }
    [active, moved] = [moved, active];
    if (expandable && overlaps > n / 2 && (pass + 1) % HEAVY_WINDOW === 0) {
      // A heavy jam (more overlapping pairs than half the nodes): do not wait for a stall.
      expand(nodes, 1 + Math.min(0.25, (0.05 * overlaps) / n));
      active.fill(1);
      index = undefined;
      lastCheck = Number.POSITIVE_INFINITY;
    } else if ((pass + 1) % STALL_WINDOW === 0) {
      // A jam: local moves stopped making progress.
      if (expandable && overlaps > 0.7 * lastCheck) {
        expand(nodes, 1 + Math.min(0.15, Math.max(0.03, (0.05 * overlaps) / n)));
        active.fill(1);
        index = undefined;
      }
      lastCheck = overlaps;
    }
  }
  return { passes: maxPasses, unresolved: active };
}

function expand(nodes: readonly SimNode[], factor: number): void {
  let mx = 0;
  let my = 0;
  for (const node of nodes) {
    mx += node.x;
    my += node.y;
  }
  mx /= nodes.length;
  my /= nodes.length;
  for (const node of nodes) {
    node.x = mx + (node.x - mx) * factor;
    node.y = my + (node.y - my) * factor;
  }
}
