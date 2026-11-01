/**
 * Mapping timings (`pnpm bench`): `toG6Data` is O(N + E). The bound is generous; it catches
 * complexity regressions, not micro-regressions. What the mapping produces is tested in
 * map.test.ts.
 */
import { expect, test } from 'vitest';
import { toG6Data } from '../src/index.js';
import { largeFrame } from './support/frame.js';

test('toG6Data, 5,000 nodes and 10,000 edges', async ({ bench }) => {
  const { scene, frame } = largeFrame(5000);
  const result = await bench('5k / 10k', () => toG6Data(scene, frame)).run({
    iterations: 10,
    time: 0,
    warmupIterations: 2,
    warmupTime: 0,
  });
  expect(result.latency.p50).toBeLessThan(400);
});
