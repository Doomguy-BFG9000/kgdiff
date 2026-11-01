import { type DiffJSON, diff, diffFromJSON, diffToJSON, formatHunk, hashGraph } from '@kgdiff/core';
import { describe, expect, it } from 'vitest';
import { enterpriseAfter, enterpriseBefore } from './support/fixtures.js';

describe('diffToJSON', () => {
  const d = diff(enterpriseBefore, enterpriseAfter('hint'));
  const json = diffToJSON(d);

  it('is a versioned, self-describing document', () => {
    expect(json).toMatchObject({
      format: 'kgdiff.diff',
      version: 1,
      meta: {
        before: { name: 'enterprise-kg', version: '2026.09' },
        after: { name: 'enterprise-kg', version: '2026.10' },
      },
      options: d.options,
      hunks: d.hunks,
      delta: d.delta,
      stats: d.stats,
    });
    expect(json).not.toHaveProperty('index');
  });

  it('stores unchanged elements once and omits empty facets', () => {
    const person = json.nodes.find((n) => n.id === 'Person');
    expect(person).toEqual({
      id: 'Person',
      beforeId: 'Person',
      afterId: 'Person',
      after: { id: 'Person', label: '自然人', types: ['Class'] },
      status: 'unchanged',
    });
    const renamed = json.nodes.find((n) => n.id === 'ExecutivePosition');
    expect(renamed?.before).toEqual({
      id: 'ExecutivePosition',
      label: '高管任职',
      types: ['Relation'],
    });
    expect(renamed?.after?.label).toBe('董监高任职');
    const subclass = json.edges.find((e) => e.status === 'unchanged');
    expect(subclass?.before).toBeUndefined();
  });

  it('serializes to the same bytes every time', () => {
    const again = diffToJSON(diff(enterpriseBefore, enterpriseAfter('hint')));
    expect(JSON.stringify(again)).toBe(JSON.stringify(json));
  });
});

describe('diffFromJSON', () => {
  const d = diff(enterpriseBefore, enterpriseAfter('heuristic'));
  const text = JSON.stringify(diffToJSON(d));
  const back = diffFromJSON(JSON.parse(text) as DiffJSON);

  it('rebuilds both graphs, the union and the index', () => {
    expect(hashGraph(back.before)).toBe(hashGraph(d.before));
    expect(hashGraph(back.after)).toBe(hashGraph(d.after));
    expect(back.nodes).toEqual(d.nodes);
    expect(back.edges).toEqual(d.edges);
    expect(back.index.nodeByBefore('LegalRep')?.facets[0]?.kind).toBe('mergedInto');
    expect(back.index.edgesOf('Person').map((e) => e.id)).toEqual(
      d.index.edgesOf('Person').map((e) => e.id),
    );
  });

  it('round-trips byte for byte', () => {
    expect(JSON.stringify(diffToJSON(back))).toBe(text);
  });

  it('produces the same hunk titles', () => {
    for (const h of d.hunks)
      expect(formatHunk(h, back, 'zh-CN')).toEqual(formatHunk(h, d, 'zh-CN'));
  });

  it('rejects other formats and newer versions', () => {
    const json = JSON.parse(text) as DiffJSON;
    expect(() =>
      diffFromJSON({ ...json, format: 'kgdiff.delta' } as unknown as DiffJSON),
    ).toThrowError(expect.objectContaining({ code: 'unsupported-version' }));
    expect(() => diffFromJSON({ ...json, version: 2 } as unknown as DiffJSON)).toThrowError(
      expect.objectContaining({ code: 'unsupported-version' }),
    );
    expect(() => diffFromJSON({ ...json, nodes: undefined } as unknown as DiffJSON)).toThrowError(
      expect.objectContaining({ code: 'invalid-input' }),
    );
  });
});

describe('diffFromJSON: validation', () => {
  const json = (): Record<string, unknown> =>
    JSON.parse(
      JSON.stringify(
        diffToJSON(diff({ nodes: [{ id: 'a' }], edges: [] }, { nodes: [{ id: 'b' }], edges: [] })),
      ),
    );

  it.each<[string, (j: Record<string, unknown>) => void]>([
    ['no meta', (j) => delete j.meta],
    ['no options', (j) => delete j.options],
    ['no delta', (j) => delete j.delta],
    [
      'an unknown node status',
      (j) =>
        (((j.nodes as Record<string, unknown>[])[0] as Record<string, unknown>).status = 'bogus'),
    ],
    ['an edge without endpoints', (j) => (j.edges = [{ id: 'e', status: 'added' }])],
  ])('rejects a document with %s as invalid-input', (_name, damage) => {
    const j = json();
    damage(j);
    expect(() => diffFromJSON(j as unknown as DiffJSON)).toThrowError(
      expect.objectContaining({ code: 'invalid-input' }),
    );
  });
});
