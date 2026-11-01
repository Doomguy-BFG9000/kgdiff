/**
 * The force simulation. d3-force supplies the link and many-body (Barnes–Hut) forces; the tick
 * loop is our own so that it is synchronous and timer-free (no d3-timer, safe in workers and
 * Node), runs a fixed number of ticks (no time-based termination) and can change forces between
 * phases:
 *
 *  1. structure (first ~35% of ticks): links + charge + node-only collision. The graph unfolds
 *     without label boxes jamming it.
 *  2. orientation (union layouts): the component is rotated onto its principal axis (wide
 *     layouts suit screens and horizontal labels) and mirrored to a canonical handedness; if its
 *     label boxes could not fit in its current extent, it is scaled up once (`makeRoom`).
 *  3. labels: label boxes are inflated from 50% to 100% over ~25% of the ticks, then held.
 *     Collision is not scaled by alpha: it keeps working while the other forces cool down.
 *  4. a position-level pass removes any overlap that is left, and merge / split partners that
 *     ended up far apart are docked next to each other.
 */
import {
  forceLink,
  forceManyBody,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import {
  type CollisionBoxes,
  collideVelocities,
  collisionScratch,
  removeOverlaps,
} from './forces/collide-rect.js';
import { dockPartners } from './forces/free-spot.js';
import { applyGravity, applySprings, type Spring } from './forces/springs.js';
import { coolingFactor } from './math.js';
import type { Random } from './prng.js';

export interface SimNode extends SimulationNodeDatum {
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  source: SimNode;
  target: SimNode;
  distance: number;
  strength: number;
}

export interface SimulationSpec {
  /** Initial positions; fixed nodes carry `fx` / `fy`. Indices must be 0..n−1. */
  readonly nodes: SimNode[];
  readonly links: SimLink[];
  readonly springs: readonly Spring[];
  /** Many-body strength per node (negative = repulsion). */
  readonly charge: Float64Array;
  /** Node-only boxes (structure phase). */
  readonly nodeBoxes: CollisionBoxes;
  /** Full node + label boxes (label phase and final overlap removal). */
  readonly labelBoxes: CollisionBoxes;
  readonly ticks: number;
  /** Starting alpha (1 for a fresh layout, lower to refine around fixed nodes). */
  readonly alpha: number;
  /** Pull towards the origin; 0 disables it (anchored layouts). */
  readonly gravity: number;
  /** Rotate / mirror into canonical orientation after the structure phase. */
  readonly orient: boolean;
  readonly springStrength: number;
  readonly springLength: number;
  /** Partners farther apart than this are docked next to each other at the end (0 = never). */
  readonly dockDistance: number;
  /** Many-body cut-off (docs/algorithms.md: 900; shorter when refining around fixed nodes). */
  readonly chargeRange: number;
  /** Gap kept between boxes. */
  readonly padding: number;
  readonly random: Random;
}

const ALPHA_MIN = 0.001;
/** d3's default: velocities keep 60% per tick. */
const VELOCITY_RETAIN = 0.6;
const STRUCTURE_SHARE = 0.35;
const RAMP_SHARE = 0.25;
/** Label boxes start the label phase at this fraction of their size. */
const RAMP_FROM = 0.5;
const COLLIDE_STRENGTH = 0.7;
/** Label boxes may cover at most this share of the nodes' bounding box after the structure phase. */
const ROOM_DENSITY = 0.4;
const MAX_OVERLAP_PASSES = 150;

/** Run the simulation in place. Returns the number of overlap-removal passes used. */
export function simulate(spec: SimulationSpec): number {
  const { nodes, ticks } = spec;
  const n = nodes.length;
  if (n === 0) return 0;

  if (ticks > 0) {
    const link = forceLink<SimNode, SimLink>(spec.links)
      .distance((l) => l.distance)
      .strength((l) => l.strength);
    link.initialize(nodes, spec.random);
    const charge = forceManyBody<SimNode>()
      .strength((d) => spec.charge[d.index] ?? 0)
      .theta(0.9)
      .distanceMax(spec.chargeRange);
    charge.initialize(nodes, spec.random);

    const decay = coolingFactor(ALPHA_MIN / spec.alpha, ticks);
    const structureEnd = Math.round(ticks * STRUCTURE_SHARE);
    const rampTicks = Math.max(1, Math.round(ticks * RAMP_SHARE));
    const ramp = scratchBoxes(spec.nodeBoxes);
    const scratch = collisionScratch(n);
    let alpha = spec.alpha;

    for (let tick = 0; tick < ticks; tick++) {
      alpha *= decay;
      link(alpha);
      charge(alpha);
      if (spec.springs.length > 0) {
        applySprings(nodes, spec.springs, alpha, spec.springStrength, spec.springLength);
      }
      if (spec.gravity > 0) applyGravity(nodes, alpha, spec.gravity);

      let boxes = spec.nodeBoxes;
      if (tick >= structureEnd) {
        const t = Math.min(1, (tick - structureEnd + 1) / rampTicks);
        boxes =
          t >= 1
            ? spec.labelBoxes
            : blendBoxes(spec.nodeBoxes, spec.labelBoxes, RAMP_FROM + (1 - RAMP_FROM) * t, ramp);
      }
      if (boxes !== undefined)
        collideVelocities(nodes, boxes, spec.padding, COLLIDE_STRENGTH, scratch);

      for (const node of nodes) {
        if (node.fx == null) {
          node.vx *= VELOCITY_RETAIN;
          node.x += node.vx;
        } else {
          node.x = node.fx;
          node.vx = 0;
        }
        if (node.fy == null) {
          node.vy *= VELOCITY_RETAIN;
          node.y += node.vy;
        } else {
          node.y = node.fy;
          node.vy = 0;
        }
      }

      if (tick + 1 === structureEnd) {
        if (spec.orient) orient(nodes);
        makeRoom(nodes, spec.labelBoxes, spec.padding, ROOM_DENSITY);
      }
    }
  }

  const cleared = removeOverlaps(nodes, spec.labelBoxes, spec.padding, MAX_OVERLAP_PASSES);
  let passes = cleared.passes;
  if (spec.springs.length > 0 && spec.dockDistance > 0) {
    const pinned = dockPartners(
      nodes,
      spec.springs,
      spec.labelBoxes,
      spec.padding,
      spec.dockDistance,
    );
    if (pinned.length > 0) {
      // Make room around docked pairs: they hold still, their new neighbours step aside. Only
      // the docked nodes (and whatever was left over) need to be looked at.
      const invMass = Float64Array.from(spec.labelBoxes.invMass);
      const active = Uint8Array.from(cleared.unresolved);
      for (const k of pinned) {
        invMass[k] = 0;
        active[k] = 1;
      }
      const boxes = { ...spec.labelBoxes, invMass };
      const room = removeOverlaps(nodes, boxes, spec.padding, MAX_OVERLAP_PASSES, active);
      // Whatever the pinned pass could not clear (a pinned pair in a tight spot) is cleared with
      // everyone movable again.
      const rest = Uint8Array.from(room.unresolved);
      for (const k of pinned) rest[k] = 1;
      passes += room.passes;
      passes += removeOverlaps(
        nodes,
        spec.labelBoxes,
        spec.padding,
        MAX_OVERLAP_PASSES,
        rest,
      ).passes;
    }
  }
  return passes;
}

function scratchBoxes(like: CollisionBoxes): CollisionBoxes {
  const n = like.halfWidth.length;
  return {
    halfWidth: new Float64Array(n),
    halfHeight: new Float64Array(n),
    offsetY: new Float64Array(n),
    invMass: like.invMass,
  };
}

/** Boxes with the label part scaled by `s` (node part kept), written into `out`. */
function blendBoxes(
  node: CollisionBoxes,
  full: CollisionBoxes,
  s: number,
  out: CollisionBoxes,
): CollisionBoxes {
  const n = node.halfWidth.length;
  for (let i = 0; i < n; i++) {
    const top = node.offsetY[i]! - node.halfHeight[i]!;
    const bottom = node.offsetY[i]! + node.halfHeight[i]!;
    const fullBottom = full.offsetY[i]! + full.halfHeight[i]!;
    const b = bottom + (fullBottom - bottom) * s;
    out.halfWidth[i] = node.halfWidth[i]! + (full.halfWidth[i]! - node.halfWidth[i]!) * s;
    out.halfHeight[i] = (b - top) / 2;
    out.offsetY[i] = (b + top) / 2;
  }
  return out;
}

/**
 * Rotate the (free) layout so its principal axis is horizontal, then mirror so the heavier tail
 * points right / down. Only exact operations: the eigenvector of the 2×2 covariance matrix gives
 * cos / sin directly.
 */
function orient(nodes: SimNode[]): void {
  let cx = 0;
  let cy = 0;
  for (const d of nodes) {
    cx += d.x;
    cy += d.y;
  }
  cx /= nodes.length;
  cy /= nodes.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const d of nodes) {
    const dx = d.x - cx;
    const dy = d.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const half = (sxx - syy) / 2;
  const lambda = (sxx + syy) / 2 + Math.sqrt(half * half + sxy * sxy);
  let ux = sxy;
  let uy = lambda - sxx;
  if (Math.abs(ux) + Math.abs(uy) < 1e-12 * (sxx + syy + 1)) {
    ux = lambda - syy;
    uy = sxy;
  }
  const len = Math.sqrt(ux * ux + uy * uy);
  const c = len > 0 ? ux / len : 1;
  const s = len > 0 ? uy / len : 0;

  let m3x = 0;
  let m3y = 0;
  for (const d of nodes) {
    const dx = d.x - cx;
    const dy = d.y - cy;
    const rx = c * dx + s * dy;
    const ry = -s * dx + c * dy;
    d.x = rx;
    d.y = ry;
    const vx = c * d.vx + s * d.vy;
    d.vy = -s * d.vx + c * d.vy;
    d.vx = vx;
    m3x += rx * rx * rx;
    m3y += ry * ry * ry;
  }
  const fx = m3x < 0 ? -1 : 1;
  const fy = m3y < 0 ? -1 : 1;
  if (fx === 1 && fy === 1) return;
  for (const d of nodes) {
    d.x *= fx;
    d.vx *= fx;
    d.y *= fy;
    d.vy *= fy;
  }
}

/**
 * Scale the (free) layout up about its centroid when its label boxes could not possibly fit:
 * when their total area exceeds `density` × the area of the nodes' bounding box. A dense graph
 * pulls itself together tighter than its labels allow, and pushing boxes apart one pair at a time
 * through such a jam takes many passes; a uniform scale keeps the picture and makes the room in
 * one step. Fixed nodes, if any, rule this out.
 */
function makeRoom(
  nodes: readonly SimNode[],
  boxes: CollisionBoxes,
  padding: number,
  density: number,
): void {
  if (nodes.length < 3 || boxes.invMass.some((m) => m === 0)) return;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const d of nodes) {
    minX = Math.min(minX, d.x);
    maxX = Math.max(maxX, d.x);
    minY = Math.min(minY, d.y);
    maxY = Math.max(maxY, d.y);
    cx += d.x;
    cy += d.y;
    area += (2 * boxes.halfWidth[d.index]! + padding) * (2 * boxes.halfHeight[d.index]! + padding);
  }
  const span = Math.max(1, maxX - minX) * Math.max(1, maxY - minY);
  const ratio = area / (density * span);
  if (ratio <= 1) return;
  const scale = Math.sqrt(ratio);
  cx /= nodes.length;
  cy /= nodes.length;
  for (const d of nodes) {
    d.x = cx + (d.x - cx) * scale;
    d.y = cy + (d.y - cy) * scale;
  }
}
