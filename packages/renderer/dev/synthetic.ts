/**
 * DEV / TEST ONLY: a deterministic synthetic diff frame exercising every primitive the renderer
 * draws — neutral context, added nodes with halos, removed ghosts with struck labels, renamed
 * nodes with rings, badges and struck secondary labels, structure moves with pivots and ghost
 * edges, merges (ghost sources, arcs, halo + badge on the target), a split, suggestions with
 * `?`, parallel curved edges, self-loops, dashed / partial / labelled / arrowed edges,
 * collapsed pills, CJK and very long labels. `animate(t)` drives pulses, growth and dash flow
 * in place, like the scene resolver does during replay.
 */
import type {
  ChangeFamily,
  CollapsedGroup,
  EdgeVisual,
  FrameVisuals,
  GlyphVisual,
  LabelVisual,
  NodeVisual,
  Theme,
} from '@kgdiff/scene';

export interface Synthetic {
  /** Union (overlay) frame. */
  readonly frame: FrameVisuals;
  /** Before-version frame for swipe. */
  readonly before: FrameVisuals;
  /** Update animated properties for time `t` (ms) in place; returns `frame`. */
  animate(t: number): FrameVisuals;
}

type Role =
  | 'neutral'
  | 'added'
  | 'removed'
  | 'content'
  | 'structure'
  | 'merge-target'
  | 'merge-source'
  | 'split-source'
  | 'split-target';

const GHOST_DASH: readonly number[] = Object.freeze([3, 2.5]);
const EDGE_DASH: readonly number[] = Object.freeze([4, 3]);

const WORDS = [
  'process',
  'binding',
  'regulation',
  'transport',
  'kinase',
  'membrane',
  'signal',
  'response',
  'cell',
  'protein',
  'metabolic',
  'activity',
  'complex',
  'receptor',
  'pathway',
  'development',
];
const CJK = [
  '上市公司',
  '企业',
  '生物过程',
  '细胞组分',
  '分子功能',
  '知识图谱',
  '金融机构',
  '子公司',
];
const PREDICATES = ['part of', 'is_a', 'regulates', 'holds', 'has part', 'occurs in'];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function label(text: string, color: string, o: Partial<LabelVisual> = {}): LabelVisual {
  return {
    text,
    color,
    alpha: 1,
    size: 12,
    weight: 400,
    strike: false,
    priority: 0.3,
    minZoom: 0.9,
    offset: 5,
    ...o,
  };
}

function nodeVisual(x: number, y: number, r: number, fill: string | null): NodeVisual {
  return {
    visible: true,
    x,
    y,
    r,
    alpha: 1,
    family: 'neutral',
    fill,
    stroke: null,
    strokeWidth: 1.25,
    dash: null,
    ring: null,
    halo: null,
    label: null,
    secondaryLabel: null,
    badge: null,
    pulse: 0,
    z: 0,
  };
}

/** Build the synthetic frames for `theme` with about `count` nodes. */
export function createSynthetic(theme: Theme, count = 2000, seed = 7): Synthetic {
  const rand = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const fam = theme.family;

  // ── Layout: clusters on a spiral, nodes on phyllotaxis discs inside each cluster ──
  const clusters = Math.max(4, Math.round(count / 220));
  const per = Math.ceil(count / clusters);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const xs: number[] = [];
  const ys: number[] = [];
  const cluster: number[] = [];
  const local: number[] = [];
  const centers: [number, number][] = [];
  for (let c = 0; c < clusters; c++) {
    const rr = 820 * Math.sqrt(c + 0.4);
    centers.push([rr * Math.cos(c * golden), rr * Math.sin(c * golden)]);
  }
  for (let i = 0; i < count; i++) {
    const c = Math.floor(i / per);
    const j = i - c * per;
    const [cx, cy] = centers[c]!;
    const r = 30 * Math.sqrt(j + 0.5);
    xs.push(cx + r * Math.cos(j * golden));
    ys.push(cy + r * Math.sin(j * golden));
    cluster.push(c);
    local.push(j);
  }

  // ── Topology: Fibonacci neighbours are spatial neighbours on a phyllotaxis disc ──
  const pairs: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const j = local[i]!;
    if (j >= 21 && rand() < 0.75) pairs.push([i, i - 21]);
    if (j >= 13 && rand() < 0.5) pairs.push([i, i - 13]);
    if (j > 0 && j < 13) pairs.push([i, i - j]);
  }
  for (let c = 1; c < clusters; c++) pairs.push([c * per, (c - 1) * per]);
  const degree = new Array<number>(count).fill(0);
  for (const [a, b] of pairs) {
    degree[a]!++;
    degree[b]!++;
  }

  // ── Roles ──
  const roles: Role[] = new Array<Role>(count).fill('neutral');
  for (let i = 0; i < count; i++) {
    if (local[i]! < 3) continue;
    const u = rand();
    roles[i] =
      u < 0.03
        ? 'added'
        : u < 0.05
          ? 'removed'
          : u < 0.08
            ? 'content'
            : u < 0.1
              ? 'structure'
              : u < 0.108
                ? 'merge-target'
                : 'neutral';
  }
  // Merge sources: two phyllotaxis neighbours of each target.
  const mergeArcs: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    if (roles[i] !== 'merge-target') continue;
    for (const d of [8, 13]) {
      const s = i + d;
      if (s < count && cluster[s] === cluster[i] && roles[s] === 'neutral') {
        roles[s] = 'merge-source';
        mergeArcs.push([s, i]);
      }
    }
  }
  // One split per ~1000 nodes.
  const splitArcs: [number, number][] = [];
  for (let c = 0; c < clusters; c += 4) {
    const s = c * per + 40;
    if (s + 21 >= count) continue;
    roles[s] = 'split-source';
    for (const d of [13, 21]) {
      roles[s + d] = 'split-target';
      splitArcs.push([s, s + d]);
    }
  }

  // ── Nodes ──
  const nodes: NodeVisual[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.min(14, Math.max(4, 4 + 2.2 * Math.sqrt(degree[i]!)));
    const role = roles[i]!;
    const importance = Math.min(1, degree[i]! / 14);
    const cjk = i % 23 === 0;
    const long = i % 157 === 0;
    const base = cjk ? pick(CJK) : `${pick(WORDS)} ${pick(WORDS)}`;
    const name = long
      ? `${base} of the extremely long and verbose ontology term that keeps going ${i}`
      : `${base}${cjk ? '' : ` ${i}`}`;
    const n = nodeVisual(xs[i]!, ys[i]!, r, theme.neutral.node);
    n.stroke = theme.neutral.nodeStroke;
    n.strokeWidth = 1;
    n.label = label(name, theme.neutral.label, {
      priority: importance * 0.5,
      minZoom: importance >= 0.7 ? 0.6 : 0.9,
    });
    const changed = (f: ChangeFamily): void => {
      n.family = f;
      n.fill = fam[f].base;
      n.stroke = null;
      n.z = 1;
      n.label = label(name, theme.text.primary, {
        weight: 600,
        priority: 0.75 + importance * 0.1,
        minZoom: 0.35,
      });
    };
    switch (role) {
      case 'added':
        changed('added');
        n.halo = {
          color: fam.added.base,
          radius: theme.glow ? 2.6 * r : r,
          alpha: theme.glow ? 0.32 : 0.35,
        };
        break;
      case 'removed':
        changed('removed');
        n.fill = null;
        n.stroke = fam.removed.base;
        n.strokeWidth = 1.25;
        n.dash = GHOST_DASH;
        n.label = label(name, fam.removed.text, {
          weight: 600,
          strike: true,
          priority: 0.78,
          minZoom: 0.35,
        });
        break;
      case 'content':
        changed('content');
        n.ring = { color: fam.content.base, width: 1.5, gap: 3.5, alpha: 1 };
        n.secondaryLabel = label(`${pick(WORDS)} (old ${i})`, theme.text.muted, {
          size: 11,
          strike: true,
          priority: 0.76,
          minZoom: 0.35,
          offset: 19,
        });
        n.badge = {
          text: '+2 −1 ~1',
          color: fam.content.text,
          background: fam.content.soft,
          minZoom: 1.2,
        };
        break;
      case 'structure':
        changed('structure');
        n.ring = { color: fam.structure.base, width: 1.5, gap: 3.5, alpha: 1 };
        break;
      case 'merge-target':
        changed('identity');
        n.ring = { color: fam.identity.base, width: 1.5, gap: 3.5, alpha: 1 };
        n.halo = {
          color: fam.identity.base,
          radius: theme.glow ? 2.6 * r : r,
          alpha: theme.glow ? 0.32 : 0.35,
        };
        n.badge = {
          text: '⊕ 3',
          color: fam.identity.text,
          background: fam.identity.soft,
          minZoom: 1.2,
        };
        n.z = 2;
        break;
      case 'merge-source':
        changed('identity');
        n.fill = null;
        n.stroke = fam.identity.base;
        n.strokeWidth = 1.25;
        n.dash = GHOST_DASH;
        n.label = label(name, theme.text.muted, { strike: true, priority: 0.7, minZoom: 0.35 });
        break;
      case 'split-source':
        changed('identity');
        n.fill = null;
        n.stroke = fam.identity.base;
        n.dash = GHOST_DASH;
        break;
      case 'split-target':
        changed('identity');
        n.ring = { color: fam.identity.base, width: 1.5, gap: 3.5, alpha: 1 };
        break;
      case 'neutral':
        break;
      default: {
        const never: never = role;
        throw new Error(String(never));
      }
    }
    nodes.push(n);
  }

  // ── Edges ──
  const edges: EdgeVisual[] = [];
  const edge = (a: number, b: number, o: Partial<EdgeVisual> = {}): EdgeVisual => {
    const e: EdgeVisual = {
      visible: true,
      x1: xs[a]!,
      y1: ys[a]!,
      x2: xs[b]!,
      y2: ys[b]!,
      r1: nodes[a]!.r,
      r2: nodes[b]!.r,
      curvature: 0,
      color: theme.neutral.edge,
      width: 1,
      alpha: 1,
      dash: null,
      dashOffset: 0,
      arrow: true,
      // Arrowheads: changed edges always, neutral context from zoom 1.2.
      arrowMinZoom: (o.z ?? 0) > 0 ? 0 : 1.2,
      progress: 1,
      fromTarget: false,
      label: null,
      z: 0,
      ...o,
    };
    edges.push(e);
    return e;
  };
  const growing: EdgeVisual[] = [];
  const flowing: EdgeVisual[] = [];
  const pivots: GlyphVisual[] = [];
  const glyphs: GlyphVisual[] = [];
  const glyph = (
    kind: GlyphVisual['kind'],
    a: number,
    b: number,
    color: string,
    o: Partial<GlyphVisual> = {},
  ): GlyphVisual => {
    const g: GlyphVisual = {
      kind,
      x1: xs[a]!,
      y1: ys[a]!,
      x2: xs[b]!,
      y2: ys[b]!,
      // Trim at the node plus ring clearance (world units), like the scene does.
      r1: kind === 'pivot' ? 0 : nodes[a]!.r + 4,
      r2: kind === 'pivot' ? 0 : nodes[b]!.r + 4,
      color,
      alpha: 1,
      width: 1.5,
      dash: null,
      progress: 1,
      curvature: 0.22,
      label: null,
      ...o,
    };
    glyphs.push(g);
    return g;
  };
  const edgeLabel = (text: string, color: string): LabelVisual =>
    label(text, color, { size: 10.5, weight: 500, priority: 0.6, minZoom: 1.1, offset: 0 });

  pairs.forEach(([a, b], idx) => {
    const ra = roles[a]!;
    const rb = roles[b]!;
    if (ra === 'added' || rb === 'added') {
      const e = edge(a, b, {
        color: fam.added.base,
        width: 1.75,
        z: 1,
        fromTarget: ra === 'added',
        label: edgeLabel(pick(PREDICATES), fam.added.text),
      });
      if (idx % 3 === 0) growing.push(e);
    } else if (ra === 'removed' || rb === 'removed') {
      const e = edge(a, b, { color: fam.removed.base, width: 1.75, dash: EDGE_DASH, z: 1 });
      if (idx % 2 === 0) flowing.push(e);
    } else if (ra === 'structure' && idx % 2 === 0) {
      // Retarget: new solid edge, old dashed ghost, pivot at the shared endpoint, move arc.
      const old = b + 1 < count && cluster[b + 1] === cluster[a] ? b + 1 : b;
      edge(a, b, {
        color: fam.structure.base,
        width: 1.75,
        z: 1,
        label: edgeLabel('is_a', fam.structure.text),
      });
      edge(a, old, { color: fam.removed.base, width: 1.75, dash: EDGE_DASH, alpha: 0.45, z: 1 });
      pivots.push(glyph('pivot', a, a, fam.structure.base, { curvature: 0, width: 6 }));
      if (old !== b) glyph('move-arrow', old, b, fam.structure.base, { dash: [2, 2.5] });
    } else if (ra === 'merge-source' || rb === 'merge-source') {
      edge(a, b, { color: fam.identity.base, width: 1.75, dash: EDGE_DASH, alpha: 0.5, z: 1 });
    } else {
      edge(a, b);
    }
  });
  // Parallel edges with curvature ±0.18·k and labels; a few self-loops.
  for (let i = 0; i < pairs.length; i += 97) {
    const [a, b] = pairs[i]!;
    if (cluster[a] !== cluster[b]) continue;
    edge(a, b, {
      curvature: 0.18,
      color: fam.content.base,
      width: 1.75,
      z: 1,
      label: edgeLabel('regulates', fam.content.text),
    });
    edge(a, b, {
      curvature: -0.18,
      color: fam.content.base,
      width: 1.75,
      z: 1,
      label: edgeLabel('has part', fam.content.text),
    });
    edge(a, b, { curvature: 0.36, z: 0 });
  }
  for (let i = 5; i < count; i += 401) {
    edge(i, i, {
      color: fam.added.base,
      width: 1.75,
      z: 1,
      label: edgeLabel('same as', fam.added.text),
    });
  }

  // ── Glyphs ──
  for (const [s, t] of mergeArcs) glyph('merge-arrow', s, t, fam.identity.base);
  for (const [s, t] of splitArcs)
    glyph('split-arrow', s, t, fam.identity.base, { curvature: -0.22 });
  const removedNodes = roles.flatMap((r, i) => (r === 'removed' ? [i] : []));
  const addedNodes = roles.flatMap((r, i) => (r === 'added' ? [i] : []));
  for (
    let i = 0;
    i < Math.min(removedNodes.length, addedNodes.length, Math.ceil(count / 250));
    i++
  ) {
    glyph('suggestion', removedNodes[i]!, addedNodes[i]!, fam.identity.base, {
      curvature: 0.12,
      width: 1.75,
      label: label(`same? ${Math.round(70 + 25 * rand())}%`, fam.identity.text, {
        size: 10.5,
        priority: 0.65,
        minZoom: 0.6,
        offset: 0,
      }),
    });
  }

  // ── Collapsed pills at cluster rims ──
  const collapsed: CollapsedGroup[] = centers
    .slice(0, Math.max(2, Math.floor(clusters / 2)))
    .map(([cx, cy], c) => ({
      id: `c${c}`,
      x: cx + 30 * Math.sqrt(per) + 60,
      y: cy - 40,
      count: 12 + ((c * 37) % 90),
      nodes: [],
      label: `+${12 + ((c * 37) % 90)} unchanged`,
    }));

  const pulsing = nodes.filter((n) => n.z > 0).filter((_, i) => i % 9 === 0);
  const frame: FrameVisuals = { nodes, edges, glyphs, collapsed, spotlight: 0 };

  // ── Before frame (swipe): before-state styling, nothing of the after version ──
  const beforeNodes = nodes.map((n, i): NodeVisual => {
    const role = roles[i]!;
    const copy: NodeVisual = { ...n, halo: null, badge: null, pulse: 0 };
    if (role === 'added' || role === 'split-target') copy.visible = false;
    if (role === 'removed' || role === 'merge-source' || role === 'split-source') {
      copy.fill = copy.stroke ?? copy.fill;
      copy.stroke = null;
      copy.dash = null;
      copy.label = n.label
        ? { ...n.label, strike: false, color: theme.text.primary, weight: 600 }
        : null;
    }
    if (role === 'content' && n.secondaryLabel) {
      copy.label = {
        ...n.secondaryLabel,
        size: 12,
        strike: false,
        offset: 5,
        color: theme.text.primary,
        weight: 600,
      };
      copy.secondaryLabel = null;
    }
    return copy;
  });
  const beforeEdges = edges.map((e): EdgeVisual => {
    const copy: EdgeVisual = { ...e, progress: 1 };
    if (e.color === fam.added.base) copy.visible = false;
    if (e.dash === EDGE_DASH && e.color === fam.removed.base) {
      copy.dash = null;
      copy.alpha = 1;
    }
    return copy;
  });
  const before: FrameVisuals = {
    nodes: beforeNodes,
    edges: beforeEdges,
    glyphs: [],
    collapsed,
    spotlight: 0,
  };

  return {
    frame,
    before,
    animate(t: number): FrameVisuals {
      const phase = (t % 1800) / 1800;
      for (let i = 0; i < pulsing.length; i++) {
        const p = (phase + i * 0.137) % 1;
        pulsing[i]!.pulse = p < 0.02 ? 0 : p;
      }
      for (let i = 0; i < growing.length; i++)
        growing[i]!.progress = Math.min(1, ((t / 2400 + i * 0.071) % 1) * 1.3);
      for (const e of flowing) e.dashOffset = -t / 60;
      for (let i = 0; i < glyphs.length; i++) {
        const g = glyphs[i]!;
        if (g.kind === 'merge-arrow') g.progress = Math.min(1, ((t / 3000 + i * 0.13) % 1) * 1.4);
      }
      return frame;
    },
  };
}
