import { KgdiffError } from '@kgdiff/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { KgdiffViewer } from '../src/element.js';
import { defineViewer, type KgdiffViewerElement } from '../src/index.js';
import { setRenderBackend } from '../src/renderer-port.js';
import { mockBackend, tick, until, zoo } from './support.js';

let backend: ReturnType<typeof mockBackend>;

function mount(attrs: Record<string, string> = {}): KgdiffViewer {
  const el = document.createElement('kgdiff-viewer') as unknown as KgdiffViewer;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}

async function loaded(attrs: Record<string, string> = {}): Promise<KgdiffViewer> {
  const el = mount(attrs);
  await el.load(zoo());
  await tick();
  return el;
}

const $ = <T extends Element = HTMLElement>(el: Element, selector: string): T => {
  const found = el.shadowRoot?.querySelector<T>(selector);
  if (!found) throw new Error(`${selector} not found`);
  return found;
};

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  backend = mockBackend();
  setRenderBackend(backend);
  localStorage.clear();
});

afterEach(() => {
  document.body.textContent = '';
  setRenderBackend(null);
  history.replaceState(null, '', '/');
});

describe('registration', () => {
  it('defines <kgdiff-viewer> on import and is idempotent', () => {
    const ctor = customElements.get('kgdiff-viewer');
    expect(ctor).toBeDefined();
    defineViewer();
    defineViewer('kgdiff-viewer');
    expect(customElements.get('kgdiff-viewer')).toBe(ctor);
  });

  it('can be registered under another tag name', () => {
    defineViewer('my-diff-viewer');
    defineViewer('my-diff-viewer');
    const el = document.createElement('my-diff-viewer') as KgdiffViewerElement;
    expect(typeof el.load).toBe('function');
    expect(el.mode).toBe('overlay');
  });

  it('renders an open shadow root with the empty state before anything is loaded', () => {
    const el = mount();
    expect(el.shadowRoot).not.toBeNull();
    expect($(el, '.state').textContent).toContain('Nothing to compare yet');
    expect(backend.renderers).toHaveLength(1);
  });

  it('applies properties set before the element was upgraded', async () => {
    const el = document.createElement('div') as unknown as Record<string, unknown>;
    expect(el).toBeDefined();
    const pre = document.createElement('kgdiff-viewer');
    document.body.appendChild(pre);
    expect((pre as KgdiffViewerElement).mode).toBe('overlay');
  });
});

describe('attributes and properties', () => {
  it('reflects mode, theme, palette and locale both ways', async () => {
    const el = mount({ locale: 'zh' });
    expect(el.locale).toBe('zh-CN');
    el.mode = 'swipe';
    expect(el.getAttribute('mode')).toBe('swipe');
    el.setAttribute('mode', 'replay');
    expect(el.mode).toBe('replay');
    // Invalid values fall back to the default (and are no longer explicit).
    el.setAttribute('mode', 'bogus');
    expect(el.mode).toBe('overlay');
    el.mode = 'replay';
    el.theme = 'light';
    expect(el.getAttribute('theme')).toBe('light');
    el.setAttribute('theme', 'dark');
    expect(el.theme).toBe('dark');
    el.palette = 'colorblind';
    expect(el.getAttribute('palette')).toBe('colorblind');
    el.locale = 'en';
    expect(el.getAttribute('locale')).toBe('en');
    el.theme = 'neon' as never;
    expect(el.theme).toBe('auto');
    expect(el.hasAttribute('theme')).toBe(false);
    el.setAttribute('theme', 'dark');
    expect(el.theme).toBe('dark');
    await tick();
    expect(backend.last().theme.palette).toBe('colorblind');
  });

  it('opens and closes the sidebar through the attribute and the \\ key', async () => {
    const el = await loaded();
    const sidebar = $(el, '.sidebar');
    expect(sidebar.dataset.open).toBe('true');
    el.setAttribute('sidebar', 'closed');
    expect(sidebar.dataset.open).toBe('false');
    press(el, '\\');
    expect(el.getAttribute('sidebar')).toBe('open');
  });
});

describe('loading', () => {
  it('shows loading steps, then the graph, and fires kgdiff-ready with stats', async () => {
    const el = mount();
    const events: string[] = [];
    el.addEventListener('kgdiff-ready', (e) => {
      events.push(`ready:${(e as CustomEvent).detail.stats.nodes.added}`);
    });
    const done = el.load(zoo());
    await tick();
    expect($(el, '.state').textContent).toContain('Preparing the diff');
    await done;
    await tick();
    expect(events).toEqual(['ready:1']);
    expect($(el, '.state').hidden).toBe(true);
    expect(backend.last().frameCount).toBeGreaterThan(0);
    expect($(el, '.list').querySelectorAll('.row').length).toBe(el.reviewState().total);
    expect($(el, '.versions').textContent).toContain('Zoo');
    expect(backend.last().canvas.getAttribute('aria-label')).toMatch(
      /Graph diff\. Before: 6 nodes/,
    );
  });

  it('rejects bad input, shows the error state and fires kgdiff-error', async () => {
    const el = mount();
    const errors: Error[] = [];
    el.addEventListener('kgdiff-error', (e) => errors.push((e as CustomEvent).detail.error));
    await expect(
      el.load({ before: { nodes: 'x' } as never, after: zoo().after }),
    ).rejects.toBeInstanceOf(KgdiffError);
    await tick();
    expect(errors).toHaveLength(1);
    expect($(el, '.state-card.error').textContent).toContain('could not be shown');
    expect($(el, '.state-card details pre').textContent).toContain('invalid-input');
  });

  it('shows the identical state for equal graphs', async () => {
    const el = mount();
    const { before } = zoo();
    await el.load({ before, after: before });
    await tick();
    expect($(el, '.state').textContent).toContain('No differences');
    expect($(el, '.state').textContent).toContain('Both versions have 6 nodes and 5 edges.');
  });

  it('exportDelta returns the delta and throws before loading', async () => {
    const el = mount();
    expect(() => el.exportDelta()).toThrow(KgdiffError);
    await el.load(zoo());
    expect(el.exportDelta().format).toBe('kgdiff.delta');
  });
});

describe('selection and events', () => {
  it('selectHunk / next / prev fire kgdiff-select and update the list and details', async () => {
    const el = await loaded();
    const selected: (string | null)[] = [];
    el.addEventListener('kgdiff-select', (e) => selected.push((e as CustomEvent).detail.hunk));
    el.selectHunk('modify:C');
    await tick();
    expect(selected).toEqual(['modify:C']);
    const row = $(el, '.row[aria-selected="true"]');
    expect(row.textContent).toContain('Renamed');
    expect($(el, '.list').getAttribute('aria-activedescendant')).toBe(row.id);
    const detail = $(el, '.detail');
    expect(detail.querySelector('.d-title')?.textContent).toContain('Cat');
    expect(detail.querySelector('del.hl')?.textContent).toBe('Cat');
    expect(detail.querySelector('ins.hl')?.textContent).toBe('Kitty');
    el.next();
    el.prev();
    expect(selected).toHaveLength(3);
    el.selectHunk(null);
    expect(selected.at(-1)).toBeNull();
  });

  it('shows word-level attribute diffs', async () => {
    const el = await loaded();
    el.selectHunk('modify:D');
    await tick();
    const table = $(el, '.detail table.attrs');
    expect(table.textContent).toContain('sound');
    expect(table.querySelector('del.hl')?.textContent?.trim()).toBe('woof');
    expect(table.querySelector('ins.hl')?.textContent?.trim()).toBe('loud');
  });

  it('marks hunks reviewed, persists it and fires kgdiff-review', async () => {
    const el = await loaded();
    const events: unknown[] = [];
    el.addEventListener('kgdiff-review', (e) => events.push((e as CustomEvent).detail));
    el.setReviewed('remove:E', true);
    await tick();
    expect(events).toEqual([
      { hunk: 'remove:E', reviewed: true, progress: { reviewed: ['remove:E'], total: 5 } },
    ]);
    expect($(el, '.progress').textContent).toContain('1 of 5 reviewed');
    const again = await loaded();
    expect(again.reviewState().reviewed).toEqual(['remove:E']);
  });

  it('announces navigation in a polite live region', async () => {
    const el = await loaded();
    el.next();
    await tick(60);
    const live = $(el, '[aria-live="polite"].sr-only');
    expect(live.textContent).toMatch(/^Change 1 of 5: /);
  });

  it('emits kgdiff-mode on mode changes', async () => {
    const el = await loaded();
    const modes: string[] = [];
    el.addEventListener('kgdiff-mode', (e) => modes.push((e as CustomEvent).detail.mode));
    el.mode = 'changes';
    el.play();
    expect(modes).toEqual(['changes', 'replay']);
    el.pause();
    await expect(el.fit()).resolves.toBeUndefined();
    expect(backend.last().camera.fits).toBe(1);
  });
});

describe('keyboard', () => {
  it('drives modes, navigation, review, theme and help', async () => {
    const el = await loaded();
    press(el, '2');
    expect(el.mode).toBe('swipe');
    press(el, 'ArrowRight', { shiftKey: true });
    expect(el.controller.split).toBeCloseTo(0.6);
    press(el, '1');
    press(el, 'j');
    expect(el.controller.selectedHunk).toBe(el.controller.list.order[0]);
    press(el, 'x');
    expect(el.reviewState().reviewed).toHaveLength(1);
    press(el, 't');
    expect(el.theme).toBe('light');
    press(el, '?');
    expect($(el, '.overlay-scrim').hidden).toBe(false);
    press(el.shadowRoot?.activeElement ?? el, 'Escape');
    expect($(el, '.overlay-scrim').hidden).toBe(true);
    press(el, 'Escape');
    expect(el.controller.selectedHunk).toBe(-1);
    press(el, '+');
    expect(backend.last().camera.zooms).toEqual([1.4]);
  });

  it('plays and steps the replay with space and arrows', async () => {
    const el = await loaded();
    press(el, '3');
    press(el, 'ArrowRight');
    expect(el.controller.clock?.position()).toBe(1);
    const e = press(el, ' ');
    expect(e.defaultPrevented).toBe(true);
    expect(el.controller.clock?.playing).toBe(true);
    press(el, ' ');
    expect(el.controller.clock?.playing).toBe(false);
  });

  it('ignores shortcuts while typing and focuses search with /', async () => {
    const el = await loaded();
    press(el, '/');
    const input = $<HTMLInputElement>(el, '.search input');
    expect(el.shadowRoot?.activeElement).toBe(input);
    press(input, '2');
    expect(el.mode).toBe('overlay');
    input.value = 'gecko';
    input.dispatchEvent(new Event('input'));
    const results = $(el, '#kg-results');
    expect(results.hidden).toBe(false);
    expect(results.textContent).toContain('Gecko');
    press(input, 'Enter');
    await tick();
    expect(el.controller.scene?.nodes[el.controller.selectedNode]?.id).toBe('G');
    expect(input.value).toBe('');
  });

  it('ignores document-level keys unless global-shortcuts is set, and never takes page keys', async () => {
    const a = await loaded();
    const b = await loaded();
    press(document.body, '2');
    expect(a.mode).toBe('overlay');
    expect(b.mode).toBe('overlay');
    b.setAttribute('global-shortcuts', '');
    press(document.body, '2');
    expect(a.mode).toBe('overlay');
    expect(b.mode).toBe('swipe');
    for (const key of ['ArrowDown', 'End', ' ', 'PageDown']) {
      const e = press(document.body, key);
      expect(e.defaultPrevented, key).toBe(false);
    }
    expect(b.controller.selectedHunk).toBe(-1);
  });

  it('takes keys while focus is inside, e.g. on the canvas after a click', async () => {
    const el = await loaded();
    const canvas = el.shadowRoot?.querySelector('.stage canvas') as HTMLCanvasElement;
    expect(canvas.tabIndex).toBe(0);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(el.shadowRoot?.activeElement).toBe(canvas);
    const e = press(canvas, 'ArrowDown');
    expect(e.defaultPrevented).toBe(true);
    expect(el.controller.selectedHunk).toBe(el.controller.list.order[0]);
  });
});

describe('sync-hash', () => {
  it('writes and reads #kgdiff deep links', async () => {
    history.replaceState(null, '', '#kgdiff=hunk:add%3AG;mode:changes');
    const el = await loaded({ 'sync-hash': '' });
    expect(el.mode).toBe('changes');
    expect(el.controller.scene?.hunks[el.controller.selectedHunk]?.id).toBe('add:G');
    el.selectHunk('remove:E');
    expect(location.hash).toBe('#kgdiff=hunk:remove%3AE;mode:changes');
    history.replaceState(null, '', '#kgdiff=hunk:modify%3AC;mode:swipe');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await until(() => el.mode === 'swipe');
    expect(el.controller.scene?.hunks[el.controller.selectedHunk]?.id).toBe('modify:C');
  });

  it('leaves the hash alone without the attribute', async () => {
    const el = await loaded();
    el.selectHunk('remove:E');
    expect(location.hash).toBe('');
  });
});

describe('lifecycle', () => {
  it('destroys the renderer on disconnect and recreates it on reconnect', async () => {
    const el = await loaded();
    const first = backend.last();
    el.remove();
    expect(first.destroyed).toBe(true);
    document.body.appendChild(el);
    await tick(20);
    expect(backend.last()).not.toBe(first);
    expect(backend.last().frameCount).toBeGreaterThan(0);
  });
});
