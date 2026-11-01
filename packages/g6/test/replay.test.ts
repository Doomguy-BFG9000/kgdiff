import type { Timeline } from '@kgdiff/scene';
import { describe, expect, it } from 'vitest';
import { REPLAY_SAMPLES } from '../src/constants.js';
import { planReplay } from '../src/replay.js';
import { datasetScene } from './support/scene.js';

function timeline(partial: Partial<Timeline>): Timeline {
  return { duration: 0, windows: [], chapters: [], mode: 'hunks', ...partial };
}

describe('planReplay', () => {
  it('samples each window at the end of its spotlight, mid-transform, settle and end', () => {
    const steps = planReplay(
      timeline({
        duration: 2000,
        windows: [
          { hunk: 0, start: 0, end: 1000, chapter: 0 },
          { hunk: 1, start: 1000, end: 2000, chapter: 0 },
        ],
      }),
    );
    expect(steps.map((s) => s.t)).toEqual([180, 500, 820, 1000, 1180, 1500, 1820, 2000]);
    expect(steps.map((s) => s.dt)).toEqual([180, 320, 320, 180, 180, 320, 320, 180]);
    expect(steps.map((s) => s.focus)).toEqual([[0], null, null, null, [1], null, null, null]);
  });

  it('adds up to the timeline: the steps cover [0, last end] exactly', () => {
    const scene = datasetScene();
    const steps = planReplay(scene.timeline);
    const total = steps.reduce((sum, s) => sum + s.dt, 0);
    const lastEnd = Math.max(...scene.timeline.windows.map((w) => w.end));
    expect(total).toBeCloseTo(lastEnd, 6);
    expect(steps).toHaveLength(scene.timeline.windows.length * REPLAY_SAMPLES.length);
    for (let k = 1; k < steps.length; k++) {
      expect((steps[k] as (typeof steps)[number]).t).toBeGreaterThan(
        (steps[k - 1] as (typeof steps)[number]).t,
      );
    }
  });

  it('samples chapters, not their overlapping windows, in chapter mode', () => {
    const steps = planReplay(
      timeline({
        mode: 'chapters',
        windows: [
          { hunk: 0, start: 0, end: 900, chapter: 0 },
          { hunk: 1, start: 100, end: 1000, chapter: 0 },
        ],
        chapters: [
          {
            phase: 'remove',
            start: 0,
            end: 1000,
            hunks: [0, 1],
            bounds: { x: 0, y: 0, width: 1, height: 1 },
          },
        ],
      }),
    );
    expect(steps.map((s) => s.t)).toEqual([180, 500, 820, 1000]);
    expect(steps[0]?.focus).toEqual([0, 1]);
  });

  it('merges coinciding samples and keeps the focus', () => {
    const steps = planReplay(
      timeline({
        windows: [
          { hunk: 0, start: 0, end: 0, chapter: 0 },
          { hunk: 1, start: 0, end: 100, chapter: 0 },
        ],
      }),
      [0, 1],
    );
    expect(steps).toEqual([
      { t: 0, dt: 0, focus: [0] },
      { t: 100, dt: 100, focus: null },
    ]);
  });

  it('plans nothing for an empty timeline and skips non-finite windows', () => {
    expect(planReplay(timeline({}))).toEqual([]);
    expect(
      planReplay(timeline({ windows: [{ hunk: 0, start: Number.NaN, end: 5, chapter: 0 }] })),
    ).toEqual([]);
  });
});
