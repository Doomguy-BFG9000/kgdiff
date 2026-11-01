/**
 * Replay choreography plan (docs/visual-language.md §Replay choreography): for every element
 * of every hunk, which animation it plays and when, as fractions `u` ∈ [0, 1] of the hunk
 * window's transform phase (18–82% of the window). Computed once per resolver.
 */
import type { HunkKind } from '@kgdiff/core';
import { assertNever, mergeBadge } from './roles.js';
import type { EdgeStyle, NodeStyle } from './styles.js';
import type { Scene } from './types.js';

/** Node animation kinds. */
export const NA_NONE = 0;
/** Both states visible: colors / rings / halos crossfade, label slides, ring flashes, badge ticks in. */
export const NA_FADE = 1;
/** Shrinks to 0.6·r while its fill drains into a dashed ghost, which lingers, then fades. */
export const NA_REMOVE = 2;
/** Pops in (scale 0 → 1.08 → 1, back-out), then its label fades in. */
export const NA_ADD = 3;
/** Merge source: travels on a gentle arc into its target, fades on arrival. */
export const NA_TRAVEL = 4;
/** Split target: emerges from its source and travels out to its position. */
export const NA_EMERGE = 5;

/** Edge animation kinds. */
export const EA_NONE = 0;
/** Grows from the existing endpoint (`progress` 0 → 1). */
export const EA_GROW = 1;
/** Retracts toward the surviving endpoint (`progress` 1 → 0). */
export const EA_RETRACT = 2;
/** The changed end swings around the shared endpoint from the old to the new node. */
export const EA_SWING = 3;
/** Carried by a merge: rides the travelling source (before form), then is the after form. */
export const EA_FOLLOW_MERGE = 4;
/** Carried by a split: rides the emerging target (after form). */
export const EA_FOLLOW_SPLIT = 5;
/** Same geometry, new label / predicate: label swaps, stroke flashes. */
export const EA_FADE = 6;
/** Geometry changes with no shared endpoint or no mover: crossfade old form → new form. */
export const EA_SWAP = 7;

/** Timings in transform-phase fractions. */
export const CHOREO = {
  retract: [0, 0.4],
  removeShrink: [0.25, 0.55],
  /** The ghost lingers until 60% of the window (u = (0.6 − 0.18) / 0.64), then fades. */
  removeGhostFade: [0.65625, 1],
  splitSourceShrink: [0.6, 0.8],
  splitSourceFade: [0.8, 1],
  growFromExisting: [0, 0.45],
  pop: [0.35, 0.75],
  popAfterArrival: [0.55, 0.85],
  growBetweenNew: [0.6, 0.9],
  growAfterArrival: [0.7, 0.95],
  growOther: [0.35, 0.85],
  labelFadeIn: 0.15,
  travelStagger: 0.15,
  travel: 0.55,
  arrivalFade: 0.12,
  mergeTargetFade: [0.55, 0.85],
  mergeFlash: [0.7, 1],
  splitStart: 0.05,
  splitSourceStay: [0.6, 0.9],
  modifyFade: [0.3, 0.7],
  modifyFlash: [0.4, 0.8],
  labelOut: [0.1, 0.5],
  labelIn: [0.3, 0.7],
  /** px the old label rises while fading / the new label rises from. */
  labelSlide: 6,
  badgeTick: 0.6,
  swing: [0.1, 0.8],
  ghostFade: [0.3, 1],
  pivotFade: [0.8, 1],
  edgeFade: [0.2, 0.7],
  swap: [0.2, 0.8],
  /** Bend of travel arcs and merge / split arrows. */
  arc: 0.25,
} as const;

export interface Choreography {
  readonly nKind: Uint8Array;
  /** Main interval [nA, nB]; nC: extra time (REMOVE fade start, ADD label start). */
  readonly nA: Float64Array;
  readonly nB: Float64Array;
  readonly nC: Float64Array;
  /** Ring flash interval; nFlashA < 0 for none. */
  readonly nFlashA: Float64Array;
  readonly nFlashB: Float64Array;
  /** 1 when the primary label text changes (slide / crossfade). */
  readonly nLabelSwap: Uint8Array;
  /** Badge tick-in time (u), or 2 for never during the transform. */
  readonly nBadgeAt: Float64Array;
  /** Merge targets: sorted arrival times and the badge text after k arrivals (`⊕ k`). */
  readonly nArrivals: readonly (Float64Array | null)[];
  readonly nBadgeSteps: readonly (readonly string[] | null)[];
  /** 1 when the node pulses at its hunk's spotlight phase (visible in its before state). */
  readonly nPulse: Uint8Array;
  /** Per hunk: no hunk node is visible before, so its context pulses instead (additions). */
  readonly hPulseContext: Uint8Array;
  readonly eKind: Uint8Array;
  readonly eA: Float64Array;
  readonly eB: Float64Array;
  /** GROW / RETRACT: draw from the target end. */
  readonly eFromTarget: Uint8Array;
  /** SWING: fixed endpoint node; FOLLOW: moving node. -1 when none. */
  readonly ePivot: Int32Array;
}

function staggered(j: number, n: number, start: number): [number, number] {
  const s = start + (n > 1 ? (CHOREO.travelStagger * j) / (n - 1) : CHOREO.travelStagger / 2);
  return [s, s + CHOREO.travel];
}

/** Plan every element's replay animation. O(N + E). */
export function choreograph(
  scene: Scene,
  nodeStyles: readonly (readonly [NodeStyle, NodeStyle, NodeStyle])[],
  edgeStyles: readonly (readonly [EdgeStyle, EdgeStyle, EdgeStyle])[],
): Choreography {
  const N = scene.nodes.length;
  const M = scene.edges.length;
  const H = scene.hunks.length;
  const c: Choreography = {
    nKind: new Uint8Array(N),
    nA: new Float64Array(N),
    nB: new Float64Array(N),
    nC: new Float64Array(N),
    nFlashA: new Float64Array(N).fill(-1),
    nFlashB: new Float64Array(N).fill(-1),
    nLabelSwap: new Uint8Array(N),
    nBadgeAt: new Float64Array(N).fill(2),
    nArrivals: new Array<Float64Array | null>(N).fill(null),
    nBadgeSteps: new Array<readonly string[] | null>(N).fill(null),
    nPulse: new Uint8Array(N),
    hPulseContext: new Uint8Array(H),
    eKind: new Uint8Array(M),
    eA: new Float64Array(M),
    eB: new Float64Array(M),
    eFromTarget: new Uint8Array(M),
    ePivot: new Int32Array(M).fill(-1),
  };
  const nArrivals = c.nArrivals as (Float64Array | null)[];
  const nBadgeSteps = c.nBadgeSteps as (readonly string[] | null)[];
  const set = (i: number, kind: number, a: number, b: number, extra = 0): void => {
    c.nKind[i] = kind;
    c.nA[i] = a;
    c.nB[i] = b;
    c.nC[i] = extra;
  };
  const flash = (i: number, ab: readonly [number, number]): void => {
    c.nFlashA[i] = ab[0];
    c.nFlashB[i] = ab[1];
  };

  for (const hunk of scene.hunks) {
    const kind: HunkKind = hunk.kind;
    const before = (i: number): NodeStyle =>
      (nodeStyles[i] as readonly NodeStyle[])[1] as NodeStyle;
    const after = (i: number): NodeStyle => (nodeStyles[i] as readonly NodeStyle[])[2] as NodeStyle;

    // Travelling participants first (they define arrival times).
    const sources = hunk.nodes.filter((i) => scene.nodes[i]?.role === 'merge-source');
    sources.forEach((i, j) => {
      const node = scene.nodes[i];
      const [a, b] = staggered(j, sources.length, 0);
      if (node?.flow !== undefined && !node.presentAfter) set(i, NA_TRAVEL, a, b);
      else if (!after(i).hidden) set(i, NA_FADE, a, b);
      else
        set(
          i,
          NA_REMOVE,
          CHOREO.removeShrink[0],
          CHOREO.removeShrink[1],
          CHOREO.removeGhostFade[0],
        );
    });
    const targets = hunk.nodes.filter(
      (i) =>
        scene.nodes[i]?.role === 'split-target' &&
        scene.nodes[i]?.flow !== undefined &&
        before(i).hidden,
    );
    targets.forEach((i, j) => {
      const [a, b] = staggered(j, targets.length, CHOREO.splitStart);
      set(i, NA_EMERGE, a, b);
    });

    let anyBefore = false;
    for (const i of hunk.nodes) {
      const node = scene.nodes[i];
      if (node === undefined) continue;
      const B = before(i);
      const A = after(i);
      if (!B.hidden) {
        anyBefore = true;
        c.nPulse[i] = 1;
      }
      if (c.nKind[i] !== NA_NONE) continue;
      if (B.hidden && A.hidden) continue;
      if (B.hidden) {
        const [a, b] = kind === 'merge' ? CHOREO.popAfterArrival : CHOREO.pop;
        set(i, NA_ADD, a, b, Math.min(1, b - 0.05));
      } else if (A.hidden) {
        if (kind === 'split') {
          set(
            i,
            NA_REMOVE,
            CHOREO.splitSourceShrink[0],
            CHOREO.splitSourceShrink[1],
            CHOREO.splitSourceFade[0],
          );
        } else {
          set(
            i,
            NA_REMOVE,
            CHOREO.removeShrink[0],
            CHOREO.removeShrink[1],
            CHOREO.removeGhostFade[0],
          );
        }
      } else if (node.role === 'merge-target') {
        set(i, NA_FADE, CHOREO.mergeTargetFade[0], CHOREO.mergeTargetFade[1]);
        flash(i, CHOREO.mergeFlash);
      } else if (node.role === 'split-source') {
        set(i, NA_FADE, CHOREO.splitSourceStay[0], CHOREO.splitSourceStay[1]);
        flash(i, CHOREO.mergeFlash);
      } else {
        set(i, NA_FADE, CHOREO.modifyFade[0], CHOREO.modifyFade[1]);
        if (A.ring !== null) flash(i, CHOREO.modifyFlash);
      }
      if ((c.nKind[i] as number) === NA_FADE) {
        c.nLabelSwap[i] = B.labelBefore && !A.labelBefore && node.labelBefore !== undefined ? 1 : 0;
        if (A.badge && !B.badge && node.badge !== undefined) c.nBadgeAt[i] = CHOREO.badgeTick;
      }
    }
    if (!anyBefore) c.hPulseContext[hunk.index] = 1;

    // Merge targets count their arrivals up: ⊕ 1, ⊕ 2, …, then the final badge.
    if (kind === 'merge') {
      for (const i of hunk.nodes) {
        const node = scene.nodes[i];
        if (node?.role !== 'merge-target' || node.badge === undefined) continue;
        const times = sources
          .filter((s) => scene.nodes[s]?.flow === i)
          .map((s) => c.nB[s] as number)
          .sort((a, b) => a - b);
        if (times.length === 0) times.push(CHOREO.mergeFlash[0]);
        nArrivals[i] = Float64Array.from(times);
        nBadgeSteps[i] = times.map((_, k) =>
          k === times.length - 1 ? (node.badge as string) : mergeBadge(k + 1),
        );
      }
    }

    const appears = (i: number): boolean =>
      scene.nodes[i]?.hunk === hunk.index && (c.nKind[i] === NA_ADD || c.nKind[i] === NA_EMERGE);
    const leaves = (i: number): boolean =>
      scene.nodes[i]?.hunk === hunk.index && (c.nKind[i] === NA_REMOVE || c.nKind[i] === NA_TRAVEL);
    const edge = (
      j: number,
      kind2: number,
      ab: readonly [number, number],
      fromTarget = false,
      pivot = -1,
    ): void => {
      c.eKind[j] = kind2;
      c.eA[j] = ab[0];
      c.eB[j] = ab[1];
      c.eFromTarget[j] = fromTarget ? 1 : 0;
      c.ePivot[j] = pivot;
    };

    for (const j of hunk.edges) {
      const e = scene.edges[j];
      if (e === undefined) continue;
      const styles = edgeStyles[j] as readonly EdgeStyle[];
      const B = styles[1] as EdgeStyle;
      const A = styles[2] as EdgeStyle;
      switch (e.role) {
        case 'added': {
          // Grow from the endpoint that already exists; between two new nodes, after they pop;
          // in merges / splits, once the travellers have arrived.
          const sNew = appears(e.s);
          const tNew = appears(e.t);
          const timing =
            sNew && tNew
              ? CHOREO.growBetweenNew
              : kind === 'add' && (sNew || tNew)
                ? CHOREO.growFromExisting
                : kind === 'merge' || kind === 'split'
                  ? CHOREO.growAfterArrival
                  : CHOREO.growOther;
          edge(j, EA_GROW, timing, sNew && !tNew);
          break;
        }
        case 'removed':
          edge(j, EA_RETRACT, CHOREO.retract, leaves(e.s) && !leaves(e.t));
          break;
        case 'collapsed':
        case 'carried': {
          if (kind === 'split' && e.role === 'carried') {
            const mover = c.nKind[e.s] === NA_EMERGE ? e.s : c.nKind[e.t] === NA_EMERGE ? e.t : -1;
            if (mover >= 0)
              edge(
                j,
                EA_FOLLOW_SPLIT,
                [c.nA[mover] as number, c.nB[mover] as number],
                false,
                mover,
              );
            else edge(j, EA_SWAP, CHOREO.swap);
            break;
          }
          const mover =
            c.nKind[e.sb] === NA_TRAVEL ? e.sb : c.nKind[e.tb] === NA_TRAVEL ? e.tb : -1;
          if (mover >= 0)
            edge(j, EA_FOLLOW_MERGE, [c.nA[mover] as number, c.nB[mover] as number], false, mover);
          else if (e.role === 'collapsed')
            edge(j, EA_RETRACT, CHOREO.retract, leaves(e.s) && !leaves(e.t));
          else edge(j, EA_SWAP, CHOREO.swap);
          break;
        }
        case 'retarget': {
          const pivot =
            e.s === e.sb && e.t !== e.tb ? e.s : e.t === e.tb && e.s !== e.sb ? e.t : -1;
          if (pivot >= 0) edge(j, EA_SWING, CHOREO.swing, false, pivot);
          else edge(j, EA_SWAP, CHOREO.swap);
          break;
        }
        case 'modified':
          edge(j, EA_FADE, CHOREO.edgeFade);
          break;
        case 'unchanged':
          break;
        default:
          assertNever(e.role);
      }
      // Safety net for unusual style combinations (e.g. an edge hidden in both versions).
      if (B.hidden && A.hidden) c.eKind[j] = EA_NONE;
    }
  }
  return c;
}
