/**
 * @kgdiff/formats: turn real-world graph files into kgdiff `GraphInput`s.
 *
 * Isomorphic (browser + Node), synchronous, no file-system access: callers pass
 * text. Every parser maps its source into the same `GraphInput` conventions
 * (docs/architecture.md §Formats) so diffs across formats behave identically.
 *
 * Output is deterministic: the same text and options always give an identical result, with
 * nodes sorted by id, edges by (source, predicate, target), attribute keys sorted and
 * multi-valued fields as sorted arrays.
 */
import type { GraphInput } from '@kgdiff/core';
import { FORMAT_EXTENSIONS, formatFromFilename, sniffFormat } from './detect.js';
import { parseJson } from './json.js';
import { parseObo } from './obo.js';
import { tableFor, WELL_KNOWN_PREFIXES } from './prefixes.js';
import { parseRdf } from './rdf.js';
import { assertNever, invalidInput, isRecord, makeMeta, Warnings } from './shared.js';

export { FORMAT_EXTENSIONS };

export type FormatId =
  /** kgdiff native JSON and the common JSON graph shapes (auto-detected). */
  'json' | 'turtle' | 'ntriples' | 'nquads' | 'trig' | 'obo';

/** JSON graph shapes recognised by the `json` format (reported as `ParseResult.dialect`). */
export type JsonDialect = 'kgdiff' | 'd3' | 'cytoscape' | 'g6' | 'graphology' | 'vis';

/** Stable codes of recoverable parse warnings. */
export type ParseWarningCode =
  /** RDF: quads from named graphs were merged into one graph. */
  | 'named-graphs'
  /** RDF: triples with RDF 1.2 triple terms outside reification were skipped. */
  | 'triple-terms'
  /** RDF: lists of resources became unordered edges. */
  | 'rdf-list-resources'
  /** RDF: several owl:Ontology headers; one was used for `meta`. */
  | 'multiple-ontologies'
  /** JSON (d3): nodes without ids got their array index as id. */
  | 'json-index-ids'
  /** JSON: element fields that are not part of the graph (rendering state, shape types…) were dropped. */
  | 'json-ignored-fields'
  /** OBO: a stanza type other than Term / Typedef / Instance was skipped. */
  | 'obo-unknown-stanza'
  /** OBO: stanzas with the same id were merged. */
  | 'obo-duplicate-id'
  /** OBO: a term has several names; extra ones became aliases. */
  | 'obo-multiple-names'
  /** OBO: a `relationship` without relation or target was skipped. */
  | 'obo-invalid-relationship'
  /** OBO: a tag without a value was skipped. */
  | 'obo-missing-value'
  /** OBO: a `def` without quotes was kept verbatim. */
  | 'obo-unquoted-def'
  /** OBO: an `idspace` header without prefix or IRI was skipped. */
  | 'obo-invalid-idspace';

export interface RdfOptions {
  /**
   * Predicates used for node labels, in priority order (full IRIs or CURIEs with a known
   * prefix). Default rdfs:label, skos:prefLabel, schema:name, dcterms:title, foaf:name.
   * Language preference outranks predicate priority; unchosen label values become aliases.
   */
  readonly labelPredicates?: readonly string[];
  /** Predicates used for aliases. Default skos:altLabel and the oboInOwl synonym predicates. */
  readonly aliasPredicates?: readonly string[];
  /** Keep `rdf:type` as edges too (default false: types only become `node.type`). */
  readonly typeEdges?: boolean;
  /** Turn `C rdfs:subClassOf [ owl:onProperty R ; owl:someValuesFrom D ]` into an edge C –R→ D. Default true. */
  readonly owlRestrictions?: boolean;
  /**
   * Language preference for labels, e.g. ['zh', 'en']. Default: untagged, then 'en', then any.
   * A tag also matches its subtags (`en` matches `en-GB`, exact tags first); untagged labels
   * come after the listed languages unless `''` is listed explicitly. Ties break
   * lexicographically.
   */
  readonly languages?: readonly string[];
  /**
   * Extra prefixes used to compact IRIs (they win over declared prefixes). Unlike prefixes
   * declared in the file, they also apply to identities, so pass the same map for every
   * version you diff.
   */
  readonly prefixes?: Readonly<Record<string, string>>;
  /**
   * Which prefixes compact identities: edge predicates, attribute keys, types and fallback
   * labels. Default `well-known`: only the well-known prefixes, the OBO PURL rule and
   * `prefixes`, so the same graph gets the same identities whether a file declares
   * `@prefix ex:` or spells IRIs out (Turtle vs N-Triples). `declared` also uses the file's
   * own `@prefix` declarations (prettier, but a renamed prefix then reads as a change).
   * Declared prefixes are always returned in `ParseResult.prefixes` for display.
   */
  readonly compactWith?: 'well-known' | 'declared';
  /**
   * Fold statement annotations (`owl:Axiom`, `rdf:Statement`, RDF 1.2 `{| … |}` reifiers)
   * into the attrs of the annotated edge, or of the node as `<property>/<annotation>` for
   * literal-valued statements. Default true; false keeps every annotation as a blank node.
   */
  readonly foldAnnotations?: boolean;
}

export interface JsonOptions {
  /**
   * Override field detection for custom shapes. Values are keys or dotted paths, looked up in
   * the element's property record (`data` for Cytoscape / G6, `attributes` for graphology,
   * the element itself otherwise), then in the raw element.
   */
  readonly fields?: {
    readonly id?: string;
    readonly label?: string;
    readonly type?: string;
    readonly source?: string;
    readonly target?: string;
    readonly predicate?: string;
  };
}

export interface ParseOptions {
  /** Default `auto`: detect from `filename` and content. */
  readonly format?: FormatId | 'auto';
  /** Used for format detection and as `meta.source`. */
  readonly filename?: string;
  /** Base IRI for relative IRIs in RDF. */
  readonly baseIRI?: string;
  readonly rdf?: RdfOptions;
  readonly json?: JsonOptions;
}

export interface ParseWarning {
  readonly code: ParseWarningCode;
  readonly message: string;
  /** 1-based line, when known. */
  readonly line?: number;
}

export interface ParseResult {
  readonly graph: GraphInput;
  readonly format: FormatId;
  /** Detected JSON dialect (json format only). */
  readonly dialect?: JsonDialect;
  /** Prefix map (declared + well-known) for compact display of IRIs. */
  readonly prefixes: Readonly<Record<string, string>>;
  /**
   * Display names the source gives its relations, by edge predicate: an RDF property's own
   * label (`BFO:0000050` → “part of”), an OBO `[Typedef]` name, or kgdiff JSON
   * `meta.predicateLabels`. Edge `label`s derive from the predicate alone, so declarations
   * coming and going never relabel edges. Also stored as `graph.meta.predicateLabels`.
   */
  readonly predicateLabels: Readonly<Record<string, string>>;
  readonly warnings: readonly ParseWarning[];
}

const FORMAT_IDS: ReadonlySet<string> = new Set(Object.keys(FORMAT_EXTENSIONS));

/**
 * Parse graph text in any supported format. Throws `KgdiffError('invalid-input')` with line
 * info on syntax errors.
 *
 * - `format` defaults to `auto` (`detectFormat(text, filename)`).
 * - `meta.source` is set to `filename` when given.
 * - Recoverable oddities (named graphs merged, unsupported OBO stanzas, d3 index ids, …) are
 *   reported in `warnings` instead of failing.
 *
 * Linear in the input size (plus sorting the output); 50k triples parse in well under a second.
 */
export function parseGraph(text: string, options: ParseOptions = {}): ParseResult {
  if (typeof text !== 'string')
    throw invalidInput('parseGraph expects the file content as a string.');
  const requested = options.format ?? 'auto';
  if (requested !== 'auto' && !FORMAT_IDS.has(requested)) {
    throw invalidInput(
      `Unknown format "${String(requested)}". Expected auto, ${[...FORMAT_IDS].join(', ')}.`,
    );
  }
  const format = requested === 'auto' ? detectFormat(text, options.filename) : requested;
  const warnings = new Warnings();
  let graph: GraphInput;
  let prefixes: Readonly<Record<string, string>> = WELL_KNOWN_PREFIXES;
  let predicateLabels: Readonly<Record<string, string>> = {};
  let dialect: JsonDialect | undefined;
  switch (format) {
    case 'json': {
      const parsed = parseJson(text, options.json, warnings);
      graph = parsed.graph;
      dialect = parsed.dialect;
      predicateLabels = parsed.predicateLabels;
      break;
    }
    case 'obo': {
      const parsed = parseObo(text, warnings);
      graph = parsed.graph;
      prefixes = parsed.prefixes;
      predicateLabels = parsed.predicateLabels;
      break;
    }
    case 'turtle':
    case 'ntriples':
    case 'nquads':
    case 'trig': {
      const parsed = parseRdf(
        text,
        format,
        { baseIRI: options.baseIRI, rdf: options.rdf },
        warnings,
      );
      graph = parsed.graph;
      prefixes = parsed.prefixes;
      predicateLabels = parsed.predicateLabels;
      break;
    }
    default:
      return assertNever(format);
  }
  const hasLabels = Object.keys(predicateLabels).length > 0;
  if (options.filename !== undefined || hasLabels) {
    const meta = makeMeta({
      ...(isRecord(graph.meta) ? graph.meta : {}),
      ...(hasLabels ? { predicateLabels } : {}),
      ...(options.filename !== undefined ? { source: options.filename } : {}),
    });
    graph = { ...graph, ...(meta ? { meta } : {}) };
  }
  return {
    graph,
    format,
    ...(dialect !== undefined ? { dialect } : {}),
    prefixes,
    predicateLabels,
    warnings: warnings.finish(),
  };
}

/**
 * Best-effort format detection from file name and content sniffing.
 *
 * The extension wins when it is known (`FORMAT_EXTENSIONS`, case-insensitive; query strings
 * are ignored). Otherwise: `{` (or a JSON array) → json; `format-version:` or a
 * `[Term]` / `[Typedef]` / `[Instance]` line → obo; Turtle directives → turtle, or trig when a
 * `{ … }` graph block appears; line-based statements → ntriples (3 terms) or nquads (4 terms).
 * Empty input is an (empty) Turtle graph. Throws `KgdiffError('invalid-input')` for
 * recognisably unsupported formats (RDF/XML, OWL/XML, OWL Functional / Manchester syntax,
 * JSON-LD is reported by the JSON parser) and for unrecognisable text.
 */
export function detectFormat(text: string, filename?: string): FormatId {
  return (
    (filename !== undefined ? formatFromFilename(filename) : undefined) ??
    sniffFormat(text, filename)
  );
}

/**
 * Compact an IRI with a prefix map: `http://purl.obolibrary.org/obo/GO_0008150` → `GO:0008150`.
 *
 * Uses the well-known prefixes (rdf, rdfs, owl, xsd, skos, schema, dcterms, dc, foaf, prov,
 * oboInOwl, obo) overlaid with `prefixes`; OBO PURLs follow the OBO rule unless `prefixes`
 * binds that id space elsewhere. The longest matching namespace wins; when several names share
 * one namespace, names from `prefixes` win over well-known ones. Returns `iri` unchanged when
 * nothing matches. For display only: node ids keep full IRIs.
 */
export function compactIri(iri: string, prefixes?: Readonly<Record<string, string>>): string {
  return tableFor(prefixes).compact(iri);
}
