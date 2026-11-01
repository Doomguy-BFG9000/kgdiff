import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatHash, isViewerMode, parseHash } from '../src/hash-sync.js';

describe('hash sync', () => {
  it('parses hunk and mode', () => {
    expect(parseHash('#kgdiff=hunk:merge%3ALEGAL_REP;mode:replay')).toEqual({
      hunk: 'merge:LEGAL_REP',
      mode: 'replay',
    });
    expect(parseHash('kgdiff=mode:swipe')).toEqual({ mode: 'swipe' });
  });

  it('ignores foreign hashes, unknown fields, bad modes and bad encodings', () => {
    expect(parseHash('#section-2')).toBeNull();
    expect(parseHash('')).toBeNull();
    expect(parseHash('#kgdiff=')).toEqual({});
    expect(parseHash('#kgdiff=mode:sideways;zoom:3;hunk:%E0%A4%A')).toEqual({});
    expect(parseHash('#kgdiff=hunk:;mode:')).toEqual({});
  });

  it('round-trips ids with IRI characters, CJK and separators', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.constantFrom('overlay', 'swipe', 'replay', 'changes' as const),
        (hunk, mode) => {
          expect(parseHash(formatHash({ hunk, mode }))).toEqual({ hunk, mode });
        },
      ),
    );
    const id = 'modify:http://ex.org/a#b;c?d=e 企业「x」';
    expect(parseHash(formatHash({ hunk: id }))).toEqual({ hunk: id });
  });

  it('validates modes', () => {
    expect(isViewerMode('changes')).toBe(true);
    expect(isViewerMode('Changes')).toBe(false);
    expect(isViewerMode(null)).toBe(false);
  });
});
