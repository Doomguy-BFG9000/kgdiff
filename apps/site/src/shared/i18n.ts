/**
 * DOM translation. English lives in the HTML (crawlable, works without JavaScript); other
 * languages are dictionaries keyed like the markup:
 *
 * - `data-i18n="key"`          → textContent
 * - `data-i18n-html="key"`     → innerHTML (trusted, static dictionary strings only)
 * - `data-i18n-attr="a=k;b=k2"` → attributes
 *
 * The English originals are captured the first time an element is translated, so switching
 * back never needs an English dictionary.
 */
import type { Locale } from '@kgdiff/core';

export type Dictionary = Readonly<Record<string, string>>;

const textOriginals = new WeakMap<Element, string>();
const htmlOriginals = new WeakMap<Element, string>();
const attrOriginals = new WeakMap<Element, Map<string, string | null>>();

function parseAttrSpec(spec: string): [attr: string, key: string][] {
  const out: [string, string][] = [];
  for (const part of spec.split(';')) {
    const [attr, key] = part.split('=').map((s) => s.trim());
    if (attr && key) out.push([attr, key]);
  }
  return out;
}

/** Translate every marked element under `root` (the document by default). */
export function translateDom(locale: Locale, dict: Dictionary, root: ParentNode = document): void {
  const en = locale === 'en';
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n') ?? '';
    if (!textOriginals.has(el)) textOriginals.set(el, el.textContent ?? '');
    const next = en ? textOriginals.get(el) : (dict[key] ?? textOriginals.get(el));
    if (next !== undefined && el.textContent !== next) el.textContent = next;
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    const key = el.getAttribute('data-i18n-html') ?? '';
    if (!htmlOriginals.has(el)) htmlOriginals.set(el, el.innerHTML);
    const next = en ? htmlOriginals.get(el) : (dict[key] ?? htmlOriginals.get(el));
    if (next !== undefined && el.innerHTML !== next) el.innerHTML = next;
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    let originals = attrOriginals.get(el);
    if (!originals) {
      originals = new Map();
      attrOriginals.set(el, originals);
    }
    for (const [attr, key] of parseAttrSpec(el.getAttribute('data-i18n-attr') ?? '')) {
      if (!originals.has(attr)) originals.set(attr, el.getAttribute(attr));
      const original = originals.get(attr) ?? null;
      const next = en ? original : (dict[key] ?? original);
      if (next === null) el.removeAttribute(attr);
      else el.setAttribute(attr, next);
    }
  }
}

/** Set `<html lang>`, the document title and description, and reveal pending text. */
export function applyDocumentLocale(
  locale: Locale,
  meta: { readonly title: string; readonly description: string },
): void {
  const html = document.documentElement;
  html.lang = locale;
  html.removeAttribute('data-i18n-pending');
  document.title = meta.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description);
}

/** `{name}` placeholders. */
export function format(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) =>
    values[k] !== undefined ? String(values[k]) : m,
  );
}
