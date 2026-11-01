/**
 * Option defaults and validation. Every default is documented on `LayoutOptions`.
 */
import { KgdiffError, type Point, type UnionId } from '@kgdiff/core';
import type { LayoutOptions, LayoutScope, LayoutStrategy } from './index.js';
import { clamp, log2 } from './math.js';
import { seedState } from './prng.js';

export interface ResolvedLayoutOptions {
  /** `undefined` = choose from the data (anchored when any position is known). */
  readonly strategy: LayoutStrategy | undefined;
  /** `undefined` = choose from the graph size. */
  readonly scope: LayoutScope | undefined;
  readonly contextHops: number;
  readonly hubDegree: number;
  readonly largeGraphThreshold: number;
  /** 32-bit PRNG state derived from `seed`. */
  readonly seed: number;
  /** `undefined` = choose from the graph size. */
  readonly iterations: number | undefined;
  readonly linkDistance: number;
  readonly labelAware: boolean;
  readonly fontSize: number;
  readonly pinned: ReadonlyMap<UnionId, Point>;
  readonly componentGap: number;
}

export const DEFAULTS = {
  contextHops: 1,
  hubDegree: 40,
  largeGraphThreshold: 3000,
  seed: 1,
  linkDistance: 56,
  labelAware: true,
  fontSize: 12,
  componentGap: 96,
} as const;

function invalid(option: string, value: unknown, expected: string): never {
  throw new KgdiffError(
    'invalid-input',
    `Invalid layout option ${option}: expected ${expected}, got ${String(value)}`,
    { option, value },
  );
}

function number(
  option: string,
  value: number | undefined,
  fallback: number,
  check: (v: number) => boolean,
  expected: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || Number.isNaN(value) || !check(value)) {
    invalid(option, value, expected);
  }
  return value;
}

export function resolveLayoutOptions(options: LayoutOptions = {}): ResolvedLayoutOptions {
  const { strategy, scope } = options;
  if (strategy !== undefined && strategy !== 'union' && strategy !== 'anchored') {
    invalid('strategy', strategy, "'union' or 'anchored'");
  }
  if (scope !== undefined && scope !== 'all' && scope !== 'changes') {
    invalid('scope', scope, "'all' or 'changes'");
  }
  const finite = Number.isFinite;
  const pinned = options.pinned ?? new Map<UnionId, Point>();
  for (const [id, p] of pinned) {
    if (!p || !finite(p.x) || !finite(p.y))
      invalid(`pinned[${id}]`, JSON.stringify(p), 'a finite point');
  }
  const iterations =
    options.iterations === undefined
      ? undefined
      : number(
          'iterations',
          options.iterations,
          0,
          (v) => Number.isInteger(v) && v >= 0,
          'an integer ≥ 0',
        );
  return {
    strategy,
    scope,
    contextHops: number(
      'contextHops',
      options.contextHops,
      DEFAULTS.contextHops,
      (v) => Number.isInteger(v) && v >= 0,
      'an integer ≥ 0',
    ),
    hubDegree: number(
      'hubDegree',
      options.hubDegree,
      DEFAULTS.hubDegree,
      (v) => v >= 0,
      'a number ≥ 0',
    ),
    largeGraphThreshold: number(
      'largeGraphThreshold',
      options.largeGraphThreshold,
      DEFAULTS.largeGraphThreshold,
      (v) => v >= 0,
      'a number ≥ 0',
    ),
    seed: seedState(number('seed', options.seed, DEFAULTS.seed, finite, 'a finite number')),
    iterations,
    linkDistance: number(
      'linkDistance',
      options.linkDistance,
      DEFAULTS.linkDistance,
      (v) => finite(v) && v > 0,
      'a finite number > 0',
    ),
    labelAware: options.labelAware ?? DEFAULTS.labelAware,
    fontSize: number(
      'fontSize',
      options.fontSize,
      DEFAULTS.fontSize,
      (v) => finite(v) && v > 0,
      'a finite number > 0',
    ),
    pinned,
    componentGap: number(
      'componentGap',
      options.componentGap,
      DEFAULTS.componentGap,
      (v) => finite(v) && v >= 0,
      'a finite number ≥ 0',
    ),
  };
}

/** Above this many nodes in one simulation the tick count shrinks (see `defaultIterations`). */
const LARGE_SIMULATION = 2000;
const MIN_TICKS = 30;

/**
 * Default tick count of a simulation over `nodeCount` nodes: `clamp(300 − 25·log₂(N), 120, 300)`
 * (docs/algorithms.md §12) up to 2000 nodes. Beyond, the per-tick cost (Barnes–Hut charge and
 * collision, ~N log N) would blow the time budget, so the work is held at that of a 2000-node
 * run: `max(30, 120 · 2000 / N)` ticks. Large components start from a BFS spiral and get their
 * label room in one step (see simulate.ts), so they need fewer ticks than the formula implies.
 */
export function defaultIterations(nodeCount: number): number {
  if (nodeCount > LARGE_SIMULATION) {
    return Math.max(MIN_TICKS, Math.round((120 * LARGE_SIMULATION) / nodeCount));
  }
  return clamp(Math.round(300 - 25 * log2(Math.max(1, nodeCount))), 120, 300);
}
