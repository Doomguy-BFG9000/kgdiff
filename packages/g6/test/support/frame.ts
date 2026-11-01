/**
 * Hand-made scenes and frames for precise mapping tests: every visual primitive can be set
 * exactly, independent of what the resolver currently emits.
 */
import {
  type EdgeVisual,
  type FrameVisuals,
  type GlyphVisual,
  getTheme,
  type LabelVisual,
  type NodeVisual,
  type Scene,
  type SceneEdge,
  type SceneHunk,
  type SceneNode,
  type ThemeName,
} from '@kgdiff/scene';

export interface MiniNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly r?: number;
  readonly hunk?: number;
}

export interface MiniEdge {
  readonly id: string;
  readonly s: number;
  readonly t: number;
  readonly sb?: number;
  readonly tb?: number;
  readonly hunk?: number;
  readonly label?: string;
}

/** A scene with just what the mapping reads; hunks are one per distinct hunk index used. */
export function miniScene(
  nodes: readonly MiniNode[],
  edges: readonly MiniEdge[] = [],
  theme: ThemeName = 'dark',
): Scene {
  const sceneNodes: SceneNode[] = nodes.map((n, index) => ({
    index,
    id: n.id,
    x: n.x,
    y: n.y,
    r: n.r ?? 6,
    status: 'unchanged',
    role: 'unchanged',
    family: 'neutral',
    familyBefore: 'neutral',
    label: `label ${n.id}`,
    hunk: n.hunk ?? -1,
    presentBefore: true,
    presentAfter: true,
    implicit: false,
    degree: 1,
    hidden: 0,
    importance: 0.5,
  }));
  const sceneEdges: SceneEdge[] = edges.map((e, index) => ({
    index,
    id: e.id,
    s: e.s,
    t: e.t,
    sb: e.sb ?? e.s,
    tb: e.tb ?? e.t,
    status: 'unchanged',
    role: 'unchanged',
    family: 'neutral',
    label: e.label ?? `edge ${e.id}`,
    curvature: 0,
    hunk: e.hunk ?? -1,
    presentBefore: true,
    presentAfter: true,
    hierarchical: false,
  }));
  const hunkCount = Math.max(0, ...nodes.map((n) => (n.hunk ?? -1) + 1));
  const hunks: SceneHunk[] = Array.from({ length: hunkCount }, (_, index) => ({
    index,
    id: `h${index}`,
    kind: 'modify',
    phase: 'modify',
    family: 'content',
    title: `hunk ${index}`,
    subtitle: '',
    anchor: -1,
    nodes: [],
    edges: [],
    context: [],
    bounds: { x: 0, y: 0, width: 1, height: 1 },
  }));
  const scene = {
    nodes: sceneNodes,
    edges: sceneEdges,
    hunks,
    suggestions: [],
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    timeline: { duration: 0, windows: [], chapters: [], mode: 'hunks' },
    theme: getTheme(theme),
    locale: 'en',
    nodeIndex: new Map(sceneNodes.map((n) => [n.id, n.index])),
    edgeIndex: new Map(sceneEdges.map((e) => [e.id, e.index])),
    hunkIndex: new Map(hunks.map((h) => [h.id, h.index])),
  };
  // `stats` and `meta` are never read by the mapping.
  return scene as unknown as Scene;
}

export function label(partial: Partial<LabelVisual> = {}): LabelVisual {
  return {
    text: 'Label',
    color: '#E7EBF3',
    alpha: 1,
    size: 12,
    weight: 600,
    strike: false,
    priority: 1,
    minZoom: 0,
    offset: 5,
    ...partial,
  };
}

export function nodeVisual(n: MiniNode, partial: Partial<NodeVisual> = {}): NodeVisual {
  return {
    visible: true,
    x: n.x,
    y: n.y,
    r: n.r ?? 6,
    alpha: 1,
    family: 'neutral',
    fill: '#4B5568',
    stroke: '#5E687C',
    strokeWidth: 1.25,
    dash: null,
    ring: null,
    halo: null,
    label: null,
    secondaryLabel: null,
    badge: null,
    pulse: 0,
    z: 0,
    ...partial,
  };
}

export function edgeVisual(scene: Scene, e: number, partial: Partial<EdgeVisual> = {}): EdgeVisual {
  const se = scene.edges[e] as SceneEdge;
  const a = scene.nodes[se.s] as SceneNode;
  const b = scene.nodes[se.t] as SceneNode;
  return {
    visible: true,
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    r1: a.r,
    r2: b.r,
    curvature: 0,
    color: '#323A4A',
    width: 1,
    alpha: 1,
    dash: null,
    dashOffset: 0,
    arrow: true,
    arrowMinZoom: 0,
    progress: 1,
    fromTarget: false,
    label: null,
    z: 0,
    ...partial,
  };
}

export function glyph(
  scene: Scene,
  a: number,
  b: number,
  partial: Partial<GlyphVisual> = {},
): GlyphVisual {
  const na = scene.nodes[a] as SceneNode;
  const nb = scene.nodes[b] as SceneNode;
  return {
    kind: 'merge-arrow',
    x1: na.x,
    y1: na.y,
    x2: nb.x,
    y2: nb.y,
    r1: na.r + 4,
    r2: nb.r + 4,
    color: '#A78BFA',
    alpha: 0.9,
    width: 1.5,
    dash: null,
    progress: 1,
    curvature: 0.25,
    label: null,
    ...partial,
  };
}

/** A frame with default visuals for every node / edge of `scene`, then `patch` applied. */
export function frameOf(scene: Scene, patch: Partial<FrameVisuals> = {}): FrameVisuals {
  return {
    nodes: scene.nodes.map((n) => nodeVisual(n)),
    edges: scene.edges.map((_, j) => edgeVisual(scene, j)),
    glyphs: [],
    collapsed: [],
    spotlight: 0,
    ...patch,
  };
}

/** Recursively freeze, so a test fails if the mapping writes to its input. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
