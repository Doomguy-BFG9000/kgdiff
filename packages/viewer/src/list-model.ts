/**
 * The change list: scene hunks grouped by replay phase (Removed, Restructured, Modified, Added),
 * scene order within a group, filtered by family. Pure; rebuilt when hunks or filters change.
 */
import type { ReplayPhase } from '@kgdiff/core';
import type { ChangeFamily, Scene } from '@kgdiff/scene';

export const PHASE_ORDER: readonly ReplayPhase[] = ['remove', 'restructure', 'modify', 'add'];

export type ListItem =
  | { readonly kind: 'header'; readonly phase: ReplayPhase; readonly count: number }
  | { readonly kind: 'row'; readonly hunk: number };

export interface ListModel {
  readonly items: readonly ListItem[];
  /** Visible hunk indices in list (navigation) order. */
  readonly order: readonly number[];
  /** Hunk index → position in `order`. */
  readonly rank: ReadonlyMap<number, number>;
  /** Hunk index → position in `items`. */
  readonly itemOf: ReadonlyMap<number, number>;
}

export const EMPTY_LIST: ListModel = Object.freeze({
  items: [],
  order: [],
  rank: new Map<number, number>(),
  itemOf: new Map<number, number>(),
});

export function buildList(scene: Scene, families: ReadonlySet<ChangeFamily>): ListModel {
  const groups = new Map<ReplayPhase, number[]>(PHASE_ORDER.map((p) => [p, []]));
  for (const h of scene.hunks) {
    if (families.size > 0 && !families.has(h.family)) continue;
    groups.get(h.phase)?.push(h.index);
  }
  const items: ListItem[] = [];
  const order: number[] = [];
  const rank = new Map<number, number>();
  const itemOf = new Map<number, number>();
  for (const phase of PHASE_ORDER) {
    const hunks = groups.get(phase) ?? [];
    if (hunks.length === 0) continue;
    items.push({ kind: 'header', phase, count: hunks.length });
    for (const h of hunks) {
      rank.set(h, order.length);
      itemOf.set(h, items.length);
      order.push(h);
      items.push({ kind: 'row', hunk: h });
    }
  }
  return { items, order, rank, itemOf };
}

/** Hunk counts per family (for the filter chips). */
export function familyCounts(scene: Scene): Record<ChangeFamily, number> {
  const counts: Record<ChangeFamily, number> = {
    added: 0,
    removed: 0,
    content: 0,
    structure: 0,
    identity: 0,
  };
  for (const h of scene.hunks) counts[h.family]++;
  return counts;
}

/**
 * The hunk `direction` steps away from `current` in list order. With no current hunk (or one
 * that is filtered out) next starts at the first hunk after it in scene order (else the first),
 * prev at the last before it (else the last). Clamps at the ends. -1 for an empty list.
 */
export function stepHunk(model: ListModel, current: number, direction: 1 | -1): number {
  const { order, rank } = model;
  if (order.length === 0) return -1;
  const r = rank.get(current);
  if (r !== undefined) {
    return order[Math.min(order.length - 1, Math.max(0, r + direction))] as number;
  }
  if (current < 0) return (direction > 0 ? order[0] : order[order.length - 1]) as number;
  // Filtered out: continue from its place in scene order.
  if (direction > 0) return order.find((h) => h > current) ?? (order[order.length - 1] as number);
  let prev = order[0] as number;
  for (const h of order) if (h < current) prev = h;
  return prev;
}
