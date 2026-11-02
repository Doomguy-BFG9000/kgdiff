import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  cleanupSemantic,
  diffChars,
  diffSequences,
  diffWords,
  pairItems,
  sideOf,
  tokenize,
} from '../src/text-diff.js';

const join = (segs: { op: string; items: string[] }[]) =>
  segs.map((s) => `${s.op[0]}:${s.items.join('')}`).join(' ');

describe('diffSequences (Myers)', () => {
  it('finds a minimal edit script', () => {
    expect(join(diffSequences([...'abcabba'], [...'cbabac']))).toBe(
      'd:ab e:c i:b e:ab d:b e:a i:c',
    );
  });

  it('handles empty sides and identical inputs', () => {
    expect(diffSequences([], [])).toEqual([]);
    expect(join(diffSequences([], [...'ab']))).toBe('i:ab');
    expect(join(diffSequences([...'ab'], []))).toBe('d:ab');
    expect(join(diffSequences([...'same'], [...'same']))).toBe('e:same');
  });

  it('puts deletions before insertions inside a change', () => {
    const segs = diffSequences([...'xay'], [...'xby']);
    expect(join(segs)).toBe('e:x d:a i:b e:y');
  });

  it('reconstructs both sides (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), fc.string({ maxLength: 40 }), (a, b) => {
        const segs = diffSequences([...a], [...b]);
        const before = segs
          .filter((s) => s.op !== 'insert')
          .flatMap((s) => s.items)
          .join('');
        const after = segs
          .filter((s) => s.op !== 'delete')
          .flatMap((s) => s.items)
          .join('');
        expect(before).toBe(a);
        expect(after).toBe(b);
      }),
    );
  });

  it('is minimal for single edits (property)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 30 }), fc.nat(), (a, i) => {
        const at = i % a.length;
        const b = a.slice(0, at) + a.slice(at + 1);
        const segs = diffSequences([...a], [...b]);
        const changed = segs.filter((s) => s.op !== 'equal').flatMap((s) => s.items).length;
        expect(changed).toBe(1);
      }),
    );
  });

  it('degrades to a replace for very different long inputs', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`);
    const segs = diffSequences(a, b);
    expect(segs.map((s) => s.op)).toEqual(['delete', 'insert']);
  });
});

describe('diffChars', () => {
  it('highlights a CJK rename as one readable change', () => {
    const segs = diffChars('高管任职', '董监高任职');
    expect(sideOf(segs, 'before')).toBe('高管任职');
    expect(sideOf(segs, 'after')).toBe('董监高任职');
    expect(segs.filter((s) => s.op === 'equal').map((s) => s.text)).toEqual(['任职']);
  });

  it('keeps long common runs and marks only the edit', () => {
    expect(diffChars('steatotic liver disease', 'fatty liver disease')).toEqual([
      { op: 'delete', text: 'steatotic' },
      { op: 'insert', text: 'fatty' },
      { op: 'equal', text: ' liver disease' },
    ]);
  });

  it('works on astral code points (emoji)', () => {
    const segs = diffChars('a😀b', 'a😃b');
    expect(segs).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'delete', text: '😀' },
      { op: 'insert', text: '😃' },
      { op: 'equal', text: 'b' },
    ]);
  });
});

describe('diffWords', () => {
  it('tokenizes words, spaces, punctuation and single CJK characters', () => {
    expect(tokenize("It's 3.5 km — 很远")).toEqual([
      "It's",
      ' ',
      '3',
      '.',
      '5',
      ' ',
      'km',
      ' ',
      '—',
      ' ',
      '很',
      '远',
    ]);
  });

  it('diffs definitions word by word', () => {
    const segs = diffWords('A disease of the liver.', 'A chronic disease of the liver.');
    expect(segs).toEqual([
      { op: 'equal', text: 'A ' },
      { op: 'insert', text: 'chronic ' },
      { op: 'equal', text: 'disease of the liver.' },
    ]);
  });

  it('reconstructs both sides (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), fc.string({ maxLength: 60 }), (a, b) => {
        const segs = diffWords(a, b);
        expect(sideOf(segs, 'before')).toBe(a);
        expect(sideOf(segs, 'after')).toBe(b);
      }),
    );
  });
});

describe('cleanupSemantic', () => {
  it('folds short equal runs between changes into the change', () => {
    const out = cleanupSemantic([
      { op: 'delete', text: 'ab' },
      { op: 'insert', text: 'xy' },
      { op: 'equal', text: 'c' },
      { op: 'delete', text: 'de' },
      { op: 'insert', text: 'zz' },
    ]);
    expect(out).toEqual([
      { op: 'delete', text: 'abcde' },
      { op: 'insert', text: 'xyczz' },
    ]);
  });

  it('keeps equal runs at the edges', () => {
    const segs = [
      { op: 'equal' as const, text: 'a' },
      { op: 'delete' as const, text: 'b' },
      { op: 'equal' as const, text: 'c' },
    ];
    expect(cleanupSemantic(segs)).toEqual(segs);
  });
});

// More items than fit in a call's arguments (roughly 10^5 on V8's default stack).
describe('changes larger than a call’s argument limit', () => {
  it('inserts 200k word tokens into an empty text', () => {
    const text = 'word '.repeat(100_000);
    expect(diffWords('', text)).toEqual([{ op: 'insert', text }]);
  });

  it('replaces 150k characters past the edit budget', () => {
    const a = 'a'.repeat(150_000);
    const b = 'b'.repeat(150_000);
    expect(diffChars(a, b)).toEqual([
      { op: 'delete', text: a },
      { op: 'insert', text: b },
    ]);
  });
});

describe('pairItems', () => {
  it('pairs a lone removal with a lone addition, however different', () => {
    expect(pairItems(['老赖'], ['失信人'])).toEqual({
      pairs: [['老赖', '失信人']],
      removed: [],
      added: [],
    });
  });

  it('pairs items sharing at least half their characters, closest first', () => {
    expect(pairItems(['Feline', 'Cat'], ['Kitty', 'Cats', 'Felines'])).toEqual({
      pairs: [
        ['Feline', 'Felines'],
        ['Cat', 'Cats'],
      ],
      removed: [],
      added: ['Kitty'],
    });
    expect(pairItems(['老赖', '失信者'], ['失信人', '黑名单'])).toEqual({
      pairs: [['失信者', '失信人']],
      removed: ['老赖'],
      added: ['黑名单'],
    });
  });

  it('leaves one-sided changes and very large ones unpaired', () => {
    expect(pairItems([], ['a'])).toEqual({ pairs: [], removed: [], added: ['a'] });
    expect(pairItems(['a', 'b'], [])).toEqual({ pairs: [], removed: ['a', 'b'], added: [] });
    const many = Array.from({ length: 21 }, (_, i) => `item ${i}`);
    const edited = many.map((x) => `${x}!`);
    expect(pairItems(many, edited).pairs).toEqual([]);
  });
});
