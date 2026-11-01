/**
 * Myers O((N+M)·D) sequence diff for the detail panel: character-level name diffs and
 * word-level attribute diffs. Small, deterministic, no dependencies.
 */

export type DiffOp = 'equal' | 'insert' | 'delete';

export interface DiffSegment {
  readonly op: DiffOp;
  readonly text: string;
}

/** Above this edit distance the diff degrades to "common prefix / suffix + replace". */
const MAX_D = 1024;

/**
 * Edit script between `a` and `b` (Myers 1986, greedy forward search with a trace for the
 * backtrack). Deletions come before insertions within a change. Common prefix / suffix are
 * stripped first, so typical edits cost O(N + M). Inputs larger than the `MAX_D` budget fall
 * back to a single replace of the differing middle.
 */
export function diffSequences<T>(a: readonly T[], b: readonly T[]): { op: DiffOp; items: T[] }[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: { op: DiffOp; items: T[] }[] = [];
  const push = (op: DiffOp, item: T): void => {
    const last = out[out.length - 1];
    if (last !== undefined && last.op === op) last.items.push(item);
    else out.push({ op, items: [item] });
  };
  for (let i = 0; i < start; i++) push('equal', a[i] as T);
  const middle = myers(a.slice(start, endA), b.slice(start, endB));
  for (const [op, item] of middle) push(op, item);
  for (let i = endA; i < a.length; i++) push('equal', a[i] as T);
  return normalizeOrder(out);
}

function myers<T>(a: readonly T[], b: readonly T[]): [DiffOp, T][] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((x) => ['insert', x]);
  if (m === 0) return a.map((x) => ['delete', x]);
  const max = n + m;
  const limit = Math.min(max, MAX_D);
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= limit; d++) {
    // State after step d − 1; the backtrack reads k ± 1 for |k| ≤ d, i.e. offsets [−d, d].
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))) {
        x = v[offset + k + 1] as number;
      } else {
        x = (v[offset + k - 1] as number) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) {
    return [
      ...a.map((x): [DiffOp, T] => ['delete', x]),
      ...b.map((x): [DiffOp, T] => ['insert', x]),
    ];
  }
  // Backtrack.
  const ops: [DiffOp, T][] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const vd = trace[d] as Int32Array;
    const at = (kk: number): number => vd[kk + d] as number;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push(['equal', a[x - 1] as T]);
      x--;
      y--;
    }
    if (down) ops.push(['insert', b[y - 1] as T]);
    else ops.push(['delete', a[x - 1] as T]);
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push(['equal', a[x - 1] as T]);
    x--;
    y--;
  }
  return ops.reverse();
}

/** Within each run of changes, deletions first, then insertions (stable, readable). */
function normalizeOrder<T>(segs: { op: DiffOp; items: T[] }[]): { op: DiffOp; items: T[] }[] {
  const out: { op: DiffOp; items: T[] }[] = [];
  let del: T[] = [];
  let ins: T[] = [];
  const flush = (): void => {
    if (del.length) out.push({ op: 'delete', items: del });
    if (ins.length) out.push({ op: 'insert', items: ins });
    del = [];
    ins = [];
  };
  for (const s of segs) {
    if (s.op === 'equal') {
      flush();
      out.push(s);
      continue;
    }
    const run = s.op === 'delete' ? del : ins;
    for (const item of s.items) run.push(item);
  }
  flush();
  return out;
}

function join(segs: { op: DiffOp; items: string[] }[]): DiffSegment[] {
  return segs.map((s) => ({ op: s.op, text: s.items.join('') }));
}

/**
 * Merge short equal runs sandwiched between changes into the changes ("semantic cleanup"),
 * so that `高管任职 → 董监高任职` reads as one replaced prefix rather than confetti.
 */
export function cleanupSemantic(segs: readonly DiffSegment[], minEqual = 3): DiffSegment[] {
  const out: DiffSegment[] = [];
  let del = '';
  let ins = '';
  const flush = (): void => {
    if (del) out.push({ op: 'delete', text: del });
    if (ins) out.push({ op: 'insert', text: ins });
    del = '';
    ins = '';
  };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i] as DiffSegment;
    if (s.op === 'delete') del += s.text;
    else if (s.op === 'insert') ins += s.text;
    else {
      const inner = i > 0 && i < segs.length - 1 && (del !== '' || ins !== '');
      const short = [...s.text].length < minEqual && s.text.trim().length <= minEqual;
      if (inner && short && hasChangeAfter(segs, i)) {
        del += s.text;
        ins += s.text;
      } else {
        flush();
        out.push(s);
      }
    }
  }
  flush();
  return out;
}

function hasChangeAfter(segs: readonly DiffSegment[], i: number): boolean {
  const next = segs[i + 1];
  return next !== undefined && next.op !== 'equal';
}

/** Character (code point) diff with semantic cleanup. */
export function diffChars(a: string, b: string): DiffSegment[] {
  return cleanupSemantic(join(diffSequences(Array.from(a), Array.from(b))));
}

/**
 * Tokens for word diffs: whitespace runs, words (letters / digits / `_'-`), single CJK
 * characters (CJK has no spaces), single punctuation marks.
 */
const TOKEN =
  /\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}\p{M}_'’-]+|[^\s]/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/** Word-level diff (CJK per character). */
export function diffWords(a: string, b: string): DiffSegment[] {
  return cleanupSemantic(join(diffSequences(tokenize(a), tokenize(b))), 2);
}

/** Rebuild the old (`equal` + `delete`) or new (`equal` + `insert`) text from a diff. */
export function sideOf(segs: readonly DiffSegment[], side: 'before' | 'after'): string {
  const skip: DiffOp = side === 'before' ? 'insert' : 'delete';
  let s = '';
  for (const seg of segs) if (seg.op !== skip) s += seg.text;
  return s;
}
