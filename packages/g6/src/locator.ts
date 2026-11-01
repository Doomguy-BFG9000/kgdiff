/**
 * Which node is at a point? Glyphs only carry endpoint coordinates, so glyph edges are attached
 * to the node whose disc contains the endpoint. A uniform grid keeps each query O(1) on average
 * (O(N) to build, done lazily once per frame and only when the frame has glyphs).
 */
import type { NodeVisual } from '@kgdiff/scene';

export class NodeLocator {
  private readonly cells = new Map<string, number[]>();
  private readonly size: number;
  private readonly reach: number;

  /**
   * @param nodes  frame nodes (positions and radii, world units)
   * @param accept which node indices may be returned (e.g. visible, present in the output)
   */
  constructor(
    private readonly nodes: readonly NodeVisual[],
    accept: (index: number) => boolean,
  ) {
    let maxR = 0;
    const members: number[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i] as NodeVisual;
      if (!accept(i) || !Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
      members.push(i);
      if (n.r > maxR) maxR = n.r;
    }
    this.reach = maxR;
    this.size = Math.max(16, 2 * maxR);
    for (const i of members) {
      const n = nodes[i] as NodeVisual;
      const key = this.key(Math.floor(n.x / this.size), Math.floor(n.y / this.size));
      const cell = this.cells.get(key);
      if (cell === undefined) this.cells.set(key, [i]);
      else cell.push(i);
    }
  }

  private key(ix: number, iy: number): string {
    return `${ix}:${iy}`;
  }

  /**
   * Index of the accepted node nearest to (x, y) among those within `r + slack` of it, or -1.
   * Ties go to the lower index, so results are deterministic.
   */
  nearest(x: number, y: number, slack: number): number {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
    const ix = Math.floor(x / this.size);
    const iy = Math.floor(y / this.size);
    const rings = Math.max(1, Math.ceil((this.reach + Math.max(0, slack)) / this.size));
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let dx = -rings; dx <= rings; dx++) {
      for (let dy = -rings; dy <= rings; dy++) {
        const cell = this.cells.get(this.key(ix + dx, iy + dy));
        if (cell === undefined) continue;
        for (const i of cell) {
          const n = this.nodes[i] as NodeVisual;
          const d = Math.hypot(n.x - x, n.y - y);
          if (d > Math.max(0, n.r) + slack) continue;
          if (d < bestD || (d === bestD && i < best)) {
            best = i;
            bestD = d;
          }
        }
      }
    }
    return best;
  }
}
