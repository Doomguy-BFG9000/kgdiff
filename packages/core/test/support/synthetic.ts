/**
 * Deterministic synthetic graphs for performance tests.
 */
import type { EdgeInput, GraphInput, NodeInput } from '@kgdiff/core';

/** mulberry32: a tiny seeded PRNG (never Math.random in tests that must be reproducible). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PREDICATES = ['knows', 'worksFor', 'is_a', 'partOf', 'locatedIn', 'owns'];
const TYPES = ['Person', 'Organization', 'Place', 'Event'];

/** A graph of `n` nodes and `e` edges with exact ids `n0…`, typed, labelled and attributed. */
export function syntheticGraph(n: number, e: number, seed = 1): GraphInput {
  const random = prng(seed);
  const nodes: NodeInput[] = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    label: `Node ${i}`,
    type: TYPES[i % TYPES.length] as string,
    attrs: { rank: i % 17, code: `C-${i}` },
  }));
  const edges: EdgeInput[] = Array.from({ length: e }, () => ({
    source: `n${Math.floor(random() * n)}`,
    target: `n${Math.floor(random() * n)}`,
    predicate: PREDICATES[Math.floor(random() * PREDICATES.length)] as string,
  }));
  return { nodes, edges };
}

/** A realistic edit of `graph`: ~1% renames, attribute edits, removals, additions, retargets. */
export function editGraph(graph: GraphInput, seed = 2): GraphInput {
  const random = prng(seed);
  const nodes = graph.nodes
    .filter(() => random() > 0.005)
    .map((node) =>
      random() < 0.01
        ? { ...node, label: `${node.label} (renamed)`, attrs: { ...node.attrs, rank: -1 } }
        : node,
    );
  const kept = new Set(nodes.map((n) => n.id));
  const extra = Array.from({ length: Math.ceil(graph.nodes.length / 200) }, (_, i) => ({
    id: `new${i}`,
    label: `New ${i}`,
  }));
  const edges = graph.edges
    .filter((edge) => kept.has(edge.source) && kept.has(edge.target) && random() > 0.01)
    .map((edge) =>
      random() < 0.005
        ? { ...edge, target: (nodes[Math.floor(random() * nodes.length)] as NodeInput).id }
        : edge,
    );
  for (const node of extra)
    edges.push({ source: node.id, target: (nodes[0] as NodeInput).id, predicate: 'knows' });
  return { nodes: [...nodes, ...extra], edges };
}

const FIRST = [
  'Marie',
  'Pierre',
  'Ada',
  'Alan',
  'Grace',
  'Emmy',
  'Niels',
  'Lise',
  'Rosalind',
  'Dmitri',
  '李',
  '王',
  '张',
];
const LAST = [
  'Curie',
  'Lovelace',
  'Turing',
  'Hopper',
  'Noether',
  'Bohr',
  'Meitner',
  'Franklin',
  'Mendeleev',
  '明',
  '华',
  '强',
];
const ORGS = ['University', 'Institute', 'Laboratory', 'Society', 'Academy', 'College'];
const PLACES = [
  'Paris',
  'Warsaw',
  'London',
  'Copenhagen',
  'Vienna',
  'Berlin',
  'Beijing',
  'Shanghai',
];

/**
 * Two extractions of the same `n` entities with unrelated random ids: the second run
 * abbreviates, re-spells or reorders some names, as an LLM would.
 */
export function extractionPair(n: number, seed = 3): [GraphInput, GraphInput] {
  const random = prng(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const entities = Array.from({ length: n }, (_, i) => {
    const kind = i % 3;
    const label =
      kind === 0
        ? `${pick(FIRST)} ${pick(LAST)} ${i}`
        : kind === 1
          ? `${pick(ORGS)} of ${pick(PLACES)} ${i}`
          : `${pick(PLACES)} Station ${i}`;
    return { label, type: ['Person', 'Organization', 'Place'][kind] as string };
  });
  const variant = (label: string): string => {
    const r = random();
    if (r < 0.15) return label.replace('University', 'Univ.');
    if (r < 0.25) return label.toUpperCase();
    if (r < 0.3) return `${label} (disambiguated)`;
    return label;
  };
  const links = Array.from(
    { length: n * 2 },
    () => [Math.floor(random() * n), Math.floor(random() * n)] as const,
  );
  const build = (prefix: string, rename: boolean): GraphInput => {
    const ids = entities.map(() => `${prefix}_${Math.floor(random() * 1e9).toString(16)}`);
    return {
      nodes: entities.map((e, i) => ({
        id: ids[i] as string,
        label: rename ? variant(e.label) : e.label,
        type: e.type,
      })),
      edges: links.map(([s, t]) => ({
        source: ids[s] as string,
        target: ids[t] as string,
        predicate: 'related',
      })),
    };
  };
  return [build('a', false), build('b', true)];
}
