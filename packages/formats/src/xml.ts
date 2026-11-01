/**
 * A small, non-validating XML 1.0 parser with namespaces and SAX-style callbacks, for RDF/XML.
 *
 * Supports what real RDF/XML files contain: the XML declaration, comments, processing
 * instructions, CDATA sections, character references, the predefined entities and general
 * entities declared in the internal DTD subset (`<!ENTITY owl "…">`, as older Protégé / OWL API
 * versions write). External DTDs and entities are never loaded (referencing an external
 * entity is an error), and entity expansion is capped, so a "billion laughs" document fails
 * fast instead of exhausting memory. Linear in the input size; no recursion, so nesting depth
 * is unlimited.
 */
import { lineAndColumn } from './shared.js';

export const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/** A namespace-qualified name: `prefix` is `''` when unprefixed, `uri` `''` when in no namespace. */
export interface XmlName {
  readonly prefix: string;
  readonly local: string;
  readonly uri: string;
}

export interface XmlAttribute extends XmlName {
  /** Normalized value: references resolved, literal tabs and line breaks turned into spaces. */
  readonly value: string;
}

export interface XmlElement extends XmlName {
  /** Attributes other than namespace declarations, in document order. */
  readonly attributes: readonly XmlAttribute[];
  /** Namespace declarations made on this element (`''` is the default namespace). */
  readonly namespaces: readonly (readonly [prefix: string, uri: string])[];
  /** Offset of the element's `<`, for error positions. */
  readonly offset: number;
}

export interface XmlHandler {
  startElement(element: XmlElement): void;
  endElement(offset: number): void;
  /** Character data inside the root element; consecutive chunks may arrive separately. */
  text(value: string, offset: number): void;
  /** A processing instruction inside the root element. */
  processingInstruction(target: string, data: string, offset: number): void;
  /** A comment inside the root element. */
  comment(value: string, offset: number): void;
}

/**
 * A well-formedness (or, thrown by a handler, grammar) error at an offset of the parsed text.
 * `parseXml` fills in the 1-based `line` before passing it on.
 */
export class XmlSyntaxError {
  line = 0;

  constructor(
    readonly message: string,
    readonly offset: number,
  ) {}
}

const NAME_START =
  'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C\\u200D' +
  '\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
const NAME_CHAR = `${NAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F\\u2040`;
const NC_NAME_SOURCE = `[${NAME_START}][${NAME_CHAR}]*`;

/** XML namespaces `NCName` (a name without colons): rdf:ID and rdf:nodeID values. */
export const NC_NAME = new RegExp(`^${NC_NAME_SOURCE}$`, 'u');
/** A qualified name at a position (sticky): `local` or `prefix:local`. */
const QNAME_AT = new RegExp(`(?:${NC_NAME_SOURCE}:)?${NC_NAME_SOURCE}`, 'uy');
/** An XML `Name` at a position (DTD declarations may use colons freely). */
const NAME_AT = new RegExp(`[:${NAME_START}][:${NAME_CHAR}]*`, 'uy');
const ENTITY_NAME = new RegExp(`^[:${NAME_START}][:${NAME_CHAR}]*$`, 'u');
const NOT_SPACE = /[^ \t\n\r]/;

const GT = 0x3e;
const SLASH = 0x2f;
const BANG = 0x21;
const QUESTION = 0x3f;

/** Entity expansion budget: generous for real files, fatal for exponential blow-ups. */
const MIN_EXPANSION_BUDGET = 4 * 1024 * 1024;
const EXPANSION_FACTOR = 16;

interface Entity {
  /** Replacement text with character references already resolved (XML 1.0 §4.5). */
  readonly value: string;
  readonly external: boolean;
  expanded?: string;
  expanding?: boolean;
}

interface OpenElement {
  readonly qname: string;
  readonly offset: number;
  /** Namespace bindings to restore when the element closes. */
  readonly outer: ReadonlyMap<string, string>;
}

const PREDEFINED: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  apos: "'",
  quot: '"',
};

/**
 * Parses an XML document, reporting elements, text, comments and processing instructions to
 * `handler`. Line breaks are normalized to `\n` first (XML 1.0 §2.11). Throws `XmlSyntaxError`
 * (with its line) on documents that are not namespace-well-formed, and passes on whatever
 * the handler throws, filling in the line of handler-thrown `XmlSyntaxError`s too.
 */
export function parseXml(text: string, handler: XmlHandler): void {
  const source = text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
  try {
    new XmlParser(source, handler).parse();
  } catch (error) {
    if (error instanceof XmlSyntaxError) error.line = lineAndColumn(source, error.offset).line;
    throw error;
  }
}

export const isXmlSpace = (value: string): boolean => !NOT_SPACE.test(value);

class XmlParser {
  private i = 0;
  private readonly stack: OpenElement[] = [];
  private namespaces: ReadonlyMap<string, string> = new Map([['xml', XML_NS]]);
  private readonly entities = new Map<string, Entity>();
  private expansion = 0;
  private readonly expansionBudget: number;
  private sawRoot = false;
  private sawDoctype = false;

  constructor(
    private readonly text: string,
    private readonly handler: XmlHandler,
  ) {
    this.expansionBudget = Math.max(MIN_EXPANSION_BUDGET, EXPANSION_FACTOR * text.length);
  }

  parse(): void {
    const { text } = this;
    // Leading whitespace before the declaration is tolerated (strictly, it is an error).
    const start = skipSpace(text, 0);
    if (text.startsWith('<?xml', start) && /[ \t\n]/.test(text[start + 5] ?? '')) {
      this.i = this.skipPast('?>', start, 'XML declaration');
    }
    while (this.i < text.length) {
      const lt = text.indexOf('<', this.i);
      const end = lt < 0 ? text.length : lt;
      if (end > this.i) this.characters(this.i, end);
      if (lt < 0) break;
      this.i = lt;
      const next = text.charCodeAt(lt + 1);
      if (next === SLASH) this.endTag();
      else if (next === BANG) this.markupDeclaration();
      else if (next === QUESTION) this.processingInstruction();
      else this.startTag();
    }
    const open = this.stack[this.stack.length - 1];
    if (open) throw new XmlSyntaxError(`Element <${open.qname}> is never closed`, open.offset);
    if (!this.sawRoot) throw new XmlSyntaxError('The document has no root element', text.length);
  }

  // ─── Markup ─────────────────────────────────────────────────────────────

  private startTag(): void {
    const { text } = this;
    const offset = this.i;
    if (this.sawRoot && this.stack.length === 0) {
      throw new XmlSyntaxError('Only one root element is allowed', offset);
    }
    const qname = this.qnameAt(offset + 1, 'an element name');
    let i = offset + 1 + qname.length;
    const raw: [name: string, value: string, offset: number][] = [];
    let selfClosing = false;
    for (;;) {
      const at = skipSpace(text, i);
      const c = text.charCodeAt(at);
      if (c === GT) {
        i = at + 1;
        break;
      }
      if (c === SLASH && text.charCodeAt(at + 1) === GT) {
        i = at + 2;
        selfClosing = true;
        break;
      }
      if (at >= text.length) throw new XmlSyntaxError(`Unclosed tag <${qname}>`, offset);
      if (at === i) throw new XmlSyntaxError(`Expected whitespace, ">" or "/>" in <${qname}>`, at);
      const name = this.qnameAt(at, 'an attribute name');
      let j = skipSpace(text, at + name.length);
      if (text[j] !== '=') throw new XmlSyntaxError(`Expected "=" after attribute ${name}`, j);
      j = skipSpace(text, j + 1);
      const quote = text[j];
      if (quote !== '"' && quote !== "'") {
        throw new XmlSyntaxError(`Expected a quoted value for attribute ${name}`, j);
      }
      const close = text.indexOf(quote, j + 1);
      if (close < 0) throw new XmlSyntaxError(`Unterminated value of attribute ${name}`, j);
      const value = text.slice(j + 1, close);
      if (value.includes('<')) {
        throw new XmlSyntaxError(`"<" is not allowed in the value of attribute ${name}`, j);
      }
      raw.push([name, value, at]);
      i = close + 1;
    }
    this.i = i;
    this.openElement(qname, raw, offset, selfClosing);
  }

  private openElement(
    qname: string,
    raw: readonly (readonly [string, string, number])[],
    offset: number,
    selfClosing: boolean,
  ): void {
    const outer = this.namespaces;
    let declarations: Map<string, string> | undefined;
    const declared: [string, string][] = [];
    for (const [name, value, at] of raw) {
      if (name !== 'xmlns' && !name.startsWith('xmlns:')) continue;
      const prefix = name === 'xmlns' ? '' : name.slice(6);
      const uri = this.attributeValue(value, at);
      checkNamespaceDeclaration(prefix, uri, at);
      declarations ??= new Map(outer);
      declarations.set(prefix, uri);
      declared.push([prefix, uri]);
    }
    const scope = declarations ?? outer;
    const element = splitName(qname, scope, offset, true);
    const attributes: XmlAttribute[] = [];
    const seen = raw.length > 1 ? new Set<string>() : undefined;
    for (const [name, value, at] of raw) {
      if (seen) {
        if (seen.has(name)) throw new XmlSyntaxError(`Duplicate attribute ${name}`, at);
        seen.add(name);
      }
      if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
      const attribute = {
        ...splitName(name, scope, at, false),
        value: this.attributeValue(value, at),
      };
      // Two prefixes for one namespace still name the same attribute.
      const key = `{${attribute.uri}}${attribute.local}`;
      if (seen && attribute.prefix !== '') {
        if (seen.has(key)) throw new XmlSyntaxError(`Duplicate attribute ${key}`, at);
        seen.add(key);
      }
      attributes.push(attribute);
    }
    this.sawRoot = true;
    this.handler.startElement({ ...element, attributes, namespaces: declared, offset });
    if (selfClosing) this.handler.endElement(offset);
    else {
      this.stack.push({ qname, offset, outer });
      this.namespaces = scope;
    }
  }

  private endTag(): void {
    const { text } = this;
    const offset = this.i;
    const qname = this.qnameAt(offset + 2, 'an element name');
    const close = skipSpace(text, offset + 2 + qname.length);
    if (text.charCodeAt(close) !== GT)
      throw new XmlSyntaxError(`Expected ">" after </${qname}`, close);
    const open = this.stack.pop();
    if (!open) throw new XmlSyntaxError(`Unexpected end tag </${qname}>`, offset);
    if (open.qname !== qname) {
      throw new XmlSyntaxError(`Expected </${open.qname}>, found </${qname}>`, offset);
    }
    this.namespaces = open.outer;
    this.i = close + 1;
    this.handler.endElement(offset);
  }

  private markupDeclaration(): void {
    const { text } = this;
    const offset = this.i;
    if (text.startsWith('<!--', offset)) {
      this.i = this.skipPast('-->', offset + 4, 'comment');
      if (this.stack.length > 0) this.handler.comment(text.slice(offset + 4, this.i - 3), offset);
    } else if (text.startsWith('<![CDATA[', offset)) {
      if (this.stack.length === 0) {
        throw new XmlSyntaxError('CDATA sections are only allowed inside the root element', offset);
      }
      const end = text.indexOf(']]>', offset + 9);
      if (end < 0) throw new XmlSyntaxError('Unterminated CDATA section', offset);
      if (end > offset + 9) this.handler.text(text.slice(offset + 9, end), offset);
      this.i = end + 3;
    } else if (text.startsWith('<!DOCTYPE', offset)) {
      if (this.sawRoot || this.sawDoctype) {
        throw new XmlSyntaxError('A DOCTYPE is only allowed once, before the root element', offset);
      }
      this.sawDoctype = true;
      this.i = this.doctype(offset + 9);
    } else {
      throw new XmlSyntaxError('Unexpected "<!"', offset);
    }
  }

  private processingInstruction(): void {
    const offset = this.i;
    const target = this.nameAt(offset + 2, 'a processing instruction target');
    if (target.toLowerCase() === 'xml') {
      throw new XmlSyntaxError('The XML declaration is only allowed at the very start', offset);
    }
    const end = this.text.indexOf('?>', offset + 2 + target.length);
    if (end < 0) throw new XmlSyntaxError('Unterminated processing instruction', offset);
    if (this.stack.length > 0) {
      const data = this.text.slice(offset + 2 + target.length, end).replace(/^[ \t\n]+/, '');
      this.handler.processingInstruction(target, data, offset);
    }
    this.i = end + 2;
  }

  private characters(start: number, end: number): void {
    const raw = this.text.slice(start, end);
    if (this.stack.length === 0) {
      if (!isXmlSpace(raw)) {
        throw new XmlSyntaxError(
          this.sawRoot ? 'Text after the root element' : 'Text before the root element',
          start + raw.search(NOT_SPACE),
        );
      }
      return;
    }
    this.handler.text(raw.includes('&') ? this.resolve(raw, start, false) : raw, start);
  }

  // ─── DTD ────────────────────────────────────────────────────────────────

  /** Skips `<!DOCTYPE …>`, reading entity declarations from the internal subset. */
  private doctype(start: number): number {
    const { text } = this;
    let i = start;
    for (;;) {
      const c = text[i];
      if (c === undefined) throw new XmlSyntaxError('Unterminated DOCTYPE', start);
      if (c === '"' || c === "'") i = this.skipPast(c, i + 1, 'DOCTYPE literal');
      else if (c === '[') i = this.internalSubset(i + 1);
      else if (c === '>') return i + 1;
      else i++;
    }
  }

  private internalSubset(start: number): number {
    const { text } = this;
    let i = start;
    for (;;) {
      i = skipSpace(text, i);
      if (i >= text.length) throw new XmlSyntaxError('Unterminated DTD internal subset', start);
      if (text[i] === ']') return i + 1;
      if (text.startsWith('<!--', i)) i = this.skipPast('-->', i + 4, 'comment');
      else if (text.startsWith('<?', i)) i = this.skipPast('?>', i + 2, 'processing instruction');
      else if (text.startsWith('<!ENTITY', i)) i = this.entityDeclaration(i);
      else if (text.startsWith('<!', i)) i = this.skipDeclaration(i);
      else if (text[i] === '%') i = this.skipPast(';', i + 1, 'parameter entity reference');
      else throw new XmlSyntaxError('Unexpected content in the DTD internal subset', i);
    }
  }

  /** `<!ENTITY name "value">`, `<!ENTITY name SYSTEM "uri">`, `<!ENTITY % name …>`. */
  private entityDeclaration(start: number): number {
    const { text } = this;
    let i = skipSpace(text, start + 8);
    const parameter = text[i] === '%';
    if (parameter) i = skipSpace(text, i + 1);
    const name = this.nameAt(i, 'an entity name');
    i = skipSpace(text, i + name.length);
    const quote = text[i];
    // Without a quoted value it is SYSTEM / PUBLIC: an external entity, never fetched.
    let entity: Entity = { value: '', external: true };
    if (quote === '"' || quote === "'") {
      const close = text.indexOf(quote, i + 1);
      if (close < 0) throw new XmlSyntaxError(`Unterminated value of entity ${name}`, i);
      entity = { value: this.characterReferences(text.slice(i + 1, close), i), external: false };
    }
    // The first declaration of an entity is binding (XML 1.0 §4.2).
    if (!parameter && !this.entities.has(name)) this.entities.set(name, entity);
    return this.skipDeclaration(start);
  }

  /** Skips a markup declaration up to its closing `>`, honouring quoted literals. */
  private skipDeclaration(start: number): number {
    const { text } = this;
    let i = start + 2;
    for (;;) {
      const c = text[i];
      if (c === undefined) throw new XmlSyntaxError('Unterminated DTD declaration', start);
      if (c === '"' || c === "'") i = this.skipPast(c, i + 1, 'DTD literal');
      else if (c === '>') return i + 1;
      else i++;
    }
  }

  // ─── References ─────────────────────────────────────────────────────────

  /** Attribute value normalization (XML 1.0 §3.3.3, CDATA attributes). */
  private attributeValue(raw: string, offset: number): string {
    const spaced = /[\t\n]/.test(raw) ? raw.replace(/[\t\n]/g, ' ') : raw;
    return spaced.includes('&') ? this.resolve(spaced, offset, true) : spaced;
  }

  /** Resolves character and entity references in content or an attribute value. */
  private resolve(raw: string, offset: number, inAttribute: boolean): string {
    let out = '';
    let last = 0;
    for (let amp = raw.indexOf('&'); amp >= 0; amp = raw.indexOf('&', last)) {
      const semicolon = raw.indexOf(';', amp + 1);
      if (semicolon < 0) throw new XmlSyntaxError('Unterminated "&" reference', offset + amp);
      const name = raw.slice(amp + 1, semicolon);
      out += raw.slice(last, amp);
      if (name.startsWith('#')) out += characterReference(name, offset + amp);
      else {
        const replacement = getPredefined(name) ?? this.entity(name, offset + amp, inAttribute);
        out += replacement;
      }
      last = semicolon + 1;
    }
    return out + raw.slice(last);
  }

  private entity(name: string, offset: number, inAttribute: boolean): string {
    if (!ENTITY_NAME.test(name)) throw new XmlSyntaxError(`Invalid reference "&${name};"`, offset);
    const entity = this.entities.get(name);
    if (!entity) throw new XmlSyntaxError(`Undeclared entity "&${name};"`, offset);
    if (entity.external) {
      throw new XmlSyntaxError(
        `External entity "&${name};" is not loaded (external resources are never fetched)`,
        offset,
      );
    }
    if (entity.expanded === undefined) {
      if (entity.expanding) throw new XmlSyntaxError(`Entity "&${name};" refers to itself`, offset);
      entity.expanding = true;
      // Memoized without attribute normalization, which applies per use.
      entity.expanded = entity.value.includes('&')
        ? this.resolve(entity.value, offset, false)
        : entity.value;
      entity.expanding = false;
    }
    const value = entity.expanded;
    if (value.includes('<')) {
      throw new XmlSyntaxError(
        `Entity "&${name};" contains markup, which is not supported`,
        offset,
      );
    }
    this.expansion += value.length;
    if (this.expansion > this.expansionBudget) {
      throw new XmlSyntaxError('Entity expansion exceeds the size limit', offset);
    }
    return inAttribute && /[\t\n]/.test(value) ? value.replace(/[\t\n]/g, ' ') : value;
  }

  /** Character references in an entity value are resolved when it is declared (§4.5). */
  private characterReferences(value: string, offset: number): string {
    return value.includes('&#')
      ? value.replace(/&(#[^;]*);/g, (_match, name: string) => characterReference(name, offset))
      : value;
  }

  // ─── Scanning helpers ───────────────────────────────────────────────────

  private qnameAt(at: number, what: string): string {
    QNAME_AT.lastIndex = at;
    const match = QNAME_AT.exec(this.text);
    if (!match) throw new XmlSyntaxError(`Expected ${what}`, at);
    return match[0];
  }

  private nameAt(at: number, what: string): string {
    NAME_AT.lastIndex = at;
    const match = NAME_AT.exec(this.text);
    if (!match) throw new XmlSyntaxError(`Expected ${what}`, at);
    return match[0];
  }

  /** Index just past the next `terminator` at or after `from`. */
  private skipPast(terminator: string, from: number, what: string): number {
    const end = this.text.indexOf(terminator, from);
    if (end < 0) throw new XmlSyntaxError(`Unterminated ${what}`, from);
    return end + terminator.length;
  }
}

function skipSpace(text: string, from: number): number {
  let i = from;
  for (;;) {
    const c = text.charCodeAt(i);
    if (c === 0x20 || c === 0x0a || c === 0x09 || c === 0x0d) i++;
    else return i;
  }
}

function getPredefined(name: string): string | undefined {
  return Object.hasOwn(PREDEFINED, name) ? PREDEFINED[name] : undefined;
}

const isXmlChar = (c: number): boolean =>
  c === 0x9 ||
  c === 0xa ||
  c === 0xd ||
  (c >= 0x20 && c <= 0xd7ff) ||
  (c >= 0xe000 && c <= 0xfffd) ||
  (c >= 0x10000 && c <= 0x10ffff);

/** `#65` / `#x41` → `A`. */
function characterReference(name: string, offset: number): string {
  const hex = name[1] === 'x';
  const digits = name.slice(hex ? 2 : 1);
  const code = (hex ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(digits)
    ? Number.parseInt(digits, hex ? 16 : 10)
    : Number.NaN;
  if (!isXmlChar(code)) {
    throw new XmlSyntaxError(`Invalid character reference "&${name};"`, offset);
  }
  return String.fromCodePoint(code);
}

function checkNamespaceDeclaration(prefix: string, uri: string, offset: number): void {
  const fail = (message: string) => new XmlSyntaxError(message, offset);
  if (prefix === 'xmlns') throw fail('The xmlns prefix cannot be declared');
  if (prefix === 'xml' && uri !== XML_NS) throw fail('The xml prefix cannot be rebound');
  if (prefix !== 'xml' && uri === XML_NS)
    throw fail(`Prefix "${prefix}" cannot be bound to the XML namespace`);
  if (uri === XMLNS_NS) throw fail('The xmlns namespace cannot be bound');
  if (prefix !== '' && uri === '') throw fail(`Prefix "${prefix}" cannot be undeclared`);
}

/** Resolves a qualified name; unprefixed attributes are in no namespace. */
function splitName(
  qname: string,
  scope: ReadonlyMap<string, string>,
  offset: number,
  isElement: boolean,
): XmlName {
  const colon = qname.indexOf(':');
  if (colon < 0) return { prefix: '', local: qname, uri: isElement ? (scope.get('') ?? '') : '' };
  const prefix = qname.slice(0, colon);
  const uri = scope.get(prefix);
  if (uri === undefined)
    throw new XmlSyntaxError(`Undeclared namespace prefix "${prefix}"`, offset);
  return { prefix, local: qname.slice(colon + 1), uri };
}
