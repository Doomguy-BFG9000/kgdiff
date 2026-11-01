/**
 * Internal model shared by the diff pipeline stages. Records are mutable drafts that are
 * turned into the immutable public `UnionNode` / `UnionEdge` objects at the very end.
 */
import type { Restructuring } from './merge-split.js';
import type {
  ChangeStatus,
  EdgeFacet,
  EdgeKey,
  Id,
  KGEdge,
  KGNode,
  KGraph,
  NodeFacet,
  NodeMatch,
  ResolvedDiffOptions,
  UnionId,
} from './types.js';

export interface PipelineContext {
  readonly before: KGraph;
  readonly after: KGraph;
  readonly options: ResolvedDiffOptions;
  readonly hierarchy: ReadonlySet<string>;
  readonly ignoreAttrs: ReadonlySet<string>;
  readonly beforeToAfter: ReadonlyMap<Id, Id>;
  readonly afterToBefore: ReadonlyMap<Id, Id>;
  /** Matches not implied by equal ids (methods `hint` and `similarity`), by before id. */
  readonly inferred: ReadonlyMap<Id, NodeMatch>;
  readonly restructuring: Restructuring;
  /** Before ids whose union id differs from the id (rekeys and `@before` collisions). */
  readonly renamed: ReadonlyMap<Id, UnionId>;
  /** Union id of a before-version node id. */
  readonly unionOfBefore: (id: Id) => UnionId;
}

export interface NodeRecord {
  readonly id: UnionId;
  readonly beforeId?: Id;
  readonly afterId?: Id;
  readonly before?: KGNode;
  readonly after?: KGNode;
  readonly status: ChangeStatus;
  readonly facets: readonly NodeFacet[];
  hunk?: string;
}

export interface EdgeRecord {
  readonly id: UnionId;
  readonly source: UnionId;
  readonly target: UnionId;
  readonly sourceBefore?: UnionId;
  readonly targetBefore?: UnionId;
  readonly predicate: string;
  readonly predicateBefore?: string;
  readonly label: string;
  readonly beforeKey?: EdgeKey;
  readonly afterKey?: EdgeKey;
  readonly before?: KGEdge;
  readonly after?: KGEdge;
  readonly status: ChangeStatus;
  readonly facets: readonly EdgeFacet[];
  readonly hierarchical: boolean;
  /**
   * True when the delta can update the paired edge in place (`edge.set` / `edge.attr`);
   * otherwise a modified edge is replaced (`edge.remove` + `edge.add`).
   */
  readonly inPlace: boolean;
  hunk?: string;
}

/** Union ids of the nodes involved in merges and splits. */
export interface RestructureIndex {
  /** Union id of a merge source → union id of its target. */
  readonly mergeTargetOf: ReadonlyMap<UnionId, UnionId>;
  /** Union id of a split source → union ids of its new targets (sorted). */
  readonly splitTargetsOf: ReadonlyMap<UnionId, readonly UnionId[]>;
  /** Union id of a new split target → union id of its source. */
  readonly splitSourceOf: ReadonlyMap<UnionId, UnionId>;
  /** `${unionId}\u0000${predicate}` for every node with a `move` facet on that predicate. */
  readonly moved: ReadonlySet<string>;
}

export function movedKey(node: UnionId, predicate: string): string {
  return `${node}\u0000${predicate}`;
}

/** Canonical facet order (docs/algorithms.md §4), then edge facets. */
export const FACET_ORDER = [
  'rekey',
  'rename',
  'mergedInto',
  'mergeTarget',
  'splitFrom',
  'splitInto',
  'move',
  'deprecate',
  'replacement',
  'types',
  'aliases',
  'attrs',
  'retarget',
  'predicate',
  'label',
  'collapsed',
] as const;
