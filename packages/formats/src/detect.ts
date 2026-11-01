/**
 * Format detection: file extension first, then content sniffing.
 */
import type { KgdiffError } from '@kgdiff/core';
import type { FormatId } from './index.js';
import { RDF_NS } from './prefixes.js';
import { invalidInput, stripBom } from './shared.js';

/** File extensions understood by `detectFormat` (matched case-insensitively, longest first). */
export const FORMAT_EXTENSIONS: Readonly<Record<FormatId, readonly string[]>> = {
  json: ['.json', '.kgdiff.json'],
  jsonld: ['.jsonld'],
  turtle: ['.ttl', '.turtle'],
  ntriples: ['.nt'],
  nquads: ['.nq'],
  trig: ['.trig'],
  rdfxml: ['.rdf', '.owl'],
  obo: ['.obo'],
};

/**
 * Extensions several syntaxes share: Protégé saves Turtle, OWL/XML or Functional Syntax as
 * `.owl` too. For these the content decides; the extension's format is only the fallback.
 */
const SHARED_EXTENSIONS: readonly string[] = ['.owl'];

const FORMATS = Object.keys(FORMAT_EXTENSIONS) as FormatId[];

const cleanName = (filename: string): string => filename.replace(/[?#].*$/, '').toLowerCase();

/** Format implied by a file name or URL, or `undefined` for unknown extensions. */
export function formatFromFilename(filename: string): FormatId | undefined {
  const name = cleanName(filename);
  let best: { format: FormatId; length: number } | undefined;
  for (const format of FORMATS) {
    for (const extension of FORMAT_EXTENSIONS[format]) {
      if (name.endsWith(extension) && (!best || extension.length > best.length)) {
        best = { format, length: extension.length };
      }
    }
  }
  return best?.format;
}

/** See `detectFormat` in index.ts. */
export function detect(text: string, filename: string | undefined): FormatId {
  const named = filename === undefined ? undefined : formatFromFilename(filename);
  if (named === undefined) return sniffFormat(text, filename);
  const name = cleanName(filename ?? '');
  if (SHARED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return sniffFormat(text, filename, named);
  }
  // `.json` holds every JSON dialect, JSON-LD included.
  if (named === 'json' && isJsonLdHead(stripBom(text.slice(0, SNIFF_WINDOW)))) return 'jsonld';
  return named;
}

/** How many leading characters content sniffing looks at (line-based checks). */
const SNIFF_WINDOW = 64 * 1024;
/** How many statement lines decide between N-Triples / N-Quads and Turtle. */
const SNIFF_LINES = 32;

/**
 * Sniffs the format from content alone. Throws for recognisably unsupported formats; returns
 * `fallback` (when given) for empty and unrecognisable text instead of guessing or failing.
 */
export function sniffFormat(text: string, filename?: string, fallback?: FormatId): FormatId {
  const head = stripBom(text.slice(0, SNIFF_WINDOW));
  const start = skipWhitespaceAndComments(head);
  // Empty (or comment-only): an empty RDF graph.
  if (start >= head.length) return fallback ?? 'turtle';
  const first = head[start];

  if (/^format-version:/m.test(head) || /^\[(?:Term|Typedef|Instance)\][ \t]*\r?$/m.test(head)) {
    return 'obo';
  }
  if (first === '{' || (first === '[' && looksLikeJsonArray(head, start))) {
    return isJsonLdHead(head) ? 'jsonld' : 'json';
  }
  if (first === '<' && looksLikeXml(head, start)) {
    const root = sniffXmlRoot(head, start);
    if (root !== undefined) {
      const kind = classifyXmlRoot(root);
      if (kind === 'rdfxml') return 'rdfxml';
      throw unsupportedFormat(kind, filename, root.qname);
    }
    if (head.includes(RDF_NS)) return 'rdfxml';
  }
  if (/^[ \t]*(?:Prefix|Ontology)\(/m.test(head)) {
    throw unsupportedFormat('OWL Functional Syntax', filename);
  }
  if (/^[ \t]*(?:Prefix|Ontology):[ \t]/m.test(head)) {
    throw unsupportedFormat('OWL Manchester Syntax', filename);
  }

  const hasDirectives = /^[ \t]*(?:@prefix|@base|PREFIX[ \t]|BASE[ \t])/im.test(head);
  if (!hasDirectives) {
    // A truncated window may end mid-line: leave that line out of the sample.
    const complete = text.length > SNIFF_WINDOW ? head.slice(0, head.lastIndexOf('\n') + 1) : head;
    const lineFormat = sniffLineFormat(complete);
    if (lineFormat) return lineFormat;
  }
  if (hasDirectives || looksLikeTurtle(head.slice(start))) {
    return hasGraphBlock(stripBom(text)) ? 'trig' : 'turtle';
  }
  if (fallback !== undefined) return fallback;
  throw invalidInput(
    `Could not detect the format of ${filename ? `"${filename}"` : 'the input'}. ` +
      `Pass \`format\` explicitly (${FORMATS.join(', ')}).`,
    filename ? { filename } : {},
  );
}

// ─── Unsupported formats ────────────────────────────────────────────────────

const TO_RDF =
  'Convert it to RDF/XML or Turtle first (e.g. `robot convert --input onto.owx --output onto.owl`).';
const TO_JSON = 'Export it as JSON first (e.g. NetworkX node-link data or Cytoscape.js JSON).';

/** Formats that are recognised but not read, with how to convert them. */
const CONVERSION_HINTS = {
  'OWL/XML': TO_RDF,
  'OWL Functional Syntax': TO_RDF,
  'OWL Manchester Syntax': TO_RDF,
  GraphML: TO_JSON,
  GEXF: TO_JSON,
  XML: 'kgdiff reads RDF/XML (an rdf:RDF root element, or a node element with rdf:about); other XML vocabularies are not graph formats it knows.',
} as const;

export type UnsupportedFormat = keyof typeof CONVERSION_HINTS;

/** `KgdiffError('invalid-input')` naming a recognised but unsupported format and a way out. */
export function unsupportedFormat(
  kind: UnsupportedFormat,
  filename?: string,
  root?: string,
): KgdiffError {
  const what = kind === 'XML' ? `XML with root element <${root ?? '?'}>` : kind;
  return invalidInput(
    `${what} is not supported${filename ? ` ("${filename}")` : ''}. ${CONVERSION_HINTS[kind]}`,
    filename ? { filename } : {},
  );
}

/** What format detection needs to know about a root element. */
export interface XmlRootInfo {
  readonly local: string;
  /** Namespace URI, when known. */
  readonly uri: string | undefined;
  /** Whether it has attributes in the RDF namespace (`rdf:about`, …). */
  readonly rdfAttributes: boolean;
  /** Whether it declares the RDF namespace (OWL/XML often does, without using it). */
  readonly rdfNamespace: boolean;
}

/**
 * RDF/XML (an `rdf:RDF` root, or a node element using the RDF namespace) or the unsupported
 * XML format a root element belongs to (`XML` when it is none of the known ones).
 */
export function classifyXmlRoot(root: XmlRootInfo): 'rdfxml' | UnsupportedFormat {
  const local = root.local;
  if (local === 'RDF') return 'rdfxml';
  // OWL/XML: <Ontology xmlns="http://www.w3.org/2002/07/owl#" ontologyIRI="…">; an RDF/XML
  // document rooted at an owl:Ontology node element uses rdf:about.
  if (local === 'Ontology' && !root.rdfAttributes) return 'OWL/XML';
  if (local.toLowerCase() === 'graphml') return 'GraphML';
  if (local.toLowerCase() === 'gexf') return 'GEXF';
  return root.rdfAttributes || root.rdfNamespace ? 'rdfxml' : 'XML';
}

/**
 * Markup rather than a Turtle IRI: a declaration, comment or DOCTYPE, or a start tag with
 * attributes, self-closing or closed later (`<a> <b> <c> .` stays Turtle).
 */
function looksLikeXml(head: string, start: number): boolean {
  const tag =
    /^<(?:([?!])|([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)(\s+[A-Za-z_][\w.:-]*\s*=|\s*\/?>))/.exec(
      head.slice(start, start + 1024),
    );
  if (!tag) return false;
  if (tag[1] !== undefined) return true;
  const [, , name = '', after = ''] = tag;
  return after.includes('=') || after.endsWith('/>') || head.includes(`</${name}`);
}

/** The root element of an XML head: prolog skipped, its own namespace declarations read. */
function sniffXmlRoot(
  head: string,
  start: number,
): (XmlRootInfo & { readonly qname: string }) | undefined {
  let i = start;
  for (;;) {
    i = skipXmlSpace(head, i);
    let end: number;
    if (head.startsWith('<?', i)) end = afterOrMinus(head, '?>', i);
    else if (head.startsWith('<!--', i)) end = afterOrMinus(head, '-->', i);
    else if (head.startsWith('<!DOCTYPE', i)) end = afterDoctype(head, i);
    else break;
    if (end < 0) return undefined;
    i = end;
  }
  const tag = /^<([^\s/>]+)((?:[^>"']|"[^"]*"|'[^']*')*)/.exec(head.slice(i));
  if (!tag) return undefined;
  const qname = tag[1] ?? '';
  const namespaces = new Map<string, string>();
  const prefixes: string[] = [];
  for (const [, name = '', double, single] of (tag[2] ?? '').matchAll(
    /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
  )) {
    const value = double ?? single ?? '';
    if (name === 'xmlns') namespaces.set('', value);
    else if (name.startsWith('xmlns:')) namespaces.set(name.slice(6), value);
    else if (name.includes(':')) prefixes.push(name.slice(0, name.indexOf(':')));
  }
  const colon = qname.indexOf(':');
  const local = colon < 0 ? qname : qname.slice(colon + 1);
  const uri = namespaces.get(colon < 0 ? '' : qname.slice(0, colon));
  const rdfAttributes = prefixes.some(
    (prefix) => namespaces.get(prefix) === RDF_NS || prefix === 'rdf',
  );
  const rdfNamespace = [...namespaces.values()].includes(RDF_NS);
  return { qname, local, uri, rdfAttributes, rdfNamespace };
}

function skipXmlSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && ' \t\n\r'.includes(text[i] ?? '')) i++;
  return i;
}

function afterOrMinus(text: string, terminator: string, from: number): number {
  const end = text.indexOf(terminator, from);
  return end < 0 ? -1 : end + terminator.length;
}

/** End of `<!DOCTYPE … [ … ]>`, or -1 when it does not end inside `text`. */
function afterDoctype(text: string, from: number): number {
  let inSubset = false;
  for (let i = from + 9; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const close = text.indexOf(c, i + 1);
      if (close < 0) return -1;
      i = close;
    } else if (c === '[') inSubset = true;
    else if (c === ']') inSubset = false;
    else if (c === '>' && !inSubset) return i + 1;
  }
  return -1;
}

// ─── JSON-LD ────────────────────────────────────────────────────────────────

/** Top-level keys that make a JSON document JSON-LD. */
const JSON_LD_KEYS: ReadonlySet<string> = new Set([
  '@context',
  '@graph',
  '@id',
  '@type',
  '@reverse',
  '@included',
  '@set',
  '@list',
  '@value',
]);

/** Whether a parsed JSON value is a JSON-LD document (by its top-level keys). */
export function isJsonLd(data: unknown): boolean {
  const object = Array.isArray(data) ? data[0] : data;
  return (
    typeof object === 'object' &&
    object !== null &&
    !Array.isArray(object) &&
    Object.keys(object).some((key) => JSON_LD_KEYS.has(key))
  );
}

/**
 * `isJsonLd` on the head of a document: the keys of the top-level object (or of the first
 * object of a top-level array) that start inside the sniff window.
 */
function isJsonLdHead(head: string): boolean {
  let i = skipXmlSpace(head, 0);
  if (head[i] === '[') i = skipXmlSpace(head, i + 1);
  if (head[i] !== '{') return false;
  i++;
  for (;;) {
    i = skipXmlSpace(head, i);
    if (head[i] !== '"') return false;
    const keyEnd = endOfJsonString(head, i);
    if (keyEnd < 0) return false;
    const key = head.slice(i + 1, keyEnd - 1);
    if (JSON_LD_KEYS.has(key)) return true;
    i = skipXmlSpace(head, keyEnd);
    if (head[i] !== ':') return false;
    i = endOfJsonValue(head, skipXmlSpace(head, i + 1));
    if (i < 0) return false;
    i = skipXmlSpace(head, i);
    if (head[i] !== ',') return false;
    i++;
  }
}

/** Index after the JSON string starting at `start`, or -1. */
function endOfJsonString(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') i++;
    else if (c === '"') return i + 1;
  }
  return -1;
}

/** Index after the JSON value starting at `start` (nested values skipped), or -1. */
function endOfJsonValue(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      i = endOfJsonString(text, i) - 1;
      if (i < 0) return -1;
      if (depth === 0) return i + 1;
    } else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
      if (depth < 0) return -1;
    } else if (depth === 0 && (c === ',' || c === ' ' || c === '\n' || c === '\r' || c === '\t')) {
      return i;
    }
  }
  return -1;
}

// ─── Text formats ───────────────────────────────────────────────────────────

function skipWhitespaceAndComments(text: string): number {
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++;
    else if (c === '#') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end + 1;
    } else break;
  }
  return i;
}

/** `[` opens JSON when followed by a JSON value; in Turtle it opens a blank node. */
function looksLikeJsonArray(text: string, start: number): boolean {
  const rest = text.slice(start + 1).trimStart();
  const next = rest[0];
  if (next === undefined) return true;
  if (next === ']') return rest.slice(1).trim() === '' || /^\]\s*[,\]]/.test(rest);
  return /[{["\d-]/.test(next);
}

/** Subject-like first token: an IRI, a blank node, a collection or a prefixed name. */
function looksLikeTurtle(text: string): boolean {
  return /^(?:<[^\s<>]*>|_:|\[|\(|[A-Za-z][\w.-]*:|:)/.test(text);
}

const NT_TERM =
  /[ \t]*(?:<[^<>"\s]*>|_:[^\s.<>"]+(?:\.[^\s.<>"]+)*|"(?:[^"\\\n]|\\.)*"(?:@[A-Za-z]+(?:-[A-Za-z0-9]+)*(?:--[a-z]+)?|\^\^<[^<>"\s]*>)?)/y;

/**
 * N-Triples / N-Quads are line-based: every statement is 3 or 4 terms and a dot. Returns
 * `nquads` when any sampled line has a graph term, `ntriples` when all have 3, and `undefined`
 * when a sampled line is not in line format (so it is Turtle or TriG).
 */
function sniffLineFormat(text: string): 'ntriples' | 'nquads' | undefined {
  let sampled = 0;
  let quads = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const terms = countLineTerms(line);
    if (terms !== 3 && terms !== 4) return undefined;
    if (terms === 4) quads = true;
    if (++sampled >= SNIFF_LINES) break;
  }
  if (sampled === 0) return undefined;
  return quads ? 'nquads' : 'ntriples';
}

function countLineTerms(line: string): number {
  let position = 0;
  let terms = 0;
  for (;;) {
    NT_TERM.lastIndex = position;
    const match = NT_TERM.exec(line);
    if (!match) break;
    position = NT_TERM.lastIndex;
    terms++;
  }
  const rest = line.slice(position).trim();
  return /^\.\s*(?:#.*)?$/.test(rest) ? terms : -1;
}

/** TriG: a `{` outside IRIs, strings and comments (`{|` is RDF 1.2 annotation syntax). */
function hasGraphBlock(text: string): boolean {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '#') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? n : end + 1;
    } else if (c === '<' && text[i + 1] !== '<') {
      const end = text.indexOf('>', i + 1);
      i = end < 0 ? n : end + 1;
    } else if (c === '"' || c === "'") {
      i = skipString(text, i, c);
    } else if (c === '{') {
      if (text[i + 1] !== '|') return true;
      i += 2;
    } else i++;
  }
  return false;
}

function skipString(text: string, start: number, quote: string): number {
  const long = text.startsWith(quote.repeat(3), start);
  const close = long ? quote.repeat(3) : quote;
  let i = start + close.length;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') i += 2;
    else if (text.startsWith(close, i)) return i + close.length;
    else if (!long && c === '\n') return i + 1;
    else i++;
  }
  return text.length;
}
