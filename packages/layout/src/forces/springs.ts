/**
 * Small custom forces that complement d3's link and many-body forces.
 */
import type { SimNode } from '../simulate.js';

export interface Spring {
  /** Sim-local index of the node that is pulled (merge source / split target). */
  readonly mover: number;
  /** Sim-local index of its partner (merge target / split source). */
  readonly anchor: number;
}

/**
 * Weak one-sided springs (docs/algorithms.md §12: strength 0.08) that keep merge sources near
 * their target and split targets near their source, so replay travel stays short. They only
 * pull (collision keeps the pair apart), and the anchor feels a small share of the reaction so
 * it is not dragged around by its ghosts.
 */
export function applySprings(
  nodes: readonly SimNode[],
  springs: readonly Spring[],
  alpha: number,
  strength: number,
  restLength: number,
): void {
  const anchorShare = 0.2;
  for (const { mover, anchor } of springs) {
    const m = nodes[mover];
    const a = nodes[anchor];
    if (m === undefined || a === undefined) continue;
    const dx = a.x + a.vx - m.x - m.vx;
    const dy = a.y + a.vy - m.y - m.vy;
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l <= restLength) continue;
    const k = ((l - restLength) / l) * alpha * strength;
    m.vx += dx * k * (1 - anchorShare);
    m.vy += dy * k * (1 - anchorShare);
    a.vx -= dx * k * anchorShare;
    a.vy -= dy * k * anchorShare;
  }
}

/** Linear pull towards the origin (d3 forceX / forceY at 0): keeps components round and compact. */
export function applyGravity(nodes: readonly SimNode[], alpha: number, strength: number): void {
  const k = strength * alpha;
  for (const node of nodes) {
    node.vx -= node.x * k;
    node.vy -= node.y * k;
  }
}
