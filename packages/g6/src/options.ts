/**
 * The G6 options `createDiffGraph` generates: no G6 theme (so no theme state styles, palettes or
 * default animations leak into kgdiff's encodings), a background plugin carrying the canvas
 * color, kgdiff-node, private hover states, and update animations for the fields kgdiff changes.
 */
import type { EdgeData, GraphOptions, IEvent, NodeData } from '@antv/g6';
import type { ChangeFamily, Theme } from '@kgdiff/scene';
import {
  BACKGROUND_PLUGIN_KEY,
  EDGE_LABEL_SIZE,
  HOVER_BEHAVIOR_KEY,
  HOVER_EDGE_WIDTH,
  HOVER_NODE_WIDTH,
  HOVER_STATE,
  NODE_TYPE,
  TEXT_HALO_ALPHA,
  Z,
} from './constants.js';
import { kgdiffData } from './map.js';

type NodeStyle = NonNullable<NodeData['style']>;
type EdgeStyle = NonNullable<EdgeData['style']>;

const CHANGE_FAMILIES: ReadonlySet<string> = new Set<ChangeFamily>([
  'added',
  'removed',
  'content',
  'structure',
  'identity',
]);

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Hover on a node, as the resolver does it: a 2-wide stroke in the family's strong color
 * (secondary text color for context), drawn on top, label revealed even below its LOD zoom.
 */
export function hoverNodeStyle(datum: NodeData, theme: Theme): NodeStyle {
  const d = kgdiffData(datum.data);
  if (d === null || d.kgdiff !== 'node') return {};
  const style = datum.style ?? {};
  const fam = d.family;
  const opacity = Math.max(num(style.labelOpacity, 0), num(style.opacity, 1));
  return {
    lineWidth: HOVER_NODE_WIDTH,
    stroke:
      d.changed && CHANGE_FAMILIES.has(fam)
        ? theme.family[fam as ChangeFamily].strong
        : theme.text.secondary,
    zIndex: Z.node + Z.span - 1,
    label: typeof style.labelText === 'string' && style.labelText.length > 0,
    labelOpacity: opacity,
    labelStrokeOpacity: TEXT_HALO_ALPHA * opacity,
  };
}

/** Hover on an edge: at least 2.5 wide, arrowhead, on top, its label shown. */
export function hoverEdgeStyle(datum: EdgeData, theme: Theme): EdgeStyle {
  const d = kgdiffData(datum.data);
  if (d === null || (d.kgdiff !== 'edge' && d.kgdiff !== 'glyph')) return {};
  const style = datum.style ?? {};
  const own = typeof style.labelText === 'string' && style.labelText.length > 0;
  const text = own ? (style.labelText as string) : d.label;
  const opacity = Math.max(num(style.labelOpacity, 0), num(style.opacity, 1));
  return {
    lineWidth: Math.max(num(style.lineWidth, 1), HOVER_EDGE_WIDTH),
    endArrow: datum.source !== datum.target,
    zIndex: (d.kgdiff === 'glyph' ? Z.glyph : Z.edge) + Z.span - 1,
    label: text.length > 0,
    labelText: text,
    labelFill: own ? (style.labelFill as string) : theme.neutral.label,
    labelFontSize: own ? num(style.labelFontSize, EDGE_LABEL_SIZE) : EDGE_LABEL_SIZE,
    labelOpacity: opacity,
    labelStrokeOpacity: TEXT_HALO_ALPHA * opacity,
  };
}

export interface GeneratedOptionsInput {
  readonly container: HTMLElement | string;
  readonly data: NonNullable<GraphOptions['data']>;
  readonly theme: () => Theme;
  readonly interactive: boolean;
  /** Whether a pointer event may activate the hover state. */
  readonly hoverable: (event: IEvent) => boolean;
}

/** Update animations: what interpolates when a frame replaces the previous one. */
const NODE_ANIMATION = {
  enter: 'fade',
  exit: 'fade',
  show: 'fade',
  hide: 'fade',
  update: [
    {
      fields: [
        'x',
        'y',
        'size',
        'fill',
        'stroke',
        'lineWidth',
        'opacity',
        'labelOpacity',
        'ringOpacity',
        'haloStrokeOpacity',
        'sublabelOpacity',
      ],
    },
  ],
  translate: [{ fields: ['x', 'y'] }],
};

const EDGE_ANIMATION = {
  enter: 'fade',
  exit: 'fade',
  show: 'fade',
  hide: 'fade',
  update: [
    {
      fields: [
        'sourceNode',
        'targetNode',
        'stroke',
        'lineWidth',
        'opacity',
        'labelOpacity',
        'curveOffset',
      ],
    },
  ],
  translate: [{ fields: ['sourceNode', 'targetNode'] }],
};

export function generatedOptions(input: GeneratedOptionsInput): GraphOptions {
  const theme = input.theme;
  return {
    container: input.container,
    autoResize: true,
    theme: false,
    padding: 32,
    data: input.data,
    node: {
      type: NODE_TYPE,
      state: { [HOVER_STATE]: (datum: NodeData) => hoverNodeStyle(datum, theme()) },
      animation: NODE_ANIMATION,
    },
    edge: {
      state: { [HOVER_STATE]: (datum: EdgeData) => hoverEdgeStyle(datum, theme()) },
      animation: EDGE_ANIMATION,
    },
    behaviors: input.interactive
      ? [
          'zoom-canvas',
          'drag-canvas',
          {
            type: 'hover-activate',
            key: HOVER_BEHAVIOR_KEY,
            state: HOVER_STATE,
            degree: 0,
            enable: input.hoverable,
          },
        ]
      : [],
    plugins: [
      { type: 'background', key: BACKGROUND_PLUGIN_KEY, background: theme().canvas.background },
    ],
  };
}

const CONCAT = new Set(['behaviors', 'plugins', 'transforms']);

function isPlain(v: unknown): v is Record<string, unknown> {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const base = out[key];
    out[key] = isPlain(base) && isPlain(value) ? deepMerge(base, value) : value;
  }
  return out;
}

/**
 * User options over generated ones: `behaviors`, `plugins` and `transforms` are appended to the
 * generated lists; plain objects (`node`, `edge`, `node.state`…) merge recursively; everything
 * else (arrays, functions, primitives) from `user` replaces the generated value.
 */
export function mergeG6Options(
  generated: GraphOptions,
  user: Readonly<Record<string, unknown>> | undefined,
): GraphOptions {
  if (user === undefined) return generated;
  const out: Record<string, unknown> = { ...generated };
  for (const [key, value] of Object.entries(user)) {
    const base = out[key];
    if (CONCAT.has(key) && Array.isArray(base) && Array.isArray(value))
      out[key] = [...base, ...value];
    else if (isPlain(base) && isPlain(value)) out[key] = deepMerge(base, value);
    else out[key] = value;
  }
  // The merged object is GraphOptions plus whatever the caller added; G6 validates it.
  return out as GraphOptions;
}
