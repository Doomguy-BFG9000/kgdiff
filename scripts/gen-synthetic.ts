/**
 * Deterministic generator of synthetic before / after graph pairs for kgdiff benchmarks,
 * stress tests and demos.
 *
 *   pnpm tsx scripts/gen-synthetic.ts --nodes 10000 --seed 7 --out examples/generated/synth-10k
 *
 * The "before" graph is scale-free-ish: a class taxonomy (`is_a`, eight root kinds) and
 * entities that join one at a time by preferential attachment, each linked to its class with
 * `is_a` and to earlier entities with typed relations. The "after" graph applies a mutation
 * pass (renames, attribute edits, merges with `replaces` / `replacedBy` hints, moves,
 * retargets, edge adds / removes, node adds / removes, rekeys, deprecations) with configurable
 * rates. The ground truth of every mutation is written to meta.json.
 *
 * Same arguments → byte-identical files: one seeded PRNG stream per phase (the before graph
 * does not depend on the mutation rates), no Math.random, no clock. Node built-ins only.
 *
 * Options
 *   --nodes <n>           nodes in the before graph, classes included (default 1000, min 40)
 *   --seed <n>            PRNG seed, unsigned 32-bit integer (default 1)
 *   --out <dir>           output directory (default examples/generated/synth-<nodes>)
 *   --edges-per-node <m>  mean relations per entity (default 2; ≈ 3 edges per node with is_a)
 *   --locale <en|zh>      label alphabet: Latin syllables or CJK characters (default en)
 *   --cjk                 shorthand for --locale zh
 *   --rates <list>        comma-separated overrides, e.g. rename=0.05,merge=0
 *                         (keys and defaults: see DEFAULT_RATES)
 *   --help                print this help
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { AttrValue, GraphInput } from '@kgdiff/core';

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Mutation rates. Node-level rates are fractions of the before entities, edge-level rates
 * fractions of the before relation edges, `classMove` a fraction of the classes.
 */
const DEFAULT_RATES = {
  /** Label changed, id kept. */
  rename: 0.02,
  /** One attribute added, removed or changed. */
  attr: 0.03,
  /** Entity merged into another one of the same kind (sources counted). */
  merge: 0.005,
  /** Entity re-parented to another class of its kind. */
  move: 0.01,
  /** Class re-parented inside its kind. */
  classMove: 0.03,
  /** Relation edge pointed at another entity. */
  retarget: 0.01,
  /** New relation edge between existing entities. */
  edgeAdd: 0.01,
  /** Relation edge removed. */
  edgeRemove: 0.01,
  /** New entities (with their class link and relations). */
  add: 0.02,
  /** Entities removed with their edges. */
  remove: 0.01,
  /** Id changed, content kept: only similarity matching can pair it. */
  rekey: 0.005,
  /** Deprecated flag set, nothing else. */
  deprecate: 0.002,
} as const;

type RateKey = keyof typeof DEFAULT_RATES;
type Rates = Record<RateKey, number>;
type Locale = 'en' | 'zh';

interface Config {
  readonly nodes: number;
  readonly seed: number;
  readonly out: string;
  readonly edgesPerNode: number;
  readonly locale: Locale;
  readonly rates: Rates;
}

const HELP = `Usage: pnpm tsx scripts/gen-synthetic.ts [options]

  --nodes <n>           nodes in the before graph, classes included (default 1000, min 40)
  --seed <n>            PRNG seed, unsigned 32-bit integer (default 1)
  --out <dir>           output directory (default examples/generated/synth-<nodes>)
  --edges-per-node <m>  mean relations per entity (default 2; ≈ 3 edges per node with is_a)
  --locale <en|zh>      Latin syllable or CJK labels (default en); --cjk = --locale zh
  --rates <list>        overrides, e.g. rename=0.05,merge=0
                        keys: ${Object.keys(DEFAULT_RATES).join(', ')}
  --help                print this help

Writes before.json, after.json and meta.json (options + ground truth).`;

const KINDS = [
  'Agent',
  'Place',
  'Event',
  'Artifact',
  'Concept',
  'Document',
  'Organism',
  'Substance',
];
const KINDS_ZH = ['主体', '地点', '事件', '人造物', '概念', '文献', '生物', '物质'];

/** Relation predicates (none of them is a hierarchy predicate, so they never cause moves). */
const PREDICATES = [
  'relatedTo',
  'partOf',
  'locatedIn',
  'memberOf',
  'creates',
  'uses',
  'cites',
  'dependsOn',
  'follows',
  'influences',
  'owns',
  'hosts',
];

const SYLLABLES = (
  'ka lo mi ra ven tor sel dan qui mar bel zen ori tal nex vio sun pra del fen gro hal ' +
  'ist jun kel lum nor pel quo ris sam tur ulm vas wex yor zir ab ec id on ul bra cle dri ' +
  'fla gli kro pli sto tri vel xan yel zor char phi tha shu wen ast eno ira oda'
).split(' ');
const QUALIFIERS = ['Nova', 'Prime', 'Minor', 'Major', 'North', 'South', 'Alpha', 'Beta', 'II'];
const CJK = [
  ...'云海星安华明山川风雨林泉金石光辰宇龙凤和平春秋青红白玄文武德信诚智仁礼乐书画诗茶花月江河湖溪松竹梅兰菊桥城村港湾岛峰岭谷原田园晨曦虹霞雪霜露岩沙洲汀泽汐澜涛',
];
const CJK_QUALIFIERS = ['新', '东', '西', '南', '北', '上', '下', '中'];

const STATUSES = ['active', 'inactive', 'draft', 'archived'];
const SOURCES = ['crawl', 'curated', 'import', 'llm'];

// ─── Small utilities ─────────────────────────────────────────────────────────

class GeneratorError extends Error {
  override readonly name = 'GeneratorError';
}

/** Element at `i`, failing loudly instead of returning `undefined`. */
function at<T>(list: readonly T[], i: number): T {
  const value = list[i];
  if (value === undefined) throw new GeneratorError(`index ${i} out of range (${list.length})`);
  return value;
}

/** FNV-1a over a string, used to derive independent PRNG streams from one seed. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: tiny, fast, good enough for test data. */
class Rng {
  private state: number;

  constructor(seed: number, stream: string) {
    this.state = (seed ^ hash32(stream)) >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Integer in [min, max]. */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(list: readonly T[]): T {
    return at(list, this.int(list.length));
  }

  /** Fisher–Yates on a copy. */
  shuffle<T>(list: readonly T[]): T[] {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = at(out, i);
      out[i] = at(out, j);
      out[j] = tmp;
    }
    return out;
  }
}

const kindName = (locale: Locale, kind: number): string =>
  at(locale === 'zh' ? KINDS_ZH : KINDS, kind);
const isLocale = (x: string): x is Locale => x === 'en' || x === 'zh';
const round2 = (x: number): number => Math.round(x * 100) / 100;
const pad = (n: number, width: number): string => String(n).padStart(width, '0');
const edgeKey = (e: SynthEdge): string => `${e.source}\u0000${e.predicate}\u0000${e.target}`;
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ─── Graph model ─────────────────────────────────────────────────────────────

interface SynthNode {
  id: string;
  label: string;
  type: string;
  aliases?: string[];
  deprecated?: boolean;
  replaces?: string[];
  replacedBy?: string[];
  attrs: Record<string, AttrValue>;
}

interface SynthEdge {
  source: string;
  predicate: string;
  target: string;
}

interface SynthGraph {
  meta: { name: string; version: string; generator: string };
  nodes: SynthNode[];
  edges: SynthEdge[];
}

/** Bookkeeping that is not part of the files. */
interface Model {
  readonly graph: SynthGraph;
  /** Class ids by kind index. */
  readonly classesByKind: string[][];
  /** Kind index of every class and entity. */
  readonly kindOf: Map<string, number>;
  /** Parent class of every class (roots map to undefined). */
  readonly classParent: Map<string, string | undefined>;
  readonly entityIds: string[];
  readonly classIds: string[];
}

// ─── Labels ──────────────────────────────────────────────────────────────────

class LabelFactory {
  private readonly used = new Set<string>();

  constructor(
    private readonly rng: Rng,
    private readonly locale: Locale,
  ) {}

  /** Mark an existing label as taken. */
  reserve(label: string): void {
    this.used.add(label);
  }

  /** A word of `syllables` syllables (or CJK characters). */
  word(syllables: number): string {
    if (this.locale === 'zh') {
      let w = '';
      for (let i = 0; i < syllables; i++) w += this.rng.pick(CJK);
      return w;
    }
    let w = '';
    for (let i = 0; i < syllables; i++) w += this.rng.pick(SYLLABLES);
    return w.charAt(0).toUpperCase() + w.slice(1);
  }

  /** A label not handed out before. Grows longer when the short space is crowded. */
  unique(make: (extra: number) => string): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const label = make(Math.floor(attempt / 20));
      if (!this.used.has(label)) {
        this.used.add(label);
        return label;
      }
    }
    throw new GeneratorError('could not find a unique label; use a larger alphabet');
  }

  className(kind: number): string {
    if (this.locale === 'zh')
      return this.unique((x) => `${this.word(2 + x)}${at(KINDS_ZH, kind)}类`);
    return this.unique((x) => `${this.word(2 + x)}${at(KINDS, kind)}`);
  }

  entityName(): string {
    if (this.locale === 'zh') return this.unique((x) => this.word(this.rng.range(2, 3) + x));
    return this.unique((x) => {
      const first = this.word(this.rng.range(2, 3) + x);
      return this.rng.chance(0.35) ? `${first} ${this.word(2)}` : first;
    });
  }

  /** A plausible edit of an existing label: one unit swapped, or a qualifier appended. */
  variant(label: string): string {
    return this.unique((x) => {
      if (this.locale === 'zh') {
        const chars = [...label];
        if (x === 0 && chars.length > 1 && this.rng.chance(0.6)) {
          chars[this.rng.int(chars.length)] = this.rng.pick(CJK);
          return chars.join('');
        }
        return `${this.rng.pick(CJK_QUALIFIERS)}${label}${x > 0 ? this.word(x) : ''}`;
      }
      if (x === 0 && this.rng.chance(0.5)) {
        const words = label.split(' ');
        const i = this.rng.int(words.length);
        words[i] = this.word(Math.max(2, Math.min(3, Math.ceil(at(words, i).length / 3))));
        return words.join(' ');
      }
      return `${label} ${this.rng.pick(QUALIFIERS)}${x > 0 ? ` ${this.word(x)}` : ''}`;
    });
  }

  /** Alternative spelling used as an alias. */
  alias(label: string): string {
    if (this.locale === 'zh') return `${label}（${this.rng.pick(CJK)}）`;
    return label.toLowerCase().replace(/ /g, '-');
  }
}

// ─── Before graph ────────────────────────────────────────────────────────────

function entityAttrs(rng: Rng, index: number): Record<string, AttrValue> {
  const attrs: Record<string, AttrValue> = {
    code: `X${pad(index, 6)}`,
    score: round2(rng.next() * 100),
  };
  if (rng.chance(0.7)) attrs.status = rng.pick(STATUSES);
  if (rng.chance(0.5)) attrs.since = rng.range(1950, 2026);
  if (rng.chance(0.3)) attrs.source = rng.pick(SOURCES);
  return attrs;
}

/** Degree-proportional sampler (Barabási–Albert): every endpoint occurrence is a ticket. */
class Attachment {
  private readonly tickets: string[] = [];

  add(id: string, weight = 1): void {
    for (let i = 0; i < weight; i++) this.tickets.push(id);
  }

  sample(rng: Rng): string {
    return rng.pick(this.tickets);
  }

  get size(): number {
    return this.tickets.length;
  }
}

function buildBefore(config: Config): Model {
  const rng = new Rng(config.seed, 'before');
  const labels = new LabelFactory(rng, config.locale);
  const graph: SynthGraph = {
    meta: {
      name: `synth-${config.nodes}`,
      version: 'before',
      generator: 'scripts/gen-synthetic.ts',
    },
    nodes: [],
    edges: [],
  };
  const kindOf = new Map<string, number>();
  const classParent = new Map<string, string | undefined>();
  const classesByKind: string[][] = KINDS.map(() => []);
  const classIds: string[] = [];
  const entityIds: string[] = [];

  // Taxonomy: eight roots, then classes that pick a parent within a random kind, preferring
  // shallow classes so the tree is bushy rather than a chain.
  const classCount = Math.min(400, Math.max(16, Math.round(Math.sqrt(config.nodes) * 0.6)));
  const depth = new Map<string, number>();
  for (let c = 0; c < classCount; c++) {
    const kind = c < KINDS.length ? c : rng.int(KINDS.length);
    const id = `C${pad(c, 4)}`;
    const siblings = at(classesByKind, kind);
    let parent: string | undefined;
    if (siblings.length > 0) {
      // two draws, keep the shallower: biases towards the top of the tree
      const a = rng.pick(siblings);
      const b = rng.pick(siblings);
      parent = (depth.get(a) ?? 0) <= (depth.get(b) ?? 0) ? a : b;
    }
    let label: string;
    if (c < KINDS.length) {
      label = kindName(config.locale, kind);
      labels.reserve(label);
    } else {
      label = labels.className(kind);
    }
    graph.nodes.push({
      id,
      label,
      type: 'Class',
      attrs: { level: parent ? (depth.get(parent) ?? 0) + 1 : 0 },
    });
    if (parent) graph.edges.push({ source: id, predicate: 'is_a', target: parent });
    depth.set(id, parent ? (depth.get(parent) ?? 0) + 1 : 0);
    classParent.set(id, parent);
    kindOf.set(id, kind);
    siblings.push(id);
    classIds.push(id);
  }

  // Entities by preferential attachment.
  const pool = new Attachment();
  const edgeKeys = new Set<string>();
  const entityCount = config.nodes - classCount;
  for (let i = 0; i < entityCount; i++) {
    const kind = rng.int(KINDS.length);
    const id = `N${pad(i, 7)}`;
    const node: SynthNode = {
      id,
      label: labels.entityName(),
      type: kindName(config.locale, kind),
      attrs: entityAttrs(rng, i),
    };
    if (rng.chance(0.08)) node.aliases = [labels.alias(node.label)];
    graph.nodes.push(node);
    graph.edges.push({ source: id, predicate: 'is_a', target: rng.pick(at(classesByKind, kind)) });
    kindOf.set(id, kind);
    const m =
      pool.size === 0 ? 0 : Math.min(entityIds.length, rng.range(1, 2 * config.edgesPerNode - 1));
    let attached = 0;
    for (let tries = 0; attached < m && tries < m * 6; tries++) {
      const other = pool.sample(rng);
      const e: SynthEdge = rng.chance(0.75)
        ? { source: id, predicate: rng.pick(PREDICATES), target: other }
        : { source: other, predicate: rng.pick(PREDICATES), target: id };
      const k = edgeKey(e);
      if (edgeKeys.has(k)) continue;
      edgeKeys.add(k);
      graph.edges.push(e);
      pool.add(other);
      attached++;
    }
    pool.add(id, 1 + attached);
    entityIds.push(id);
  }
  return { graph, classesByKind, kindOf, classParent, entityIds, classIds };
}

// ─── Mutation pass ───────────────────────────────────────────────────────────

interface Truth {
  renamed: { id: string; from: string; to: string }[];
  attrsEdited: { id: string; key: string; change: 'added' | 'removed' | 'changed' }[];
  merged: { target: string; sources: string[]; sourceKept: boolean }[];
  moved: { id: string; from: string; to: string }[];
  retargeted: { source: string; predicate: string; from: string; to: string }[];
  edgesAdded: SynthEdge[];
  edgesRemoved: SynthEdge[];
  added: string[];
  removed: string[];
  rekeyed: { from: string; to: string }[];
  deprecated: string[];
}

function mutate(model: Model, config: Config): { after: SynthGraph; truth: Truth } {
  const rng = new Rng(config.seed, 'mutate');
  const labels = new LabelFactory(rng, config.locale);
  for (const n of model.graph.nodes) labels.reserve(n.label);
  const rates = config.rates;
  const after: SynthGraph = {
    meta: { ...model.graph.meta, version: 'after' },
    nodes: model.graph.nodes.map((n) => structuredClone(n)),
    edges: model.graph.edges.map((e) => ({ ...e })),
  };
  const nodeById = new Map(after.nodes.map((n) => [n.id, n]));
  const node = (id: string): SynthNode => {
    const n = nodeById.get(id);
    if (!n) throw new GeneratorError(`unknown node ${id}`);
    return n;
  };
  const truth: Truth = {
    renamed: [],
    attrsEdited: [],
    merged: [],
    moved: [],
    retargeted: [],
    edgesAdded: [],
    edgesRemoved: [],
    added: [],
    removed: [],
    rekeyed: [],
    deprecated: [],
  };

  // Each entity takes part in at most one node-level mutation, so the truth stays unambiguous.
  const touched = new Set<string>();
  const order = rng.shuffle(model.entityIds);
  let cursor = 0;
  const take = (count: number, accept: (id: string) => boolean = () => true): string[] => {
    const out: string[] = [];
    while (out.length < count && cursor < order.length) {
      const id = at(order, cursor++);
      if (touched.has(id) || !accept(id)) continue;
      touched.add(id);
      out.push(id);
    }
    return out;
  };
  const quota = (rate: number, base: number): number => Math.round(rate * base);
  const entities = model.entityIds.length;

  // Node-level mutations.
  for (const id of take(quota(rates.rename, entities))) {
    const n = node(id);
    const to = labels.variant(n.label);
    truth.renamed.push({ id, from: n.label, to });
    n.label = to;
  }
  for (const id of take(quota(rates.attr, entities))) {
    const n = node(id);
    const keys = Object.keys(n.attrs).filter((k) => k !== 'code');
    const roll = rng.next();
    if (roll < 0.5 && keys.includes('score')) {
      n.attrs.score = round2(rng.next() * 100);
      truth.attrsEdited.push({ id, key: 'score', change: 'changed' });
    } else if (roll < 0.75 && !('reviewed' in n.attrs)) {
      n.attrs.reviewed = rng.chance(0.5);
      truth.attrsEdited.push({ id, key: 'reviewed', change: 'added' });
    } else {
      const key = keys.length > 0 ? rng.pick(keys) : 'score';
      delete n.attrs[key];
      truth.attrsEdited.push({ id, key, change: 'removed' });
    }
  }
  for (const id of take(quota(rates.deprecate, entities))) {
    node(id).deprecated = true;
    truth.deprecated.push(id);
  }
  // Indexes over the (mutable) edge objects of the after graph.
  const isaOf = new Map<string, SynthEdge>();
  const incident = new Map<string, SynthEdge[]>();
  for (const e of after.edges) {
    if (e.predicate === 'is_a') isaOf.set(e.source, e);
    for (const end of [e.source, e.target]) {
      const list = incident.get(end);
      if (list) list.push(e);
      else incident.set(end, [e]);
    }
  }
  const classesOfKind = (id: string): string[] =>
    at(model.classesByKind, model.kindOf.get(id) ?? 0);

  // Moves: an entity re-parented to another class of its kind.
  for (const id of take(quota(rates.move, entities), (x) => classesOfKind(x).length > 1)) {
    const edge = isaOf.get(id);
    if (!edge) continue;
    const to = rng.pick(classesOfKind(id).filter((c) => c !== edge.target));
    truth.moved.push({ id, from: edge.target, to });
    edge.target = to;
  }
  // Class moves: re-parent inside the kind, never under the class itself or a descendant.
  const isDescendant = (candidate: string, ancestor: string): boolean => {
    for (let c: string | undefined = candidate; c !== undefined; c = model.classParent.get(c)) {
      if (c === ancestor) return true;
    }
    return false;
  };
  const movableClasses = rng.shuffle(
    model.classIds.filter((c) => model.classParent.get(c) !== undefined),
  );
  for (const id of movableClasses.slice(0, quota(rates.classMove, model.classIds.length))) {
    const edge = isaOf.get(id);
    if (!edge) continue;
    const options = classesOfKind(id).filter((c) => c !== edge.target && !isDescendant(c, id));
    if (options.length === 0) continue;
    const to = rng.pick(options);
    truth.moved.push({ id, from: edge.target, to });
    edge.target = to;
    model.classParent.set(id, to);
  }

  // Merges: 1–2 sources of the same kind collapse into a target, which takes over their
  // relations and labels (as aliases). Half of the merges delete the sources and list them in
  // the target's `replaces`; the other half keep them as deprecated stubs with `replacedBy`.
  const removedIds = new Set<string>();
  for (const target of take(Math.round(quota(rates.merge, entities) / 1.5))) {
    const kind = model.kindOf.get(target);
    const sources = take(rng.chance(0.5) ? 2 : 1, (x) => model.kindOf.get(x) === kind);
    if (sources.length === 0) continue;
    const t = node(target);
    const kept = rng.chance(0.5);
    for (const s of sources) {
      const src = node(s);
      t.aliases = [...new Set([...(t.aliases ?? []), src.label])].sort(byString);
      if (kept) {
        src.deprecated = true;
        src.replacedBy = [target];
      } else {
        t.replaces = [...(t.replaces ?? []), s].sort(byString);
        removedIds.add(s);
      }
      for (const e of incident.get(s) ?? []) {
        if (e.predicate === 'is_a' && e.source === s) continue; // the class link stays with the source
        if (e.source === s) e.source = target;
        if (e.target === s) e.target = target;
      }
    }
    truth.merged.push({ target, sources: [...sources].sort(byString), sourceKept: kept });
  }

  // Removals; then drop edges of removed nodes and the duplicates / self-loops merges created.
  for (const id of take(quota(rates.remove, entities))) {
    removedIds.add(id);
    truth.removed.push(id);
  }
  after.nodes = after.nodes.filter((n) => !removedIds.has(n.id));
  const seenEdges = new Set<string>();
  after.edges = after.edges.filter((e) => {
    if (removedIds.has(e.source) || removedIds.has(e.target) || e.source === e.target) return false;
    const k = edgeKey(e);
    if (seenEdges.has(k)) return false;
    seenEdges.add(k);
    return true;
  });

  // Rekeys: new id, same content (only similarity matching can pair them).
  const rekeyed = new Map<string, string>();
  for (const id of take(quota(rates.rekey, entities))) {
    const to = `${id}-r${pad(rng.int(1000), 3)}`;
    rekeyed.set(id, to);
    node(id).id = to;
    truth.rekeyed.push({ from: id, to });
  }
  for (const e of after.edges) {
    e.source = rekeyed.get(e.source) ?? e.source;
    e.target = rekeyed.get(e.target) ?? e.target;
  }

  // Edge-level mutations on relations whose endpoints were not touched above. Each
  // (source, predicate) group is mutated at most once so retargets stay recognisable.
  const live = after.edges.filter(
    (e) => e.predicate !== 'is_a' && !touched.has(e.source) && !touched.has(e.target),
  );
  const relationCount = model.graph.edges.filter((e) => e.predicate !== 'is_a').length;
  const groups = new Set<string>();
  const keys = new Set<string>();
  for (const e of after.edges) keys.add(edgeKey(e));
  const pickEdges = (count: number): SynthEdge[] => {
    const out: SynthEdge[] = [];
    for (const e of rng.shuffle(live)) {
      if (out.length >= count) break;
      const g = `${e.source}\u0000${e.predicate}`;
      const gt = `${e.target}\u0000${e.predicate}\u0000t`;
      if (groups.has(g) || groups.has(gt)) continue;
      groups.add(g);
      groups.add(gt);
      out.push(e);
    }
    return out;
  };
  const freeEntities = model.entityIds.filter((x) => !touched.has(x));
  for (const e of pickEdges(quota(rates.retarget, relationCount))) {
    for (let tries = 0; tries < 10; tries++) {
      const to = rng.pick(freeEntities);
      const next = { ...e, target: to };
      if (to === e.source || to === e.target || keys.has(edgeKey(next))) continue;
      if (groups.has(`${to}\u0000${e.predicate}\u0000t`)) continue;
      groups.add(`${to}\u0000${e.predicate}\u0000t`);
      keys.delete(edgeKey(e));
      keys.add(edgeKey(next));
      truth.retargeted.push({ source: e.source, predicate: e.predicate, from: e.target, to });
      e.target = to;
      break;
    }
  }
  const dropped = new Set(pickEdges(quota(rates.edgeRemove, relationCount)));
  after.edges = after.edges.filter((e) => !dropped.has(e));
  for (const e of dropped) {
    keys.delete(edgeKey(e));
    truth.edgesRemoved.push({ ...e });
  }
  for (let i = 0, guard = 0; i < quota(rates.edgeAdd, relationCount) && guard < 100_000; guard++) {
    const e: SynthEdge = {
      source: rng.pick(freeEntities),
      predicate: rng.pick(PREDICATES),
      target: rng.pick(freeEntities),
    };
    const g = `${e.source}\u0000${e.predicate}`;
    const gt = `${e.target}\u0000${e.predicate}\u0000t`;
    if (e.source === e.target || keys.has(edgeKey(e)) || groups.has(g) || groups.has(gt)) continue;
    groups.add(g);
    groups.add(gt);
    keys.add(edgeKey(e));
    after.edges.push(e);
    truth.edgesAdded.push({ ...e });
    i++;
  }

  // New entities, attached to surviving untouched entities.
  const anchors = freeEntities.filter((x) => !removedIds.has(x));
  const addCount = quota(rates.add, entities);
  for (let i = 0; i < addCount; i++) {
    const kind = rng.int(KINDS.length);
    const id = `N${pad(entities + i, 7)}`;
    after.nodes.push({
      id,
      label: labels.entityName(),
      type: kindName(config.locale, kind),
      attrs: entityAttrs(rng, entities + i),
    });
    after.edges.push({
      source: id,
      predicate: 'is_a',
      target: rng.pick(at(model.classesByKind, kind)),
    });
    const m = rng.range(1, config.edgesPerNode);
    const seen = new Set<string>();
    for (let j = 0; j < m && anchors.length > 0; j++) {
      const other = rng.pick(anchors);
      const e: SynthEdge = { source: id, predicate: rng.pick(PREDICATES), target: other };
      if (seen.has(edgeKey(e))) continue;
      seen.add(edgeKey(e));
      after.edges.push(e);
    }
    truth.added.push(id);
  }

  return { after, truth };
}

// ─── Output ──────────────────────────────────────────────────────────────────

/** Valid kgdiff GraphInput, one node / edge per line so large files stay diffable. */
function serialize(graph: SynthGraph): string {
  const checked: GraphInput = graph;
  const lines = ['{', `  "meta": ${JSON.stringify(checked.meta)},`, '  "nodes": ['];
  const rows = (items: readonly object[]): void => {
    for (let i = 0; i < items.length; i++) {
      lines.push(`    ${JSON.stringify(items[i])}${i < items.length - 1 ? ',' : ''}`);
    }
  };
  rows(graph.nodes);
  lines.push('  ],', '  "edges": [');
  rows(graph.edges);
  lines.push('  ]', '}', '');
  return lines.join('\n');
}

function parseConfig(argv: readonly string[]): Config | undefined {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      nodes: { type: 'string' },
      seed: { type: 'string' },
      out: { type: 'string' },
      'edges-per-node': { type: 'string' },
      locale: { type: 'string' },
      cjk: { type: 'boolean' },
      rates: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) return undefined;
  const int = (
    name: string,
    raw: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ): number => {
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new GeneratorError(`--${name} must be an integer in [${min}, ${max}], got "${raw}"`);
    }
    return n;
  };
  const nodes = int('nodes', values.nodes, 1000, 40, 5_000_000);
  const locale = values.cjk ? 'zh' : (values.locale ?? 'en');
  if (!isLocale(locale)) throw new GeneratorError(`--locale must be en or zh, got "${locale}"`);
  const rates: Rates = { ...DEFAULT_RATES };
  for (const part of (values.rates ?? '').split(',').filter(Boolean)) {
    const [key, raw] = part.split('=');
    const value = Number(raw);
    if (!key || !(key in DEFAULT_RATES))
      throw new GeneratorError(
        `unknown rate "${key}" (known: ${Object.keys(DEFAULT_RATES).join(', ')})`,
      );
    if (!Number.isFinite(value) || value < 0 || value > 0.5)
      throw new GeneratorError(`rate ${key} must be in [0, 0.5], got "${raw}"`);
    rates[key as RateKey] = value;
  }
  return {
    nodes,
    seed: int('seed', values.seed, 1, 0, 0xffffffff),
    out: values.out ?? join('examples', 'generated', `synth-${nodes}`),
    edgesPerNode: int('edges-per-node', values['edges-per-node'], 2, 1, 20),
    locale,
    rates,
  };
}

function main(): void {
  const config = parseConfig(process.argv.slice(2));
  if (!config) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const model = buildBefore(config);
  const before = model.graph;
  const beforeCounts = { nodes: before.nodes.length, edges: before.edges.length };
  const { after, truth } = mutate(model, config);
  const outDir = resolve(config.out);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'before.json'), serialize(before));
  writeFileSync(join(outDir, 'after.json'), serialize(after));

  const sortedTruth: Truth = {
    renamed: [...truth.renamed].sort((a, b) => byString(a.id, b.id)),
    attrsEdited: [...truth.attrsEdited].sort((a, b) => byString(a.id, b.id)),
    merged: [...truth.merged].sort((a, b) => byString(a.target, b.target)),
    moved: [...truth.moved].sort((a, b) => byString(a.id, b.id)),
    retargeted: [...truth.retargeted].sort((a, b) =>
      byString(a.source + a.predicate, b.source + b.predicate),
    ),
    edgesAdded: [...truth.edgesAdded].sort((a, b) => byString(edgeKey(a), edgeKey(b))),
    edgesRemoved: [...truth.edgesRemoved].sort((a, b) => byString(edgeKey(a), edgeKey(b))),
    added: [...truth.added].sort(byString),
    removed: [...truth.removed].sort(byString),
    rekeyed: [...truth.rekeyed].sort((a, b) => byString(a.from, b.from)),
    deprecated: [...truth.deprecated].sort(byString),
  };
  const name = `synth-${config.nodes}`;
  const args = [
    `--nodes ${config.nodes}`,
    `--seed ${config.seed}`,
    `--edges-per-node ${config.edgesPerNode}`,
    `--locale ${config.locale}`,
  ];
  const overrides = (Object.keys(DEFAULT_RATES) as RateKey[]).filter(
    (k) => config.rates[k] !== DEFAULT_RATES[k],
  );
  if (overrides.length > 0)
    args.push(`--rates ${overrides.map((k) => `${k}=${config.rates[k]}`).join(',')}`);
  const meta = {
    id: name,
    title: {
      en: `Synthetic graph, ${config.nodes} nodes`,
      'zh-CN': `合成图（${config.nodes} 个节点）`,
    },
    description: {
      en: 'Generated by scripts/gen-synthetic.ts: a scale-free-ish graph with a class taxonomy and a seeded mutation pass. `truth` lists every mutation applied.',
      'zh-CN':
        '由 scripts/gen-synthetic.ts 生成：带类别层级的近似无标度图，并按随机种子施加变更；truth 列出全部变更。',
    },
    format: 'json',
    files: { before: 'before.json', after: 'after.json' },
    versions: { before: 'before', after: 'after' },
    options: { match: { strategy: 'auto' } },
    featured: false,
    license: 'CC0-1.0',
    generator: {
      script: 'scripts/gen-synthetic.ts',
      command: `pnpm tsx scripts/gen-synthetic.ts ${args.join(' ')} --out ${config.out}`,
      nodes: config.nodes,
      seed: config.seed,
      edgesPerNode: config.edgesPerNode,
      locale: config.locale,
      rates: config.rates,
    },
    counts: {
      before: beforeCounts,
      after: { nodes: after.nodes.length, edges: after.edges.length },
    },
    truth: sortedTruth,
  };
  writeFileSync(join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  process.stdout.write(
    `${name}: before ${beforeCounts.nodes} nodes / ${beforeCounts.edges} edges, after ${after.nodes.length} / ${after.edges.length} → ${outDir}\n`,
  );
}

try {
  main();
} catch (error) {
  const code = (error as { code?: unknown }).code;
  if (
    error instanceof GeneratorError ||
    (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS'))
  ) {
    process.stderr.write(`gen-synthetic: ${(error as Error).message}\n${HELP}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
