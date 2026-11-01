import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  graphemeWidth,
  padEnd,
  padStart,
  sanitize,
  stringWidth,
  truncate,
  wrap,
} from '../src/index.js';

const cp = (...points: number[]): string => String.fromCodePoint(...points);

describe('stringWidth', () => {
  it('counts ASCII one column per character', () => {
    expect(stringWidth('kgdiff 0.1.0')).toBe(12);
    expect(stringWidth('')).toBe(0);
  });

  it('counts CJK ideographs, kana, hangul and fullwidth forms as two columns', () => {
    expect(stringWidth('法定代表人')).toBe(10);
    expect(stringWidth('カタカナ')).toBe(8);
    expect(stringWidth('한국어')).toBe(6);
    expect(stringWidth('ＡＢＣ')).toBe(6);
    expect(stringWidth('「企业」（原）')).toBe(14);
  });

  it('counts East Asian ambiguous punctuation used by the CLI as one column', () => {
    for (const ch of ['→', '·', '…', '−', '⇄', '⊕', '⑂', '█', '“', '”']) {
      expect(stringWidth(ch)).toBe(1);
    }
  });

  it('gives combining marks, joiners and variation selectors no width', () => {
    expect(stringWidth(`e${cp(0x301)}`)).toBe(1);
    expect(stringWidth(`a${cp(0x200b)}b`)).toBe(2);
    expect(stringWidth(cp(0x301))).toBe(0);
  });

  it('measures emoji (presentation, ZWJ sequences, flags, keycaps, skin tones) as two columns', () => {
    expect(stringWidth('😀')).toBe(2);
    expect(stringWidth(cp(0x1f469, 0x200d, 0x1f4bb))).toBe(2); // woman technologist
    expect(stringWidth(cp(0x1f1e8, 0x1f1f3))).toBe(2); // flag CN
    expect(stringWidth(cp(0x31, 0xfe0f, 0x20e3))).toBe(2); // keycap 1
    expect(stringWidth(cp(0x1f44d, 0x1f3fd))).toBe(2); // thumbs up, medium skin tone
    expect(stringWidth(cp(0x2764, 0xfe0f))).toBe(2); // heart with emoji presentation
    expect(stringWidth(cp(0x2764, 0xfe0e))).toBe(1); // heart with text presentation
    expect(stringWidth('🟩🟥')).toBe(4);
  });

  it('measures mixed text', () => {
    expect(stringWidth('「法人代表」合并入「法定代表人」')).toBe(32);
    expect(stringWidth('Merged “A” → 「甲」')).toBe(19);
  });

  it('gives control characters no width', () => {
    expect(graphemeWidth(cp(0x1b))).toBe(0);
    expect(graphemeWidth('')).toBe(0);
  });
});

describe('sanitize', () => {
  it('turns line breaks and tabs into spaces', () => {
    expect(sanitize('a\tb\nc\r\nd')).toBe('a b c  d');
  });

  it('makes escape sequences visible instead of interpreting them', () => {
    const evil = `${cp(0x1b)}[31mred${cp(0x1b)}[0m`;
    const safe = sanitize(evil);
    expect(safe).not.toContain(cp(0x1b));
    expect(safe).toBe(`${cp(0x241b)}[31mred${cp(0x241b)}[0m`);
  });

  it('replaces C1 controls and DEL', () => {
    expect(sanitize(`a${cp(0x9b)}b${cp(0x7f)}`)).toBe(`a${cp(0xfffd)}b${cp(0x2421)}`);
  });

  it('leaves printable text alone', () => {
    expect(sanitize('「企业」 → “x” 😀')).toBe('「企业」 → “x” 😀');
  });
});

describe('truncate', () => {
  it('returns text that fits unchanged', () => {
    expect(truncate('hello', 5)).toBe('hello');
    expect(truncate('法定', 4)).toBe('法定');
  });

  it('cuts with an ellipsis to at most the given width', () => {
    expect(truncate('hello world', 8)).toBe('hello w…');
    expect(stringWidth(truncate('hello world', 8))).toBe(8);
  });

  it('never splits a wide character', () => {
    // 5 columns: two ideographs (4) + ellipsis (1).
    expect(truncate('法定代表人', 5)).toBe('法定…');
    // 6 columns: the third ideograph would end at column 7 with the ellipsis, so it is dropped.
    expect(truncate('法定代表人', 6)).toBe('法定…');
    expect(stringWidth(truncate('法定代表人', 6))).toBe(5);
  });

  it('keeps grapheme clusters whole', () => {
    const family = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    expect(truncate(`${family}${family}${family}`, 4)).toBe(`${family}…`);
    expect(truncate(`e${cp(0x301)}e${cp(0x301)}e${cp(0x301)}`, 2)).toBe(`e${cp(0x301)}…`);
  });

  it('handles tiny widths', () => {
    expect(truncate('hello', 1)).toBe('…');
    expect(truncate('hello', 0)).toBe('');
  });

  it('never exceeds the width (property)', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme', maxLength: 30 }),
        fc.integer({ min: 0, max: 40 }),
        (s, w) => {
          expect(stringWidth(truncate(s, w))).toBeLessThanOrEqual(w);
        },
      ),
    );
  });
});

describe('padding and wrapping', () => {
  it('pads by display width', () => {
    expect(padEnd('企业', 6)).toBe('企业  ');
    expect(padStart('企业', 6)).toBe('  企业');
    expect(padEnd('toolong', 3)).toBe('toolong');
  });

  it('wraps words and CJK text to the width', () => {
    expect(wrap('one two three four', 9)).toEqual(['one two', 'three', 'four']);
    const cjk = wrap('企业信用知识图谱本体目录', 8);
    expect(cjk).toEqual(['企业信用', '知识图谱', '本体目录']);
    for (const line of wrap('Hierarchy predicate (repeatable); replaces the defaults', 20)) {
      expect(stringWidth(line)).toBeLessThanOrEqual(20);
    }
  });
});
