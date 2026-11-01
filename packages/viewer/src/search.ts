/**
 * Node search for the sidebar: fuzzy match over labels, aliases and ids of every union node
 * (including nodes outside a `changes`-scoped layout).
 *
 * Scoring per candidate string (higher is better): exact 1000, prefix 800, word-start 600,
 * substring 400 (earlier is better), then subsequence (gaps cost). Labels outrank aliases
 * outrank ids; changed nodes win ties.
 */
import type { DiffResult, UnionNode } from '@kgdiff/core';

export interface SearchHit {
  readonly node: UnionNode;
  readonly score: number;
  /** The text that matched (label, alias or id). */
  readonly matched: string;
  readonly field: 'label' | 'alias' | 'id';
}

interface Entry {
  readonly node: UnionNode;
  readonly texts: readonly string[];
  readonly folded: readonly string[];
  readonly fields: readonly SearchHit['field'][];
}

export function fold(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

const WORD_BREAK = /[\s_\-./:#|()[\]{}「」“”"'’,;]/;

export function scoreText(query: string, text: string): number {
  if (query === '') return 0;
  if (text === query) return 1000;
  if (text.startsWith(query)) return 800 - Math.min(100, text.length - query.length);
  const at = text.indexOf(query);
  if (at > 0) {
    const wordStart = WORD_BREAK.test(text[at - 1] ?? '');
    return (wordStart ? 600 : 400) - Math.min(150, at);
  }
  // Subsequence: every query character in order; contiguous runs and word starts score.
  let score = 200;
  let ti = 0;
  let prev = -2;
  for (const ch of query) {
    const found = text.indexOf(ch, ti);
    if (found < 0) return 0;
    if (found !== prev + 1) score -= Math.min(20, found - ti + 2);
    if (found === 0 || WORD_BREAK.test(text[found - 1] ?? '')) score += 6;
    prev = found;
    ti = found + 1;
  }
  return Math.max(1, score);
}

export class SearchIndex {
  readonly #entries: Entry[];

  constructor(diff: DiffResult) {
    this.#entries = diff.nodes.map((node) => {
      const texts: string[] = [node.label];
      const fields: SearchHit['field'][] = ['label'];
      const add = (text: string | undefined, field: SearchHit['field']): void => {
        if (text && !texts.includes(text)) {
          texts.push(text);
          fields.push(field);
        }
      };
      add(node.before?.label, 'label');
      for (const a of node.after?.aliases ?? []) add(a, 'alias');
      for (const a of node.before?.aliases ?? []) add(a, 'alias');
      add(node.afterId, 'id');
      add(node.beforeId, 'id');
      add(node.id, 'id');
      return { node, texts, folded: texts.map(fold), fields };
    });
  }

  /** Best `limit` hits for `query` (trimmed, case- and width-insensitive). O(N · |text|). */
  search(query: string, limit = 50): SearchHit[] {
    const q = fold(query.trim());
    if (q === '') return [];
    const hits: SearchHit[] = [];
    for (const e of this.#entries) {
      let best = 0;
      let bi = 0;
      for (let i = 0; i < e.folded.length; i++) {
        const field = e.fields[i];
        const weight = field === 'label' ? 0 : field === 'alias' ? 40 : 60;
        const s = scoreText(q, e.folded[i] as string);
        if (s > 0 && s - weight > best) {
          best = s - weight;
          bi = i;
        }
      }
      if (best > 0) {
        hits.push({
          node: e.node,
          score: best + (e.node.status === 'unchanged' ? 0 : 1),
          matched: e.texts[bi] as string,
          field: e.fields[bi] as SearchHit['field'],
        });
      }
    }
    hits.sort(
      (a, b) =>
        b.score - a.score ||
        a.node.label.length - b.node.label.length ||
        (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0),
    );
    return hits.slice(0, limit);
  }
}
