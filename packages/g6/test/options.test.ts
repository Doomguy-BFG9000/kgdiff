import type { EdgeData, GraphOptions, NodeData } from '@antv/g6';
import { getTheme } from '@kgdiff/scene';
import { describe, expect, it } from 'vitest';
import { BACKGROUND_PLUGIN_KEY, HOVER_STATE, NODE_TYPE } from '../src/constants.js';
import type { KgdiffDatumData } from '../src/map.js';
import {
  generatedOptions,
  hoverEdgeStyle,
  hoverNodeStyle,
  mergeG6Options,
} from '../src/options.js';

const dark = getTheme('dark');

function meta(partial: Partial<KgdiffDatumData>): KgdiffDatumData {
  return {
    kgdiff: 'node',
    index: 0,
    hunk: -1,
    family: 'neutral',
    changed: false,
    label: '',
    glyph: '',
    ...partial,
  };
}

function generated(interactive = true): GraphOptions {
  return generatedOptions({
    container: 'stage',
    data: { nodes: [], edges: [] },
    theme: () => dark,
    interactive,
    hoverable: () => true,
  });
}

describe('generatedOptions', () => {
  it('uses no G6 theme, kgdiff-node and a background plugin in the canvas color', () => {
    const o = generated();
    expect(o.theme).toBe(false);
    expect(o.node?.type).toBe(NODE_TYPE);
    expect(o.edge?.type).toBeUndefined();
    expect(o.plugins).toEqual([
      { type: 'background', key: BACKGROUND_PLUGIN_KEY, background: dark.canvas.background },
    ]);
    expect(o.node?.state?.[HOVER_STATE]).toBeTypeOf('function');
    expect(o.edge?.state?.[HOVER_STATE]).toBeTypeOf('function');
  });

  it('adds zoom, drag and hover behaviors only when interactive', () => {
    const behaviors = generated().behaviors ?? [];
    expect(behaviors.slice(0, 2)).toEqual(['zoom-canvas', 'drag-canvas']);
    expect(behaviors[2]).toMatchObject({ type: 'hover-activate', state: HOVER_STATE, degree: 0 });
    expect(generated(false).behaviors).toEqual([]);
  });

  it('animates the fields kgdiff changes', () => {
    const animation = generated().node?.animation as { update: { fields: string[] }[] } | undefined;
    expect(animation?.update[0]?.fields).toEqual(
      expect.arrayContaining(['x', 'y', 'opacity', 'fill']),
    );
  });
});

describe('mergeG6Options', () => {
  it('appends behaviors and plugins, merges objects deeply, replaces the rest', () => {
    const merged = mergeG6Options(generated(), {
      behaviors: ['brush-select'],
      plugins: [{ type: 'minimap' }],
      node: { state: { selected: { lineWidth: 3 } } },
      zoomRange: [0.1, 4],
      animation: false,
    });
    expect(merged.behaviors?.at(-1)).toBe('brush-select');
    expect(merged.behaviors).toHaveLength(4);
    expect(merged.plugins).toHaveLength(2);
    expect(merged.node?.type).toBe(NODE_TYPE);
    expect(Object.keys(merged.node?.state ?? {})).toEqual([HOVER_STATE, 'selected']);
    expect(merged.zoomRange).toEqual([0.1, 4]);
    expect(merged.animation).toBe(false);
  });

  it('returns the generated options untouched without user options', () => {
    const o = generated();
    expect(mergeG6Options(o, undefined)).toBe(o);
  });
});

describe('hover styles', () => {
  it('strokes changed nodes in their family strong color, context in secondary text', () => {
    const changed: NodeData = {
      id: 'a',
      style: { labelText: 'A', labelOpacity: 0.2, opacity: 0.18 },
      data: meta({ family: 'added', changed: true }),
    };
    expect(hoverNodeStyle(changed, dark)).toMatchObject({
      lineWidth: 2,
      stroke: dark.family.added.strong,
      label: true,
      labelOpacity: 0.2,
    });
    const context: NodeData = { id: 'b', style: { labelText: '' }, data: meta({}) };
    expect(hoverNodeStyle(context, dark)).toMatchObject({
      stroke: dark.text.secondary,
      label: false,
    });
  });

  it('widens edges, shows their arrow and reveals their label', () => {
    const e: EdgeData = {
      id: 'e',
      source: 'a',
      target: 'b',
      style: { lineWidth: 1, labelText: '', opacity: 0.5 },
      data: meta({ kgdiff: 'edge', label: '持股' }),
    };
    expect(hoverEdgeStyle(e, dark)).toMatchObject({
      lineWidth: 2.5,
      endArrow: true,
      label: true,
      labelText: '持股',
      labelFill: dark.neutral.label,
      labelOpacity: 0.5,
    });
    const loop: EdgeData = { ...e, target: 'a', style: { lineWidth: 4, labelText: 'x' } };
    expect(hoverEdgeStyle(loop, dark)).toMatchObject({ lineWidth: 4, endArrow: false });
  });

  it('leaves foreign elements alone', () => {
    expect(hoverNodeStyle({ id: 'x', data: {} }, dark)).toEqual({});
    expect(hoverEdgeStyle({ source: 'a', target: 'b', data: meta({}) }, dark)).toEqual({});
  });
});
