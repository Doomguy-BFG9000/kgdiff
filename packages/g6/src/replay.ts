/**
 * Replay plan: the timeline times at which the controller resolves a frame and hands it to G6,
 * which animates linearly from one sample to the next. Pure.
 */
import type { Timeline } from '@kgdiff/scene';
import { REPLAY_SAMPLES } from './constants.js';

export interface ReplayStep {
  /** Timeline time to resolve (ms at 1×). */
  readonly t: number;
  /** Time since the previous step (ms at 1×); the first step counts from 0. */
  readonly dt: number;
  /** On the first step of a unit (window, or chapter in chapter mode): its hunks, for the camera. */
  readonly focus: readonly number[] | null;
}

interface Unit {
  readonly start: number;
  readonly end: number;
  readonly hunks: readonly number[];
}

/**
 * Sample every unit of `timeline` at `samples` (fractions of its duration). Units are the
 * hunk windows, or the chapters in chapter mode (whose windows overlap and play together).
 * Steps are sorted by time; samples closer than 1e-6 ms are merged. O(U log U).
 */
export function planReplay(
  timeline: Timeline,
  samples: readonly number[] = REPLAY_SAMPLES,
): ReplayStep[] {
  const units: Unit[] =
    timeline.mode === 'chapters'
      ? timeline.chapters.map((c) => ({ start: c.start, end: c.end, hunks: c.hunks }))
      : timeline.windows.map((w) => ({ start: w.start, end: w.end, hunks: [w.hunk] }));
  const raw: { t: number; focus: readonly number[] | null; order: number }[] = [];
  units.forEach((u, k) => {
    if (!Number.isFinite(u.start) || !Number.isFinite(u.end)) return;
    const length = Math.max(0, u.end - u.start);
    samples.forEach((f, s) => {
      raw.push({ t: u.start + f * length, focus: s === 0 ? u.hunks : null, order: k });
    });
  });
  raw.sort((a, b) => a.t - b.t || a.order - b.order);
  const steps: ReplayStep[] = [];
  let prev = 0;
  for (const r of raw) {
    const last = steps[steps.length - 1];
    if (last !== undefined && r.t - last.t < 1e-6) {
      if (r.focus !== null && last.focus === null) {
        steps[steps.length - 1] = { ...last, focus: r.focus };
      }
      continue;
    }
    steps.push({ t: r.t, dt: Math.max(0, r.t - prev), focus: r.focus });
    prev = r.t;
  }
  return steps;
}
