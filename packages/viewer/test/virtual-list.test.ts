import type { GraphInput } from '@kgdiff/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { KgdiffViewer } from '../src/element.js';
import '../src/index.js';
import { setRenderBackend } from '../src/renderer-port.js';
import { ROW_SLOT } from '../src/ui/sidebar.js';
import { mockBackend, tick } from './support.js';

/** 2,000 isolated added nodes: one `add` hunk each. */
function many(n: number): { before: GraphInput; after: GraphInput } {
  const anchor = { id: 'root', label: 'Root' };
  const nodes = [anchor];
  for (let i = 0; i < n; i++)
    nodes.push({ id: `n${String(i).padStart(4, '0')}`, label: `Node ${i}` });
  return { before: { nodes: [anchor], edges: [] }, after: { nodes, edges: [] } };
}

beforeEach(() => setRenderBackend(mockBackend()));
afterEach(() => {
  document.body.textContent = '';
  setRenderBackend(null);
});

describe('change list virtualization', () => {
  it('renders only a window of rows for 2,000 hunks and follows scrolling and selection', async () => {
    const el = document.createElement('kgdiff-viewer') as unknown as KgdiffViewer;
    document.body.appendChild(el);
    await el.load({ ...many(2000), layout: { iterations: 1 } });
    await tick();
    const list = el.shadowRoot?.querySelector('.list') as HTMLElement;
    expect(el.reviewState().total).toBe(2000);
    const rows = () => list.querySelectorAll('.row').length;
    expect(rows()).toBeGreaterThan(5);
    expect(rows()).toBeLessThan(40);
    const inner = list.querySelector('.list-inner') as HTMLElement;
    expect(Number.parseFloat(inner.style.height)).toBeGreaterThan(2000 * ROW_SLOT);

    el.controller.last();
    await tick(40);
    const selected = list.querySelector('.row[aria-selected="true"]');
    expect(selected).not.toBeNull();
    expect(rows()).toBeLessThan(40);
    expect(list.getAttribute('aria-activedescendant')).toBe(selected?.id);
  }, 30_000);
});
