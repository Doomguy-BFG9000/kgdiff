import { hashGraph, normalize } from '@kgdiff/core';
import { describe, expect, it } from 'vitest';
import { Cyrb53, canonicalJSON, cyrb53 } from '../src/canonical.js';

const base = {
  meta: { name: 'demo', version: '1' },
  nodes: [
    { id: 'a', label: 'A', attrs: { x: 1, y: { p: [1, 2], q: null } } },
    { id: 'b', type: ['T'] },
  ],
  edges: [
    { source: 'a', target: 'b', predicate: 'p' },
    { source: 'b', target: 'a', predicate: 'q', attrs: { w: 1 } },
  ],
};

describe('hashGraph', () => {
  it('renders 53 bits as c53: plus 14 hex digits', () => {
    expect(hashGraph(normalize(base))).toMatch(/^c53:[0-9a-f]{14}$/);
    expect(hashGraph(normalize({ nodes: [], edges: [] }))).toMatch(/^c53:[0-9a-f]{14}$/);
  });

  it('ignores element order, attribute key order, meta and positions', () => {
    const reference = hashGraph(normalize(base));
    const variant = normalize({
      meta: { name: 'other' },
      nodes: [
        { id: 'b', type: ['T'], position: { x: 4, y: 2 } },
        { id: 'a', label: 'A', attrs: { y: { q: null, p: [1, 2] }, x: 1 } },
      ],
      edges: [...base.edges].reverse(),
    });
    expect(hashGraph(variant)).toBe(reference);
  });

  it('ignores whether a node was declared or created implicitly', () => {
    const implicit = normalize({ nodes: [{ id: 'a' }], edges: [{ source: 'a', target: 'b' }] });
    const explicit = normalize({
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [{ source: 'a', target: 'b' }],
    });
    expect(hashGraph(implicit)).toBe(hashGraph(explicit));
  });

  it('changes with any content change', () => {
    const reference = hashGraph(normalize(base));
    const variants = [
      { ...base, nodes: [{ ...base.nodes[0], label: 'A2' }, base.nodes[1]] },
      { ...base, nodes: [{ ...base.nodes[0], attrs: { x: 2 } }, base.nodes[1]] },
      { ...base, nodes: [base.nodes[0], { id: 'b', type: ['U'] }] },
      { ...base, nodes: [base.nodes[0], { id: 'b', type: ['T'], deprecated: true }] },
      { ...base, nodes: [base.nodes[0], { id: 'b', type: ['T'], aliases: ['B'] }] },
      { ...base, nodes: [base.nodes[0], { id: 'b', type: ['T'], replacedBy: ['a'] }] },
      { ...base, edges: [base.edges[0], { ...base.edges[1], attrs: { w: 2 } }] },
      { ...base, edges: [base.edges[0], { ...base.edges[1], label: 'Q' }] },
      { ...base, edges: [base.edges[0]] },
    ];
    const hashes = variants.map((v) => hashGraph(normalize(v as typeof base)));
    for (const h of hashes) expect(h).not.toBe(reference);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('covers edge ids only under id identity', () => {
    const withId = (id: string) => ({
      nodes: [{ id: 'a' }],
      edges: [{ id, source: 'a', target: 'a' }],
    });
    expect(hashGraph(normalize(withId('e1')))).toBe(hashGraph(normalize(withId('e2'))));
    expect(hashGraph(normalize(withId('e1'), { edgeIdentity: 'id' }))).not.toBe(
      hashGraph(normalize(withId('e2'), { edgeIdentity: 'id' })),
    );
  });

  it('frames strings unambiguously', () => {
    const a = normalize({ nodes: [{ id: 'ab', label: 'c' }], edges: [] });
    const b = normalize({ nodes: [{ id: 'a', label: 'bc' }], edges: [] });
    expect(hashGraph(a)).not.toBe(hashGraph(b));
  });
});

describe('cyrb53', () => {
  it('matches the reference implementation', () => {
    // Reference values of bryc's cyrb53 (seed 0).
    expect(cyrb53('a')).toBe(7929297801672961);
    expect(cyrb53('revenge')).toBe(4051478007546757);
    expect(cyrb53('revenue')).toBe(8309097637345594);
  });

  it('hashes a stream like its concatenation', () => {
    expect(new Cyrb53().update('hello ').update('world').digest()).toBe(cyrb53('hello world'));
  });
});

describe('canonicalJSON', () => {
  it('sorts object keys recursively and keeps array order', () => {
    expect(canonicalJSON({ b: 1, a: [{ d: 1, c: 2 }, 3] })).toBe('{"a":[{"c":2,"d":1},3],"b":1}');
  });
});
