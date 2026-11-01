import {
  DEFAULT_HIERARCHY_PREDICATES,
  type DiffOptions,
  KgdiffError,
  resolveOptions,
} from '@kgdiff/core';
import { describe, expect, it } from 'vitest';

describe('resolveOptions', () => {
  it('fills every documented default', () => {
    expect(resolveOptions()).toEqual({
      match: { strategy: 'auto', threshold: 0.82, suggestThreshold: 0.6, maxCandidates: 8 },
      edgeIdentity: 'structure',
      hierarchyPredicates: [...DEFAULT_HIERARCHY_PREDICATES],
      detectMerges: true,
      detectSplits: true,
      ignoreAttrs: [],
    });
  });

  it('keeps given values, de-duplicates lists and sorts ignoreAttrs', () => {
    const resolved = resolveOptions({
      match: { strategy: 'similarity', threshold: 0.9 },
      edgeIdentity: 'id',
      hierarchyPredicates: ['broader', 'is_a', 'broader'],
      detectMerges: false,
      ignoreAttrs: ['updated', 'created', 'updated'],
    });
    expect(resolved.match).toEqual({
      strategy: 'similarity',
      threshold: 0.9,
      suggestThreshold: 0.6,
      maxCandidates: 8,
    });
    expect(resolved.hierarchyPredicates).toEqual(['broader', 'is_a']);
    expect(resolved.ignoreAttrs).toEqual(['created', 'updated']);
    expect(resolved.detectMerges).toBe(false);
    expect(resolved.detectSplits).toBe(true);
  });

  it('is idempotent', () => {
    const once = resolveOptions({ match: { maxCandidates: 3 }, ignoreAttrs: ['b', 'a'] });
    expect(resolveOptions(once)).toEqual(once);
  });

  it('exposes the default hierarchy predicates (frozen)', () => {
    expect(DEFAULT_HIERARCHY_PREDICATES).toContain('rdfs:subClassOf');
    expect(DEFAULT_HIERARCHY_PREDICATES).toContain('is_a');
    expect(Object.isFrozen(DEFAULT_HIERARCHY_PREDICATES)).toBe(true);
  });

  it.each<[string, unknown]>([
    ['a threshold above 1', { match: { threshold: 1.5 } }],
    ['a negative suggestThreshold', { match: { suggestThreshold: -0.1 } }],
    ['a NaN threshold', { match: { threshold: Number.NaN } }],
    ['an unknown strategy', { match: { strategy: 'fuzzy' } }],
    ['a fractional maxCandidates', { match: { maxCandidates: 2.5 } }],
    ['zero maxCandidates', { match: { maxCandidates: 0 } }],
    ['an unknown edge identity', { edgeIdentity: 'key' }],
    ['non-string hierarchy predicates', { hierarchyPredicates: [1] }],
    ['a non-array ignoreAttrs', { ignoreAttrs: 'x' }],
    ['a non-boolean detectMerges', { detectMerges: 'yes' }],
    ['options that are not an object', 'fast'],
  ])('rejects %s with invalid-input', (_name, options) => {
    const run = (): unknown => resolveOptions(options as DiffOptions);
    expect(run).toThrowError(KgdiffError);
    expect(run).toThrowError(expect.objectContaining({ code: 'invalid-input' }));
  });
});
