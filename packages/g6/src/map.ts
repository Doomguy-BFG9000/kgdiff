/**
 * Resolved frame → G6 v5 `GraphData`. Pure: no G6 runtime, no DOM, no shared mutable state.
 *
 * Every element always carries the full set of style keys it can ever use (switched off with
 * `false` / 0 / ''), because G6's `setData` / `updateData` *merge* an update into the previous
 * style: a key that is merely omitted would keep its old value. `datum.data` holds flat
 * primitives only, so G6's shallow equality check can skip unchanged elements.
 *
 * Sizes the scene gives in screen px are emitted as world units (exact at zoom 1); level of
 * detail (`minZoom`, `arrowMinZoom`) is applied for the zoom passed in `zoom`.
 */
import type { EdgeData, GraphData, NodeData } from '@antv/g6';
import { KgdiffError } from '@kgdiff/core';
import type {
  EdgeVisual,
  FrameVisuals,
  NodeVisual,
  Scene,
  SceneEdge,
  SceneNode,
} from '@kgdiff/scene';
import { type Ctx, claim, type KgdiffDatumData } from './map-context.js';
import { mapEdge, mapGlyph } from './map-edge.js';
import { mapCollapsed, mapNode } from './map-node.js';

export type { ElementKind, KgdiffDatumData } from './map-context.js';

export interface MapOptions {
  readonly idPrefix: string;
  readonly keepHidden: boolean;
  /** Camera zoom the level of detail is evaluated at. */
  readonly zoom: number;
}

export interface MappedFrame {
  readonly data: { nodes: NodeData[]; edges: EdgeData[] };
  /**
   * Distinct positive LOD thresholds present in the frame (sorted): the zooms at which the
   * mapping would change. Crossing one calls for a re-map.
   */
  readonly lod: readonly number[];
}

// ─── Frame ──────────────────────────────────────────────────────────────────

/**
 * Map a resolved frame. Output order: scene nodes (by index), collapsed pills, then glyph anchors
 * and pivot dots; scene edges (by index), then glyph arcs (frame order). O(N + E + G), plus O(N)
 * grids when the frame has glyphs.
 *
 * @throws KgdiffError(`invalid-input`) when the frame was not resolved for `scene`.
 */
export function mapFrame(scene: Scene, frame: FrameVisuals, options: MapOptions): MappedFrame {
  if (frame.nodes.length !== scene.nodes.length || frame.edges.length !== scene.edges.length) {
    throw new KgdiffError(
      'invalid-input',
      `The frame does not belong to this scene: it has ${frame.nodes.length} nodes / ${frame.edges.length} edges, the scene ${scene.nodes.length} / ${scene.edges.length}. Resolve it with createVisualResolver(scene).`,
    );
  }
  if (typeof options.idPrefix !== 'string') {
    throw new KgdiffError('invalid-input', 'idPrefix must be a string.');
  }
  const N = scene.nodes.length;
  const ctx: Ctx = {
    scene,
    frame,
    theme: scene.theme,
    bg: scene.theme.canvas.background,
    prefix: options.idPrefix,
    keepHidden: options.keepHidden,
    zoom: options.zoom,
    present: new Uint8Array(N),
    nodeIds: new Array<string>(N),
    used: new Set<string>(),
    lod: new Set<number>(),
    locator: null,
    anyLocator: null,
    anchors: new Map(),
    nodeBase: null,
    edgeBase: null,
  };
  const nodes: NodeData[] = [];
  const edges: EdgeData[] = [];
  for (let i = 0; i < N; i++) {
    const sn = scene.nodes[i] as SceneNode;
    const v = frame.nodes[i] as NodeVisual;
    ctx.nodeIds[i] = claim(ctx, options.idPrefix + sn.id);
    const datum = mapNode(sn, v, ctx);
    if (datum === null) continue;
    ctx.present[i] = 1;
    nodes.push(datum);
  }
  frame.collapsed.forEach((g, i) => {
    const datum = mapCollapsed(g, i, ctx);
    if (datum !== null) nodes.push(datum);
  });
  for (let j = 0; j < scene.edges.length; j++) {
    const datum = mapEdge(scene.edges[j] as SceneEdge, frame.edges[j] as EdgeVisual, ctx);
    if (datum !== null) edges.push(datum);
  }
  frame.glyphs.forEach((g, i) => {
    const datum = mapGlyph(g, i, ctx, nodes);
    if (datum === null) return;
    if ('edge' in datum) edges.push(datum.edge);
    else nodes.push(datum.node);
  });
  return { data: { nodes, edges }, lod: [...ctx.lod].sort((a, b) => a - b) };
}

/** True when moving the camera from zoom `a` to `b` crosses one of the `lod` thresholds. */
export function crossesLod(lod: readonly number[], a: number, b: number): boolean {
  for (const m of lod) if (a < m !== b < m) return true;
  return false;
}

/** The kgdiff part of a datum's `data`, or null for elements this package did not generate. */
export function kgdiffData(data: unknown): KgdiffDatumData | null {
  if (data === null || typeof data !== 'object') return null;
  const d = data as Partial<KgdiffDatumData>;
  return d.kgdiff === 'node' ||
    d.kgdiff === 'edge' ||
    d.kgdiff === 'glyph' ||
    d.kgdiff === 'collapsed' ||
    d.kgdiff === 'anchor'
    ? (d as KgdiffDatumData)
    : null;
}

/** Narrowing helper for consumers of `toG6Data`: the graph data with both arrays present. */
export type MappedGraphData = Required<Pick<GraphData, 'nodes' | 'edges'>>;
