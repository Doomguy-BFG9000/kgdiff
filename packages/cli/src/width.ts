/**
 * Terminal display width of text (East Asian Width, combining marks, emoji) and the helpers
 * built on it: sanitizing untrusted labels, truncating with an ellipsis and padding.
 *
 * Widths follow what modern terminals render: CJK / fullwidth / emoji-presentation characters
 * take two columns, combining marks, joiners and variation selectors none, East Asian
 * "ambiguous" characters (`→`, `·`, `…`, box drawing) one. Measurement is per grapheme cluster
 * (`Intl.Segmenter`), so `é` (e + U+0301), a ZWJ emoji sequence, a flag and a keycap
 * are each measured as one unit.
 */

/** East Asian Width W and F ranges (Unicode 16), as inclusive [start, end] pairs, sorted. */
const WIDE_RANGES: readonly number[] = [
  0x1100, 0x115f, 0x231a, 0x231b, 0x2329, 0x232a, 0x23e9, 0x23ec, 0x23f0, 0x23f0, 0x23f3, 0x23f3,
  0x25fd, 0x25fe, 0x2614, 0x2615, 0x2630, 0x2637, 0x2648, 0x2653, 0x267f, 0x267f, 0x268a, 0x268f,
  0x2693, 0x2693, 0x26a1, 0x26a1, 0x26aa, 0x26ab, 0x26bd, 0x26be, 0x26c4, 0x26c5, 0x26ce, 0x26ce,
  0x26d4, 0x26d4, 0x26ea, 0x26ea, 0x26f2, 0x26f3, 0x26f5, 0x26f5, 0x26fa, 0x26fa, 0x26fd, 0x26fd,
  0x2705, 0x2705, 0x270a, 0x270b, 0x2728, 0x2728, 0x274c, 0x274c, 0x274e, 0x274e, 0x2753, 0x2755,
  0x2757, 0x2757, 0x2795, 0x2797, 0x27b0, 0x27b0, 0x27bf, 0x27bf, 0x2b1b, 0x2b1c, 0x2b50, 0x2b50,
  0x2b55, 0x2b55, 0x2e80, 0x2e99, 0x2e9b, 0x2ef3, 0x2f00, 0x2fd5, 0x2ff0, 0x303e, 0x3041, 0x3096,
  0x3099, 0x30ff, 0x3105, 0x312f, 0x3131, 0x318e, 0x3190, 0x31e5, 0x31ef, 0x321e, 0x3220, 0x3247,
  0x3250, 0xa48c, 0xa490, 0xa4c6, 0xa960, 0xa97c, 0xac00, 0xd7a3, 0xf900, 0xfaff, 0xfe10, 0xfe19,
  0xfe30, 0xfe52, 0xfe54, 0xfe66, 0xfe68, 0xfe6b, 0xff01, 0xff60, 0xffe0, 0xffe6, 0x16fe0, 0x16fe4,
  0x16ff0, 0x16ff1, 0x17000, 0x187f7, 0x18800, 0x18cd5, 0x18d00, 0x18d08, 0x1aff0, 0x1aff3, 0x1aff5,
  0x1affb, 0x1affd, 0x1affe, 0x1b000, 0x1b122, 0x1b132, 0x1b132, 0x1b150, 0x1b152, 0x1b155, 0x1b155,
  0x1b164, 0x1b167, 0x1b170, 0x1b2fb, 0x1d300, 0x1d356, 0x1d360, 0x1d376, 0x1f004, 0x1f004, 0x1f0cf,
  0x1f0cf, 0x1f18e, 0x1f18e, 0x1f191, 0x1f19a, 0x1f200, 0x1f202, 0x1f210, 0x1f23b, 0x1f240, 0x1f248,
  0x1f250, 0x1f251, 0x1f260, 0x1f265, 0x1f300, 0x1f320, 0x1f32d, 0x1f335, 0x1f337, 0x1f37c, 0x1f37e,
  0x1f393, 0x1f3a0, 0x1f3ca, 0x1f3cf, 0x1f3d3, 0x1f3e0, 0x1f3f0, 0x1f3f4, 0x1f3f4, 0x1f3f8, 0x1f43e,
  0x1f440, 0x1f440, 0x1f442, 0x1f4fc, 0x1f4ff, 0x1f53d, 0x1f54b, 0x1f54e, 0x1f550, 0x1f567, 0x1f57a,
  0x1f57a, 0x1f595, 0x1f596, 0x1f5a4, 0x1f5a4, 0x1f5fb, 0x1f64f, 0x1f680, 0x1f6c5, 0x1f6cc, 0x1f6cc,
  0x1f6d0, 0x1f6d2, 0x1f6d5, 0x1f6d7, 0x1f6dc, 0x1f6df, 0x1f6eb, 0x1f6ec, 0x1f6f4, 0x1f6fc, 0x1f7e0,
  0x1f7eb, 0x1f7f0, 0x1f7f0, 0x1f90c, 0x1f93a, 0x1f93c, 0x1f945, 0x1f947, 0x1f9ff, 0x1fa70, 0x1fa7c,
  0x1fa80, 0x1fa89, 0x1fa8f, 0x1fac6, 0x1face, 0x1fadc, 0x1fadf, 0x1fae9, 0x1faf0, 0x1faf8, 0x20000,
  0x2fffd, 0x30000, 0x3fffd,
];

/** True when the code point is East Asian Wide or Fullwidth. O(log n). */
export function isWideCodePoint(cp: number): boolean {
  if (cp < 0x1100) return false;
  let lo = 0;
  let hi = WIDE_RANGES.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = WIDE_RANGES[mid * 2] as number;
    const end = WIDE_RANGES[mid * 2 + 1] as number;
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return true;
  }
  return false;
}

const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u;
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const EMOJI = /\p{Emoji}/u;
const REGIONAL_INDICATOR = /\p{Regional_Indicator}/u;

/** Display width of one grapheme cluster: 0, 1 or 2 columns. */
export function graphemeWidth(grapheme: string): number {
  const cp = grapheme.codePointAt(0);
  if (cp === undefined) return 0;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp < 0x7f && grapheme.length === 1) return 1; // ASCII fast path
  if (grapheme.length > 1) {
    // Emoji sequences: presentation selector, ZWJ sequences, flags, keycaps, skin tones.
    if (grapheme.includes('\uFE0F') && EMOJI.test(grapheme)) return 2;
    if (grapheme.includes('\u200D') && EMOJI_PRESENTATION.test(grapheme)) return 2;
    if (REGIONAL_INDICATOR.test(grapheme)) return 2;
  }
  const first = String.fromCodePoint(cp);
  if (ZERO_WIDTH.test(first)) return 0;
  if (grapheme.includes('\uFE0E')) return 1; // text presentation selector
  if (isWideCodePoint(cp) || EMOJI_PRESENTATION.test(first)) return 2;
  return 1;
}

let segmenter: Intl.Segmenter | null | undefined;

/** Grapheme clusters of `text` (code points as a fallback when `Intl.Segmenter` is missing). */
export function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter('en', { granularity: 'grapheme' })
        : null;
  }
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  // Fallback: attach zero-width code points to the previous one.
  const out: string[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (out.length > 0 && (ZERO_WIDTH.test(ch) || (cp >= 0x1f3fb && cp <= 0x1f3ff))) {
      out[out.length - 1] += ch;
    } else out.push(ch);
  }
  return out;
}

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/** Display width of `text` in terminal columns. Text must not contain ANSI escape sequences. */
export function stringWidth(text: string): number {
  if (PRINTABLE_ASCII.test(text)) return text.length;
  let width = 0;
  for (const g of graphemes(text)) width += graphemeWidth(g);
  return width;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/**
 * Invisible characters that can disguise text ("Trojan Source"): bidirectional controls
 * (U+061C, U+200E/F, U+202A–U+202E, U+2066–U+2069), zero-width and invisible format characters
 * (U+180E, U+200B, U+2060–U+2064, U+FEFF, U+FFF9–U+FFFB) and tag characters outside emoji flag
 * sequences. Joiners (U+200C, U+200D) and variation selectors stay: scripts and emoji need them.
 */
const INVISIBLE =
  /[\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFF9-\uFFFB]|(?<!\u{1F3F4}[\u{E0020}-\u{E007E}]*)[\u{E0000}-\u{E007F}]/gu;

/** Replace invisible and bidirectional control characters with a visible `⟨U+202E⟩`. */
export function revealInvisible(text: string): string {
  return text.replace(INVISIBLE, (ch) => {
    const cp = ch.codePointAt(0) as number;
    return `⟨U+${cp.toString(16).toUpperCase().padStart(4, '0')}⟩`;
  });
}

/**
 * Make untrusted text (labels, ids, file names, parser messages) safe to print on one
 * terminal line: tabs and line breaks become spaces, other C0 controls (notably ESC, which
 * could inject escape sequences or hyperlinks) become control pictures (`␛`), C1 controls
 * U+FFFD, and invisible or bidirectional controls a visible `⟨U+202E⟩`.
 */
export function sanitize(text: string): string {
  return revealInvisible(
    text.replace(CONTROL, (ch) => {
      const cp = ch.charCodeAt(0);
      if (cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0x2028 || cp === 0x2029) return ' ';
      if (cp < 0x20) return String.fromCharCode(0x2400 + cp);
      if (cp === 0x7f) return '\u2421';
      return '\uFFFD';
    }),
  );
}

/** `sanitize` line by line, keeping line breaks (stack traces). */
export function sanitizeLines(text: string): string {
  return text.split(/\r?\n/).map(sanitize).join('\n');
}

/**
 * Truncate `text` to at most `max` columns, ending with `…` when something was cut. Never
 * splits a grapheme; a wide character that does not fit is dropped whole (the result may then
 * be one column narrower than `max`). Returns '' for `max` ≤ 0.
 */
export function truncate(text: string, max: number, ellipsis = '…'): string {
  if (max <= 0) return '';
  if (stringWidth(text) <= max) return text;
  const room = max - stringWidth(ellipsis);
  if (room < 0) return '';
  let width = 0;
  let out = '';
  for (const g of graphemes(text)) {
    const w = graphemeWidth(g);
    if (width + w > room) break;
    out += g;
    width += w;
  }
  return out.trimEnd() + ellipsis;
}

/** Pad `text` with spaces on the right to `width` columns (no-op when already wider). */
export function padEnd(text: string, width: number): string {
  const gap = width - stringWidth(text);
  return gap > 0 ? text + ' '.repeat(gap) : text;
}

/** Pad `text` with spaces on the left to `width` columns (no-op when already wider). */
export function padStart(text: string, width: number): string {
  const gap = width - stringWidth(text);
  return gap > 0 ? ' '.repeat(gap) + text : text;
}

/**
 * Greedy word wrap to `width` columns. Breaks at spaces; CJK text (no spaces) breaks between
 * graphemes. Lines never exceed `width` unless a single grapheme is wider.
 */
export function wrap(text: string, width: number): string[] {
  if (width <= 0 || stringWidth(text) <= width) return [text];
  const lines: string[] = [];
  let line = '';
  let lineWidth = 0;
  const flush = (): void => {
    lines.push(line.trimEnd());
    line = '';
    lineWidth = 0;
  };
  for (const word of text.split(/(?<= )/)) {
    const w = stringWidth(word);
    if (lineWidth + stringWidth(word.trimEnd()) <= width) {
      line += word;
      lineWidth += w;
      continue;
    }
    if (lineWidth > 0) flush();
    if (stringWidth(word.trimEnd()) <= width) {
      line = word;
      lineWidth = w;
      continue;
    }
    for (const g of graphemes(word)) {
      const gw = graphemeWidth(g);
      if (lineWidth + gw > width && lineWidth > 0) flush();
      line += g;
      lineWidth += gw;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}
