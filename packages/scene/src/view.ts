/**
 * View state construction.
 */
import type { ChangeFamily, ViewState } from './types.js';

const NO_FAMILIES: ReadonlySet<ChangeFamily> = new Set<ChangeFamily>();

/**
 * Default view: union layer, t = 0, nothing selected or hovered, no focus, every family,
 * suggestions shown, motion enabled, full spotlight emphasis. `partial` overrides fields; `undefined` values keep the
 * default. The result is frozen.
 */
export function createViewState(partial: Partial<ViewState> = {}): ViewState {
  return Object.freeze({
    layer: partial.layer ?? 'union',
    t: partial.t ?? 0,
    selectedHunk: partial.selectedHunk ?? -1,
    hoveredNode: partial.hoveredNode ?? -1,
    hoveredEdge: partial.hoveredEdge ?? -1,
    selectedNode: partial.selectedNode ?? -1,
    focus: partial.focus ?? null,
    families: partial.families ?? NO_FAMILIES,
    showSuggestions: partial.showSuggestions ?? true,
    reducedMotion: partial.reducedMotion ?? false,
    emphasis: partial.emphasis ?? 1,
  });
}
