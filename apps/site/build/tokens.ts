/**
 * The site's design tokens, read from `@kgdiff/scene` `getTheme()` at build time (runs in Node
 * through Vite's module runner, see `plugins.ts`), so the pages always share the viewer's
 * colors, fonts and motion — including contrast fixes made in the scene package. Emitted as
 * CSS custom properties and inlined into each page's <head> (no extra request, no flash).
 */
import { type ChangeFamily, getTheme, type Theme } from '@kgdiff/scene';

const FAMILIES: readonly ChangeFamily[] = ['added', 'removed', 'content', 'structure', 'identity'];

function colorVars(t: Theme): Record<string, string> {
  const vars: Record<string, string> = {
    '--bg': t.canvas.background,
    '--grid': t.canvas.grid,
    '--panel': t.surface.panel,
    '--raised': t.surface.raised,
    '--overlay': t.surface.overlay,
    '--border': t.surface.border,
    '--border-strong': t.surface.borderStrong,
    '--control-border': t.surface.controlBorder,
    '--shadow': t.surface.shadow,
    '--text': t.text.primary,
    '--text-2': t.text.secondary,
    '--text-3': t.text.muted,
    '--accent': t.accent.base,
    '--accent-strong': t.accent.strong,
    '--accent-soft': t.accent.soft,
    '--accent-text': t.accent.text,
    '--neutral-node': t.neutral.node,
    '--neutral-stroke': t.neutral.nodeStroke,
    '--neutral-edge': t.neutral.edge,
    '--neutral-label': t.neutral.label,
  };
  for (const f of FAMILIES) {
    const c = t.family[f];
    vars[`--${f}`] = c.base;
    vars[`--${f}-strong`] = c.strong;
    vars[`--${f}-soft`] = c.soft;
    vars[`--${f}-text`] = c.text;
  }
  return vars;
}

const block = (selector: string, vars: Record<string, string>): string =>
  `${selector}{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')}}`;

/** CSS for both themes (`:root[data-theme]`) plus fonts and motion. */
export function tokensCss(): string {
  const dark = getTheme('dark');
  const light = getTheme('light');
  const [x1, y1, x2, y2] = dark.motion.easing;
  return [
    '/* kgdiff tokens: generated from @kgdiff/scene getTheme() */',
    block(":root,:root[data-theme='dark']", colorVars(dark)),
    block(":root[data-theme='light']", colorVars(light)),
    block(':root', {
      '--font': dark.font.family,
      '--font-display': dark.font.family.replace(/(["'])SF Pro Text\1/, '$1SF Pro Display$1'),
      '--mono': dark.font.mono,
      '--fast': `${dark.motion.fast}ms`,
      '--base': `${dark.motion.base}ms`,
      '--ease': `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`,
    }),
  ].join('\n');
}

/** Canvas backgrounds, for `<meta name="theme-color">`. */
export function themeColors(): { readonly dark: string; readonly light: string } {
  return {
    dark: getTheme('dark').canvas.background,
    light: getTheme('light').canvas.background,
  };
}
