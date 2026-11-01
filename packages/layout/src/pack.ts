/**
 * Packing of laid-out components (docs/algorithms.md §12 "Components").
 *
 * Components are packed with a skyline bottom-left packer (tallest first) into a strip whose
 * width is chosen from a few candidates so the overall picture is closest to a 16:10 viewport;
 * isolated nodes follow as a compact table (aligned columns, rows sharing a baseline) spanning
 * the same width.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Placement {
  readonly x: number;
  readonly y: number;
}

/** A node in the isolated-node grid: its visual box relative to the node center. */
export interface GridItem {
  readonly halfWidth: number;
  /** Negative: distance from the center to the top of the box. */
  readonly top: number;
  readonly bottom: number;
}

export interface PackInput {
  /** Bounding boxes of multi-node components. */
  readonly components: readonly Size[];
  readonly isolated: readonly GridItem[];
  readonly componentGap: number;
  readonly gridGapX: number;
  readonly gridGapY: number;
  /** Target width / height. Default 1.6 (16:10). */
  readonly aspect?: number;
}

export interface PackResult {
  /** Top-left corner of each component box, by input index. */
  readonly components: readonly Placement[];
  /** Node center of each isolated item, by input index. */
  readonly isolated: readonly Placement[];
  readonly width: number;
  readonly height: number;
}

const WIDTH_FACTORS = [0.55, 0.7, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];

interface Segment {
  x: number;
  y: number;
  w: number;
}

/** Skyline bottom-left placement into a strip; boxes must not be wider than the strip. */
function skyline(
  sizes: readonly Size[],
  order: readonly number[],
  stripWidth: number,
): { positions: Placement[]; width: number; height: number } {
  const positions: Placement[] = new Array(sizes.length);
  let segments: Segment[] = [{ x: 0, y: 0, w: stripWidth }];
  let width = 0;
  let height = 0;
  const eps = 1e-9;

  for (const index of order) {
    const { width: w, height: h } = sizes[index]!;
    let bestY = Number.POSITIVE_INFINITY;
    let bestX = 0;
    for (let i = 0; i < segments.length; i++) {
      const x = segments[i]!.x;
      if (x + w > stripWidth + eps && x > 0) break;
      let y = 0;
      let covered = 0;
      for (let j = i; j < segments.length && covered < w - eps; j++) {
        y = Math.max(y, segments[j]!.y);
        covered = segments[j]!.x + segments[j]!.w - x;
      }
      if (y < bestY - eps) {
        bestY = y;
        bestX = x;
      }
    }
    positions[index] = { x: bestX, y: bestY };
    width = Math.max(width, bestX + w);
    height = Math.max(height, bestY + h);

    // Raise the skyline over [bestX, bestX + w).
    const left = bestX;
    const right = bestX + w;
    const next: Segment[] = [];
    for (const seg of segments) {
      const segRight = seg.x + seg.w;
      if (segRight <= left + eps || seg.x >= right - eps) {
        next.push(seg);
        continue;
      }
      if (seg.x < left) next.push({ x: seg.x, y: seg.y, w: left - seg.x });
      if (segRight > right) next.push({ x: right, y: seg.y, w: segRight - right });
    }
    next.push({ x: left, y: bestY + h, w });
    next.sort((a, b) => a.x - b.x);
    segments = [];
    for (const seg of next) {
      const last = segments[segments.length - 1];
      if (last !== undefined && Math.abs(last.y - seg.y) < eps) last.w = seg.x + seg.w - last.x;
      else segments.push({ ...seg });
    }
  }
  return { positions, width, height };
}

/** Table layout of isolated nodes with the largest column count that fits `targetWidth`. */
function grid(
  items: readonly GridItem[],
  gapX: number,
  gapY: number,
  targetWidth: number,
): { centers: Placement[]; width: number; height: number } {
  const n = items.length;
  if (n === 0) return { centers: [], width: 0, height: 0 };
  const tableWidth = (columns: number): number => {
    let total = gapX * (columns - 1);
    for (let col = 0; col < columns; col++) {
      let w = 0;
      for (let i = col; i < n; i += columns) w = Math.max(w, 2 * items[i]!.halfWidth);
      total += w;
    }
    return total;
  };
  let columns = 1;
  while (columns < n && tableWidth(columns + 1) <= targetWidth) columns++;

  const colWidth: number[] = [];
  for (let col = 0; col < columns; col++) {
    let w = 0;
    for (let i = col; i < n; i += columns) w = Math.max(w, 2 * items[i]!.halfWidth);
    colWidth.push(w);
  }
  const colCenter: number[] = [];
  let cursor = 0;
  for (const w of colWidth) {
    colCenter.push(cursor + w / 2);
    cursor += w + gapX;
  }
  const width = cursor - gapX;

  const centers: Placement[] = new Array(n);
  let top = 0;
  for (let row = 0; row * columns < n; row++) {
    let above = 0;
    let below = 0;
    for (let i = row * columns; i < Math.min(n, (row + 1) * columns); i++) {
      above = Math.max(above, -items[i]!.top);
      below = Math.max(below, items[i]!.bottom);
    }
    for (let i = row * columns; i < Math.min(n, (row + 1) * columns); i++) {
      centers[i] = { x: colCenter[i - row * columns]!, y: top + above };
    }
    top += above + below + gapY;
  }
  return { centers, width, height: top - gapY };
}

/** Area of the smallest `aspect` rectangle enclosing width × height. */
const enclosingArea = (width: number, height: number, aspect: number): number => {
  const w = Math.max(width, height * aspect);
  return w * (w / aspect);
};

export function pack(input: PackInput): PackResult {
  const aspect = input.aspect ?? 1.6;
  const gap = input.componentGap;
  const inflated = input.components.map((s) => ({ width: s.width + gap, height: s.height + gap }));
  const order = inflated
    .map((_, i) => i)
    .sort(
      (a, b) =>
        inflated[b]!.height - inflated[a]!.height ||
        inflated[b]!.width - inflated[a]!.width ||
        a - b,
    );
  let area = 0;
  let widest = 0;
  for (const s of inflated) {
    area += s.width * s.height;
    widest = Math.max(widest, s.width);
  }
  for (const item of input.isolated) {
    area += (2 * item.halfWidth + input.gridGapX) * (item.bottom - item.top + input.gridGapY);
    widest = Math.max(widest, 2 * item.halfWidth);
  }
  const base = Math.sqrt(area * aspect);

  let best: PackResult | undefined;
  let bestCost = Number.POSITIVE_INFINITY;
  const tried = new Set<number>();
  for (const factor of WIDTH_FACTORS) {
    const strip = Math.max(widest, base * factor);
    if (tried.has(strip)) continue;
    tried.add(strip);
    const packed = skyline(inflated, order, strip);
    const compWidth = packed.width > 0 ? packed.width - gap : 0;
    const compHeight = packed.height > 0 ? packed.height - gap : 0;
    const table = grid(
      input.isolated,
      input.gridGapX,
      input.gridGapY,
      Math.max(strip - gap, compWidth),
    );
    const tableTop = compHeight > 0 && table.height > 0 ? compHeight + gap : 0;
    const width = Math.max(compWidth, table.width);
    const height = table.height > 0 ? tableTop + table.height : compHeight;
    const cost = enclosingArea(width, height, aspect);
    if (cost < bestCost - 1e-6) {
      bestCost = cost;
      best = {
        components: packed.positions,
        isolated: table.centers.map((c) => ({ x: c.x, y: c.y + tableTop })),
        width,
        height,
      };
    }
  }
  return best ?? { components: [], isolated: [], width: 0, height: 0 };
}
