/**
 * RDF → `GraphInput`, following docs/architecture.md §"Formats: mapping conventions". Every
 * RDF syntax produces quads first — Turtle, N-Triples, N-Quads and TriG through n3
 * (`readN3`), RDF/XML through `rdfxml.ts`, JSON-LD through `jsonld.ts` — and `mapRdf` maps
 * them all the same way, so one graph diffs identically in any syntax.
 *
 *  - Triples are a set: repeated triples count once, whatever the syntax.
 *  - Node ids: OBO PURLs become CURIEs (`GO:0008150`), other IRIs stay whole; blank nodes get
 *    content-hashed ids `_:b<hash>` (hash of their sorted outgoing triples, recursive,
 *    cycle-safe), so ids are stable across files and parser runs.
 *  - Labels: label predicates with language preference; the other label values become aliases.
 *    Without a label a named node is labelled with its compact IRI.
 *  - Identities (predicates, attr keys, types) are compacted with well-known and user prefixes
 *    only by default (`RdfOptions.compactWith`), so they do not depend on file declarations.
 *  - Literal-valued properties → attrs keyed by compact predicate (numbers / booleans typed,
 *    language-tagged text as `"text@lang"`, multi-values as sorted arrays).
 *  - IRI-valued properties → edges (compact predicate, readable label).
 *  - `rdf:type` → types; `owl:deprecated` → deprecated; `IAO:0100001` → replacedBy.
 *  - OWL: `C ⊑ ∃R.D` and `C ≡ A ⊓ ∃R.D` become edges; `owl:Ontology` becomes `meta`.
 *  - Lists: literal lists become attr arrays; lists of resources become (unordered) edges.
 *  - Statement annotations (`owl:Axiom`, `rdf:Statement`, RDF 1.2 `rdf:reifies`) are folded
 *    into the attrs of the annotated edge (or of the node, for literal-valued statements),
 *    unless `RdfOptions.foldAnnotations` is false.
 */
import type { AttrValue, EdgeInput, GraphInput, GraphMeta, NodeInput } from '@kgdiff/core';
import type { Quad } from 'n3';
import { BlankNode, Literal, NamedNode, Parser } from 'n3';
import type { RdfOptions } from './index.js';
import {
  nodeIdForIri,
  OBO_IN_OWL_NS,
  OBO_PURL,
  OWL_NS,
  PrefixTable,
  RDF_NS,
  RDFS_NS,
  readableName,
  SKOS_NS,
  WELL_KNOWN_PREFIXES,
  XSD_NS,
} from './prefixes.js';
import {
  AttrBag,
  compareStrings,
  hash53,
  invalidInput,
  makeEdge,
  makeMeta,
  NodeBuilder,
  plural,
  setOwn,
  sortEdges,
  sortNodes,
  typedValue,
  type Warnings,
} from './shared.js';

/** RDF syntaxes read by n3. */
export type N3Format = 'turtle' | 'ntriples' | 'nquads' | 'trig';

/** The quads of one RDF document and the prefixes it declares (for display only). */
export interface RdfDocument {
  readonly quads: readonly Quad[];
  readonly prefixes: Readonly<Record<string, string>>;
}

export interface RdfParseOutput {
  readonly graph: GraphInput;
  readonly prefixes: Readonly<Record<string, string>>;
  /** Labels the file gives the properties it uses, by compact predicate. */
  readonly predicateLabels: Readonly<Record<string, string>>;
}

const FORMAT_NAMES: Readonly<Record<N3Format, string>> = {
  turtle: 'Turtle',
  ntriples: 'N-Triples',
  nquads: 'N-Quads',
  trig: 'TriG',
};

const RDF_TYPE = `${RDF_NS}type`;
const RDF_FIRST = `${RDF_NS}first`;
const RDF_REST = `${RDF_NS}rest`;
const RDF_NIL = `${RDF_NS}nil`;
const RDF_LIST = `${RDF_NS}List`;
const RDF_REIFIES = `${RDF_NS}reifies`;
const RDF_STATEMENT = `${RDF_NS}Statement`;
const RDF_SUBJECT = `${RDF_NS}subject`;
const RDF_PREDICATE = `${RDF_NS}predicate`;
const RDF_OBJECT = `${RDF_NS}object`;
const RDFS_SUBCLASS_OF = `${RDFS_NS}subClassOf`;
const OWL_ONTOLOGY = `${OWL_NS}Ontology`;
const OWL_IMPORTS = `${OWL_NS}imports`;
const OWL_VERSION_INFO = `${OWL_NS}versionInfo`;
const OWL_VERSION_IRI = `${OWL_NS}versionIRI`;
const OWL_DEPRECATED = `${OWL_NS}deprecated`;
const OWL_CLASS = `${OWL_NS}Class`;
const OWL_RESTRICTION = `${OWL_NS}Restriction`;
const OWL_ON_PROPERTY = `${OWL_NS}onProperty`;
const OWL_SOME_VALUES_FROM = `${OWL_NS}someValuesFrom`;
const OWL_EQUIVALENT_CLASS = `${OWL_NS}equivalentClass`;
const OWL_INTERSECTION_OF = `${OWL_NS}intersectionOf`;
const OWL_UNION_OF = `${OWL_NS}unionOf`;
const OWL_AXIOM = `${OWL_NS}Axiom`;
const OWL_ANNOTATED_SOURCE = `${OWL_NS}annotatedSource`;
const OWL_ANNOTATED_PROPERTY = `${OWL_NS}annotatedProperty`;
const OWL_ANNOTATED_TARGET = `${OWL_NS}annotatedTarget`;
const IAO_REPLACED_BY = `${OBO_PURL}IAO_0100001`;
const DC_TITLE = `${WELL_KNOWN_PREFIXES.dc}title`;
const DCTERMS_TITLE = `${WELL_KNOWN_PREFIXES.dcterms}title`;
const SCHEMA_HTTPS = 'https://schema.org/';
const SCHEMA_HTTP = 'http://schema.org/';

/** Default label predicates, in priority order (schema.org in both http and https forms). */
const DEFAULT_LABEL_PREDICATES: readonly string[] = [
  `${RDFS_NS}label`,
  `${SKOS_NS}prefLabel`,
  `${SCHEMA_HTTPS}name`,
  DCTERMS_TITLE,
  `${WELL_KNOWN_PREFIXES.foaf}name`,
];

/** Default alias predicates: SKOS alternative labels and the oboInOwl synonym family. */
const DEFAULT_ALIAS_PREDICATES: readonly string[] = [
  `${SKOS_NS}altLabel`,
  `${OBO_IN_OWL_NS}hasExactSynonym`,
  `${OBO_IN_OWL_NS}hasRelatedSynonym`,
  `${OBO_IN_OWL_NS}hasBroadSynonym`,
  `${OBO_IN_OWL_NS}hasNarrowSynonym`,
  `${OBO_IN_OWL_NS}hasSynonym`,
];

type Resource = NamedNode | BlankNode;
type Value = NamedNode | BlankNode | Literal;

/** All triples of one subject, grouped by predicate IRI in document order. */
interface Subject {
  readonly term: Resource;
  readonly props: Map<string, Value[]>;
}

/** An RDF 1.2 triple term (`<<( s p o )>>`); not covered by @types/n3. */
interface TripleTerm {
  readonly termType: 'Quad';
  readonly subject: unknown;
  readonly predicate: unknown;
  readonly object: unknown;
}

function isTripleTerm(value: unknown): value is TripleTerm {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { termType?: unknown }).termType === 'Quad' &&
    'subject' in value &&
    'predicate' in value &&
    'object' in value
  );
}

/** A statement about a statement: owl:Axiom, rdf:Statement or an RDF 1.2 reifier. */
interface Reification {
  readonly subject: Resource;
  readonly predicate: string;
  readonly object: Value;
  readonly annotations: readonly (readonly [string, readonly Value[]])[];
}

interface LabelCandidate {
  readonly tier: number;
  readonly rank: number;
  readonly value: string;
  readonly language: string;
}

interface EdgeBuilder {
  readonly source: string;
  readonly predicate: string;
  readonly target: string;
  readonly label: string;
  readonly attrs: AttrBag;
}

const keyOf = (term: Resource): string =>
  term.termType === 'BlankNode' ? `_:${term.value}` : term.value;

/** Value lists up to this length are de-duplicated by a linear scan (see `contains`). */
const SCAN_LIMIT = 8;

const termKey = (term: Value): string => `${term.termType}\u0000${term.id}`;

const isBlankKey = (key: string): boolean => key.startsWith('_:');

/** Reads Turtle-family text with n3. Throws `KgdiffError('invalid-input')` with the line on syntax errors. */
export function readN3(text: string, format: N3Format, baseIRI: string | undefined): RdfDocument {
  const declared: Record<string, string> = {};
  const parser = new Parser({ format: FORMAT_NAMES[format], baseIRI });
  try {
    const quads = parser.parse(text, null, (prefix, iri) => {
      setOwn(declared, prefix, iri.value);
    });
    return { quads, prefixes: declared };
  } catch (error) {
    throw syntaxError(error, format);
  }
}

/** Maps the quads of an RDF document (any syntax) to a `GraphInput`. */
export function mapRdf(
  document: RdfDocument,
  options: RdfOptions | undefined,
  warnings: Warnings,
): RdfParseOutput {
  const user = options?.prefixes ?? {};
  const display = new PrefixTable([
    ['well-known', WELL_KNOWN_PREFIXES],
    ['declared', document.prefixes],
    ['user', user],
  ]);
  // Identities must not depend on how a file happens to abbreviate IRIs (see `compactWith`).
  const identity =
    options?.compactWith === 'declared'
      ? display
      : new PrefixTable([
          ['well-known', WELL_KNOWN_PREFIXES],
          ['user', user],
        ]);
  const mapper = new RdfMapper(identity, display, options ?? {}, warnings);
  mapper.ingest(document.quads);
  const graph = mapper.build();
  return { graph, prefixes: display.record, predicateLabels: mapper.propertyLabels() };
}

function syntaxError(error: unknown, format: N3Format) {
  const message = error instanceof Error ? error.message : String(error);
  const context =
    error instanceof Error ? (error as Error & { context?: unknown }).context : undefined;
  const line =
    typeof context === 'object' &&
    context !== null &&
    'line' in context &&
    typeof context.line === 'number'
      ? context.line
      : undefined;
  const hint =
    format === 'turtle' && /\bgraph\b|\{/i.test(message)
      ? ' Named graphs need TriG: use a .trig file or format "trig".'
      : '';
  return invalidInput(`Invalid ${FORMAT_NAMES[format]}: ${message}${hint}`, {
    format,
    ...(line !== undefined ? { line } : {}),
  });
}

class RdfMapper {
  private readonly subjects = new Map<string, Subject>();
  /**
   * Distinct (subject, predicate) pairs using each blank node as object: lists, restrictions,
   * roots and context ids depend on it. `parents` keeps the first one.
   */
  private readonly referrers = new Map<string, Set<string>>();
  private readonly parents = new Map<
    string,
    { readonly subject: string; readonly predicate: string }
  >();
  /** RDF 1.2 `rdf:reifies` triple terms by reifier key. */
  private readonly reifies = new Map<string, TripleTerm>();
  private readonly namedGraphs = new Set<string>();
  private skippedTripleTerms = 0;
  /** Term keys of long value lists, for `contains`. */
  private readonly valueIndex = new WeakMap<readonly Value[], Set<string>>();

  private readonly labelRanks = new Map<string, number>();
  private readonly aliasPredicates: ReadonlySet<string>;
  private readonly languages: readonly string[];
  private readonly typeEdges: boolean;
  private readonly owlRestrictions: boolean;
  private readonly foldAnnotations: boolean;

  private readonly ontologies = new Set<string>();
  private readonly nodes = new Map<string, NodeBuilder>();
  private readonly edges = new Map<string, EdgeBuilder>();
  /** Compact predicate → IRI of every predicate used for an edge or attribute. */
  private readonly usedPredicates = new Map<string, string>();

  private readonly lists = new Map<string, readonly Value[] | null>();
  private readonly existentials = new Map<string, { property: string; filler: string } | null>();
  /** Content hash of every blank node, computed once on first use, and the ones on cycles. */
  private blankHashes: ReadonlyMap<string, string> | undefined;
  private readonly cyclicBlanks = new Set<string>();
  /** Final `_:b…` ids (content- or context-based). */
  private readonly blankIds = new Map<string, string>();
  /** Blank nodes emitted as nodes of their own (`_:b…`), and the queue still to emit. */
  private readonly emittedBlanks = new Set<string>();
  private readonly blankQueue: string[] = [];
  private blankCursor = 0;

  /**
   * @param table compacts identities (predicates, attr keys, types, fallback labels)
   * @param display expands CURIEs in options, with the file's declared prefixes too
   */
  constructor(
    private readonly table: PrefixTable,
    display: PrefixTable,
    options: RdfOptions,
    private readonly warnings: Warnings,
  ) {
    const labelPredicates =
      options.labelPredicates?.map((p) => display.expand(p)) ?? DEFAULT_LABEL_PREDICATES;
    labelPredicates.forEach((iri, rank) => {
      for (const variant of schemaVariants(iri)) {
        if (!this.labelRanks.has(variant)) this.labelRanks.set(variant, rank);
      }
    });
    const aliasPredicates =
      options.aliasPredicates?.map((p) => display.expand(p)) ?? DEFAULT_ALIAS_PREDICATES;
    this.aliasPredicates = new Set(aliasPredicates.flatMap(schemaVariants));
    const languages = (options.languages ?? ['', 'en']).map((language) => language.toLowerCase());
    this.languages = languages.includes('') ? languages : [...languages, ''];
    this.typeEdges = options.typeEdges ?? false;
    this.owlRestrictions = options.owlRestrictions ?? true;
    this.foldAnnotations = options.foldAnnotations ?? true;
  }

  // ─── Ingestion ──────────────────────────────────────────────────────────

  ingest(quads: readonly Quad[]): void {
    for (const { subject, predicate, object, graph } of quads) {
      if (graph.termType !== 'DefaultGraph') this.namedGraphs.add(graph.value);
      // Subjects can be RDF 1.2 triple terms at runtime, which @types/n3 does not model.
      if (
        !(subject instanceof NamedNode || subject instanceof BlankNode) ||
        !(predicate instanceof NamedNode)
      ) {
        this.skippedTripleTerms++;
        continue;
      }
      const subjectKey = keyOf(subject);
      if (object instanceof NamedNode || object instanceof BlankNode || object instanceof Literal) {
        this.add(subject, subjectKey, predicate.value, object);
      } else if (
        isTripleTerm(object) &&
        predicate.value === RDF_REIFIES &&
        subject instanceof BlankNode
      ) {
        this.reifies.set(subjectKey, object);
        this.subjectOf(subject, subjectKey);
      } else {
        this.skippedTripleTerms++;
      }
    }
  }

  private referenceCount(key: string): number {
    return this.referrers.get(key)?.size ?? 0;
  }

  /**
   * Whether `values` already holds `object`: RDF graphs are sets, and syntaxes differ in how
   * often they repeat a triple (JSON-LD embeds a node wherever it is used). Long value lists
   * get a key index instead of a linear scan; adding a missing key records it.
   */
  private contains(values: readonly Value[], object: Value): boolean {
    if (values.length < SCAN_LIMIT) return values.some((value) => value.equals(object));
    let index = this.valueIndex.get(values);
    if (!index) {
      index = new Set(values.map(termKey));
      this.valueIndex.set(values, index);
    }
    const key = termKey(object);
    if (index.has(key)) return true;
    index.add(key);
    return false;
  }

  private subjectOf(term: Resource, key: string): Subject {
    let subject = this.subjects.get(key);
    if (!subject) {
      subject = { term, props: new Map() };
      this.subjects.set(key, subject);
    }
    return subject;
  }

  private add(term: Resource, key: string, predicate: string, object: Value): void {
    const props = this.subjectOf(term, key).props;
    const values = props.get(predicate);
    if (!values) props.set(predicate, [object]);
    else if (this.contains(values, object)) return;
    else values.push(object);
    if (object.termType === 'BlankNode') {
      const objectKey = `_:${object.value}`;
      let referrers = this.referrers.get(objectKey);
      if (!referrers) {
        referrers = new Set();
        this.referrers.set(objectKey, referrers);
        this.parents.set(objectKey, { subject: key, predicate });
      }
      referrers.add(`${key}\u0000${predicate}`);
    }
  }

  // ─── Build ──────────────────────────────────────────────────────────────

  build(): GraphInput {
    const reifications: [string, Reification][] = [];
    const roots: string[] = [];
    for (const [key, subject] of this.subjects) {
      if (this.hasType(subject, OWL_ONTOLOGY)) this.ontologies.add(key);
    }
    for (const [key, subject] of this.subjects) {
      if (this.ontologies.has(key)) continue;
      if (!isBlankKey(key)) {
        this.emitResource(subject, nodeIdForIri(key));
        continue;
      }
      if (this.referenceCount(key) > 0) continue;
      const reification = this.foldAnnotations ? this.reification(key, subject) : undefined;
      if (reification) reifications.push([key, reification]);
      else roots.push(key);
    }
    for (const key of roots) this.requestBlank(key);
    for (const key of this.orphanBlanks()) this.requestBlank(key);
    this.drainBlanks();
    for (const [key, reification] of reifications) {
      if (!this.foldReification(reification)) this.requestBlank(key);
    }
    this.drainBlanks();

    if (this.namedGraphs.size > 0) {
      this.warnings.add(
        'named-graphs',
        `Merged ${plural(this.namedGraphs.size, 'named graph')} into one graph.`,
      );
    }
    if (this.skippedTripleTerms > 0) {
      this.warnings.add(
        'triple-terms',
        `Skipped ${plural(this.skippedTripleTerms, 'triple')} with RDF 1.2 triple terms (not representable as edges).`,
      );
    }

    const nodes: NodeInput[] = [];
    for (const node of this.nodes.values()) nodes.push(node.build());
    const edges: EdgeInput[] = [];
    for (const edge of this.edges.values()) {
      edges.push(
        makeEdge({
          source: edge.source,
          target: edge.target,
          predicate: edge.predicate,
          label: edge.label,
          attrs: edge.attrs.build(),
        }),
      );
    }
    const meta = this.ontologyMeta();
    return { nodes: sortNodes(nodes), edges: sortEdges(edges), ...(meta ? { meta } : {}) };
  }

  /**
   * Blank nodes that nothing outside their own cycle points to (`_:a :p _:b . _:b :p _:a .`).
   * They have references, so they are not roots, yet no named node leads to them either.
   */
  private orphanBlanks(): string[] {
    const reached = new Set<string>();
    const queue: string[] = [];
    const reach = (key: string) => {
      if (!reached.has(key)) {
        reached.add(key);
        queue.push(key);
      }
    };
    for (const key of this.subjects.keys()) {
      if (!isBlankKey(key) || this.referenceCount(key) === 0) reach(key);
    }
    for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
      this.forEachBlankChild(key, reach);
    }
    return [...this.subjects.keys()].filter((key) => isBlankKey(key) && !reached.has(key));
  }

  private drainBlanks(): void {
    // An index instead of shift(): the queue can hold every blank node of a large file.
    for (; this.blankCursor < this.blankQueue.length; this.blankCursor++) {
      const key = this.blankQueue[this.blankCursor] as string;
      const subject = this.subjects.get(key);
      const id = this.blankId(key);
      if (subject) this.emitResource(subject, id);
      else this.nodeBuilder(id);
    }
  }

  private requestBlank(key: string): void {
    if (this.emittedBlanks.has(key)) return;
    this.emittedBlanks.add(key);
    this.blankQueue.push(key);
  }

  private nodeBuilder(id: string): NodeBuilder {
    let node = this.nodes.get(id);
    if (!node) {
      node = new NodeBuilder(id);
      this.nodes.set(id, node);
    }
    return node;
  }

  private hasType(subject: Subject, type: string): boolean {
    return (
      subject.props
        .get(RDF_TYPE)
        ?.some((value) => value.value === type && value.termType === 'NamedNode') ?? false
    );
  }

  // ─── Resources ──────────────────────────────────────────────────────────

  private emitResource(subject: Subject, id: string): void {
    const node = this.nodeBuilder(id);
    if (node.label === undefined) {
      node.label =
        this.bestLabel(subject) ??
        (subject.term.termType === 'NamedNode'
          ? this.table.compact(subject.term.value)
          : undefined);
    }
    for (const [predicate, values] of subject.props) {
      if (predicate === RDF_TYPE) {
        for (const value of values) {
          if (value.termType === 'NamedNode') {
            node.types.add(this.table.compact(value.value));
            if (this.typeEdges) this.emitValue(id, predicate, value);
          } else this.emitValue(id, predicate, value);
        }
      } else if (this.labelRanks.has(predicate) || this.aliasPredicates.has(predicate)) {
        // Label values that were not chosen become aliases (makeNode drops the label itself).
        for (const value of values) if (value.termType === 'Literal') node.aliases.add(value.value);
      } else if (predicate === OWL_DEPRECATED) {
        if (values.some((value) => value.termType === 'Literal' && isTrue(value.value)))
          node.deprecated = true;
      } else if (predicate === IAO_REPLACED_BY) {
        for (const value of values) {
          if (value.termType === 'NamedNode') node.replacedBy.add(nodeIdForIri(value.value));
          else if (value.termType === 'Literal' && value.value.trim() !== '') {
            node.replacedBy.add(nodeIdForIri(value.value.trim()));
          }
        }
      } else {
        for (const value of values) this.emitValue(id, predicate, value);
      }
    }
  }

  private emitValue(sourceId: string, predicate: string, value: Value): void {
    if (value.termType === 'Literal') {
      this.nodeBuilder(sourceId).attrs.add(this.attrKey(predicate), literalValue(value));
      return;
    }
    if (value.termType === 'NamedNode') {
      if (value.value === RDF_NIL)
        this.nodeBuilder(sourceId).attrs.add(this.attrKey(predicate), []);
      else if (this.ontologies.has(value.value)) {
        // The ontology is metadata, not a node: references to it stay as plain values.
        this.nodeBuilder(sourceId).attrs.add(this.attrKey(predicate), value.value);
      } else this.addEdge(sourceId, predicate, nodeIdForIri(value.value));
      return;
    }
    const key = `_:${value.value}`;
    const items = this.listItems(key);
    if (items) {
      this.emitList(sourceId, predicate, items);
      return;
    }
    if (predicate === RDFS_SUBCLASS_OF && this.owlRestrictions) {
      const restriction = this.existential(key);
      if (restriction) {
        this.addEdge(sourceId, restriction.property, nodeIdForIri(restriction.filler));
        return;
      }
    }
    if (predicate === OWL_EQUIVALENT_CLASS) {
      const members = this.classExpression(key);
      if (members) {
        for (const member of members) this.addEdge(sourceId, member.predicate, member.target);
        return;
      }
    }
    this.addEdge(sourceId, predicate, this.blankId(key));
    this.requestBlank(key);
  }

  private emitList(sourceId: string, predicate: string, items: readonly Value[]): void {
    if (items.every((item): item is Literal => item.termType === 'Literal')) {
      this.nodeBuilder(sourceId).attrs.add(this.attrKey(predicate), items.map(literalValue));
      return;
    }
    this.warnings.count(
      'rdf-list-resources',
      (n) =>
        `${plural(n, 'RDF list')} of resources mapped to unordered edges (item order is not kept).`,
    );
    for (const item of items) this.emitValue(sourceId, predicate, item);
  }

  private addEdge(source: string, predicate: string, target: string): EdgeBuilder {
    const compact = this.usePredicate(predicate);
    const key = `${source}\u0000${compact}\u0000${target}`;
    let edge = this.edges.get(key);
    if (!edge) {
      // The label derives from the predicate alone: a property declaration appearing or
      // disappearing must not relabel every edge. Declared labels go to `propertyLabels`.
      edge = {
        source,
        predicate: compact,
        target,
        label: readableName(compact),
        attrs: new AttrBag(),
      };
      this.edges.set(key, edge);
    }
    return edge;
  }

  /** Attribute key of a literal-valued property (its compact form). */
  private attrKey(predicate: string): string {
    return this.usePredicate(predicate);
  }

  /** Compact form of a predicate, remembered so its declared label can be reported. */
  private usePredicate(predicate: string): string {
    const compact = this.table.compact(predicate);
    this.usedPredicates.set(compact, predicate);
    return compact;
  }

  /**
   * Labels the file declares for the properties used as edge predicates or attr keys
   * (`BFO:0000050` → “part of”), by compact predicate, for display.
   */
  propertyLabels(): Record<string, string> {
    const labels: Record<string, string> = {};
    for (const compact of [...this.usedPredicates.keys()].sort(compareStrings)) {
      const subject = this.subjects.get(this.usedPredicates.get(compact) ?? '');
      const label = subject && this.bestLabel(subject);
      if (label) setOwn(labels, compact, label);
    }
    return labels;
  }

  // ─── Labels ─────────────────────────────────────────────────────────────

  /**
   * Picks the label by language tier first (preferred languages in order, then untagged, then
   * any), then by label predicate priority, then lexicographically: deterministic for any order.
   */
  private bestLabel(subject: Subject): string | undefined {
    let best: LabelCandidate | undefined;
    for (const [predicate, values] of subject.props) {
      const rank = this.labelRanks.get(predicate);
      if (rank === undefined) continue;
      for (const value of values) {
        if (value.termType !== 'Literal') continue;
        const candidate = {
          tier: this.languageTier(value.language),
          rank,
          value: value.value,
          language: value.language,
        };
        if (!best || compareCandidates(candidate, best) < 0) best = candidate;
      }
    }
    return best?.value;
  }

  private languageTier(language: string): number {
    const tag = language.toLowerCase();
    for (let i = 0; i < this.languages.length; i++) {
      const preferred = this.languages[i];
      if (preferred === tag) return 2 * i;
      if (preferred !== '' && tag.startsWith(`${preferred}-`)) return 2 * i + 1;
    }
    return 2 * this.languages.length;
  }

  // ─── Blank node structures ──────────────────────────────────────────────

  /** Items of a well-formed RDF list headed by `head`, or `undefined`. */
  private listItems(head: string): readonly Value[] | undefined {
    const cached = this.lists.get(head);
    if (cached !== undefined) return cached ?? undefined;
    const items: Value[] = [];
    const seen = new Set<string>();
    let key = head;
    let result: readonly Value[] | null = null;
    for (;;) {
      const cell = this.subjects.get(key);
      if (!cell || seen.has(key) || (key !== head && this.referenceCount(key) !== 1)) break;
      seen.add(key);
      const first = cell.props.get(RDF_FIRST);
      const rest = cell.props.get(RDF_REST);
      const types = cell.props.get(RDF_TYPE) ?? [];
      const extra = cell.props.size - (first ? 1 : 0) - (rest ? 1 : 0) - (types.length > 0 ? 1 : 0);
      if (first?.length !== 1 || rest?.length !== 1 || extra > 0) break;
      if (!types.every((type) => type.termType === 'NamedNode' && type.value === RDF_LIST)) break;
      const [item] = first;
      const [next] = rest;
      if (item === undefined || next === undefined) break;
      items.push(item);
      if (next.termType === 'NamedNode' && next.value === RDF_NIL) {
        result = items;
        break;
      }
      if (next.termType !== 'BlankNode') break;
      key = `_:${next.value}`;
    }
    this.lists.set(head, result);
    return result ?? undefined;
  }

  /** `[ a owl:Restriction ; owl:onProperty R ; owl:someValuesFrom D ]` with named R and D. */
  private existential(key: string): { property: string; filler: string } | undefined {
    const cached = this.existentials.get(key);
    if (cached !== undefined) return cached ?? undefined;
    let result: { property: string; filler: string } | null = null;
    const subject = this.subjects.get(key);
    if (subject) {
      let property: string | undefined;
      let filler: string | undefined;
      let simple = true;
      for (const [predicate, values] of subject.props) {
        const [only] = values;
        const named =
          values.length === 1 && only?.termType === 'NamedNode' ? only.value : undefined;
        if (predicate === RDF_TYPE) simple &&= values.every((v) => v.value === OWL_RESTRICTION);
        else if (predicate === OWL_ON_PROPERTY && named !== undefined) property = named;
        else if (predicate === OWL_SOME_VALUES_FROM && named !== undefined) filler = named;
        else simple = false;
      }
      if (simple && property !== undefined && filler !== undefined) result = { property, filler };
    }
    this.existentials.set(key, result);
    return result ?? undefined;
  }

  /**
   * Members of `C owl:equivalentClass X` that are worth an edge: an existential X gives
   * `C –R→ D`; an `owl:intersectionOf` / `owl:unionOf` list of named classes (and, for
   * intersections, existentials) gives one edge per member. `undefined` when X has any other
   * shape, which keeps it as a blank node of its own.
   */
  private classExpression(key: string): { predicate: string; target: string }[] | undefined {
    const restriction = this.owlRestrictions ? this.existential(key) : undefined;
    if (restriction)
      return [{ predicate: restriction.property, target: nodeIdForIri(restriction.filler) }];
    const subject = this.subjects.get(key);
    if (!subject) return undefined;
    let operator: string | undefined;
    let head: string | undefined;
    for (const [predicate, values] of subject.props) {
      const [only] = values;
      if (predicate === RDF_TYPE) {
        if (!values.every((v) => v.value === OWL_CLASS)) return undefined;
      } else if (
        (predicate === OWL_INTERSECTION_OF || predicate === OWL_UNION_OF) &&
        operator === undefined &&
        values.length === 1 &&
        only?.termType === 'BlankNode'
      ) {
        operator = predicate;
        head = `_:${only.value}`;
      } else return undefined;
    }
    const items = head === undefined ? undefined : this.listItems(head);
    if (operator === undefined || !items) return undefined;
    const members: { predicate: string; target: string }[] = [];
    for (const item of items) {
      if (item.termType === 'NamedNode') {
        members.push({ predicate: operator, target: nodeIdForIri(item.value) });
        continue;
      }
      const nested =
        item.termType === 'BlankNode' && operator === OWL_INTERSECTION_OF && this.owlRestrictions
          ? this.existential(`_:${item.value}`)
          : undefined;
      if (!nested) return undefined;
      members.push({ predicate: nested.property, target: nodeIdForIri(nested.filler) });
    }
    return members;
  }

  // ─── Blank node identity ────────────────────────────────────────────────

  /**
   * Id of a blank node. Tree-shaped blank nodes (used by exactly one subject / predicate and
   * not on a cycle) are skolemized by context: `_:b` + hash(parent id, predicate, content), so
   * `alice :knows []` and `bob :knows []` stay two nodes. Shared, unreferenced and cyclic
   * blank nodes are identified by content alone. Iterative, so parent chains of any length work.
   */
  private blankId(key: string): string {
    const known = this.blankIds.get(key);
    if (known !== undefined) return known;
    const content = (blank: string) => {
      this.blankHashes ??= this.hashBlanks();
      return this.blankHashes.get(blank) ?? hash53('');
    };
    // Walk up the unique-parent chain until an ancestor's id is known or context-free.
    const chain: string[] = [];
    for (let cursor = key; !this.blankIds.has(cursor); ) {
      const parent = this.treeParent(cursor);
      if (!parent) {
        this.blankIds.set(cursor, `_:b${content(cursor)}`);
        break;
      }
      chain.push(cursor);
      if (!isBlankKey(parent.subject)) break;
      cursor = parent.subject;
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const child = chain[i] as string;
      const parent = this.treeParent(child);
      if (!parent) continue;
      const parentId = isBlankKey(parent.subject)
        ? (this.blankIds.get(parent.subject) ?? '')
        : nodeIdForIri(parent.subject);
      const hash = hash53(`${parentId}\n<${parent.predicate}>\n${content(child)}`);
      this.blankIds.set(child, `_:b${hash}`);
    }
    return this.blankIds.get(key) ?? `_:b${content(key)}`;
  }

  /** The single (subject, predicate) using a tree-shaped blank node, if it is one. */
  private treeParent(
    key: string,
  ): { readonly subject: string; readonly predicate: string } | undefined {
    this.blankHashes ??= this.hashBlanks();
    if (this.referenceCount(key) !== 1 || this.cyclicBlanks.has(key)) return undefined;
    return this.parents.get(key);
  }

  /**
   * Content hashes for all blank nodes, independent of blank node labels and statement order.
   *
   * A blank node's hash covers its sorted outgoing triples, with blank objects replaced by
   * their own hashes. Strongly connected components (Tarjan, iterative) are processed children
   * first, so acyclic structures hash bottom-up in one pass. Blank nodes on a cycle are
   * hashed by colour refinement (1-WL) within their component until the partition is stable.
   * Structurally indistinguishable blank nodes therefore share an id. O(triples) for acyclic
   * data; at most O(component size × component triples) for cycles.
   */
  private hashBlanks(): Map<string, string> {
    const keys: string[] = [];
    const indexOf = new Map<string, number>();
    const add = (key: string): number => {
      let index = indexOf.get(key);
      if (index === undefined) {
        index = keys.length;
        indexOf.set(key, index);
        keys.push(key);
      }
      return index;
    };
    for (const key of this.subjects.keys()) if (isBlankKey(key)) add(key);
    const children: number[][] = [];
    for (let i = 0; i < keys.length; i++) {
      const out: number[] = [];
      this.forEachBlankChild(keys[i] as string, (child) => out.push(add(child)));
      children.push(out);
    }

    const hashes = new Map<string, string>();
    for (const component of stronglyConnected(children)) {
      const [first] = component;
      if (first === undefined) continue;
      const selfLoop = (children[first] ?? []).includes(first);
      if (component.length === 1 && !selfLoop) {
        const key = keys[first] as string;
        const lines = this.canonicalLines(key, (child) => hashes.get(child) ?? '');
        hashes.set(key, hash53(lines.join('\n')));
      } else {
        const members = component.map((index) => keys[index] as string);
        for (const member of members) this.cyclicBlanks.add(member);
        for (const [key, color] of this.refineCycle(members, hashes)) hashes.set(key, color);
      }
    }
    return hashes;
  }

  /**
   * Colour refinement for the blank nodes of one cycle: start from each node's own content
   * (cycle members anonymous), then repeatedly fold in the members' colours until the number
   * of distinct colours stops growing (at most one round per member).
   */
  private refineCycle(members: readonly string[], hashes: ReadonlyMap<string, string>) {
    const inside = new Set(members);
    const outside = (child: string) => hashes.get(child) ?? '';
    const colorOf = (key: string, previous: ReadonlyMap<string, string> | undefined) => {
      const lines = this.canonicalLines(key, (child) =>
        inside.has(child) ? (previous?.get(child) ?? '~') : outside(child),
      );
      return hash53(`${previous?.get(key) ?? '~'}\n${lines.join('\n')}`);
    };
    let colors = new Map(members.map((key) => [key, colorOf(key, undefined)]));
    for (let round = 0; round < members.length; round++) {
      const previous = colors;
      colors = new Map(members.map((key) => [key, colorOf(key, previous)]));
      if (new Set(colors.values()).size === new Set(previous.values()).size) break;
    }
    return colors;
  }

  /** Calls `visit` for every blank node a blank node points to (triple terms included). */
  private forEachBlankChild(key: string, visit: (child: string) => void): void {
    const term = (value: unknown): void => {
      if (value instanceof BlankNode) visit(`_:${value.value}`);
      else if (isTripleTerm(value)) {
        term(value.subject);
        term(value.object);
      }
    };
    for (const values of this.subjects.get(key)?.props.values() ?? []) {
      for (const value of values) term(value);
    }
    term(this.reifies.get(key));
  }

  /** Sorted, de-duplicated canonical lines of a blank node; `blank` names blank objects. */
  private canonicalLines(key: string, blank: (child: string) => string): string[] {
    const term = (value: unknown): string => {
      if (value instanceof BlankNode) return `_:${blank(`_:${value.value}`)}`;
      if (value instanceof NamedNode) return `<${value.value}>`;
      if (value instanceof Literal) {
        return value.language
          ? `${JSON.stringify(value.value)}@${value.language}`
          : `${JSON.stringify(value.value)}^^<${value.datatype.value}>`;
      }
      return isTripleTerm(value)
        ? `<<${term(value.subject)} ${term(value.predicate)} ${term(value.object)}>>`
        : '?';
    };
    const lines: string[] = [];
    for (const [predicate, values] of this.subjects.get(key)?.props ?? []) {
      for (const value of values) lines.push(`<${predicate}> ${term(value)}`);
    }
    const reified = this.reifies.get(key);
    if (reified) lines.push(`<${RDF_REIFIES}> ${term(reified)}`);
    return [...new Set(lines)].sort(compareStrings);
  }

  // ─── Statement annotations ──────────────────────────────────────────────

  /** Recognises an unreferenced blank node that annotates a statement. */
  private reification(key: string, subject: Subject): Reification | undefined {
    const parts = new Map<string, Value>();
    const annotations: [string, Value[]][] = [];
    for (const [predicate, values] of subject.props) {
      switch (predicate) {
        case OWL_ANNOTATED_SOURCE:
        case OWL_ANNOTATED_PROPERTY:
        case OWL_ANNOTATED_TARGET:
        case RDF_SUBJECT:
        case RDF_PREDICATE:
        case RDF_OBJECT: {
          const [only] = values;
          if (values.length !== 1 || only === undefined) return undefined;
          parts.set(predicate, only);
          break;
        }
        case RDF_TYPE:
          if (!values.every((v) => v.value === OWL_AXIOM || v.value === RDF_STATEMENT))
            return undefined;
          break;
        default:
          annotations.push([predicate, values]);
      }
    }
    const triple = this.reifies.get(key);
    let s: unknown;
    let p: unknown;
    let o: unknown;
    if (parts.size === 3 && parts.has(OWL_ANNOTATED_SOURCE)) {
      [s, p, o] = [
        parts.get(OWL_ANNOTATED_SOURCE),
        parts.get(OWL_ANNOTATED_PROPERTY),
        parts.get(OWL_ANNOTATED_TARGET),
      ];
    } else if (parts.size === 3 && parts.has(RDF_SUBJECT)) {
      [s, p, o] = [parts.get(RDF_SUBJECT), parts.get(RDF_PREDICATE), parts.get(RDF_OBJECT)];
    } else if (parts.size === 0 && triple) {
      [s, p, o] = [triple.subject, triple.predicate, triple.object];
    } else return undefined;
    if (!(s instanceof NamedNode || s instanceof BlankNode) || !(p instanceof NamedNode))
      return undefined;
    if (!(o instanceof NamedNode || o instanceof BlankNode || o instanceof Literal))
      return undefined;
    return { subject: s, predicate: p.value, object: o, annotations };
  }

  /**
   * Attaches a statement's annotations to the edge it describes (keyed by compact annotation
   * predicate), or — for an asserted literal-valued statement — to the node, keyed
   * `<property>/<annotation>`. Returns false when it cannot, so the annotation stays a node.
   */
  private foldReification(reification: Reification): boolean {
    const { subject, predicate, object } = reification;
    const sourceKey = keyOf(subject);
    let sourceId: string | undefined;
    if (subject.termType === 'NamedNode') sourceId = nodeIdForIri(subject.value);
    else if (this.emittedBlanks.has(sourceKey)) sourceId = this.blankId(sourceKey);
    if (sourceId === undefined) return false;

    const values: [string, AttrValue][] = [];
    for (const [annotation, annotationValues] of reification.annotations) {
      const key = this.attrKey(annotation);
      for (const value of annotationValues) {
        if (value.termType === 'BlankNode') return false;
        values.push([
          key,
          value.termType === 'Literal' ? literalValue(value) : nodeIdForIri(value.value),
        ]);
      }
    }

    const edge = this.annotatedEdge(sourceId, predicate, object);
    if (edge) {
      for (const [key, value] of values) edge.attrs.add(key, value);
      return true;
    }
    const asserted = this.subjects
      .get(sourceKey)
      ?.props.get(predicate)
      ?.some((value) => value.equals(object));
    const node = this.nodes.get(sourceId);
    if (object.termType !== 'Literal' || !asserted || !node) return false;
    const property = this.attrKey(predicate);
    for (const [key, value] of values) node.attrs.add(`${property}/${key}`, value);
    return true;
  }

  private annotatedEdge(
    sourceId: string,
    predicate: string,
    object: Value,
  ): EdgeBuilder | undefined {
    const find = (p: string, target: string) =>
      this.edges.get(`${sourceId}\u0000${this.table.compact(p)}\u0000${target}`);
    if (object.termType === 'NamedNode') return find(predicate, nodeIdForIri(object.value));
    if (object.termType !== 'BlankNode') return undefined;
    const key = `_:${object.value}`;
    // OWL API repeats the annotated class expression as a fresh blank node: match its shape.
    const restriction = predicate === RDFS_SUBCLASS_OF ? this.existential(key) : undefined;
    if (restriction) return find(restriction.property, nodeIdForIri(restriction.filler));
    return this.emittedBlanks.has(key) ? find(predicate, this.blankId(key)) : undefined;
  }

  // ─── Ontology header ────────────────────────────────────────────────────

  private ontologyMeta(): GraphMeta | undefined {
    if (this.ontologies.size === 0) return undefined;
    const imported = new Set<string>();
    for (const key of this.ontologies) {
      for (const value of this.subjects.get(key)?.props.get(OWL_IMPORTS) ?? [])
        imported.add(value.value);
    }
    const candidates = [...this.ontologies].sort(
      (a, b) =>
        Number(imported.has(a)) - Number(imported.has(b)) ||
        Number(isBlankKey(a)) - Number(isBlankKey(b)) ||
        compareStrings(a, b),
    );
    if (candidates.length > 1) {
      this.warnings.add(
        'multiple-ontologies',
        `Found ${candidates.length} owl:Ontology headers; using ${candidates[0]} for name and version.`,
      );
    }
    const key = candidates[0];
    const subject = key === undefined ? undefined : this.subjects.get(key);
    if (!subject || key === undefined) return undefined;
    const literal = (predicate: string) =>
      (subject.props.get(predicate) ?? [])
        .filter((value) => value.termType === 'Literal')
        .map((value) => value.value)
        .sort(compareStrings)[0];
    const iri = (predicate: string) =>
      subject.props.get(predicate)?.find((value) => value.termType === 'NamedNode')?.value;
    return makeMeta({
      name:
        this.bestLabel(subject) ??
        literal(DCTERMS_TITLE) ??
        literal(DC_TITLE) ??
        (isBlankKey(key) ? undefined : key),
      version: literal(OWL_VERSION_INFO) ?? iri(OWL_VERSION_IRI),
    });
  }
}

// ─── Values ─────────────────────────────────────────────────────────────────

/** Attribute value of a literal: typed XSD numbers / booleans, `"text@lang"` for tagged text. */
function literalValue(literal: Literal): AttrValue {
  if (literal.language) return `${literal.value}@${literal.language}`;
  const datatype = literal.datatype.value;
  return typedValue(
    literal.value,
    datatype.startsWith(XSD_NS) ? datatype.slice(XSD_NS.length) : undefined,
  );
}

const isTrue = (lexical: string): boolean => {
  const value = lexical.trim();
  return value === 'true' || value === '1';
};

function compareCandidates(a: LabelCandidate, b: LabelCandidate): number {
  return (
    a.tier - b.tier ||
    a.rank - b.rank ||
    compareStrings(a.value, b.value) ||
    compareStrings(a.language, b.language)
  );
}

/** schema.org is published under both http and https; treat them as one vocabulary. */
function schemaVariants(iri: string): string[] {
  if (iri.startsWith(SCHEMA_HTTPS)) return [iri, SCHEMA_HTTP + iri.slice(SCHEMA_HTTPS.length)];
  if (iri.startsWith(SCHEMA_HTTP)) return [iri, SCHEMA_HTTPS + iri.slice(SCHEMA_HTTP.length)];
  return [iri];
}

/**
 * Strongly connected components of a directed graph given as adjacency lists (Tarjan,
 * iterative). Components come out in reverse topological order: every component after all
 * components it points to.
 */
function stronglyConnected(adjacency: readonly (readonly number[])[]): number[][] {
  const n = adjacency.length;
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const components: number[][] = [];
  let counter = 0;
  const open = (node: number, work: [number, number][]) => {
    index[node] = low[node] = counter++;
    stack.push(node);
    onStack[node] = 1;
    work.push([node, 0]);
  };
  for (let start = 0; start < n; start++) {
    if ((index[start] ?? 0) !== -1) continue;
    const work: [number, number][] = [];
    open(start, work);
    while (work.length > 0) {
      const frame = work[work.length - 1] as [number, number];
      const [node, position] = frame;
      const next = adjacency[node]?.[position];
      if (next !== undefined) {
        frame[1]++;
        if (index[next] === -1) open(next, work);
        else if (onStack[next]) low[node] = Math.min(low[node] ?? 0, index[next] ?? 0);
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low[parent[0]] = Math.min(low[parent[0]] ?? 0, low[node] ?? 0);
      if (low[node] === index[node]) {
        const component: number[] = [];
        let member: number | undefined;
        do {
          member = stack.pop();
          if (member === undefined) break;
          onStack[member] = 0;
          component.push(member);
        } while (member !== node);
        components.push(component);
      }
    }
  }
  return components;
}
