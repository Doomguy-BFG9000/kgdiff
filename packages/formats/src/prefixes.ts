/**
 * IRI compaction: well-known prefixes, declared prefixes and the OBO PURL rule
 * (`http://purl.obolibrary.org/obo/GO_0008150` → `GO:0008150`).
 */
import { compareStrings, getOwn, setOwn } from './shared.js';

export const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const RDFS_NS = 'http://www.w3.org/2000/01/rdf-schema#';
export const OWL_NS = 'http://www.w3.org/2002/07/owl#';
export const XSD_NS = 'http://www.w3.org/2001/XMLSchema#';
export const SKOS_NS = 'http://www.w3.org/2004/02/skos/core#';
export const OBO_IN_OWL_NS = 'http://www.geneontology.org/formats/oboInOwl#';
export const OBO_PURL = 'http://purl.obolibrary.org/obo/';

/** Prefixes every parser knows without a declaration. */
export const WELL_KNOWN_PREFIXES: Readonly<Record<string, string>> = Object.freeze({
  dc: 'http://purl.org/dc/elements/1.1/',
  dcterms: 'http://purl.org/dc/terms/',
  foaf: 'http://xmlns.com/foaf/0.1/',
  obo: OBO_PURL,
  oboInOwl: OBO_IN_OWL_NS,
  owl: OWL_NS,
  prov: 'http://www.w3.org/ns/prov#',
  rdf: RDF_NS,
  rdfs: RDFS_NS,
  schema: 'https://schema.org/',
  skos: SKOS_NS,
  xsd: XSD_NS,
});

/** Namespaces that compact to a well-known prefix besides its canonical namespace. */
const WELL_KNOWN_VARIANTS: readonly (readonly [string, string])[] = [
  ['schema', 'http://schema.org/'],
];

/** OBO Foundry id spaces: a letter followed by letters / digits, then `_` and a local id. */
const OBO_LOCAL_ID = /^([A-Za-z][A-Za-z0-9]*)_([^\s/#?]+)$/;

/** `http://purl.obolibrary.org/obo/GO_0008150` → `GO:0008150`; `undefined` for other IRIs. */
export function oboCurie(iri: string): string | undefined {
  if (!iri.startsWith(OBO_PURL)) return undefined;
  const match = OBO_LOCAL_ID.exec(iri.slice(OBO_PURL.length));
  return match ? `${match[1]}:${match[2]}` : undefined;
}

/**
 * Stable node id for an IRI: OBO PURLs become CURIEs, every other IRI stays whole so the same
 * resource gets the same id whatever prefixes a file declares.
 */
export function nodeIdForIri(iri: string): string {
  return oboCurie(iri) ?? iri;
}

/** Where a prefix came from. */
export type PrefixSource = 'user' | 'well-known' | 'declared';

/** Preference when several names share one namespace (lower wins). */
const SOURCE_PREFERENCE: Readonly<Record<PrefixSource, number>> = {
  user: 0,
  'well-known': 1,
  declared: 2,
};

/** Override order per name: well-known, then declared, then user. */
const SOURCE_OVERRIDE: Readonly<Record<PrefixSource, number>> = {
  'well-known': 0,
  declared: 1,
  user: 2,
};

interface Entry {
  readonly prefix: string;
  readonly namespace: string;
  readonly preference: number;
}

/**
 * Compiled prefix map. Compaction picks the longest matching namespace; when several prefixes
 * share a namespace, explicit options beat well-known names, which beat file declarations,
 * so `rdfs:` stays `rdfs:` even in a file that declares it under another name.
 */
export class PrefixTable {
  /** Name → namespace, as reported in `ParseResult.prefixes` (sorted by name). */
  readonly record: Readonly<Record<string, string>>;
  private readonly entries: readonly Entry[];
  /** Name → namespace for lookups (a Map: prefix names like `constructor` are ordinary). */
  private readonly namespaces = new Map<string, string>();
  private readonly cache = new Map<string, string>();

  constructor(layers: readonly (readonly [PrefixSource, Readonly<Record<string, string>>])[]) {
    // Name → namespace: declared names override well-known ones, user names override both.
    const byName = new Map<string, Entry>();
    const ordered = [...layers].sort(([a], [b]) => SOURCE_OVERRIDE[a] - SOURCE_OVERRIDE[b]);
    for (const [source, prefixes] of ordered) {
      const preference = SOURCE_PREFERENCE[source];
      for (const [prefix, namespace] of Object.entries(prefixes)) {
        if (namespace) byName.set(prefix, { prefix, namespace, preference });
      }
    }
    const record: Record<string, string> = {};
    for (const name of [...byName.keys()].sort(compareStrings)) {
      const entry = byName.get(name);
      if (!entry) continue;
      setOwn(record, name, entry.namespace);
      this.namespaces.set(name, entry.namespace);
    }
    this.record = record;

    const entries = [...byName.values()];
    for (const [prefix, namespace] of WELL_KNOWN_VARIANTS) {
      if (byName.get(prefix)?.namespace === getOwn(WELL_KNOWN_PREFIXES, prefix)) {
        entries.push({ prefix, namespace, preference: SOURCE_PREFERENCE['well-known'] });
      }
    }
    // Longest namespace first; for equal namespaces the preferred name first.
    this.entries = entries.sort(
      (a, b) =>
        b.namespace.length - a.namespace.length ||
        compareStrings(a.namespace, b.namespace) ||
        a.preference - b.preference ||
        a.prefix.length - b.prefix.length ||
        compareStrings(a.prefix, b.prefix),
    );
  }

  /** Compact form of `iri` (cached), or `iri` itself when no prefix applies. */
  compact(iri: string): string {
    let compact = this.cache.get(iri);
    if (compact === undefined) {
      compact = this.compute(iri);
      this.cache.set(iri, compact);
    }
    return compact;
  }

  /**
   * Expands a CURIE with a known prefix (or an OBO-style `GO:0008150`) to a full IRI.
   * Strings that already look like absolute IRIs are returned unchanged.
   */
  expand(value: string): string {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('urn:')) return value;
    const colon = value.indexOf(':');
    if (colon < 0) return value;
    const namespace = this.namespaces.get(value.slice(0, colon));
    if (namespace !== undefined) return namespace + value.slice(colon + 1);
    const prefix = value.slice(0, colon);
    // Undeclared upper-case id spaces (`IAO:0100001`) follow the OBO PURL convention.
    if (/^[A-Z][A-Za-z0-9]*$/.test(prefix)) return `${OBO_PURL}${prefix}_${value.slice(colon + 1)}`;
    return value;
  }

  private compute(iri: string): string {
    const obo = oboCurie(iri);
    if (obo !== undefined) {
      const idSpace = obo.slice(0, obo.indexOf(':'));
      const declared = this.namespaces.get(idSpace);
      // Respect a file that binds the id space to something else.
      if (declared === undefined || declared === `${OBO_PURL}${idSpace}_`) return obo;
    }
    for (const entry of this.entries) {
      if (iri.startsWith(entry.namespace))
        return `${entry.prefix}:${iri.slice(entry.namespace.length)}`;
    }
    return iri;
  }
}

const defaultTable = new PrefixTable([['well-known', WELL_KNOWN_PREFIXES]]);
const tables = new WeakMap<Readonly<Record<string, string>>, PrefixTable>();

/** Table for `compactIri`: well-known prefixes overlaid with `prefixes` (cached per object). */
export function tableFor(prefixes?: Readonly<Record<string, string>>): PrefixTable {
  if (!prefixes) return defaultTable;
  let table = tables.get(prefixes);
  if (!table) {
    table = new PrefixTable([
      ['well-known', WELL_KNOWN_PREFIXES],
      ['user', prefixes],
    ]);
    tables.set(prefixes, table);
  }
  return table;
}

/**
 * Readable form of a predicate or id, mirroring core's `predicateLabel`: the local part after
 * the last `#`, `/` or `:`, with `_` turned into spaces. Opaque local parts (digits only) keep
 * the whole compact form: `BFO:0000050` stays `BFO:0000050`.
 */
export function readableName(value: string): string {
  const cut = Math.max(value.lastIndexOf('#'), value.lastIndexOf('/'), value.lastIndexOf(':'));
  const local = value.slice(cut + 1);
  if (local === '' || /^\d+$/.test(local)) return value;
  return local.replace(/_/g, ' ');
}
