/**
 * Format detection: file extension first, then content sniffing.
 */
import type { FormatId } from './index.js';
import { invalidInput, stripBom } from './shared.js';

/** File extensions understood by `detectFormat` (matched case-insensitively, longest first). */
export const FORMAT_EXTENSIONS: Readonly<Record<FormatId, readonly string[]>> = {
  json: ['.json', '.kgdiff.json'],
  turtle: ['.ttl', '.turtle'],
  ntriples: ['.nt'],
  nquads: ['.nq'],
  trig: ['.trig'],
  obo: ['.obo'],
};

const FORMATS = Object.keys(FORMAT_EXTENSIONS) as FormatId[];

/** Format implied by a file name or URL, or `undefined` for unknown extensions. */
export function formatFromFilename(filename: string): FormatId | undefined {
  const name = filename.replace(/[?#].*$/, '').toLowerCase();
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

/** How many leading characters content sniffing looks at (line-based checks). */
const SNIFF_WINDOW = 64 * 1024;
/** How many statement lines decide between N-Triples / N-Quads and Turtle. */
const SNIFF_LINES = 32;

/** Sniffs the format from content alone. Throws for recognisably unsupported formats. */
export function sniffFormat(text: string, filename?: string): FormatId {
  const head = stripBom(text.slice(0, SNIFF_WINDOW));
  const start = skipWhitespaceAndComments(head);
  if (start >= head.length) return 'turtle'; // Empty (or comment-only): an empty RDF graph.
  const first = head[start];

  if (/^format-version:/m.test(head) || /^\[(?:Term|Typedef|Instance)\][ \t]*\r?$/m.test(head)) {
    return 'obo';
  }
  if (first === '{') return 'json';
  if (first === '[' && looksLikeJsonArray(head, start)) return 'json';
  if (first === '<' && /^<(?:\?xml|!DOCTYPE|rdf:RDF|Ontology)\b/i.test(head.slice(start))) {
    throw unsupported('RDF/XML or OWL/XML', filename);
  }
  if (/^[ \t]*(?:Prefix|Ontology)\(/m.test(head)) {
    throw unsupported('OWL Functional Syntax', filename);
  }
  if (/^[ \t]*(?:Prefix|Ontology):[ \t]/m.test(head)) {
    throw unsupported('OWL Manchester Syntax', filename);
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
  throw invalidInput(
    `Could not detect the format of ${filename ? `"${filename}"` : 'the input'}. ` +
      'Pass `format` explicitly (json, turtle, ntriples, nquads, trig or obo).',
    filename ? { filename } : {},
  );
}

function unsupported(kind: string, filename?: string) {
  return invalidInput(
    `${kind} is not supported${filename ? ` ("${filename}")` : ''}. ` +
      'Convert it to Turtle, N-Triples or OBO first (e.g. `robot convert` or `riot --output=turtle`).',
    filename ? { filename } : {},
  );
}

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
