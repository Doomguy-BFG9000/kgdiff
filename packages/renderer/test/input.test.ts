import { describe, expect, it } from 'vitest';
import {
  classifyWheel,
  createWheelMemory,
  GLIDE_MAX_SPEED,
  isNotchDelta,
  VelocityTracker,
  type WheelLike,
  wheelPixels,
  wheelZoomFactor,
} from '../src/input.js';

const wheel = (o: Partial<WheelLike>): WheelLike => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  ...o,
});

describe('wheel classification', () => {
  it('treats ctrl / meta + small pixel deltas as a pinch', () => {
    expect(classifyWheel(wheel({ deltaY: 3.2, ctrlKey: true }), createWheelMemory(), 0)).toBe(
      'pinch',
    );
    expect(classifyWheel(wheel({ deltaY: -1, metaKey: true }), createWheelMemory(), 0)).toBe(
      'pinch',
    );
  });

  it('treats ctrl + a mouse notch as a notch zoom', () => {
    expect(classifyWheel(wheel({ deltaY: 100, ctrlKey: true }), createWheelMemory(), 0)).toBe(
      'notch',
    );
    expect(
      classifyWheel(wheel({ deltaY: 3, deltaMode: 1, ctrlKey: true }), createWheelMemory(), 0),
    ).toBe('notch');
  });

  it('treats line / page deltas as a mouse wheel', () => {
    expect(classifyWheel(wheel({ deltaY: 3, deltaMode: 1 }), createWheelMemory(), 0)).toBe('notch');
    expect(classifyWheel(wheel({ deltaY: 1, deltaMode: 2 }), createWheelMemory(), 0)).toBe('notch');
  });

  it('treats horizontal or fractional pixel deltas as trackpad panning', () => {
    expect(classifyWheel(wheel({ deltaX: 2, deltaY: 5 }), createWheelMemory(), 0)).toBe('pan');
    expect(classifyWheel(wheel({ deltaY: 7.5 }), createWheelMemory(), 0)).toBe('pan');
    expect(classifyWheel(wheel({ deltaY: 12 }), createWheelMemory(), 0)).toBe('pan');
  });

  it('uses wheelDeltaY when the browser reports it', () => {
    expect(classifyWheel(wheel({ deltaY: 120, wheelDeltaY: -360 }), createWheelMemory(), 0)).toBe(
      'pan',
    );
    expect(classifyWheel(wheel({ deltaY: 100, wheelDeltaY: -120 }), createWheelMemory(), 0)).toBe(
      'notch',
    );
  });

  it('recognises integer mouse notches and macOS wheel steps', () => {
    expect(isNotchDelta(100)).toBe(true);
    expect(isNotchDelta(-120)).toBe(true);
    expect(isNotchDelta(4.000244140625)).toBe(true);
    expect(isNotchDelta(4.000244140625 * 3)).toBe(true);
    expect(isNotchDelta(4)).toBe(false);
    expect(isNotchDelta(0)).toBe(false);
    expect(isNotchDelta(57.5)).toBe(false);
  });

  it('keeps one classification for the events of a gesture', () => {
    const mem = createWheelMemory();
    expect(classifyWheel(wheel({ deltaY: 6 }), mem, 0)).toBe('pan');
    // A fast flick inside the same gesture looks like a notch on its own.
    expect(classifyWheel(wheel({ deltaY: 100 }), mem, 40)).toBe('pan');
    // After a pause it is classified afresh.
    expect(classifyWheel(wheel({ deltaY: 100 }), mem, 1000)).toBe('notch');
  });

  it('converts line and page deltas to pixels', () => {
    expect(wheelPixels(wheel({ deltaX: 1, deltaY: 3, deltaMode: 1 }), 600)).toEqual({
      x: 16,
      y: 48,
    });
    expect(wheelPixels(wheel({ deltaY: 1, deltaMode: 2 }), 600)).toEqual({ x: 0, y: 600 });
    expect(wheelPixels(wheel({ deltaY: 7 }), 600)).toEqual({ x: 0, y: 7 });
  });

  it('zooms in for negative deltas and out for positive ones, symmetrically', () => {
    for (const intent of ['pinch', 'notch'] as const) {
      const zin = wheelZoomFactor(intent, -40);
      const zout = wheelZoomFactor(intent, 40);
      expect(zin).toBeGreaterThan(1);
      expect(zout).toBeLessThan(1);
      expect(zin * zout).toBeCloseTo(1, 12);
    }
    expect(wheelZoomFactor('pinch', -10)).toBeCloseTo(Math.exp(0.1), 12);
    expect(wheelZoomFactor('notch', -100)).toBeCloseTo(2 ** (100 / 240), 12);
  });

  it('caps the zoom of one event', () => {
    expect(wheelZoomFactor('notch', -1e6)).toBeCloseTo(2, 12);
    expect(wheelZoomFactor('pinch', 1e6)).toBeCloseTo(Math.exp(-0.5), 12);
  });
});

describe('VelocityTracker', () => {
  it('measures release velocity over the last 100 ms', () => {
    const v = new VelocityTracker();
    for (let t = 0; t <= 200; t += 10) v.add(t, t * 0.5, -t * 0.25);
    const vel = v.velocity(200);
    expect(vel.x).toBeCloseTo(0.5, 9);
    expect(vel.y).toBeCloseTo(-0.25, 9);
  });

  it('reports zero after the pointer rested', () => {
    const v = new VelocityTracker();
    v.add(0, 0, 0);
    v.add(16, 10, 0);
    expect(v.velocity(200)).toEqual({ x: 0, y: 0 });
  });

  it('caps flings', () => {
    const v = new VelocityTracker();
    v.add(0, 0, 0);
    v.add(1, 1000, 0);
    expect(Math.hypot(v.velocity(1).x, v.velocity(1).y)).toBeCloseTo(GLIDE_MAX_SPEED, 9);
  });

  it('needs two samples', () => {
    const v = new VelocityTracker();
    v.add(0, 5, 5);
    expect(v.velocity(0)).toEqual({ x: 0, y: 0 });
  });
});
