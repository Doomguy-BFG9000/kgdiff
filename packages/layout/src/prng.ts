/**
 * Seeded randomness. The layout never calls `Math.random`: every random choice comes from a
 * mulberry32 stream (fast, 32-bit state, good equidistribution for layout jitter), and per-node
 * choices are derived from a hash of the node id so they do not depend on processing order.
 */

export type Random = () => number;

/** mulberry32: uniform floats in [0, 1) from a 32-bit seed. */
export function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over UTF-16 code units, mixed with `salt`. */
export function hashString(text: string, salt = 0): number {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Final avalanche (murmur3 fmix32) so similar ids give unrelated streams.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** Map any finite seed to a 32-bit state (integers map directly, others via their decimal text). */
export function seedState(seed: number): number {
  return Number.isInteger(seed) ? seed >>> 0 : hashString(String(seed));
}

/** A stream that depends only on the layout seed and one node id. */
export function nodeRandom(seed: number, id: string): Random {
  return mulberry32(hashString(id, seed));
}

/** A uniformly random unit vector, without trigonometry (rejection sampling in the unit disc). */
export function randomDirection(random: Random): { readonly x: number; readonly y: number } {
  for (let i = 0; i < 32; i++) {
    const x = random() * 2 - 1;
    const y = random() * 2 - 1;
    const d2 = x * x + y * y;
    if (d2 > 1e-4 && d2 <= 1) {
      const d = Math.sqrt(d2);
      return { x: x / d, y: y / d };
    }
  }
  return { x: 1, y: 0 };
}
