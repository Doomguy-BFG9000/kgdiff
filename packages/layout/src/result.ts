/**
 * Assembling the immutable `LayoutResult`.
 */
import type { Point, UnionId } from '@kgdiff/core';
import { connectedComponents } from './components.js';
import { emptyExtent, extentOf, includeNode, toRect } from './geometry.js';
import type { LayoutGraph } from './graph.js';
import type { LayoutComponent, LayoutResult, LayoutScope, LayoutStrategy } from './index.js';

export const now = (): number =>
  typeof performance === 'object' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export interface AssembleInput {
  readonly graph: LayoutGraph;
  /** Final positions of every graph node (and possibly of nodes outside the graph). */
  readonly positions: ReadonlyMap<UnionId, Point>;
  readonly radii: ReadonlyMap<UnionId, number>;
  readonly hidden: ReadonlyMap<UnionId, number>;
  readonly scope: LayoutScope;
  readonly strategy: LayoutStrategy;
  readonly iterations: number;
  readonly started: number;
}

const byId = <T>(map: ReadonlyMap<UnionId, T>): Map<UnionId, T> =>
  new Map([...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export function assemble(input: AssembleInput): LayoutResult {
  const { graph } = input;
  const x = new Float64Array(graph.n);
  const y = new Float64Array(graph.n);
  const bounds = emptyExtent();
  for (let i = 0; i < graph.n; i++) {
    const p = input.positions.get(graph.nodes[i]!.id);
    if (p === undefined) continue;
    x[i] = p.x;
    y[i] = p.y;
    includeNode(bounds, graph, i, p.x, p.y);
  }
  const components: LayoutComponent[] = connectedComponents(graph).map((members) =>
    Object.freeze({
      nodes: Object.freeze(members.map((i) => graph.nodes[i]!.id)),
      bounds: toRect(extentOf(graph, members, x, y)),
    }),
  );
  const positions = byId(input.positions);
  return Object.freeze({
    positions,
    radii: byId(input.radii),
    bounds: toRect(bounds),
    scope: input.scope,
    hidden: byId(input.hidden),
    components: Object.freeze(components),
    stats: Object.freeze({
      strategy: input.strategy,
      iterations: input.iterations,
      nodes: positions.size,
      ms: now() - input.started,
    }),
  });
}
