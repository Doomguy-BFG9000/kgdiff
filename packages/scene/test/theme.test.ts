import { KgdiffError } from '@kgdiff/core';
import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, formatColor, parseColor } from '../src/color.js';
import { FONT_FAMILY, FONT_MONO, getTheme } from '../src/theme.js';
import type { ChangeFamily, PaletteName, Theme, ThemeName } from '../src/types.js';

const COMBOS: readonly [ThemeName, PaletteName][] = [
  ['dark', 'default'],
  ['dark', 'colorblind'],
  ['light', 'default'],
  ['light', 'colorblind'],
];
const FAMILIES: readonly ChangeFamily[] = ['added', 'removed', 'content', 'structure', 'identity'];

/** Fails with the token pair and the measured ratio in the message. */
function assertContrast(theme: Theme, label: string, fg: string, bg: string, min: number): void {
  const ratio = contrastRatio(fg, bg);
  if (ratio < min) {
    throw new Error(
      `${theme.name}/${theme.palette}: ${label} ${fg} on ${bg} is ${ratio.toFixed(3)}:1, needs ≥ ${min}:1`,
    );
  }
}

describe.each(COMBOS)(
  '%s / %s contrast (docs/visual-language.md §Color tokens)',
  (name, palette) => {
    const theme = getTheme(name, palette);
    const surfaces: [string, string][] = [
      ['canvas.background', theme.canvas.background],
      ['surface.panel', theme.surface.panel],
      ['surface.raised', theme.surface.raised],
    ];

    it.each(FAMILIES)('family.%s.base is ≥ 3:1 against canvas.background', (family) => {
      assertContrast(
        theme,
        `family.${family}.base`,
        theme.family[family].base,
        theme.canvas.background,
        3,
      );
    });

    it.each(FAMILIES)('family.%s.text is ≥ 4.5:1 against panel, raised and canvas', (family) => {
      for (const [surface, bg] of surfaces) {
        assertContrast(
          theme,
          `family.${family}.text vs ${surface}`,
          theme.family[family].text,
          bg,
          4.5,
        );
      }
    });

    it.each(FAMILIES)(
      'family.%s.text is ≥ 4.5:1 over its own soft tint (badges, chips)',
      (family) => {
        const { text, soft } = theme.family[family];
        for (const [surface, bg] of surfaces) {
          const tinted = formatColor(composite(parseColor(soft), parseColor(bg)));
          assertContrast(theme, `family.${family}.text vs soft on ${surface}`, text, tinted, 4.5);
        }
      },
    );

    it('text.primary, text.secondary and text.muted are ≥ 4.5:1 against panel, raised and canvas', () => {
      for (const [surface, bg] of surfaces) {
        assertContrast(theme, `text.primary vs ${surface}`, theme.text.primary, bg, 4.5);
        assertContrast(theme, `text.secondary vs ${surface}`, theme.text.secondary, bg, 4.5);
        assertContrast(theme, `text.muted vs ${surface}`, theme.text.muted, bg, 4.5);
      }
    });

    it('control borders and the accent (2 px focus indicator) are ≥ 3:1 against panel, raised and canvas', () => {
      for (const [surface, bg] of surfaces) {
        assertContrast(
          theme,
          `surface.controlBorder vs ${surface}`,
          theme.surface.controlBorder,
          bg,
          3,
        );
        assertContrast(theme, `accent.base vs ${surface}`, theme.accent.base, bg, 3);
      }
    });

    it('neutral labels and accent text are readable on the canvas (≥ 4.5:1)', () => {
      assertContrast(theme, 'neutral.label', theme.neutral.label, theme.canvas.background, 4.5);
      assertContrast(theme, 'accent.text', theme.accent.text, theme.canvas.background, 4.5);
    });

    it('reports a failing pair loudly', () => {
      expect(() =>
        assertContrast(theme, 'probe', theme.canvas.background, theme.canvas.background, 3),
      ).toThrow(/probe .* is 1\.000:1, needs ≥ 3:1/);
    });
  },
);

describe('getTheme', () => {
  it('returns the exact dark tokens', () => {
    const t = getTheme('dark');
    expect(t.name).toBe('dark');
    expect(t.palette).toBe('default');
    expect(t.canvas).toEqual({ background: '#0B0E14', grid: 'rgba(148, 163, 184, 0.07)' });
    expect(t.surface).toEqual({
      panel: '#11151D',
      raised: '#171C26',
      overlay: 'rgba(17, 21, 29, 0.78)',
      border: 'rgba(255,255,255,0.07)',
      borderStrong: 'rgba(255,255,255,0.13)',
      controlBorder: '#5E687C',
      shadow: '0 8px 32px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.04) inset',
    });
    // muted: one lightness step up from the spec's #737D8F (4.11:1 on raised).
    expect(t.text).toEqual({ primary: '#E7EBF3', secondary: '#A6AFBF', muted: '#7A8495' });
    expect(t.accent).toEqual({
      base: '#7C9CFF',
      strong: '#A3BAFF',
      soft: 'rgba(124,156,255,0.16)',
      text: '#A9BEFF',
    });
    expect(t.neutral).toEqual({
      node: '#4B5568',
      nodeStroke: '#5E687C',
      edge: '#323A4A',
      label: '#7A8495',
    });
    expect(t.family.added).toEqual({
      base: '#34D399',
      strong: '#6EE7B7',
      soft: 'rgba(52,211,153,0.16)',
      text: '#6EE7B7',
    });
    expect(t.family.identity).toEqual({
      base: '#A78BFA',
      strong: '#C4B5FD',
      soft: 'rgba(167,139,250,0.17)',
      text: '#C4B5FD',
    });
    expect(t.glow).toBe(true);
  });

  it('returns the light tokens, with the one contrast-driven adjustment', () => {
    const t = getTheme('light');
    expect(t.canvas.background).toBe('#F7F8FA');
    expect(t.surface.panel).toBe('#FFFFFF');
    // Contrast-driven: muted (spec #7B8597, 3.50:1), added text over its tint (spec #15803D).
    expect(t.text).toEqual({ primary: '#0F172A', secondary: '#475569', muted: '#687284' });
    expect(contrastRatio('#7B8597', '#F7F8FA')).toBeLessThan(4.5);
    expect(t.family.added.text).toBe('#147A3A');
    expect(t.family.added.strong).toBe('#15803D');
    expect(t.surface.controlBorder).toBe('#8690A3');
    expect(t.family.structure).toEqual({
      base: '#0284C7',
      strong: '#0369A1',
      soft: 'rgba(2,132,199,0.10)',
      text: '#075985',
    });
    // Spec #D97706 measures 2.998:1 on #F7F8FA; one step darker is the closest passing value.
    expect(contrastRatio('#D97706', '#F7F8FA')).toBeLessThan(3);
    expect(t.family.content.base).toBe('#D87506');
    expect(t.glow).toBe(false);
  });

  it('replaces family colors with the Okabe–Ito palette and derives strong / soft', () => {
    const dark = getTheme('dark', 'colorblind');
    expect(dark.family.added.base).toBe('#56B4E9');
    expect(dark.family.added.text).toBe('#8FD0F5');
    expect(dark.family.added.strong).toBe('#8FD0F5');
    expect(dark.family.added.soft).toBe('rgba(86, 180, 233, 0.16)');
    const light = getTheme('light', 'colorblind');
    expect(light.family.removed).toMatchObject({
      base: '#D55E00',
      text: '#A84A00',
      strong: '#BF5400',
    });
    // Everything but the families is shared with the default palette.
    expect(light.text).toEqual(getTheme('light').text);
    expect(light.neutral).toEqual(getTheme('light').neutral);
  });

  it('shares typography and motion tokens', () => {
    for (const [name, palette] of COMBOS) {
      const t = getTheme(name, palette);
      expect(t.font).toEqual({
        family: FONT_FAMILY,
        mono: FONT_MONO,
        size: 12,
        weightRegular: 400,
        weightStrong: 600,
      });
      expect(t.motion).toEqual({ fast: 120, base: 220, slow: 420, easing: [0.2, 0, 0, 1] });
    }
    expect(FONT_FAMILY).toContain('"PingFang SC"');
    expect(FONT_FAMILY.startsWith('Inter, ')).toBe(true);
    expect(FONT_MONO.startsWith('"JetBrains Mono"')).toBe(true);
  });

  it('is cached and deeply frozen', () => {
    const t = getTheme('dark', 'default');
    expect(getTheme('dark')).toBe(t);
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t.family.added)).toBe(true);
    expect(Object.isFrozen(t.motion.easing)).toBe(true);
  });

  it('rejects unknown names', () => {
    expect(() => getTheme('sepia' as ThemeName)).toThrow(KgdiffError);
    expect(() => getTheme('dark', 'mono' as PaletteName)).toThrow(/Unknown palette/);
  });
});
