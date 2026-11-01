import type { Timeline } from '@kgdiff/scene';
import { describe, expect, it } from 'vitest';
import { MAX_FRAME_MS, ReplayClock, SPEEDS } from '../src/replay.js';

const hunks: Timeline = {
  duration: 3000,
  mode: 'hunks',
  windows: [
    { hunk: 0, start: 0, end: 1000, chapter: 0 },
    { hunk: 1, start: 1000, end: 2000, chapter: 0 },
    { hunk: 2, start: 2000, end: 3000, chapter: 1 },
  ],
  chapters: [
    {
      phase: 'remove',
      start: 0,
      end: 2000,
      hunks: [0, 1],
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    },
    {
      phase: 'add',
      start: 2000,
      end: 3000,
      hunks: [2],
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    },
  ],
};

const chapters: Timeline = {
  ...hunks,
  mode: 'chapters',
  windows: [
    { hunk: 0, start: 0, end: 1500, chapter: 0 },
    { hunk: 1, start: 100, end: 1600, chapter: 0 },
    { hunk: 2, start: 2000, end: 3000, chapter: 1 },
  ],
};

describe('ReplayClock', () => {
  it('advances by real time × speed only while playing', () => {
    const c = new ReplayClock(hunks);
    expect(c.advance(100)).toBe(false);
    c.play();
    c.advance(100);
    expect(c.t).toBe(100);
    c.setSpeed(4);
    c.advance(50);
    expect(c.t).toBe(300);
    c.setSpeed(3);
    expect(c.speed).toBe(4);
    c.pause();
    c.advance(50);
    expect(c.t).toBe(300);
  });

  it('caps long frame gaps', () => {
    const c = new ReplayClock(hunks);
    c.play();
    c.advance(5000);
    expect(c.t).toBe(MAX_FRAME_MS);
  });

  it('stops at the end and restarts from 0 when played again', () => {
    const c = new ReplayClock(hunks);
    c.seek(2950);
    c.play();
    c.advance(80);
    expect(c.t).toBe(3000);
    expect(c.playing).toBe(false);
    expect(c.finished).toBe(true);
    expect(c.progress).toBe(1);
    c.play();
    expect(c.t).toBe(0);
    expect(c.playing).toBe(true);
  });

  it('clamps seeks', () => {
    const c = new ReplayClock(hunks);
    c.seek(-5);
    expect(c.t).toBe(0);
    c.seek(1e9);
    expect(c.t).toBe(3000);
    c.seek(Number.NaN);
    expect(c.t).toBe(0);
  });

  it('steps between window ends and pauses', () => {
    const c = new ReplayClock(hunks);
    c.play();
    c.step(1);
    expect(c.t).toBe(1000);
    expect(c.playing).toBe(false);
    c.step(1);
    c.step(1);
    expect(c.t).toBe(3000);
    c.step(1);
    expect(c.t).toBe(3000);
    c.step(-1);
    expect(c.t).toBe(2000);
    c.seek(1500);
    c.step(-1);
    expect(c.t).toBe(1000);
    c.step(-1);
    expect(c.t).toBe(0);
  });

  it('steps by chapter in chapter mode', () => {
    const c = new ReplayClock(chapters);
    c.step(1);
    expect(c.t).toBe(2000);
    c.step(1);
    expect(c.t).toBe(3000);
    expect(c.activeTarget(50)).toEqual({ kind: 'chapter', index: 0 });
    expect(c.activeTarget(1800)).toEqual({ kind: 'chapter', index: 0 });
    expect(c.activeTarget(2500)).toEqual({ kind: 'chapter', index: 1 });
  });

  it('reports the position as started windows and the active hunk', () => {
    const c = new ReplayClock(hunks);
    expect(c.position()).toBe(0);
    expect(c.total).toBe(3);
    expect(c.position(500)).toBe(1);
    expect(c.position(1000)).toBe(1);
    expect(c.position(1001)).toBe(2);
    expect(c.position(3000)).toBe(3);
    expect(c.activeHunk(1500)).toBe(1);
    expect(c.activeHunk(3000)).toBe(-1);
    expect(c.activeTarget(1500)).toEqual({ kind: 'hunk', index: 1 });
    expect(new ReplayClock(chapters).activeHunk(120)).toBe(1);
    expect(c.windowEnd(1)).toBe(2000);
    expect(c.windowEnd(9)).toBeNull();
  });

  it('cycles through the speeds', () => {
    const c = new ReplayClock(hunks);
    const seen = SPEEDS.map(() => c.cycleSpeed());
    expect(seen).toEqual([2, 4, 0.5, 1]);
  });

  it('never plays an empty timeline', () => {
    const c = new ReplayClock({ duration: 0, mode: 'hunks', windows: [], chapters: [] });
    c.play();
    expect(c.playing).toBe(false);
    expect(c.finished).toBe(false);
    c.step(1);
    expect(c.t).toBe(0);
  });
});
