/**
 * fast-check generators: random graphs full of edge cases (special-character ids, CJK,
 * dangling edges, parallel edges, self-loops, replacement hints) and random edit scripts
 * that turn one version into another.
 */
import type { Attrs, AttrValue, EdgeInput, GraphInput, NodeInput } from '@kgdiff/core';
import fc from 'fast-check';

export const ID_POOL = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'x|y',
  'q"uote',
  'back\\slash',
  'http://ex.org/n#1',
  'GO:0008150',
  '企业',
  '法定代表人',
  ' sp ace ',
  'emoji😀',
  'n#2',
  '["a","p","b"]',
  'a@before',
] as const;

export const LABEL_POOL = [
  'Alpha',
  'alpha',
  'Alpha Beta',
  'Marie Curie',
  'Marie Skłodowska-Curie',
  'Univ. of Paris',
  'University of Paris',
  '企业',
  '上市公司',
  '法人代表',
  '法定代表人',
  'x',
  '…',
] as const;

export const PREDICATES = [
  'p',
  'q',
  'is_a',
  'rdfs:subClassOf',
  'kg:持股',
  'http://ex.org/rel#part_of',
  '',
] as const;
const TYPES = ['Person', 'Org', 'Class'] as const;
const ATTR_KEYS = ['k1', 'k2', '名称', 'a.b'] as const;

const attrValue: fc.Arbitrary<AttrValue> = fc.oneof(
  fc.string({ maxLength: 4 }),
  fc.integer({ min: -3, max: 3 }),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.integer({ min: 0, max: 2 }), { maxLength: 2 }),
  fc.record({ x: fc.integer({ min: 0, max: 2 }), y: fc.constantFrom('u', 'v') }),
);

const attrs: fc.Arbitrary<Attrs> = fc.dictionary(fc.constantFrom(...ATTR_KEYS), attrValue, {
  maxKeys: 3,
});

function compact<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined)) as T;
}

const nodeFields = fc.record(
  {
    label: fc.constantFrom(...LABEL_POOL),
    type: fc.subarray([...TYPES], { maxLength: 2 }),
    aliases: fc.subarray([...LABEL_POOL], { maxLength: 2 }),
    attrs,
    deprecated: fc.boolean(),
    replacedBy: fc.subarray([...ID_POOL], { maxLength: 1 }),
  },
  { requiredKeys: [] },
);

const edgeFields = fc.record(
  {
    s: fc.nat(),
    t: fc.nat(),
    predicate: fc.constantFrom(...PREDICATES),
    label: fc.constantFrom('holds', '持股', 'x'),
    attrs,
    dangling: fc.boolean(),
    withId: fc.boolean(),
  },
  { requiredKeys: ['s', 't', 'predicate'] },
);

export interface GraphOptions {
  readonly maxNodes?: number;
  readonly maxEdges?: number;
}

/** A random graph with unique node ids and unique edge ids (when present). */
export function graphArb({
  maxNodes = 10,
  maxEdges = 16,
}: GraphOptions = {}): fc.Arbitrary<GraphInput> {
  return fc
    .tuple(
      fc.uniqueArray(fc.constantFrom(...ID_POOL), { maxLength: maxNodes }),
      fc.array(nodeFields, { maxLength: maxNodes }),
      fc.array(edgeFields, { maxLength: maxEdges }),
    )
    .map(([ids, fields, edgeSpecs]) => {
      const nodes: NodeInput[] = ids.map((id, i) => compact({ id, ...(fields[i] ?? {}) }));
      const edges: EdgeInput[] = [];
      if (ids.length > 0) {
        edgeSpecs.forEach((spec, i) => {
          const source = ids[spec.s % ids.length] as string;
          const target = spec.dangling ? 'dangling' : (ids[spec.t % ids.length] as string);
          edges.push(
            compact({
              id: spec.withId ? `e${i}` : undefined,
              source,
              target,
              predicate: spec.predicate,
              label: spec.label,
              attrs: spec.attrs,
            }),
          );
        });
      }
      return { nodes, edges };
    });
}

// ─── Edit scripts ────────────────────────────────────────────────────────────

export type Mutation =
  | { readonly kind: 'addNode'; readonly id: string; readonly label: string }
  | { readonly kind: 'removeNode'; readonly i: number }
  | { readonly kind: 'rename'; readonly i: number; readonly label: string }
  | {
      readonly kind: 'setAttr';
      readonly i: number;
      readonly key: string;
      readonly value: AttrValue;
    }
  | { readonly kind: 'delAttr'; readonly i: number }
  | { readonly kind: 'setTypes'; readonly i: number; readonly types: string[] }
  | { readonly kind: 'setAliases'; readonly i: number; readonly aliases: string[] }
  | { readonly kind: 'deprecate'; readonly i: number; readonly j: number }
  | { readonly kind: 'addEdge'; readonly s: number; readonly t: number; readonly predicate: string }
  | { readonly kind: 'removeEdge'; readonly j: number }
  | { readonly kind: 'retarget'; readonly j: number; readonly t: number }
  | { readonly kind: 'repredicate'; readonly j: number; readonly predicate: string }
  | { readonly kind: 'move'; readonly i: number; readonly t: number }
  | { readonly kind: 'mergeInto'; readonly i: number; readonly j: number; readonly hint: boolean }
  | { readonly kind: 'split'; readonly i: number; readonly id: string }
  | { readonly kind: 'rekey'; readonly i: number; readonly id: string; readonly hint: boolean }
  | { readonly kind: 'edgeAttr'; readonly j: number; readonly value: AttrValue }
  | { readonly kind: 'edgeLabel'; readonly j: number; readonly label: string };

const NEW_IDS = ['n1', 'n2', 'n3', 'Z|z', '新节点'] as const;

export const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({
    kind: fc.constant('addNode' as const),
    id: fc.constantFrom(...NEW_IDS),
    label: fc.constantFrom(...LABEL_POOL),
  }),
  fc.record({ kind: fc.constant('removeNode' as const), i: fc.nat() }),
  fc.record({
    kind: fc.constant('rename' as const),
    i: fc.nat(),
    label: fc.constantFrom(...LABEL_POOL),
  }),
  fc.record({
    kind: fc.constant('setAttr' as const),
    i: fc.nat(),
    key: fc.constantFrom(...ATTR_KEYS),
    value: attrValue,
  }),
  fc.record({ kind: fc.constant('delAttr' as const), i: fc.nat() }),
  fc.record({
    kind: fc.constant('setTypes' as const),
    i: fc.nat(),
    types: fc.subarray([...TYPES]),
  }),
  fc.record({
    kind: fc.constant('setAliases' as const),
    i: fc.nat(),
    aliases: fc.subarray([...LABEL_POOL], { maxLength: 2 }),
  }),
  fc.record({ kind: fc.constant('deprecate' as const), i: fc.nat(), j: fc.nat() }),
  fc.record({
    kind: fc.constant('addEdge' as const),
    s: fc.nat(),
    t: fc.nat(),
    predicate: fc.constantFrom(...PREDICATES),
  }),
  fc.record({ kind: fc.constant('removeEdge' as const), j: fc.nat() }),
  fc.record({ kind: fc.constant('retarget' as const), j: fc.nat(), t: fc.nat() }),
  fc.record({
    kind: fc.constant('repredicate' as const),
    j: fc.nat(),
    predicate: fc.constantFrom(...PREDICATES),
  }),
  fc.record({ kind: fc.constant('move' as const), i: fc.nat(), t: fc.nat() }),
  fc.record({
    kind: fc.constant('mergeInto' as const),
    i: fc.nat(),
    j: fc.nat(),
    hint: fc.boolean(),
  }),
  fc.record({ kind: fc.constant('split' as const), i: fc.nat(), id: fc.constantFrom(...NEW_IDS) }),
  fc.record({
    kind: fc.constant('rekey' as const),
    i: fc.nat(),
    id: fc.constantFrom(...NEW_IDS),
    hint: fc.boolean(),
  }),
  fc.record({ kind: fc.constant('edgeAttr' as const), j: fc.nat(), value: attrValue }),
  fc.record({
    kind: fc.constant('edgeLabel' as const),
    j: fc.nat(),
    label: fc.constantFrom('holds', 'owns', '持股'),
  }),
);

type MutableNode = { -readonly [K in keyof NodeInput]: NodeInput[K] };
type MutableEdge = { -readonly [K in keyof EdgeInput]: EdgeInput[K] };

/** Applies an edit script to a copy of `graph`. Indices wrap; impossible edits are skipped. */
export function mutate(graph: GraphInput, script: readonly Mutation[]): GraphInput {
  const nodes: MutableNode[] = graph.nodes.map((n) => ({ ...n }));
  const edges: MutableEdge[] = graph.edges.map((e) => ({ ...e }));
  const pick = <T>(list: readonly T[], i: number): T | undefined =>
    list.length ? list[i % list.length] : undefined;
  const hasId = (id: string): boolean => nodes.some((n) => n.id === id);
  const dropNode = (id: string): void => {
    const at = nodes.findIndex((n) => n.id === id);
    if (at >= 0) nodes.splice(at, 1);
    for (let k = edges.length - 1; k >= 0; k--) {
      const e = edges[k] as MutableEdge;
      if (e.source === id || e.target === id) edges.splice(k, 1);
    }
  };
  const nextEdgeId = (): string => `m${edges.length}-${Math.abs(script.length)}-${nodes.length}`;
  for (const m of script) {
    switch (m.kind) {
      case 'addNode':
        if (!hasId(m.id)) nodes.push({ id: m.id, label: m.label });
        break;
      case 'removeNode': {
        const n = pick(nodes, m.i);
        if (n) dropNode(n.id);
        break;
      }
      case 'rename': {
        const n = pick(nodes, m.i);
        if (n) n.label = m.label;
        break;
      }
      case 'setAttr': {
        const n = pick(nodes, m.i);
        if (n) n.attrs = { ...n.attrs, [m.key]: m.value };
        break;
      }
      case 'delAttr': {
        const n = pick(nodes, m.i);
        if (n?.attrs) {
          const [first] = Object.keys(n.attrs);
          if (first !== undefined) {
            const { [first]: _, ...rest } = n.attrs;
            n.attrs = rest;
          }
        }
        break;
      }
      case 'setTypes': {
        const n = pick(nodes, m.i);
        if (n) n.type = m.types;
        break;
      }
      case 'setAliases': {
        const n = pick(nodes, m.i);
        if (n) n.aliases = m.aliases;
        break;
      }
      case 'deprecate': {
        const n = pick(nodes, m.i);
        const into = pick(nodes, m.j);
        if (n && into && n !== into) {
          n.deprecated = true;
          n.replacedBy = [into.id];
        }
        break;
      }
      case 'addEdge': {
        const s = pick(nodes, m.s);
        const t = pick(nodes, m.t);
        if (s && t) edges.push({ source: s.id, target: t.id, predicate: m.predicate });
        break;
      }
      case 'removeEdge':
        if (edges.length) edges.splice(m.j % edges.length, 1);
        break;
      case 'retarget': {
        const e = pick(edges, m.j);
        const t = pick(nodes, m.t);
        if (e && t) e.target = t.id;
        break;
      }
      case 'repredicate': {
        const e = pick(edges, m.j);
        if (e) {
          e.predicate = m.predicate;
          delete e.label;
        }
        break;
      }
      case 'move': {
        const child = pick(nodes, m.i);
        const parent = pick(nodes, m.t);
        if (!child || !parent) break;
        for (let k = edges.length - 1; k >= 0; k--) {
          const e = edges[k] as MutableEdge;
          if (e.source === child.id && e.predicate === 'is_a') edges.splice(k, 1);
        }
        edges.push({ source: child.id, target: parent.id, predicate: 'is_a' });
        break;
      }
      case 'mergeInto': {
        const source = pick(nodes, m.i);
        const target = pick(nodes, m.j);
        if (!source || !target || source === target) break;
        for (const e of edges) {
          if (e.source === source.id) e.source = target.id;
          if (e.target === source.id) e.target = target.id;
        }
        const label = source.label ?? source.id;
        target.aliases = [...(target.aliases ?? []), label];
        if (m.hint) target.replaces = [...(target.replaces ?? []), source.id];
        dropNode(source.id);
        break;
      }
      case 'split': {
        const source = pick(nodes, m.i);
        if (!source || hasId(m.id)) break;
        nodes.push({
          id: m.id,
          label: `${source.label ?? source.id} (part)`,
          replaces: [source.id],
        });
        edges.forEach((e, k) => {
          if (k % 2 === 0 && e.source === source.id) e.source = m.id;
        });
        break;
      }
      case 'rekey': {
        const n = pick(nodes, m.i);
        if (!n || hasId(m.id)) break;
        const old = n.id;
        n.id = m.id;
        // Like an OBO alt_id: the new id declares the old one it replaces.
        if (m.hint) n.replaces = [...(n.replaces ?? []), old];
        for (const e of edges) {
          if (e.source === old) e.source = m.id;
          if (e.target === old) e.target = m.id;
        }
        break;
      }
      case 'edgeAttr': {
        const e = pick(edges, m.j);
        if (e) e.attrs = { ...e.attrs, w: m.value };
        break;
      }
      case 'edgeLabel': {
        const e = pick(edges, m.j);
        if (e) e.label = m.label;
        break;
      }
      default: {
        const exhaustive: never = m;
        throw new Error(`unknown mutation ${String(exhaustive)}`);
      }
    }
  }
  // Edge ids stay unique: the shuffle-determinism property requires it under `id` identity.
  const seen = new Set<string>();
  for (const e of edges) {
    if (e.id === undefined) continue;
    if (seen.has(e.id)) e.id = nextEdgeId();
    seen.add(e.id);
  }
  return { nodes, edges };
}

/** A random pair (before, after) where `after` is `before` plus a random edit script. */
export function versionPairArb(options?: GraphOptions): fc.Arbitrary<[GraphInput, GraphInput]> {
  return fc
    .tuple(graphArb(options), fc.array(mutationArb, { maxLength: 8 }))
    .map(([before, script]) => [before, mutate(before, script)] as [GraphInput, GraphInput]);
}

/** Deterministic Fisher–Yates shuffle driven by a seed. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function shuffleGraph(graph: GraphInput, seed: number): GraphInput {
  return {
    ...graph,
    nodes: shuffle(graph.nodes, seed),
    edges: shuffle(graph.edges, seed * 31 + 7),
  };
}
