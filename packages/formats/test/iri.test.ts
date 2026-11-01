import { describe, expect, it } from 'vitest';
import { isAbsoluteIri, resolveIri } from '../src/iri.js';

describe('resolveIri', () => {
  const base = 'http://a/b/c/d;p?q';

  // RFC 3986 §5.4.1 and §5.4.2.
  it.each([
    ['g:h', 'g:h'],
    ['g', 'http://a/b/c/g'],
    ['./g', 'http://a/b/c/g'],
    ['g/', 'http://a/b/c/g/'],
    ['/g', 'http://a/g'],
    ['//g', 'http://g'],
    ['?y', 'http://a/b/c/d;p?y'],
    ['g?y', 'http://a/b/c/g?y'],
    ['#s', 'http://a/b/c/d;p?q#s'],
    ['g#s', 'http://a/b/c/g#s'],
    ['g?y#s', 'http://a/b/c/g?y#s'],
    [';x', 'http://a/b/c/;x'],
    ['g;x', 'http://a/b/c/g;x'],
    ['', 'http://a/b/c/d;p?q'],
    ['.', 'http://a/b/c/'],
    ['./', 'http://a/b/c/'],
    ['..', 'http://a/b/'],
    ['../', 'http://a/b/'],
    ['../g', 'http://a/b/g'],
    ['../..', 'http://a/'],
    ['../../g', 'http://a/g'],
    ['../../../g', 'http://a/g'],
    ['/./g', 'http://a/g'],
    ['/../g', 'http://a/g'],
    ['g.', 'http://a/b/c/g.'],
    ['.g', 'http://a/b/c/.g'],
    ['..g', 'http://a/b/c/..g'],
    ['./../g', 'http://a/b/g'],
    ['./g/.', 'http://a/b/c/g/'],
    ['g/./h', 'http://a/b/c/g/h'],
    ['g/../h', 'http://a/b/c/h'],
    ['g;x=1/./y', 'http://a/b/c/g;x=1/y'],
    ['g?y/./x', 'http://a/b/c/g?y/./x'],
    ['g#s/../x', 'http://a/b/c/g#s/../x'],
  ])('%s → %s', (reference, expected) => {
    expect(resolveIri(reference, base)).toBe(expected);
  });

  it('keeps absolute IRIs as written, like n3 does for Turtle', () => {
    expect(resolveIri('http://ex.org/a/../b', base)).toBe('http://ex.org/a/../b');
    expect(resolveIri('urn:isbn:123', base)).toBe('urn:isbn:123');
  });

  it('merges under "/" for a base with an authority and no path, and ignores its fragment', () => {
    expect(resolveIri('g', 'http://a')).toBe('http://a/g');
    expect(resolveIri('#x', 'http://a/doc#old')).toBe('http://a/doc#x');
  });

  it('leaves relative references alone without a base', () => {
    expect(resolveIri('#me', undefined)).toBe('#me');
    expect(resolveIri('../x', '')).toBe('../x');
  });
});

describe('isAbsoluteIri', () => {
  it('requires a scheme', () => {
    expect(isAbsoluteIri('http://ex.org/')).toBe(true);
    expect(isAbsoluteIri('urn:x')).toBe(true);
    expect(isAbsoluteIri('_:b0')).toBe(false);
    expect(isAbsoluteIri('/path')).toBe(false);
    expect(isAbsoluteIri('1abc:x')).toBe(false);
  });
});
