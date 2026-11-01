/**
 * Uniform grid over points (node centres) in compressed-row form: O(n) build with two passes
 * and no per-cell arrays, O(k) rectangle queries. Used for picking and glyph endpoint lookup.
 */

const MAX_CELLS_PER_AXIS = 512;

export class PointGrid {
  private x0 = 0;
  private y0 = 0;
  private cell = 1;
  private cols = 0;
  private rows = 0;
  private start = new Int32Array(1);
  private items = new Int32Array(0);
  /** Largest radius among the indexed points (query rectangles grow by it). */
  maxR = 0;
  /** Number of indexed points. */
  size = 0;

  /**
   * Index `n` points. `ids[i]` is reported by queries for the point at (xs[i], ys[i]).
   * The cell size targets about one point per cell, bounded by the largest radius.
   */
  build(xs: Float64Array, ys: Float64Array, rs: Float64Array, ids: Int32Array, n: number): void {
    this.size = n;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      const x = xs[i]!;
      const y = ys[i]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (rs[i]! > maxR) maxR = rs[i]!;
    }
    this.maxR = maxR;
    if (n === 0) {
      this.cols = this.rows = 0;
      return;
    }
    const w = Math.max(maxX - minX, 1e-9);
    const h = Math.max(maxY - minY, 1e-9);
    let cell = Math.max(Math.sqrt((w * h) / n), 2 * maxR, 1e-6);
    cell = Math.max(cell, w / MAX_CELLS_PER_AXIS, h / MAX_CELLS_PER_AXIS);
    this.cell = cell;
    this.x0 = minX;
    this.y0 = minY;
    this.cols = Math.floor(w / cell) + 1;
    this.rows = Math.floor(h / cell) + 1;
    const cells = this.cols * this.rows;
    if (this.start.length < cells + 1) this.start = new Int32Array(cells + 1);
    else this.start.fill(0, 0, cells + 1);
    if (this.items.length < n) this.items = new Int32Array(Math.max(n, this.items.length * 2));
    const start = this.start;
    for (let i = 0; i < n; i++) start[this.cellOf(xs[i]!, ys[i]!) + 1]!++;
    for (let c = 0; c < cells; c++) start[c + 1]! += start[c]!;
    // Fill using `start` as a cursor, then shift it back.
    for (let i = 0; i < n; i++) {
      const c = this.cellOf(xs[i]!, ys[i]!);
      this.items[start[c]!++] = ids[i]!;
    }
    for (let c = cells; c > 0; c--) start[c] = start[c - 1]!;
    start[0] = 0;
  }

  /** Ids of points whose centre may lie in [x0, x1] × [y0, y1]; returns how many were written. */
  query(x0: number, y0: number, x1: number, y1: number, out: number[]): number {
    out.length = 0;
    if (this.cols === 0) return 0;
    const c0 = Math.max(0, Math.floor((x0 - this.x0) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor((x1 - this.x0) / this.cell));
    const r0 = Math.max(0, Math.floor((y0 - this.y0) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor((y1 - this.y0) / this.cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = r * this.cols + c;
        const end = this.start[cell + 1]!;
        for (let j = this.start[cell]!; j < end; j++) out.push(this.items[j]!);
      }
    }
    return out.length;
  }

  private cellOf(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.x0) / this.cell)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.y0) / this.cell)));
    return r * this.cols + c;
  }
}
