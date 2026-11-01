/**
 * Option defaults and validation (docs/architecture.md: "every default documented").
 */
import { KgdiffError } from './errors.js';
import type { DiffOptions, EdgeIdentity, MatchOptions, ResolvedDiffOptions } from './types.js';

/** Hierarchy predicates recognised out of the box (child → parent). */
export const DEFAULT_HIERARCHY_PREDICATES: readonly string[] = Object.freeze([
  'rdfs:subClassOf',
  'http://www.w3.org/2000/01/rdf-schema#subClassOf',
  'rdfs:subPropertyOf',
  'http://www.w3.org/2000/01/rdf-schema#subPropertyOf',
  'skos:broader',
  'http://www.w3.org/2004/02/skos/core#broader',
  'is_a',
  'subClassOf',
  'parent',
]);

/** Matching defaults (docs/algorithms.md §2). */
const DEFAULT_MATCH_OPTIONS: Required<MatchOptions> = Object.freeze({
  strategy: 'auto',
  threshold: 0.82,
  suggestThreshold: 0.6,
  maxCandidates: 8,
});

const STRATEGIES: ReadonlySet<string> = new Set(['id', 'auto', 'similarity']);
const EDGE_IDENTITIES: ReadonlySet<string> = new Set(['structure', 'id']);

function invalid(message: string, option: string): never {
  throw new KgdiffError('invalid-input', message, { option });
}

function unitInterval(value: unknown, fallback: number, option: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !(value >= 0 && value <= 1)) {
    invalid(`${option} must be a number between 0 and 1 (got ${String(value)})`, option);
  }
  return value;
}

function stringList(value: unknown, fallback: readonly string[], option: string): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    invalid(`${option} must be an array of strings`, option);
  }
  return [...new Set(value as string[])];
}

/** Validates `MatchOptions` and fills every default. */
export function resolveMatchOptions(options?: MatchOptions): Required<MatchOptions> {
  if (options === undefined) return DEFAULT_MATCH_OPTIONS;
  if (typeof options !== 'object' || options === null)
    invalid('match options must be an object', 'match');
  const strategy = options.strategy ?? DEFAULT_MATCH_OPTIONS.strategy;
  if (!STRATEGIES.has(strategy)) {
    invalid(
      `match.strategy must be 'id', 'auto' or 'similarity' (got ${String(strategy)})`,
      'match.strategy',
    );
  }
  const maxCandidates = options.maxCandidates ?? DEFAULT_MATCH_OPTIONS.maxCandidates;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) {
    invalid(
      `match.maxCandidates must be a positive integer (got ${String(maxCandidates)})`,
      'match.maxCandidates',
    );
  }
  return {
    strategy,
    threshold: unitInterval(options.threshold, DEFAULT_MATCH_OPTIONS.threshold, 'match.threshold'),
    suggestThreshold: unitInterval(
      options.suggestThreshold,
      DEFAULT_MATCH_OPTIONS.suggestThreshold,
      'match.suggestThreshold',
    ),
    maxCandidates,
  };
}

export function resolveEdgeIdentity(
  value: unknown,
  fallback: EdgeIdentity = 'structure',
): EdgeIdentity {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !EDGE_IDENTITIES.has(value)) {
    invalid(`edgeIdentity must be 'structure' or 'id' (got ${String(value)})`, 'edgeIdentity');
  }
  return value as EdgeIdentity;
}

/**
 * Fills every option with its documented default:
 * `match` → `DEFAULT_MATCH_OPTIONS`, `edgeIdentity` → `'structure'`,
 * `hierarchyPredicates` → `DEFAULT_HIERARCHY_PREDICATES`, `detectMerges` / `detectSplits` →
 * `true`, `ignoreAttrs` → `[]`. Lists are de-duplicated; `ignoreAttrs` is sorted (it is a set).
 *
 * @throws KgdiffError `invalid-input` for out-of-range or ill-typed options.
 */
export function resolveOptions(options?: DiffOptions): ResolvedDiffOptions {
  if (options !== undefined && (typeof options !== 'object' || options === null)) {
    invalid('options must be an object', 'options');
  }
  const o: DiffOptions = options ?? {};
  for (const flag of ['detectMerges', 'detectSplits'] as const) {
    if (o[flag] !== undefined && typeof o[flag] !== 'boolean')
      invalid(`${flag} must be a boolean`, flag);
  }
  return {
    match: resolveMatchOptions(o.match),
    edgeIdentity: resolveEdgeIdentity(o.edgeIdentity),
    hierarchyPredicates: stringList(
      o.hierarchyPredicates,
      DEFAULT_HIERARCHY_PREDICATES,
      'hierarchyPredicates',
    ),
    detectMerges: o.detectMerges ?? true,
    detectSplits: o.detectSplits ?? true,
    ignoreAttrs: stringList(o.ignoreAttrs, [], 'ignoreAttrs').sort(),
  };
}
