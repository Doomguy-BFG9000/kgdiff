/**
 * Placement strategies over a `LayoutGraph` (docs/algorithms.md §12 "Strategy", "Components").
 *
 * - `placeFree`: every component laid out on its own, packed, centered at the origin.
 * - `placeAnchored`: known nodes never move; unknown nodes connected to them are seeded next to
 *   their placed neighbours and refined by a simulation in which the known nodes are fixed;
 *   components without any known node are laid out freely and packed beside the anchored region.
 */
import { type QuadtreeLeaf, quadtree } from 'd3-quadtree';
import { connectedComponents } from './components.js';
import { type CollisionBoxes, removeOverlaps } from './forces/collide-rect.js';
import { settleOverlapping } from './forces/free-spot.js';
import {
  anchoredChargeRange,
  CHARGE_RANGE,
  chargeStrength,
  gravityFor,
  linkDistance,
  linkStrength,
} from './forces/params.js';
import type { Spring } from './forces/springs.js';
import { BOX_PADDING, type Extent, extentOf, isEmpty } from './geometry.js';
import type { LayoutGraph } from './graph.js';
import { partnerLists, placeAroundFixed, placeOnSpiral } from './init.js';
import { defaultIterations, type ResolvedLayoutOptions } from './options.js';
import { pack } from './pack.js';
import { mulberry32, type Random } from './prng.js';
import { type SimLink, type SimNode, simulate } from './simulate.js';

/** Merge / split partner springs (docs/algorithms.md §12), rest length 0.5·L. */
const SPRING_STRENGTH = 0.08;
const SPRING_LENGTH_RATIO = 0.5;
/** Spiral spacing relative to the link distance: starts a bit denser than the final layout. */
const SPIRAL_SPACING_RATIO = 0.4;
const TARGET_ASPECT = 1.6;
/** Pushing passes before wedged nodes are moved to free spots instead. */
const SETTLE_PASSES = 24;

export interface EngineContext {
  readonly graph: LayoutGraph;
  readonly options: ResolvedLayoutOptions;
  /** Positions by layout index, filled in place. */
  readonly x: Float64Array;
  readonly y: Float64Array;
}

interface Workspace {
  readonly partners: readonly (readonly number[])[];
  /** layout index → sim index, −1 outside the current simulation. */
  readonly slot: Int32Array;
  readonly random: Random;
}

const workspace = (ctx: EngineContext): Workspace => ({
  partners: partnerLists(ctx.graph),
  slot: new Int32Array(ctx.graph.n).fill(-1),
  random: mulberry32(ctx.options.seed),
});

/** Ticks for a simulation over `size` nodes: the option, else `defaultIterations(size)`. */
const ticksFor = (ctx: EngineContext, size: number): number =>
  ctx.options.iterations ?? defaultIterations(size);

/**
 * Lay out everything freely. Returns the ticks of the largest simulation run (0 when none ran,
 * e.g. only isolated nodes).
 */
export function placeFree(ctx: EngineContext): number {
  const ws = workspace(ctx);
  const components = connectedComponents(ctx.graph);
  const block = layoutBlock(ctx, ws, components);
  const all = components.flat();
  const e = extentOf(ctx.graph, all, ctx.x, ctx.y);
  if (!isEmpty(e)) translate(ctx, all, -(e.minX + e.maxX) / 2, -(e.minY + e.maxY) / 2);
  return block.ticks;
}

/**
 * Lay out around `fixed` nodes, whose positions must already be in `ctx.x` / `ctx.y`.
 * Returns the ticks of the largest simulation run (0 when none ran).
 */
export function placeAnchored(ctx: EngineContext, fixed: Uint8Array): number {
  const { graph } = ctx;
  const ws = workspace(ctx);
  const components = connectedComponents(graph);
  const anchoredComponents: number[][] = [];
  const freeComponents: number[][] = [];
  for (const component of components) {
    (component.some((i) => fixed[i] === 1) ? anchoredComponents : freeComponents).push(component);
  }

  const members = anchoredComponents.flat().sort((a, b) => a - b);
  const placed = Uint8Array.from(fixed);
  placeAroundFixed(
    graph,
    ws.partners,
    members,
    placed,
    ctx.x,
    ctx.y,
    ctx.options.linkDistance,
    ctx.options.seed,
  );

  const free = members.filter((i) => fixed[i] !== 1);
  let ticks = 0;
  let largest = 0;
  if (free.length > 0) {
    // Refine with an energy (and a charge range) matching how much of the picture is new.
    const share = free.length / members.length;
    const window = simulationWindow(ctx, members, free, fixed);
    ticks = ticksFor(ctx, window.length);
    largest = window.length;
    runSimulation(
      ctx,
      ws,
      window,
      fixed,
      ticks,
      0.3 + 0.7 * share,
      false,
      0,
      anchoredChargeRange(share, ctx.options.linkDistance),
    );
    settle(ctx, members, fixed);
  }

  if (freeComponents.length > 0) {
    const block = layoutBlock(ctx, ws, freeComponents);
    if (block.largest > largest) ticks = block.ticks;
    const anchoredExtent = extentOf(graph, members, ctx.x, ctx.y);
    const nodes = freeComponents.flat();
    const gap = ctx.options.componentGap;
    const right = { dx: anchoredExtent.maxX + gap, dy: anchoredExtent.minY };
    const below = { dx: anchoredExtent.minX, dy: anchoredExtent.maxY + gap };
    const cost = (dx: number, dy: number): number => {
      const w = Math.max(anchoredExtent.maxX, dx + block.width) - Math.min(anchoredExtent.minX, dx);
      const h =
        Math.max(anchoredExtent.maxY, dy + block.height) - Math.min(anchoredExtent.minY, dy);
      const side = Math.max(w, h * TARGET_ASPECT);
      return side * side;
    };
    const at = cost(below.dx, below.dy) < cost(right.dx, right.dy) - 1e-6 ? below : right;
    translate(ctx, nodes, at.dx, at.dy);
  }
  return ticks;
}

/**
 * The nodes worth simulating around `free` ones: all of them, their graph neighbours, and the
 * fixed nodes within reach of where any of them starts (a quadtree range query per free node).
 * Far-away fixed nodes cannot interact with the new ones in a refinement run, and skipping them
 * keeps `extendLayout` interactive on large graphs.
 */
function simulationWindow(
  ctx: EngineContext,
  members: readonly number[],
  free: readonly number[],
  fixed: Uint8Array,
): number[] {
  const { graph, x, y } = ctx;
  if (free.length * 2 >= members.length) return [...members];
  const inWindow = new Uint8Array(graph.n);
  let reach = 4 * ctx.options.linkDistance;
  for (const i of free) {
    reach = Math.max(reach, 2 * graph.boxHalfWidth[i]!, 2 * graph.boxBottom[i]!);
    inWindow[i] = 1;
    for (let k = graph.offsets[i]!; k < graph.offsets[i + 1]!; k++)
      inWindow[graph.adjacency[k]!] = 1;
  }
  const tree = quadtree<number>()
    .x((i) => x[i]!)
    .y((i) => y[i]!)
    .addAll(members.filter((i) => fixed[i] === 1));
  for (const i of free) {
    const x0 = x[i]! - reach;
    const x1 = x[i]! + reach;
    const y0 = y[i]! - reach;
    const y1 = y[i]! + reach;
    tree.visit((cell, cx0, cy0, cx1, cy1) => {
      if (!cell.length) {
        let leaf: QuadtreeLeaf<number> | undefined = cell as QuadtreeLeaf<number>;
        while (leaf !== undefined) {
          const j = leaf.data;
          if (x[j]! >= x0 && x[j]! <= x1 && y[j]! >= y0 && y[j]! <= y1) inWindow[j] = 1;
          leaf = leaf.next;
        }
      }
      return cx0 > x1 || cx1 < x0 || cy0 > y1 || cy1 < y0;
    });
  }
  return members.filter((i) => inWindow[i] === 1);
}

interface Block {
  readonly width: number;
  readonly height: number;
  /** Ticks of the largest component simulated (0 when none was). */
  readonly ticks: number;
  /** Size of that component. */
  readonly largest: number;
}

/**
 * Simulate each multi-node component around the origin, then pack all of them (and the
 * isolated nodes) into one block whose visual extent starts at (0, 0).
 */
function layoutBlock(ctx: EngineContext, ws: Workspace, components: readonly number[][]): Block {
  const { graph, x, y, options } = ctx;
  const visited = new Uint8Array(graph.n);
  const groups: number[][] = [];
  const isolated: number[] = [];
  const extents: Extent[] = [];
  let ticks = 0;
  let largest = 0;

  for (const component of components) {
    if (component.length === 1) {
      isolated.push(component[0]!);
      continue;
    }
    placeOnSpiral(
      graph,
      ws.partners,
      component,
      options.linkDistance * SPIRAL_SPACING_RATIO,
      ws.random,
      visited,
      x,
      y,
    );
    const componentTicks = ticksFor(ctx, component.length);
    // Components come largest first.
    if (component.length > largest) {
      largest = component.length;
      ticks = componentTicks;
    }
    runSimulation(
      ctx,
      ws,
      component,
      undefined,
      componentTicks,
      1,
      true,
      gravityFor(component.length),
      CHARGE_RANGE,
    );
    groups.push(component);
    extents.push(extentOf(graph, component, x, y));
  }

  isolated.sort((a, b) => a - b);
  const packed = pack({
    components: extents.map((e) => ({ width: e.maxX - e.minX, height: e.maxY - e.minY })),
    isolated: isolated.map((i) => ({
      halfWidth: graph.boxHalfWidth[i]!,
      top: graph.boxTop[i]!,
      bottom: graph.boxBottom[i]!,
    })),
    componentGap: options.componentGap,
    gridGapX: options.fontSize * 1.5,
    gridGapY: options.fontSize,
    aspect: TARGET_ASPECT,
  });
  for (let c = 0; c < groups.length; c++) {
    const at = packed.components[c]!;
    const e = extents[c]!;
    translate(ctx, groups[c]!, at.x - e.minX, at.y - e.minY);
  }
  for (let k = 0; k < isolated.length; k++) {
    const i = isolated[k]!;
    const at = packed.isolated[k]!;
    x[i] = at.x;
    y[i] = at.y;
  }
  return { width: packed.width, height: packed.height, ticks, largest };
}

function translate(ctx: EngineContext, nodes: readonly number[], dx: number, dy: number): void {
  for (const i of nodes) {
    ctx.x[i]! += dx;
    ctx.y[i]! += dy;
  }
}

interface SimSetup {
  readonly nodes: SimNode[];
  readonly nodeBoxes: CollisionBoxes;
  readonly labelBoxes: CollisionBoxes;
  readonly charge: Float64Array;
}

/** Sim nodes (index k ↔ `list[k]`), collision boxes and charges for a list of layout indices. */
function setup(
  ctx: EngineContext,
  list: readonly number[],
  fixed: Uint8Array | undefined,
): SimSetup {
  const { graph, x, y, options } = ctx;
  const m = list.length;
  const nodeBoxes: CollisionBoxes = {
    halfWidth: new Float64Array(m),
    halfHeight: new Float64Array(m),
    offsetY: new Float64Array(m),
    invMass: new Float64Array(m),
  };
  const labelBoxes: CollisionBoxes = options.labelAware
    ? {
        halfWidth: new Float64Array(m),
        halfHeight: new Float64Array(m),
        offsetY: new Float64Array(m),
        invMass: nodeBoxes.invMass,
      }
    : nodeBoxes;
  const charge = new Float64Array(m);
  const nodes: SimNode[] = [];
  for (let k = 0; k < m; k++) {
    const i = list[k]!;
    const r = graph.radius[i]!;
    const isFixed = fixed !== undefined && fixed[i] === 1;
    const node: SimNode = { index: k, x: x[i]!, y: y[i]!, vx: 0, vy: 0 };
    if (isFixed) {
      node.fx = node.x;
      node.fy = node.y;
    }
    nodes.push(node);
    nodeBoxes.halfWidth[k] = r;
    nodeBoxes.halfHeight[k] = r;
    // Hubs are heavy: in a collision the leaf steps aside. Fixed nodes never move.
    nodeBoxes.invMass[k] = isFixed ? 0 : 1 / (1 + graph.degree[i]!);
    if (labelBoxes !== nodeBoxes) {
      labelBoxes.halfWidth[k] = graph.boxHalfWidth[i]!;
      labelBoxes.halfHeight[k] = (graph.boxBottom[i]! - graph.boxTop[i]!) / 2;
      labelBoxes.offsetY[k] = (graph.boxBottom[i]! + graph.boxTop[i]!) / 2;
    }
    charge[k] = chargeStrength(graph, i, options.linkDistance, options.labelAware);
  }
  return { nodes, nodeBoxes, labelBoxes, charge };
}

function writeBack(ctx: EngineContext, list: readonly number[], nodes: readonly SimNode[]): void {
  for (let k = 0; k < list.length; k++) {
    const node = nodes[k]!;
    if (node.fx == null) {
      ctx.x[list[k]!] = node.x;
      ctx.y[list[k]!] = node.y;
    }
  }
}

/** Simulate `list` (ascending layout indices) in place; fixed nodes keep their position. */
function runSimulation(
  ctx: EngineContext,
  ws: Workspace,
  list: readonly number[],
  fixed: Uint8Array | undefined,
  ticks: number,
  alpha: number,
  orient: boolean,
  gravity: number,
  chargeRange: number,
): void {
  const { graph, options } = ctx;
  const { slot } = ws;
  for (let k = 0; k < list.length; k++) slot[list[k]!] = k;
  const { nodes, nodeBoxes, labelBoxes, charge } = setup(ctx, list, fixed);
  const isFixed = (i: number): boolean => fixed !== undefined && fixed[i] === 1;

  const L = options.linkDistance;
  const links: SimLink[] = [];
  for (let k = 0; k < list.length; k++) {
    const i = list[k]!;
    for (let e = graph.offsets[i]!; e < graph.offsets[i + 1]!; e++) {
      const v = graph.adjacency[e]!;
      const kv = slot[v]!;
      if (v <= i || kv < 0 || (isFixed(i) && isFixed(v))) continue;
      const distance = linkDistance(L, Math.max(1, Math.min(graph.degree[i]!, graph.degree[v]!)));
      links.push({
        source: nodes[k]!,
        target: nodes[kv]!,
        distance,
        strength: linkStrength(graph, i, v, distance, options.labelAware),
      });
    }
  }
  const springs: Spring[] = [];
  for (const { mover, anchor } of graph.partners) {
    const km = slot[mover]!;
    const ka = slot[anchor]!;
    if (km >= 0 && ka >= 0) springs.push({ mover: km, anchor: ka });
  }
  for (const i of list) slot[i] = -1;

  simulate({
    nodes,
    links,
    springs,
    charge,
    nodeBoxes,
    labelBoxes,
    ticks,
    alpha,
    gravity,
    orient,
    springStrength: SPRING_STRENGTH,
    springLength: L * SPRING_LENGTH_RATIO,
    dockDistance: L,
    chargeRange,
    padding: BOX_PADDING,
    random: ws.random,
  });
  writeBack(ctx, list, nodes);
}

/**
 * Final overlap removal over the whole anchored region (`list`), fixed nodes being immovable
 * obstacles: pushes first (new nodes may have drifted next to fixed nodes outside the simulation
 * window), then free spots for nodes that pushing cannot free.
 */
function settle(ctx: EngineContext, list: readonly number[], fixed: Uint8Array): void {
  const { graph, x, y } = ctx;
  const { nodes, labelBoxes } = setup(ctx, list, fixed);
  removeOverlaps(nodes, labelBoxes, BOX_PADDING, SETTLE_PASSES);
  const slotOf = new Map<number, number>();
  list.forEach((i, k) => {
    slotOf.set(i, k);
  });
  settleOverlapping(nodes, labelBoxes, BOX_PADDING, (k) => {
    const i = list[k]!;
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (let e = graph.offsets[i]!; e < graph.offsets[i + 1]!; e++) {
      const node = nodes[slotOf.get(graph.adjacency[e]!) ?? -1];
      if (node === undefined) continue;
      sx += node.x;
      sy += node.y;
      count++;
    }
    return count > 0 ? { x: sx / count, y: sy / count } : { x: x[i]!, y: y[i]! };
  });
  writeBack(ctx, list, nodes);
}
