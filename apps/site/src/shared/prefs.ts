/**
 * Site preferences: language (English default; 中文 via the toggle, `?lang=zh` or a Chinese
 * `navigator.language`) and theme (dark default, light on request). The inline script in each
 * page's <head> applies the same rules before first paint; this module owns them afterwards.
 */
import type { Locale } from '@kgdiff/core';

export type SiteTheme = 'dark' | 'light';

const LOCALE_KEY = 'kgdiff-site-locale';
const THEME_KEY = 'kgdiff-site-theme';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode / blocked storage: the choice just is not remembered.
  }
}

/** `zh`, `zh-CN`, `zh-Hans`… → `zh-CN`; `en…` → `en`; anything else → null. */
export function parseLocale(value: string | null | undefined): Locale | null {
  const v = (value ?? '').trim().toLowerCase();
  if (v.startsWith('zh')) return 'zh-CN';
  if (v.startsWith('en')) return 'en';
  return null;
}

/** The language the browser asks for (Chinese → `zh-CN`, anything else → `en`). */
export function browserLocale(): Locale {
  return /^zh/i.test(navigator.language || '') ? 'zh-CN' : 'en';
}

export function initialLocale(): Locale {
  const fromUrl = parseLocale(new URLSearchParams(location.search).get('lang'));
  if (fromUrl) return fromUrl;
  return parseLocale(read(LOCALE_KEY)) ?? browserLocale();
}

/**
 * The `lang` URL parameter for `locale`: present only when it differs from the browser's
 * language, so a shared link opens in the language the sender saw.
 */
export function langParam(locale: Locale): string | null {
  if (locale === browserLocale()) return null;
  return locale === 'zh-CN' ? 'zh' : 'en';
}

export function initialTheme(): SiteTheme {
  const fromUrl = new URLSearchParams(location.search).get('theme');
  if (fromUrl === 'light' || fromUrl === 'dark') return fromUrl;
  return read(THEME_KEY) === 'light' ? 'light' : 'dark';
}

export function storeLocale(locale: Locale): void {
  write(LOCALE_KEY, locale);
}

export function storeTheme(theme: SiteTheme): void {
  write(THEME_KEY, theme);
}

export function applyTheme(theme: SiteTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // The canvas color of the theme (a token inlined from @kgdiff/scene getTheme()).
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

/** Keep `?lang=` in the address bar in sync, so a copied URL opens in the same language. */
export function syncLangParam(locale: Locale): void {
  const url = new URL(location.href);
  const lang = langParam(locale);
  if (lang) url.searchParams.set('lang', lang);
  else url.searchParams.delete('lang');
  if (url.href !== location.href) history.replaceState(history.state, '', url);
}

/** `href` with the current language carried over (`?lang=zh`). */
export function localizedHref(href: string, locale: Locale): string {
  const url = new URL(href, location.href);
  const lang = langParam(locale);
  if (lang) url.searchParams.set('lang', lang);
  else url.searchParams.delete('lang');
  return url.origin === location.origin ? url.pathname + url.search + url.hash : url.href;
}
