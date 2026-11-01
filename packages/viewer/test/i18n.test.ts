import { describe, expect, it } from 'vitest';
import {
  detectLocale,
  formatNumber,
  MESSAGES,
  type MessageKey,
  normalizeLocale,
  plural,
  quote,
  translate,
} from '../src/i18n.js';

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();

describe('i18n', () => {
  it('has every key in both locales, non-empty, with the same placeholders', () => {
    const en = MESSAGES.en;
    const zh = MESSAGES['zh-CN'];
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(en[key].trim(), key).not.toBe('');
      expect(zh[key].trim(), key).not.toBe('');
      expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('every plural key has .one and .other forms', () => {
    for (const key of Object.keys(MESSAGES.en)) {
      if (key.endsWith('.one')) expect(MESSAGES.en).toHaveProperty(key.replace(/\.one$/, '.other'));
    }
  });

  it('quotes names the way each locale does', () => {
    expect(quote('x', 'en')).toBe('“x”');
    expect(quote('x', 'zh-CN')).toBe('「x」');
    expect(translate('zh-CN', 'sidebar.noResults', { q: 'abc' })).toBe('没有与「abc」匹配的节点');
    expect(translate('en', 'sidebar.noResults', { q: 'abc' })).toBe('No nodes match “abc”');
    for (const text of Object.values(MESSAGES['zh-CN'])) expect(text).not.toMatch(/[“”]/);
  });

  it('interpolates and formats numbers per locale', () => {
    expect(translate('en', 'review.progress', { done: 1234, total: 2000 })).toBe(
      '1,234 of 2,000 reviewed',
    );
    expect(translate('zh-CN', 'review.progress', { done: 7, total: 23 })).toBe('已审阅 7 / 23');
    expect(translate('en', 'replay.position', { i: 3 })).toBe('3 / {n}');
    expect(formatNumber(1490, 'en')).toBe('1,490');
  });

  it('picks plural forms', () => {
    expect(plural('en', 'tooltip.relations', 1)).toBe('1 relation');
    expect(plural('en', 'tooltip.relations', 2)).toBe('2 relations');
    expect(plural('zh-CN', 'tooltip.relations', 2)).toBe('2 条关系');
  });

  it('normalizes locales', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(normalizeLocale('EN-gb')).toBe('en');
    expect(normalizeLocale('fr')).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
    expect(['en', 'zh-CN']).toContain(detectLocale());
  });
});
