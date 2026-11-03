/**
 * What UI components share: the controller, the current translator and element-level actions
 * (attribute-reflected preferences, sidebar, popovers).
 */
import type { AttrValue, HunkKind, Locale } from '@kgdiff/core';
import type { ChangeFamily, PaletteName, SceneHunk } from '@kgdiff/scene';
import type { ViewerController } from '../controller.js';
import type { Translator } from '../i18n.js';
import type { ThemePreference, ViewerMode } from '../index.js';

export interface UiContext {
  readonly controller: ViewerController;
  readonly tr: () => Translator;
  setMode(mode: ViewerMode): void;
  /** Toggle the `changes` scope (explains itself when it is locked). */
  toggleScope(): void;
  setThemePreference(pref: ThemePreference): void;
  setPalette(palette: PaletteName): void;
  setLocale(locale: Locale): void;
  toggleSidebar(open?: boolean): void;
  sidebarOpen(): boolean;
  toggleMenu(open?: boolean): void;
  openHelp(): void;
  focusSearch(): void;
  /** Root of the shadow tree (for focus management). */
  readonly root: ShadowRoot;
}

/** One-character glyph of a hunk (docs/interaction.md §Change list): `+ − ~ ⇄ ⊕ ⑂`. */
export function hunkGlyph(kind: HunkKind, family: ChangeFamily): string {
  switch (kind) {
    case 'add':
      return '+';
    case 'remove':
      return '−';
    case 'merge':
      return '⊕';
    case 'split':
      return '⑂';
    case 'relations':
      return '⇄';
    case 'modify':
      return family === 'structure' ? '⇄' : family === 'identity' ? '≡' : '~';
    default:
      return '~';
  }
}

export function sceneHunkGlyph(h: SceneHunk): string {
  return hunkGlyph(h.kind, h.family);
}

/** Single-line display form of an attribute value. */
export function formatValue(value: AttrValue | undefined): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => formatValue(v as AttrValue)).join(', ');
  return JSON.stringify(value);
}

/** Items of a list-like value (arrays of scalars), else null. */
export function listItems(value: AttrValue | undefined): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const v of value as readonly AttrValue[]) {
    if (typeof v === 'object' && v !== null) return null;
    out.push(formatValue(v));
  }
  return out;
}
