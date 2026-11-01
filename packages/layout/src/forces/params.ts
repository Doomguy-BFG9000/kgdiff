/**
 * Force parameters (docs/algorithms.md §12 "Simulation") and their label-aware adjustments.
 *
 * Spec values:
 *  - link distance `L·(1 + 0.15·log₂(1 + min(deg_s, deg_t)))`, strength `1 / min(deg_s, deg_t)`;
 *  - many-body strength `−(220 + 40·√degree)` (θ 0.9, distanceMax 900, see simulate.ts), scaled
 *    by `(linkDistance / 56)²` so the picture scales with the `linkDistance` option.
 *
 * Label-aware adjustments (only when `labelAware`), both of which reduce to the spec values for
 * nodes with ordinary labels and ordinary neighbourhoods:
 *  - charge × `clamp(boxArea / 1.5·L², 1, 3)`: a node whose label block needs more room than the
 *    ~L² the spec charge buys pushes proportionally harder, so the layout makes room for long
 *    labels globally instead of jamming them locally;
 *  - link strength × `min(1, 2·distance / crowding)`, where `crowding` is the radius of a disc
 *    holding the label blocks of a node's neighbours: the links of a hub with hundreds of
 *    labelled leaves relax, so the leaves spread into a disc instead of being squeezed into a
 *    ring of radius L that cannot hold them.
 */
import type { LayoutGraph } from '../graph.js';
import { log2 } from '../math.js';

const DEFAULT_LINK_DISTANCE = 56;
const LABEL_CHARGE_MAX = 3;
const LABEL_AREA_REF = 1.5;
const CROWDING_RATIO = 2;
/** Gravity of a component with ≤ 16 nodes; larger components get less (see `gravityFor`). */
const GRAVITY = 0.3;
/** 400 nodes, in units of 16. */
const GRAVITY_KNEE = 25;

export function linkDistance(linkDistanceOption: number, minDegree: number): number {
  return linkDistanceOption * (1 + 0.15 * log2(1 + minDegree));
}

export function linkStrength(
  graph: LayoutGraph,
  a: number,
  b: number,
  distance: number,
  labelAware: boolean,
): number {
  const minDegree = Math.max(1, Math.min(graph.degree[a]!, graph.degree[b]!));
  const strength = 1 / minDegree;
  if (!labelAware) return strength;
  const crowding = Math.max(graph.crowding[a]!, graph.crowding[b]!);
  const limit = CROWDING_RATIO * distance;
  return crowding > limit ? (strength * limit) / crowding : strength;
}

export function chargeStrength(
  graph: LayoutGraph,
  i: number,
  linkDistanceOption: number,
  labelAware: boolean,
): number {
  // The spec constants are tuned for the default link distance; scaling by (L / 56)² keeps the
  // equilibrium shape, so a larger `linkDistance` gives a proportionally larger picture.
  const scale = linkDistanceOption / DEFAULT_LINK_DISTANCE;
  const base = -(220 + 40 * Math.sqrt(graph.degree[i]!)) * scale * scale;
  if (!labelAware) return base;
  const ratio = graph.boxArea[i]! / (LABEL_AREA_REF * linkDistanceOption * linkDistanceOption);
  return base * Math.min(LABEL_CHARGE_MAX, Math.max(1, ratio));
}

/**
 * Pull towards the component center (not in the spec): keeps components round and compact.
 * A linear pull compresses the core of a large component (its pressure grows with the radius), so
 * it decays with size: `0.3 / √(n/16)` up to 400 nodes, then as `(n/400)^−0.75` beyond.
 * Powers are built from `Math.sqrt` only (deterministic across engines).
 */
export function gravityFor(size: number): number {
  const s = Math.max(1, size / 16);
  if (s <= GRAVITY_KNEE) return GRAVITY / Math.sqrt(s);
  const r = s / GRAVITY_KNEE;
  return GRAVITY / Math.sqrt(GRAVITY_KNEE) / (Math.sqrt(r) * Math.sqrt(Math.sqrt(r)));
}

/** Many-body cut-off of the spec. */
export const CHARGE_RANGE = 900;

/**
 * Many-body cut-off when refining around fixed nodes: when most of the picture is fixed, new
 * nodes should settle into local gaps next to their neighbours instead of being blown out of the
 * graph by the summed repulsion of everything that is already placed.
 */
export function anchoredChargeRange(freeShare: number, linkDistanceOption: number): number {
  return freeShare >= 0.5 ? CHARGE_RANGE : Math.min(CHARGE_RANGE, 4 * linkDistanceOption);
}
