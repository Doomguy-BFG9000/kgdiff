import type { Attrs, GraphInput } from '@kgdiff/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseGraph } from '../src/index.js';
import { fixture, parseFixture } from './helpers.js';

const FIXTURES = [
  'people.ttl',
  'people.nt',
  'people.nq',
  'people.trig',
  'go-mini.ttl',
  'go-mini.obo',
  'kgdiff.json',
  'd3.json',
  'd3-index.json',
  'networkx.json',
  'cytoscape.json',
  'cytoscape-elements.json',
  'g6.json',
  'graphology.json',
  'vis.json',
];

const isSorted = (values: readonly string[]) =>
  values.every((value, i) => i === 0 || values[i - 1]! <= value);

/** Every multi-valued field the parsers produce comes out sorted. */
function expectCanonical(graph: GraphInput, sortedAttrArrays: boolean): void {
  expect(isSorted(graph.nodes.map((node) => node.id))).toBe(true);
  const edgeKeys = graph.edges.map((edge) =>
    JSON.stringify([edge.source, edge.predicate ?? '', edge.target]),
  );
  expect(edgeKeys.every((key, i) => i === 0 || edgeKeys[i - 1]! <= key)).toBe(true);
  const checkAttrs = (attrs: Attrs | undefined) => {
    if (!attrs) return;
    expect(isSorted(Object.keys(attrs))).toBe(true);
    if (!sortedAttrArrays) return;
    for (const value of Object.values(attrs)) {
      if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        expect(isSorted(value as string[])).toBe(true);
      }
    }
  };
  for (const node of graph.nodes) {
    if (Array.isArray(node.type)) expect(isSorted(node.type)).toBe(true);
    for (const list of [node.aliases, node.replaces, node.replacedBy]) {
      if (list) expect(isSorted(list)).toBe(true);
    }
    checkAttrs(node.attrs);
  }
  for (const edge of graph.edges) checkAttrs(edge.attrs);
}

describe('determinism', () => {
  it.each(FIXTURES)('%s parses to byte-identical output every time', (name) => {
    const first = JSON.stringify(parseFixture(name));
    expect(JSON.stringify(parseFixture(name))).toBe(first);
  });

  it.each(FIXTURES)('%s comes out in canonical order', (name) => {
    // JSON attribute arrays are user data and keep their order; RDF / OBO multi-values are sets.
    expectCanonical(parseFixture(name).graph, !name.endsWith('.json'));
  });

  it('does not depend on the order of N-Triples statements or on blank node labels', () => {
    const statements = fixture('people.nt')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('#'));
    const labels = [...new Set(statements.flatMap((line) => line.match(/_:\w+/g) ?? []))];
    const expected = JSON.stringify(parseGraph(statements.join('\n'), { format: 'ntriples' }));
    fc.assert(
      fc.property(
        fc.shuffledSubarray(statements, {
          minLength: statements.length,
          maxLength: statements.length,
        }),
        fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/), {
          minLength: labels.length,
          maxLength: labels.length,
        }),
        (shuffled, renamed) => {
          const text = shuffled
            .join('\n')
            .replace(/_:\w+/g, (label) => `_:${renamed[labels.indexOf(label)]}`);
          expect(JSON.stringify(parseGraph(text, { format: 'ntriples' }))).toBe(expected);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('gives blank nodes the same ids whatever their labels or statement order, cycles included', () => {
    const iris = ['<http://ex.org/x>', '<http://ex.org/y>', '"1"', '"two"@en'];
    const blankGraphs = fc.integer({ min: 1, max: 6 }).chain((size) =>
      fc
        .array(
          fc.tuple(
            fc.nat(size - 1),
            fc.constantFrom('p', 'q'),
            fc.oneof(fc.nat(size - 1), fc.constantFrom(...iris)),
          ),
          { minLength: 1, maxLength: 14 },
        )
        .chain((triples) =>
          fc.tuple(
            fc.constant(triples),
            fc.shuffledSubarray(triples, {
              minLength: triples.length,
              maxLength: triples.length,
            }),
            fc.shuffledSubarray([...Array(size).keys()], { minLength: size, maxLength: size }),
            fc.boolean(),
          ),
        ),
    );
    const write = (
      triples: readonly (readonly [number, string, number | string])[],
      label: (i: number) => string,
      root: boolean,
    ) =>
      [
        ...(root ? [`<http://ex.org/root> <http://ex.org/has> ${label(0)} .`] : []),
        ...triples.map(
          ([s, p, o]) =>
            `${label(s)} <http://ex.org/${p}> ${typeof o === 'number' ? label(o) : o} .`,
        ),
      ].join('\n');
    fc.assert(
      fc.property(blankGraphs, ([triples, shuffled, permutation, root]) => {
        const a = parseGraph(
          write(triples, (i) => `_:b${i}`, root),
          { format: 'ntriples' },
        );
        const b = parseGraph(
          write(shuffled, (i) => `_:n${permutation[i]}x`, root),
          { format: 'ntriples' },
        );
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
        // Every blank subject's content survives.
        const literals = triples.filter(([, , o]) => o === '"1"').length;
        if (literals > 0) expect(JSON.stringify(a.graph)).toContain('"1"');
      }),
      { numRuns: 300 },
    );
  });

  it('does not depend on the order of OWL axioms, restrictions or annotations', () => {
    const blocks = fixture('go-mini.ttl').split(/\n(?=\S)/);
    const prefixes = blocks.filter((block) => block.startsWith('@prefix'));
    const statements = blocks.filter(
      (block) => !block.startsWith('@prefix') && !block.startsWith('#'),
    );
    const expected = JSON.stringify(parseGraph(fixture('go-mini.ttl'), { format: 'turtle' }));
    fc.assert(
      fc.property(
        fc.shuffledSubarray(statements, {
          minLength: statements.length,
          maxLength: statements.length,
        }),
        (shuffled) => {
          const text = [...prefixes, ...shuffled].join('\n');
          expect(JSON.stringify(parseGraph(text, { format: 'turtle' }))).toBe(expected);
        },
      ),
      { numRuns: 40 },
    );
  });

  it('does not depend on the order of OBO stanzas or tags', () => {
    const [header = '', ...stanzas] = fixture('go-mini.obo').split(/\n(?=\[)/);
    const expected = JSON.stringify(parseGraph(fixture('go-mini.obo'), { format: 'obo' }));
    const shuffleTags = (stanza: string, keys: readonly number[]) => {
      const [title = '', ...tags] = stanza.trim().split('\n');
      const order = tags.map((tag, i) => ({ tag, key: keys[i % keys.length] ?? 0, i }));
      order.sort((a, b) => a.key - b.key || a.i - b.i);
      return [title, ...order.map((entry) => entry.tag)].join('\n');
    };
    fc.assert(
      fc.property(
        fc.shuffledSubarray(stanzas, { minLength: stanzas.length, maxLength: stanzas.length }),
        fc.array(fc.nat(), { minLength: 1, maxLength: 20 }),
        (shuffled, keys) => {
          const text = [header, ...shuffled.map((stanza) => shuffleTags(stanza, keys))].join(
            '\n\n',
          );
          expect(JSON.stringify(parseGraph(text, { format: 'obo' }))).toBe(expected);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('does not depend on the order of JSON nodes, edges or object keys', () => {
    const data = JSON.parse(fixture('kgdiff.json')) as {
      nodes: object[];
      edges: object[];
      meta: object;
    };
    const expected = JSON.stringify(parseGraph(fixture('kgdiff.json'), { format: 'json' }));
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (typeof value !== 'object' || value === null) return value;
      return Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([k, v]) => [k, reverseKeys(v)]),
      );
    };
    fc.assert(
      fc.property(
        fc.shuffledSubarray(data.nodes, {
          minLength: data.nodes.length,
          maxLength: data.nodes.length,
        }),
        fc.shuffledSubarray(data.edges, {
          minLength: data.edges.length,
          maxLength: data.edges.length,
        }),
        fc.boolean(),
        (nodes, edges, reversed) => {
          const shuffled = { meta: data.meta, edges, nodes };
          const text = JSON.stringify(reversed ? reverseKeys(shuffled) : shuffled);
          expect(JSON.stringify(parseGraph(text, { format: 'json' }))).toBe(expected);
        },
      ),
      { numRuns: 60 },
    );
  });
});
