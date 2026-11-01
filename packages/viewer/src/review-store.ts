/**
 * Review progress: which hunks were marked reviewed, persisted in `localStorage` per diff
 * (`kgdiff:review:<base hash>→<target hash>`). Storage failures (private mode, quota, sandboxed
 * iframes) never break the viewer: the state simply stays in memory.
 */
import type { ReviewState } from './index.js';

export const STORAGE_PREFIX = 'kgdiff:review:';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function reviewKey(baseHash: string, targetHash: string): string {
  return `${STORAGE_PREFIX}${baseHash}→${targetHash}`;
}

/** `window.localStorage`, or null when unavailable / blocked. */
export function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export class ReviewStore {
  #reviewed: string[] = [];
  #set = new Set<string>();
  /** Ids from storage this diff does not have (another hunking version): kept, never shown. */
  #foreign: string[] = [];
  readonly #known: ReadonlySet<string>;
  readonly #storage: StorageLike | null;
  readonly #key: string | null;
  readonly #valid: readonly string[];

  /**
   * @param key storage key (`reviewKey`), or null to keep the state in memory only.
   * @param valid hunk ids of the current diff; stored ids it does not have are preserved.
   */
  constructor(storage: StorageLike | null, key: string | null, valid: readonly string[]) {
    this.#storage = storage;
    this.#key = key;
    this.#valid = valid;
    this.#known = new Set(valid);
    this.#load();
  }

  #load(): void {
    this.#reviewed = [];
    this.#set = new Set();
    this.#foreign = [];
    for (const id of this.#read()) {
      if (this.#set.has(id) || this.#foreign.includes(id)) continue;
      if (this.#known.has(id)) {
        this.#set.add(id);
        this.#reviewed.push(id);
      } else this.#foreign.push(id);
    }
  }

  /**
   * Re-read storage after a `storage` event for `key` (null: everything changed). Returns
   * whether the visible state changed.
   */
  reload(key: string | null): boolean {
    if (key !== null && key !== this.#key) return false;
    const before = this.#reviewed.join('\n');
    this.#load();
    return this.#reviewed.join('\n') !== before;
  }

  has(id: string): boolean {
    return this.#set.has(id);
  }

  get size(): number {
    return this.#reviewed.length;
  }

  /** Returns true when the state changed. Unknown ids are ignored. */
  setReviewed(id: string, reviewed: boolean): boolean {
    if (reviewed === this.#set.has(id)) return false;
    if (reviewed) {
      if (!this.#known.has(id)) return false;
      this.#set.add(id);
      this.#reviewed.push(id);
    } else {
      this.#set.delete(id);
      this.#reviewed.splice(this.#reviewed.indexOf(id), 1);
    }
    this.#write();
    return true;
  }

  state(): ReviewState {
    return { reviewed: [...this.#reviewed], total: this.#valid.length };
  }

  #read(): string[] {
    if (!this.#storage || !this.#key) return [];
    try {
      const raw = this.#storage.getItem(this.#key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      const list = Array.isArray(parsed)
        ? parsed
        : typeof parsed === 'object' && parsed !== null && 'reviewed' in parsed
          ? (parsed as { reviewed: unknown }).reviewed
          : [];
      return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  #write(): void {
    if (!this.#storage || !this.#key) return;
    try {
      const all = [...this.#reviewed, ...this.#foreign];
      if (all.length === 0) this.#storage.removeItem(this.#key);
      else this.#storage.setItem(this.#key, JSON.stringify({ v: 1, reviewed: all }));
    } catch {
      // Quota exceeded or storage blocked: keep the in-memory state.
    }
  }
}
