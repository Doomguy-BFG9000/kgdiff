/**
 * Replay clock: pure time arithmetic over a scene `Timeline` (no timers). The controller
 * advances it from its animation-frame loop.
 */
import type { Timeline } from '@kgdiff/scene';

export const SPEEDS = [0.5, 1, 2, 4] as const;
export type ReplaySpeed = (typeof SPEEDS)[number];

/** Times closer than this (ms) count as equal when stepping. */
const EPS = 0.5;
/** A frame gap longer than this (tab in background, debugger) advances at most this much. */
export const MAX_FRAME_MS = 100;

export class ReplayClock {
  #time = 0;
  #rate: ReplaySpeed = 1;
  #running = false;
  /** Sorted, distinct stop times for stepping (window or chapter ends). */
  readonly #stops: readonly number[];
  readonly #starts: Float64Array;

  constructor(readonly timeline: Timeline) {
    const ends =
      timeline.mode === 'chapters'
        ? timeline.chapters.map((c) => c.end)
        : timeline.windows.map((w) => w.end);
    this.#stops = [...new Set(ends)].sort((a, b) => a - b);
    this.#starts = Float64Array.from(timeline.windows.map((w) => w.start)).sort();
  }

  get t(): number {
    return this.#time;
  }

  get duration(): number {
    return this.timeline.duration;
  }

  get speed(): ReplaySpeed {
    return this.#rate;
  }

  get playing(): boolean {
    return this.#running;
  }

  /** At the end and not playing. */
  get finished(): boolean {
    return !this.#running && this.duration > 0 && this.#time >= this.duration;
  }

  /** Normalized position in [0, 1]. */
  get progress(): number {
    return this.duration > 0 ? this.#time / this.duration : 0;
  }

  setSpeed(speed: number): void {
    const s = SPEEDS.find((x) => x === speed);
    if (s !== undefined) this.#rate = s;
  }

  /** Next speed in `SPEEDS`, wrapping around. */
  cycleSpeed(): ReplaySpeed {
    const i = SPEEDS.indexOf(this.#rate);
    this.#rate = SPEEDS[(i + 1) % SPEEDS.length] as ReplaySpeed;
    return this.#rate;
  }

  /** Start playing; a finished replay restarts from 0. No-op for an empty timeline. */
  play(): void {
    if (this.duration <= 0) return;
    if (this.#time >= this.duration) this.#time = 0;
    this.#running = true;
  }

  pause(): void {
    this.#running = false;
  }

  seek(t: number): void {
    this.#time = Number.isFinite(t) ? Math.min(this.duration, Math.max(0, t)) : 0;
  }

  /**
   * Advance by a real-time delta (ms, capped at `MAX_FRAME_MS`) scaled by the speed. Stops at
   * the end. Returns whether time moved.
   */
  advance(dt: number): boolean {
    if (!this.#running || !(dt > 0)) return false;
    const before = this.#time;
    this.#time = Math.min(this.duration, this.#time + Math.min(dt, MAX_FRAME_MS) * this.#rate);
    if (this.#time >= this.duration) this.#running = false;
    return this.#time !== before;
  }

  /**
   * Seek to the next (+1) / previous (−1) stop: the end of a hunk window (`hunks` timelines) or
   * of a chapter (`chapters`). Backwards from the first stop goes to 0. Pauses playback.
   */
  step(direction: 1 | -1): void {
    this.#running = false;
    const t = this.#time;
    if (direction > 0) {
      const next = this.#stops.find((s) => s > t + EPS);
      this.#time = next ?? this.duration;
    } else {
      let prev = 0;
      for (const s of this.#stops) {
        if (s < t - EPS) prev = s;
        else break;
      }
      this.#time = prev;
    }
  }

  /** End of hunk `h`'s window (where selecting it in the list seeks to), or null. */
  windowEnd(h: number): number | null {
    const w = this.timeline.windows.find((x) => x.hunk === h);
    return w === undefined ? null : w.end;
  }

  /** Number of windows that have started (strictly before `t`): the `3` in `3 / 23`. */
  position(t = this.#time): number {
    let lo = 0;
    let hi = this.#starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.#starts[mid] as number) < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  get total(): number {
    return this.timeline.windows.length;
  }

  /**
   * What the camera follows at `t`: in `hunks` mode the hunk whose window contains `t` (the latest
   * started), in `chapters` mode the chapter containing `t`. `-1` between windows.
   */
  activeTarget(t = this.#time): { readonly kind: 'hunk' | 'chapter'; readonly index: number } {
    if (this.timeline.mode === 'chapters') {
      const c = this.timeline.chapters.findIndex((x) => t >= x.start && t < x.end);
      return { kind: 'chapter', index: c };
    }
    return { kind: 'hunk', index: this.activeHunk(t) };
  }

  /** The hunk whose window is playing at `t` (latest started), or -1. */
  activeHunk(t = this.#time): number {
    let best = -1;
    let bestStart = Number.NEGATIVE_INFINITY;
    for (const w of this.timeline.windows) {
      if (t >= w.start && t < w.end && w.start >= bestStart) {
        best = w.hunk;
        bestStart = w.start;
      }
    }
    return best;
  }
}
