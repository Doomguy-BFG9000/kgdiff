/**
 * RDF/XML → RDF quads (W3C RDF 1.1 XML Syntax), on top of the XML parser in `xml.ts`. The
 * quads go through the same mapping as Turtle (`rdf.ts`), so a graph diffs identically in
 * either syntax.
 *
 * The whole grammar: `rdf:RDF` or a single node element as the root; typed node elements;
 * `rdf:about`, `rdf:ID` and `rdf:nodeID`; property attributes; `rdf:li`; `rdf:datatype`;
 * `xml:lang` and `xml:base` scoping; empty property elements; `rdf:parseType` `Resource`,
 * `Collection` and `Literal` (exclusive XML canonicalization, with comments); reification by
 * `rdf:ID` on property elements; the legacy unqualified `about`, `ID`, `resource`,
 * `parseType` and `type` attributes. Grammar errors carry the line of the offending element.
 */
import { BlankNode, DataFactory, type Literal, NamedNode, type Quad } from 'n3';
import { classifyXmlRoot, unsupportedFormat } from './detect.js';
import { resolveIri } from './iri.js';
import { RDF_NS } from './prefixes.js';
import type { RdfDocument } from './rdf.js';
import { compareStrings, invalidInput, setOwn, stripBom } from './shared.js';
import {
  isXmlSpace,
  NC_NAME,
  parseXml,
  XML_NS,
  type XmlAttribute,
  type XmlElement,
  type XmlHandler,
  type XmlName,
  XmlSyntaxError,
} from './xml.js';

const RDF_TYPE = `${RDF_NS}type`;
const RDF_DESCRIPTION = `${RDF_NS}Description`;
const RDF_LI = `${RDF_NS}li`;
const RDF_FIRST = `${RDF_NS}first`;
const RDF_REST = `${RDF_NS}rest`;
const RDF_NIL = `${RDF_NS}nil`;
const RDF_STATEMENT = `${RDF_NS}Statement`;
const RDF_SUBJECT = `${RDF_NS}subject`;
const RDF_PREDICATE = `${RDF_NS}predicate`;
const RDF_OBJECT = `${RDF_NS}object`;
const RDF_XML_LITERAL = `${RDF_NS}XMLLiteral`;

/** `rdf:` names that are syntax: never node elements, property elements or properties. */
const SYNTAX_NAMES: ReadonlySet<string> = new Set([
  'RDF',
  'ID',
  'about',
  'parseType',
  'resource',
  'nodeID',
  'datatype',
  // Removed from RDF/XML in 2004.
  'aboutEach',
  'aboutEachPrefix',
  'bagID',
]);

/** Syntax attributes of property elements (RDF 1.1 XML Syntax §7.2.14–7.2.21). */
const PROPERTY_SYNTAX: ReadonlySet<string> = new Set([
  'ID',
  'parseType',
  'resource',
  'nodeID',
  'datatype',
]);

/** Unqualified attributes RDF/XML still reads as `rdf:` names (RDF 1.1 XML Syntax §6.1.4). */
const LEGACY_UNQUALIFIED: ReadonlySet<string> = new Set([
  'ID',
  'about',
  'resource',
  'parseType',
  'type',
]);

type Resource = NamedNode | BlankNode;
type Value = Resource | Literal;

/** In-scope `xml:base` and `xml:lang`. */
interface Scope {
  readonly base: string | undefined;
  readonly language: string;
}

/** The triple a property element asserts, and the IRI that reifies it (`rdf:ID`). */
interface Statement {
  readonly subject: Resource;
  readonly predicate: NamedNode;
  readonly reifier: NamedNode | undefined;
}

interface PropertyFrame {
  readonly kind: 'property';
  readonly scope: Scope;
  readonly statement: Statement;
  readonly resource: string | undefined;
  readonly nodeId: string | undefined;
  readonly datatype: string | undefined;
  readonly properties: readonly (readonly [NamedNode, string])[];
  readonly offset: number;
  text: string;
  object: Resource | undefined;
}

type Frame =
  | { readonly kind: 'document' | 'nodes'; readonly scope: Scope }
  | { readonly kind: 'node'; readonly scope: Scope; readonly subject: Resource; li: number }
  | {
      readonly kind: 'collection';
      readonly scope: Scope;
      readonly statement: Statement;
      readonly items: Resource[];
    }
  | PropertyFrame
  | {
      readonly kind: 'literal';
      /** Set on the property element itself; nested literal elements only write markup. */
      readonly statement: Statement | undefined;
      readonly writer: XmlLiteralWriter;
    };

/**
 * Reads RDF/XML (`.rdf`, `.owl` as written by Protégé, the OWL API and ROBOT) into quads.
 * Whitespace-only input is an empty graph. Throws `KgdiffError('invalid-input')` with the line
 * for XML that is not well-formed or not RDF/XML (OWL/XML and GraphML get a conversion hint).
 */
export function readRdfXml(text: string, baseIRI: string | undefined): RdfDocument {
  const source = stripBom(text);
  if (isXmlSpace(source)) return { quads: [], prefixes: {} };
  const reader = new RdfXmlReader(baseIRI);
  try {
    parseXml(source, reader);
  } catch (error) {
    if (!(error instanceof XmlSyntaxError)) throw error;
    throw invalidInput(`Invalid RDF/XML: ${error.message} on line ${error.line}.`, {
      format: 'rdfxml',
      line: error.line,
    });
  }
  return { quads: reader.quads, prefixes: reader.prefixes };
}

class RdfXmlReader implements XmlHandler {
  readonly quads: Quad[] = [];
  readonly prefixes: Record<string, string> = {};
  private readonly stack: Frame[];
  /** IRIs minted by `rdf:ID`, which must be unique in a document. */
  private readonly ids = new Set<string>();
  private readonly iris = new Map<string, NamedNode>();
  private blanks = 0;

  constructor(baseIRI: string | undefined) {
    this.stack = [{ kind: 'document', scope: { base: baseIRI, language: '' } }];
  }

  // ─── XML events ─────────────────────────────────────────────────────────

  startElement(element: XmlElement): void {
    for (const [prefix, uri] of element.namespaces) {
      if (prefix !== 'xml' && !Object.hasOwn(this.prefixes, prefix))
        setOwn(this.prefixes, prefix, uri);
    }
    const parent = this.top();
    if (parent.kind === 'literal') {
      parent.writer.start(element);
      this.stack.push({ kind: 'literal', statement: undefined, writer: parent.writer });
      return;
    }
    const scope = inScope(element, parent.scope);
    switch (parent.kind) {
      case 'document':
        this.root(element, scope);
        return;
      case 'nodes':
        this.nodeElement(element, scope);
        return;
      case 'collection':
        parent.items.push(this.nodeElement(element, scope));
        return;
      case 'node':
        this.propertyElement(element, scope, parent);
        return;
      case 'property': {
        if (parent.object !== undefined) {
          throw this.error('A property element can contain only one node element', element.offset);
        }
        if (!isXmlSpace(parent.text)) {
          throw this.error('A property element cannot mix text and a node element', element.offset);
        }
        if (
          parent.resource !== undefined ||
          parent.nodeId !== undefined ||
          parent.datatype !== undefined ||
          parent.properties.length > 0
        ) {
          throw this.error(
            'A property element with rdf:resource, rdf:nodeID, rdf:datatype or property attributes cannot contain a node element',
            element.offset,
          );
        }
        const object = this.nodeElement(element, scope);
        parent.object = object;
        this.assert(parent.statement, object);
        return;
      }
      default:
        assertExhausted(parent);
    }
  }

  endElement(): void {
    const frame = this.stack.pop();
    if (frame === undefined) return;
    switch (frame.kind) {
      case 'property':
        this.endProperty(frame);
        return;
      case 'collection': {
        let head: Resource = this.iri(RDF_NIL);
        for (let i = frame.items.length - 1; i >= 0; i--) {
          const cell = this.blank();
          this.emit(cell, this.iri(RDF_FIRST), frame.items[i] as Resource);
          this.emit(cell, this.iri(RDF_REST), head);
          head = cell;
        }
        this.assert(frame.statement, head);
        return;
      }
      case 'literal':
        if (frame.statement) {
          const value = DataFactory.literal(frame.writer.result(), this.iri(RDF_XML_LITERAL));
          this.assert(frame.statement, value);
        } else frame.writer.end();
        return;
      default:
        return;
    }
  }

  text(value: string, offset: number): void {
    const frame = this.top();
    if (frame.kind === 'literal') frame.writer.text(value);
    else if (frame.kind === 'property' && frame.object === undefined) frame.text += value;
    else if (!isXmlSpace(value)) {
      throw this.error(
        frame.kind === 'property'
          ? 'A property element cannot mix text and a node element'
          : `Unexpected text "${value.trim().slice(0, 40)}"`,
        offset,
      );
    }
  }

  processingInstruction(target: string, data: string): void {
    const frame = this.top();
    if (frame.kind === 'literal') frame.writer.processingInstruction(target, data);
  }

  comment(value: string): void {
    const frame = this.top();
    if (frame.kind === 'literal') frame.writer.comment(value);
  }

  // ─── Grammar ────────────────────────────────────────────────────────────

  private root(element: XmlElement, scope: Scope): void {
    if (element.uri === RDF_NS && element.local === 'RDF') {
      this.stack.push({ kind: 'nodes', scope });
      return;
    }
    // A lone node element is RDF/XML too (whatever its vocabulary), but OWL/XML, GraphML and
    // GEXF roots are recognisably something else: say so instead of reading them as nodes.
    const kind = classifyXmlRoot({
      local: element.local,
      uri: element.uri,
      rdfAttributes: element.attributes.some((attribute) => attribute.uri === RDF_NS),
      rdfNamespace: element.namespaces.some(([, uri]) => uri === RDF_NS),
    });
    if (kind !== 'rdfxml' && kind !== 'XML') throw unsupportedFormat(kind);
    this.nodeElement(element, scope);
  }

  private nodeElement(element: XmlElement, scope: Scope): Resource {
    const type = this.elementIri(element, 'node');
    let subject: Resource | undefined;
    let identifiers = 0;
    const properties: [NamedNode, string][] = [];
    for (const attribute of element.attributes) {
      const meaning = this.attribute(attribute, element.offset);
      if (meaning === undefined) continue;
      if (meaning instanceof NamedNode) {
        properties.push([meaning, attribute.value]);
        continue;
      }
      identifiers++;
      if (meaning === 'about') subject = this.iri(resolveIri(attribute.value, scope.base));
      else if (meaning === 'ID') subject = this.idIri(attribute.value, scope, element.offset);
      else if (meaning === 'nodeID') subject = this.labelled(attribute.value, element.offset);
      else throw this.error(`rdf:${meaning} is not allowed on a node element`, element.offset);
    }
    if (identifiers > 1) {
      throw this.error(
        'A node element can have only one of rdf:about, rdf:ID and rdf:nodeID',
        element.offset,
      );
    }
    subject ??= this.blank();
    if (type !== RDF_DESCRIPTION) this.emit(subject, this.iri(RDF_TYPE), this.iri(type));
    this.propertyAttributes(subject, properties, scope);
    this.stack.push({ kind: 'node', scope, subject, li: 0 });
    return subject;
  }

  private propertyElement(
    element: XmlElement,
    scope: Scope,
    parent: Extract<Frame, { kind: 'node' }>,
  ): void {
    let iri = this.elementIri(element, 'property');
    if (iri === RDF_LI) iri = `${RDF_NS}_${++parent.li}`;
    const syntax = new Map<string, string>();
    const properties: [NamedNode, string][] = [];
    for (const attribute of element.attributes) {
      const meaning = this.attribute(attribute, element.offset);
      if (meaning === undefined) continue;
      if (meaning instanceof NamedNode) properties.push([meaning, attribute.value]);
      else if (!PROPERTY_SYNTAX.has(meaning)) {
        throw this.error(`rdf:${meaning} is not allowed on a property element`, element.offset);
      } else if (syntax.has(meaning)) {
        throw this.error(`rdf:${meaning} is given twice`, element.offset);
      } else syntax.set(meaning, attribute.value);
    }
    const id = syntax.get('ID');
    const statement: Statement = {
      subject: parent.subject,
      predicate: this.iri(iri),
      reifier: id === undefined ? undefined : this.idIri(id, scope, element.offset),
    };
    const parseType = syntax.get('parseType');
    const resource = syntax.get('resource');
    const nodeId = syntax.get('nodeID');
    const datatype = syntax.get('datatype');
    if (parseType !== undefined) {
      if (
        resource !== undefined ||
        nodeId !== undefined ||
        datatype !== undefined ||
        properties.length > 0
      ) {
        throw this.error(
          'rdf:parseType cannot be combined with rdf:resource, rdf:nodeID, rdf:datatype or property attributes',
          element.offset,
        );
      }
      if (parseType === 'Resource') {
        const object = this.blank();
        this.assert(statement, object);
        this.stack.push({ kind: 'node', scope, subject: object, li: 0 });
      } else if (parseType === 'Collection') {
        this.stack.push({ kind: 'collection', scope, statement, items: [] });
      } else {
        // "Literal", and any other value (RDF/XML §7.2.20).
        this.stack.push({ kind: 'literal', statement, writer: new XmlLiteralWriter() });
      }
      return;
    }
    if ([resource, nodeId, datatype].filter((value) => value !== undefined).length > 1) {
      throw this.error(
        'A property element can have only one of rdf:resource, rdf:nodeID and rdf:datatype',
        element.offset,
      );
    }
    if (datatype !== undefined && properties.length > 0) {
      throw this.error('rdf:datatype cannot be combined with property attributes', element.offset);
    }
    this.stack.push({
      kind: 'property',
      scope,
      statement,
      resource,
      nodeId,
      datatype,
      properties,
      offset: element.offset,
      text: '',
      object: undefined,
    });
  }

  /** Literal, empty and resource-valued property elements, decided by what they contained. */
  private endProperty(frame: PropertyFrame): void {
    if (frame.object !== undefined) return; // A node element: asserted when it started.
    const { scope, resource, nodeId, datatype, properties, text } = frame;
    const resourceLike = resource !== undefined || nodeId !== undefined || properties.length > 0;
    if (text !== '' && !resourceLike) {
      this.assert(frame.statement, this.literal(text, scope, datatype));
      return;
    }
    if (!isXmlSpace(text)) {
      throw this.error(
        'A property element with rdf:resource, rdf:nodeID or property attributes cannot contain text',
        frame.offset,
      );
    }
    if (!resourceLike) {
      this.assert(frame.statement, this.literal('', scope, datatype));
      return;
    }
    const object =
      resource !== undefined
        ? this.iri(resolveIri(resource, scope.base))
        : nodeId !== undefined
          ? this.labelled(nodeId, frame.offset)
          : this.blank();
    this.propertyAttributes(object, properties, scope);
    this.assert(frame.statement, object);
  }

  private propertyAttributes(
    subject: Resource,
    properties: readonly (readonly [NamedNode, string])[],
    scope: Scope,
  ): void {
    for (const [predicate, value] of properties) {
      const object =
        predicate.value === RDF_TYPE
          ? this.iri(resolveIri(value, scope.base))
          : this.literal(value, scope, undefined);
      this.emit(subject, predicate, object);
    }
  }

  /** The IRI an element names, rejecting syntax names in the wrong place. */
  private elementIri(element: XmlElement, role: 'node' | 'property'): string {
    const { uri, local } = element;
    if (uri === '') throw this.error(`Element <${local}> is in no namespace`, element.offset);
    if (
      uri === RDF_NS &&
      (SYNTAX_NAMES.has(local) || local === (role === 'node' ? 'li' : 'Description'))
    ) {
      throw this.error(`rdf:${local} cannot be used as a ${role} element`, element.offset);
    }
    return uri + local;
  }

  /**
   * What an attribute means: an `rdf:` syntax name, a property, or nothing (reserved `xml…`
   * names, which RDF/XML ignores; `xml:lang` and `xml:base` are read by `inScope`).
   */
  private attribute(attribute: XmlAttribute, offset: number): NamedNode | string | undefined {
    const { prefix, local, uri } = attribute;
    if (/^xml/i.test(prefix) || (prefix === '' && /^xml/i.test(local))) return undefined;
    if (uri === '') {
      if (!LEGACY_UNQUALIFIED.has(local)) {
        throw this.error(`Attribute "${local}" is in no namespace`, offset);
      }
      return local === 'type' ? this.iri(RDF_TYPE) : local;
    }
    if (uri === RDF_NS) {
      if (SYNTAX_NAMES.has(local)) return local;
      if (local === 'li' || local === 'Description') {
        throw this.error(`rdf:${local} cannot be used as an attribute`, offset);
      }
    }
    return this.iri(uri + local);
  }

  // ─── Terms ──────────────────────────────────────────────────────────────

  /** `rdf:ID` → `base#id`, unique per document. */
  private idIri(id: string, scope: Scope, offset: number): NamedNode {
    if (!NC_NAME.test(id)) throw this.error(`rdf:ID "${id}" is not an XML name`, offset);
    const iri = resolveIri(`#${id}`, scope.base);
    if (this.ids.has(iri)) throw this.error(`rdf:ID "${id}" is used twice`, offset);
    this.ids.add(iri);
    return this.iri(iri);
  }

  /** `rdf:nodeID` blank nodes; their labels cannot clash with generated ones (`g…`). */
  private labelled(label: string, offset: number): BlankNode {
    if (!NC_NAME.test(label)) throw this.error(`rdf:nodeID "${label}" is not an XML name`, offset);
    return new BlankNode(`n${label}`);
  }

  private blank(): BlankNode {
    return new BlankNode(`g${this.blanks++}`);
  }

  private iri(value: string): NamedNode {
    let node = this.iris.get(value);
    if (!node) {
      node = new NamedNode(value);
      this.iris.set(value, node);
    }
    return node;
  }

  private literal(value: string, scope: Scope, datatype: string | undefined): Literal {
    if (datatype !== undefined) {
      return DataFactory.literal(value, this.iri(resolveIri(datatype, scope.base)));
    }
    return scope.language === ''
      ? DataFactory.literal(value)
      : DataFactory.literal(value, scope.language);
  }

  private assert({ subject, predicate, reifier }: Statement, object: Value): void {
    this.emit(subject, predicate, object);
    if (!reifier) return;
    this.emit(reifier, this.iri(RDF_TYPE), this.iri(RDF_STATEMENT));
    this.emit(reifier, this.iri(RDF_SUBJECT), subject);
    this.emit(reifier, this.iri(RDF_PREDICATE), predicate);
    this.emit(reifier, this.iri(RDF_OBJECT), object);
  }

  private emit(subject: Resource, predicate: NamedNode, object: Value): void {
    this.quads.push(DataFactory.quad(subject, predicate, object));
  }

  private top(): Frame {
    return this.stack[this.stack.length - 1] as Frame;
  }

  private error(message: string, offset: number): XmlSyntaxError {
    return new XmlSyntaxError(message, offset);
  }
}

/** `xml:base` and `xml:lang` of an element, inheriting the enclosing scope. */
function inScope(element: XmlElement, outer: Scope): Scope {
  let { base, language } = outer;
  for (const attribute of element.attributes) {
    if (attribute.uri !== XML_NS) continue;
    if (attribute.local === 'base') base = resolveIri(attribute.value, base);
    else if (attribute.local === 'lang') language = attribute.value;
  }
  return base === outer.base && language === outer.language ? outer : { base, language };
}

function assertExhausted(frame: never): never {
  throw new XmlSyntaxError(`Unexpected parser state ${String(frame)}`, 0);
}

// ─── XML literals ───────────────────────────────────────────────────────────

const NO_NAMESPACES: ReadonlyMap<string, string> = new Map();

/**
 * Lexical form of an `rdf:parseType="Literal"` value: Exclusive XML Canonicalization (with
 * comments, empty InclusiveNamespaces list) of the element content, as RDF 1.1 XML Syntax
 * requires. Namespaces are declared where they are first visibly used.
 */
class XmlLiteralWriter {
  private out = '';
  private readonly open: {
    readonly qname: string;
    readonly rendered: ReadonlyMap<string, string>;
  }[] = [];

  start(element: XmlElement): void {
    const outer = this.open[this.open.length - 1]?.rendered ?? NO_NAMESPACES;
    const used = new Map<string, string>([[element.prefix, element.uri]]);
    for (const attribute of element.attributes) {
      if (attribute.prefix !== '' && attribute.prefix !== 'xml')
        used.set(attribute.prefix, attribute.uri);
    }
    const declarations = [...used]
      .filter(([prefix, uri]) => (outer.get(prefix) ?? '') !== uri)
      .sort(([a], [b]) => compareStrings(a, b));
    let rendered = outer;
    if (declarations.length > 0) {
      const next = new Map(outer);
      for (const [prefix, uri] of declarations) next.set(prefix, uri);
      rendered = next;
    }
    const attributes = [...element.attributes].sort(
      (a, b) => compareStrings(a.uri, b.uri) || compareStrings(a.local, b.local),
    );
    const name = qualified(element);
    let tag = `<${name}`;
    for (const [prefix, uri] of declarations) {
      tag += ` xmlns${prefix === '' ? '' : `:${prefix}`}="${escapeAttribute(uri)}"`;
    }
    for (const attribute of attributes)
      tag += ` ${qualified(attribute)}="${escapeAttribute(attribute.value)}"`;
    this.out += `${tag}>`;
    this.open.push({ qname: name, rendered });
  }

  end(): void {
    const element = this.open.pop();
    if (element) this.out += `</${element.qname}>`;
  }

  text(value: string): void {
    this.out += value.replace(/[&<>\r]/g, (c) => TEXT_ESCAPES[c] ?? c);
  }

  comment(value: string): void {
    this.out += `<!--${value}-->`;
  }

  processingInstruction(target: string, data: string): void {
    this.out += data === '' ? `<?${target}?>` : `<?${target} ${data}?>`;
  }

  result(): string {
    return this.out;
  }
}

const TEXT_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '\r': '&#xD;',
};

const ATTRIBUTE_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '"': '&quot;',
  '\t': '&#x9;',
  '\n': '&#xA;',
  '\r': '&#xD;',
};

function escapeAttribute(value: string): string {
  return value.replace(/[&<"\t\n\r]/g, (c) => ATTRIBUTE_ESCAPES[c] ?? c);
}

const qualified = (name: XmlName): string =>
  name.prefix === '' ? name.local : `${name.prefix}:${name.local}`;
