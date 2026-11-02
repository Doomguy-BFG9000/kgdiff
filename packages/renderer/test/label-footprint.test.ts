import { describe, expect, it } from 'vitest';
import { darkTheme } from '../dev/theme.js';
import { FrameCache } from '../src/frame-cache.js';
import { labelFootprint } from '../src/index.js';
import { FrameFootprint } from '../src/label-footprint.js';
import { Painter, Resources } from '../src/paint.js';
import { lineHeight } from '../src/text.js';
import { frameOf, lbl, node, noSurfaces, RecordingContext } from './helpers/recording-ctx.js';

describe('labelFootprint', () => {
  it('is the discs alone at k = Infinity and grows with the labels as the camera zooms out', () => {
    const fp = labelFootprint(
      frameOf([
        node(0, 0, { r: 10, label: lbl('a fairly long label') }),
        node(100, 0, { r: 10, visible: false }),
        node(60, 0, { r: 10 }),
      ]),
      darkTheme,
    );
    expect(fp.at(Number.POSITIVE_INFINITY)).toEqual({ x: -10, y: -10, width: 80, height: 20 });
    const near = fp.at(1);
    const far = fp.at(0.5);
    // Centred below the node: wider than its disc, and below it.
    expect(near?.x).toBeLessThan(-10);
    expect((near?.y ?? 0) + (near?.height ?? 0)).toBeGreaterThan(10 + 5 + lineHeight(12) - 1);
    expect(far?.width).toBeGreaterThan(near?.width ?? 0);
    expect(labelFootprint(frameOf([]), darkTheme).at(1)).toBeNull();
  });

  it('leaves out labels hidden at that zoom', () => {
    const fp = labelFootprint(
      frameOf([node(0, 0, { r: 10, label: lbl('hidden far out', { minZoom: 0.5 }) })]),
      darkTheme,
    );
    expect(fp.at(0.3)).toEqual({ x: -10, y: -10, width: 20, height: 20 });
  });

  it('frames a paint that keeps labels inside: every label drawn is whole', () => {
    const ctx = new RecordingContext();
    const res = new Resources(noSurfaces, darkTheme, ctx);
    const frame = frameOf([
      // Alpha's spot below is taken by Beta's disc: it has to move.
      node(0, 0, { label: lbl('Alpha, a long label', { priority: 1 }) }),
      node(0, 18, { label: lbl('Beta') }),
      node(-90, 40, { label: lbl('Gamma, far left') }),
    ]);
    const drawn: Record<number, string[]> = {};
    for (const k of [0.6, 1, 1.7]) {
      const box = new FrameFootprint(frame, res).at(k);
      if (!box) throw new Error('no footprint');
      // The canvas is what the footprint covers (and a pixel on each side for rounding).
      const width = Math.ceil(box.width * k) + 2;
      const height = Math.ceil(box.height * k) + 2;
      const cam = { x: box.x + box.width / 2, y: box.y + box.height / 2, k };
      ctx.clear();
      const painter = new Painter(res);
      painter.labelsInside = true;
      painter.paint(
        { ctx, width, height, dpr: 1 },
        cam,
        frame,
        { main: new FrameCache(), before: new FrameCache(), after: new FrameCache() },
        1,
        darkTheme,
        false,
      );
      const texts = ctx.calls('fillText');
      drawn[k] = texts.map((t) => t.args[0] as string);
      for (const t of texts) {
        const [text, x, cy] = t.args as [string, number, number];
        const w = [...text].length * 12 * 0.6;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(width + 1e-6);
        expect(cy - lineHeight(12) / 2).toBeGreaterThanOrEqual(0);
        expect(cy + lineHeight(12) / 2).toBeLessThanOrEqual(height + 1e-6);
      }
    }
    // Close in, everything has room; further out the crowded labels give way rather than cross
    // the edge (Alpha: below is taken and every other spot crosses an edge).
    expect(drawn[1.7]).toEqual(['Alpha, a long label', 'Beta', 'Gamma, far left']);
    expect(drawn[1]).toEqual(['Beta', 'Gamma, far left']);
    expect(drawn[0.6]).toEqual(['Beta']);
  });
});
