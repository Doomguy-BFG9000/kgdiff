import { KgdiffError } from '@kgdiff/core';
import { describe, expect, it } from 'vitest';
import {
  colorRamp,
  composite,
  contrastRatio,
  desaturate,
  formatColor,
  mix,
  parseColor,
  RAMP_STEPS,
  RampCache,
  rampAt,
  relativeLuminance,
  withAlpha,
} from '../src/color.js';

describe('parseColor', () => {
  it.each([
    ['#fff', { r: 255, g: 255, b: 255, a: 1 }],
    ['#0B0E14', { r: 11, g: 14, b: 20, a: 1 }],
    ['#11223380', { r: 17, g: 34, b: 51, a: 128 / 255 }],
    ['#1238', { r: 17, g: 34, b: 51, a: 136 / 255 }],
    ['rgb(1, 2, 3)', { r: 1, g: 2, b: 3, a: 1 }],
    ['rgba(148, 163, 184, 0.07)', { r: 148, g: 163, b: 184, a: 0.07 }],
    ['rgba(255,255,255,0.13)', { r: 255, g: 255, b: 255, a: 0.13 }],
    ['rgb(10 20 30 / 50%)', { r: 10, g: 20, b: 30, a: 0.5 }],
    ['rgb(100%, 0%, 50%)', { r: 255, g: 0, b: 127.5, a: 1 }],
    ['  TRANSPARENT ', { r: 0, g: 0, b: 0, a: 0 }],
  ])('parses %s', (css, rgba) => {
    const c = parseColor(css);
    expect(c.r).toBeCloseTo(rgba.r, 10);
    expect(c.g).toBeCloseTo(rgba.g, 10);
    expect(c.b).toBeCloseTo(rgba.b, 10);
    expect(c.a).toBeCloseTo(rgba.a, 10);
  });

  it.each([
    'red',
    '#12',
    '#12345',
    '#ggg',
    'rgb(1,2)',
    'rgb(1,2,3,4,5)',
    'rgb(a,b,c)',
    'hsl(1,2%,3%)',
    'rgb(1 2 3 / 4 / 5)',
  ])('rejects %s with a KgdiffError', (css) => {
    expect(() => parseColor(css)).toThrow(KgdiffError);
    try {
      parseColor(css);
    } catch (e) {
      expect((e as KgdiffError).code).toBe('invalid-input');
    }
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for equal colors', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 10);
    expect(contrastRatio('#777', '#777')).toBe(1);
  });

  it('matches the WCAG reference value for #767676 on white (4.54)', () => {
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });

  it('composites a translucent foreground over the background first', () => {
    // 50% white over black composites (in sRGB, like browsers) to #808080, not white.
    const half = contrastRatio('rgba(255,255,255,0.5)', '#000');
    expect(half).toBeCloseTo(contrastRatio('#808080', '#000'), 1);
    expect(half).toBeLessThan(21);
    expect(contrastRatio('rgba(0,0,0,0)', '#123456')).toBe(1);
  });

  it('composites a translucent background over white', () => {
    expect(contrastRatio('#000', 'rgba(0,0,0,0)')).toBeCloseTo(21, 10);
  });
});

describe('composition and formatting', () => {
  it('composites source-over', () => {
    const c = composite({ r: 255, g: 0, b: 0, a: 0.5 }, { r: 0, g: 0, b: 255, a: 1 });
    expect(c).toEqual({ r: 127.5, g: 0, b: 127.5, a: 1 });
    expect(composite({ r: 1, g: 1, b: 1, a: 0 }, { r: 0, g: 0, b: 0, a: 0 }).a).toBe(0);
  });

  it('computes relative luminance', () => {
    expect(relativeLuminance(parseColor('#fff'))).toBeCloseTo(1, 10);
    expect(relativeLuminance(parseColor('#000'))).toBe(0);
  });

  it('formats opaque colors as uppercase hex and translucent ones as rgba()', () => {
    expect(formatColor({ r: 11, g: 14, b: 20, a: 1 })).toBe('#0B0E14');
    expect(formatColor({ r: 52, g: 211, b: 153, a: 0.16 })).toBe('rgba(52, 211, 153, 0.16)');
    expect(formatColor({ r: 300, g: -4, b: 12.6, a: 1 })).toBe('#FF000D');
  });

  it('mixes in premultiplied sRGB', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#FF0000', 'rgba(0,0,255,0)', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(mix('#123456', '#ABCDEF', 0)).toBe('#123456');
    expect(mix('#123456', '#ABCDEF', 2)).toBe('#ABCDEF');
  });

  it('replaces alpha and desaturates toward equal-luma gray', () => {
    expect(withAlpha('#34D399', 0.16)).toBe('rgba(52, 211, 153, 0.16)');
    expect(desaturate('#FF0000', 0)).toBe('#FF0000');
    const gray = parseColor(desaturate('#FF0000', 1));
    expect(gray.r).toBe(gray.g);
    expect(gray.g).toBe(gray.b);
  });
});

describe('color ramps', () => {
  it('interpolates with exact token endpoints', () => {
    const ramp = colorRamp('#0B0E14', '#34D399');
    expect(ramp).toHaveLength(RAMP_STEPS);
    expect(ramp[0]).toBe('#0B0E14');
    expect(ramp[RAMP_STEPS - 1]).toBe('#34D399');
    expect(rampAt(ramp, -1)).toBe('#0B0E14');
    expect(rampAt(ramp, 0)).toBe('#0B0E14');
    expect(rampAt(ramp, 1)).toBe('#34D399');
    expect(rampAt(ramp, 0.5)).toBe(ramp[(RAMP_STEPS - 1) / 2]);
    expect(Object.isFrozen(ramp)).toBe(true);
  });

  it('caches ramps by endpoint pair', () => {
    const cache = new RampCache();
    expect(cache.get('#000', '#fff')).toBe(cache.get('#000', '#fff'));
    expect(cache.get('#000', '#fff')).not.toBe(cache.get('#fff', '#000'));
  });
});
