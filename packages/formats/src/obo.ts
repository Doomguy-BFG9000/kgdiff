/**
 * OBO 1.4 flat files → `GraphInput`.
 *
 * `[Term]` and `[Instance]` stanzas become nodes typed `Term` / `Instance`; `[Typedef]` stanzas
 * are not nodes, their `name` labels the edges of that relation. Tags map as follows:
 *
 *   id → id · name → label · synonym → aliases + attr `synonyms` (`"text (SCOPE)"`)
 *   def → attrs `def` + `def_xrefs` · is_obsolete → deprecated · replaced_by → replacedBy
 *   alt_id → replaces + attr `alt_id` · is_a / relationship / intersection_of / union_of /
 *   disjoint_from / equivalent_to / instance_of → edges · property_value → attr keyed by property
 *   every other tag (namespace, xref, subset, consider, comment, created_by, …) → attr
 *
 * Trailing `! comments` and `{qualifier}` blocks are stripped; OBO escapes are decoded.
 */
import type { AttrValue, EdgeInput, GraphInput, NodeInput } from '@kgdiff/core';
import { PrefixTable, readableName, WELL_KNOWN_PREFIXES } from './prefixes.js';
import {
  compareStrings,
  type EdgeFields,
  getOwn,
  invalidInput,
  makeEdge,
  makeMeta,
  NodeBuilder,
  setOwn,
  sortEdges,
  sortNodes,
  stripBom,
  typedValue,
  type Warnings,
} from './shared.js';

export interface OboParseOutput {
  readonly graph: GraphInput;
  readonly prefixes: Readonly<Record<string, string>>;
  /** `[Typedef]` names by relation id (`part_of` → “part of”). */
  readonly predicateLabels: Readonly<Record<string, string>>;
}

interface Clause {
  readonly tag: string;
  readonly value: string;
  readonly line: number;
}

interface Stanza {
  readonly kind: string;
  readonly line: number;
  readonly clauses: Clause[];
}

/** Attributes that are lists by nature: always arrays, even with one value. */
const LIST_ATTRS: ReadonlySet<string> = new Set([
  'alt_id',
  'consider',
  'def_xrefs',
  'subset',
  'synonyms',
  'xref',
]);

/** Tags whose single value is the target of an edge with the tag as predicate. */
const EDGE_TAGS: ReadonlySet<string> = new Set([
  'is_a',
  'union_of',
  'disjoint_from',
  'equivalent_to',
  'instance_of',
]);

const SYNONYM_SCOPES: ReadonlySet<string> = new Set(['EXACT', 'BROAD', 'NARROW', 'RELATED']);

/** OBO 1.2 scoped synonym tags. */
const LEGACY_SYNONYMS: Readonly<Record<string, string>> = {
  exact_synonym: 'EXACT',
  broad_synonym: 'BROAD',
  narrow_synonym: 'NARROW',
  related_synonym: 'RELATED',
};

/** Parses OBO text. Throws `KgdiffError('invalid-input')` with the line on malformed input. */
export function parseObo(text: string, warnings: Warnings): OboParseOutput {
  const { header, stanzas } = readFrames(text);

  const meta: Record<string, unknown> = {};
  const idSpaces: Record<string, string> = {};
  let defaultNamespace: string | undefined;
  for (const clause of header) {
    const value = splitValue(clause.value, clause.tag).text;
    switch (clause.tag) {
      case 'data-version':
        meta.version = decodeEscapes(value);
        break;
      case 'ontology':
        meta.name = decodeEscapes(value);
        break;
      case 'default-namespace':
        defaultNamespace = decodeEscapes(value);
        break;
      case 'idspace': {
        const [prefix, iri] = tokens(value);
        if (prefix !== undefined && iri !== undefined) setOwn(idSpaces, prefix, iri);
        else
          warnings.add('obo-invalid-idspace', '`idspace` needs a prefix and an IRI.', clause.line);
        break;
      }
      default:
        break;
    }
  }

  // Typedef names are reported for display; edge labels derive from the relation id alone,
  // so adding or removing a Typedef does not relabel every edge that uses it.
  const relationNames = new Map<string, string>();
  for (const stanza of stanzas) {
    if (stanza.kind !== 'Typedef') continue;
    const id = stanzaId(stanza);
    const name = stanza.clauses.find((clause) => clause.tag === 'name');
    if (name && !relationNames.has(id))
      relationNames.set(id, decodeEscapes(splitValue(name.value, name.tag).text));
  }

  const builder = new OboGraphBuilder(warnings);
  for (const stanza of stanzas) {
    switch (stanza.kind) {
      case 'Term':
      case 'Instance':
        builder.addStanza(stanza);
        break;
      case 'Typedef':
        break;
      default:
        warnings.add(
          'obo-unknown-stanza',
          `Skipped unsupported [${stanza.kind}] stanza.`,
          stanza.line,
        );
    }
  }

  const prefixes = new PrefixTable([
    ['well-known', WELL_KNOWN_PREFIXES],
    ['declared', idSpaces],
  ]).record;
  const graphMeta = makeMeta(meta);
  const graph: GraphInput = {
    nodes: builder.nodes(defaultNamespace),
    edges: builder.edges(),
    ...(graphMeta ? { meta: graphMeta } : {}),
  };
  const predicateLabels: Record<string, string> = {};
  for (const id of [...relationNames.keys()].sort(compareStrings)) {
    setOwn(predicateLabels, id, relationNames.get(id) ?? id);
  }
  return { graph, prefixes, predicateLabels };
}

// ─── Frames ─────────────────────────────────────────────────────────────────

function readFrames(text: string): { header: Clause[]; stanzas: Stanza[] } {
  const header: Clause[] = [];
  const stanzas: Stanza[] = [];
  let current: Stanza | undefined;
  const lines = stripBom(text).split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? '').trim();
    const lineNumber = index + 1;
    if (line === '' || line.startsWith('!')) continue;
    if (line.startsWith('[')) {
      const match = /^\[([^\]]*)\]\s*(?:!.*)?$/.exec(line);
      if (!match) {
        throw invalidInput(
          `Invalid OBO on line ${lineNumber}: malformed stanza header "${clip(line)}".`,
          {
            line: lineNumber,
          },
        );
      }
      current = { kind: (match[1] ?? '').trim(), line: lineNumber, clauses: [] };
      stanzas.push(current);
      continue;
    }
    const match = /^([^\s:]+):[ \t]*(.*)$/.exec(line);
    if (!match) {
      throw invalidInput(
        `Invalid OBO on line ${lineNumber}: expected "tag: value", got "${clip(line)}".`,
        { line: lineNumber },
      );
    }
    const clause = { tag: match[1] ?? '', value: match[2] ?? '', line: lineNumber };
    (current ? current.clauses : header).push(clause);
  }
  return { header, stanzas };
}

function stanzaId(stanza: Stanza): string {
  const clause = stanza.clauses.find((candidate) => candidate.tag === 'id');
  const id = clause ? tokens(splitValue(clause.value, clause.tag).text)[0] : undefined;
  if (id === undefined) {
    throw invalidInput(`Invalid OBO: [${stanza.kind}] stanza on line ${stanza.line} has no id.`, {
      line: stanza.line,
    });
  }
  return id;
}

const clip = (text: string): string => (text.length > 60 ? `${text.slice(0, 57)}…` : text);

// ─── Values ─────────────────────────────────────────────────────────────────

const ESCAPES: Readonly<Record<string, string>> = { n: '\n', t: '\t', W: ' ' };

/** Decodes OBO escapes: `\n`, `\t`, `\W` (space); any other `\x` is `x` (`\"`, `\\`, `\!`, …). */
function decodeEscapes(text: string): string {
  return text.includes('\\')
    ? text.replace(/\\([\s\S])/g, (_, c: string) => ESCAPES[c] ?? c)
    : text;
}

/**
 * Tags whose values contain quoted strings (`def: "…" […]`, `synonym: "…" SCOPE`,
 * `property_value: p "…" xsd:string`, `xref: X "description"`, header descriptions).
 * Elsewhere a `"` is an ordinary character: `name: 5" pipe ! comment` names a 5" pipe.
 */
const QUOTED_TAGS: ReadonlySet<string> = new Set([
  'def',
  'synonym',
  ...Object.keys(LEGACY_SYNONYMS),
  'property_value',
  'xref',
  'idspace',
  'subsetdef',
  'synonymtypedef',
]);

/**
 * Splits a raw tag value into its text and `{qualifiers}`, dropping a trailing `! comment`.
 * Escaped characters never split; quoted strings protect `!` and `{` only in tags that have
 * them (`QUOTED_TAGS`) and inside qualifier blocks (`{source="a!b"}`).
 */
function splitValue(raw: string, tag: string): { text: string; qualifiers: string | undefined } {
  const quotedTag = QUOTED_TAGS.has(tag);
  let quoted = false;
  let inQualifier = false;
  let end = raw.length;
  let lastBrace = -1;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\') i++;
    else if (c === '"' && (quotedTag || inQualifier)) quoted = !quoted;
    else if (quoted) continue;
    else if (c === '!') {
      end = i;
      break;
    } else if (c === '{') {
      lastBrace = i;
      inQualifier = true;
    } else if (c === '}') inQualifier = false;
  }
  let text = raw.slice(0, end).trimEnd();
  let qualifiers: string | undefined;
  if (lastBrace >= 0 && lastBrace < end && text.endsWith('}') && !text.endsWith('\\}')) {
    qualifiers = text.slice(lastBrace + 1, -1);
    text = text.slice(0, lastBrace).trimEnd();
  }
  return { text, qualifiers };
}

/** Whitespace-separated tokens (escapes respected and decoded). */
function tokens(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    if (c === '\\' && i + 1 < text.length) {
      current += c + (text[i + 1] ?? '');
      started = true;
      i++;
    } else if (c === ' ' || c === '\t') {
      if (started) out.push(decodeEscapes(current));
      current = '';
      started = false;
    } else {
      current += c;
      started = true;
    }
  }
  if (started) out.push(decodeEscapes(current));
  return out;
}

/** Reads a leading quoted string; `undefined` when `text` does not start with a quote. */
function readQuoted(text: string, clause: Clause): { value: string; rest: string } | undefined {
  if (!text.startsWith('"')) return undefined;
  for (let i = 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') i++;
    else if (c === '"')
      return { value: decodeEscapes(text.slice(1, i)), rest: text.slice(i + 1).trim() };
  }
  throw invalidInput(
    `Invalid OBO on line ${clause.line}: unterminated quoted string in \`${clause.tag}\`.`,
    { line: clause.line },
  );
}

/** Reads a leading `[xref, xref "description" {qualifiers}, …]` list. */
function readXrefs(text: string, clause: Clause): { xrefs: string[]; rest: string } {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('[')) return { xrefs: [], rest: trimmed };
  const items: string[] = [];
  let quoted = false;
  let start = 1;
  for (let i = 1; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === '\\') i++;
    else if (c === '"') quoted = !quoted;
    else if (!quoted && (c === ',' || c === ']')) {
      items.push(trimmed.slice(start, i));
      start = i + 1;
      if (c === ']') {
        const xrefs = items.map(xrefId).filter((id) => id !== '');
        return { xrefs, rest: trimmed.slice(i + 1).trim() };
      }
    }
  }
  throw invalidInput(
    `Invalid OBO on line ${clause.line}: unterminated xref list in \`${clause.tag}\`.`,
    {
      line: clause.line,
    },
  );
}

/** The id of one xref, without its quoted description or qualifiers. */
function xrefId(item: string): string {
  const text = item.trim();
  let end = text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') i++;
    else if (c === ' ' || c === '\t' || c === '"' || c === '{') {
      end = i;
      break;
    }
  }
  return decodeEscapes(text.slice(0, end));
}

function xsdLocalName(datatype: string | undefined): string | undefined {
  if (datatype === undefined) return undefined;
  if (datatype.startsWith('xsd:')) return datatype.slice(4);
  const hash = datatype.lastIndexOf('#');
  return datatype.startsWith('http://www.w3.org/2001/XMLSchema#')
    ? datatype.slice(hash + 1)
    : undefined;
}

// ─── Graph building ─────────────────────────────────────────────────────────

class OboGraphBuilder {
  private readonly builders = new Map<string, NodeBuilder>();
  private readonly edgeMap = new Map<string, EdgeFields>();

  constructor(private readonly warnings: Warnings) {}

  addStanza(stanza: Stanza): void {
    const id = stanzaId(stanza);
    let node = this.builders.get(id);
    if (node) {
      this.warnings.add(
        'obo-duplicate-id',
        `[${stanza.kind}] ${id} is defined more than once; the stanzas were merged.`,
        stanza.line,
      );
    } else {
      node = new NodeBuilder(id);
      this.builders.set(id, node);
    }
    node.types.add(stanza.kind);
    for (const clause of stanza.clauses) this.addClause(node, clause);
  }

  nodes(defaultNamespace: string | undefined): NodeInput[] {
    const nodes: NodeInput[] = [];
    for (const node of this.builders.values()) {
      if (defaultNamespace !== undefined && !node.attrs.has('namespace')) {
        node.attrs.add('namespace', defaultNamespace);
      }
      nodes.push(node.build(LIST_ATTRS));
    }
    return sortNodes(nodes);
  }

  edges(): EdgeInput[] {
    return sortEdges([...this.edgeMap.values()].map(makeEdge));
  }

  private addEdge(source: string, predicate: string, target: string, relation?: string): void {
    const key = JSON.stringify([source, predicate, target, relation ?? null]);
    if (this.edgeMap.has(key)) return;
    const label =
      relation === undefined
        ? readableName(predicate)
        : `${readableName(predicate)} (${readableName(relation)})`;
    this.edgeMap.set(key, {
      source,
      target,
      predicate,
      label,
      ...(relation !== undefined ? { attrs: { relation } } : {}),
    });
  }

  private addClause(node: NodeBuilder, clause: Clause): void {
    const { tag } = clause;
    const { text } = splitValue(clause.value, tag);
    const [first, second] = tokens(text);
    switch (tag) {
      case 'id':
        return;
      case 'name': {
        const name = decodeEscapes(text);
        if (node.label === undefined) node.label = name;
        else if (node.label !== name) {
          node.aliases.add(name);
          this.warnings.add(
            'obo-multiple-names',
            `${node.id} has more than one name.`,
            clause.line,
          );
        }
        return;
      }
      case 'def': {
        const quoted = readQuoted(text, clause);
        if (!quoted) {
          node.attrs.add('def', decodeEscapes(text));
          this.warnings.add(
            'obo-unquoted-def',
            `Definition of ${node.id} is not quoted.`,
            clause.line,
          );
          return;
        }
        node.attrs.add('def', quoted.value);
        for (const xref of readXrefs(quoted.rest, clause).xrefs) node.attrs.add('def_xrefs', xref);
        return;
      }
      case 'synonym':
      case 'exact_synonym':
      case 'broad_synonym':
      case 'narrow_synonym':
      case 'related_synonym': {
        const quoted = readQuoted(text, clause);
        const synonym = quoted ? quoted.value : decodeEscapes(text);
        const scopeToken = quoted ? tokens(quoted.rest.replace(/\[[\s\S]*$/, ''))[0] : undefined;
        const scope =
          getOwn(LEGACY_SYNONYMS, tag) ??
          (scopeToken !== undefined && SYNONYM_SCOPES.has(scopeToken) ? scopeToken : 'RELATED');
        if (synonym === '') return;
        node.aliases.add(synonym);
        node.attrs.add('synonyms', `${synonym} (${scope})`);
        return;
      }
      case 'relationship':
        if (first === undefined || second === undefined) {
          this.warnings.add(
            'obo-invalid-relationship',
            'relationship needs a relation and a target.',
            clause.line,
          );
          return;
        }
        this.addEdge(node.id, first, second);
        return;
      case 'intersection_of':
        if (first === undefined) {
          this.missingValue(clause);
          return;
        }
        if (second === undefined) this.addEdge(node.id, tag, first);
        else this.addEdge(node.id, tag, second, first);
        return;
      case 'is_obsolete':
        if (first === 'true') node.deprecated = true;
        return;
      case 'replaced_by':
        if (first === undefined) {
          this.missingValue(clause);
          return;
        }
        node.replacedBy.add(first);
        return;
      case 'alt_id':
        if (first === undefined) {
          this.missingValue(clause);
          return;
        }
        node.replaces.add(first);
        node.attrs.add('alt_id', first);
        return;
      case 'consider':
      case 'subset':
        if (first === undefined) {
          this.missingValue(clause);
          return;
        }
        node.attrs.add(tag, first);
        return;
      case 'xref': {
        const id = xrefId(text);
        if (id === '') {
          this.missingValue(clause);
          return;
        }
        node.attrs.add('xref', id);
        return;
      }
      case 'property_value':
        this.addPropertyValue(node, text, clause);
        return;
      default:
        if (EDGE_TAGS.has(tag)) {
          if (first === undefined) {
            this.missingValue(clause);
            return;
          }
          this.addEdge(node.id, tag, first);
          return;
        }
        // namespace, comment, created_by, creation_date and any other tag: kept verbatim.
        node.attrs.add(tag, decodeEscapes(text));
    }
  }

  /** `property_value: prop "text" xsd:type` or `property_value: prop target-id`. */
  private addPropertyValue(node: NodeBuilder, text: string, clause: Clause): void {
    const space = text.search(/[ \t]/);
    const property = space < 0 ? undefined : decodeEscapes(text.slice(0, space));
    const rest = space < 0 ? '' : text.slice(space).trim();
    let value: AttrValue | undefined;
    const quoted = readQuoted(rest, clause);
    if (quoted) value = typedValue(quoted.value, xsdLocalName(tokens(quoted.rest)[0]));
    else value = tokens(rest)[0];
    if (property === undefined || value === undefined) {
      this.missingValue(clause);
      return;
    }
    node.attrs.add(property, value);
  }

  private missingValue(clause: Clause): void {
    this.warnings.add('obo-missing-value', `\`${clause.tag}\` has no value.`, clause.line);
  }
}
