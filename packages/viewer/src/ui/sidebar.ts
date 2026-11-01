/**
 * Sidebar: "Changes" header with review progress, node search, family filter chips, the
 * phase-grouped change list (virtualized, sticky group headers, `listbox` with
 * `aria-activedescendant`) and the detail panel. Below 760 px it is a resizable bottom sheet.
 */
import type { SceneHunk } from '@kgdiff/scene';
import type { Topic } from '../controller.js';
import { attr, h, icon, replace, setText } from '../dom.js';
import { familyCounts, type ListItem } from '../list-model.js';
import type { SearchHit } from '../search.js';
import { FAMILIES } from '../styles.js';
import { sceneHunkGlyph, type UiContext } from './context.js';
import { Detail } from './detail.js';

/** Row slot and group-header heights (px); rows are 52 px tall inside a 56 px slot. */
export const ROW_SLOT = 56;
export const HEADER_SLOT = 32;
const OVERSCAN = 320;
const SEARCH_LIMIT = 50;

function itemHeight(item: ListItem): number {
  return item.kind === 'header' ? HEADER_SLOT : ROW_SLOT;
}

export class Sidebar {
  readonly el: HTMLElement;
  readonly detail: Detail;
  readonly #title: HTMLElement;
  readonly #count: HTMLElement;
  readonly #progress: HTMLElement;
  readonly #progressText: HTMLElement;
  readonly #progressBar: HTMLElement;
  readonly searchInput: HTMLInputElement;
  readonly #searchKbd: HTMLElement;
  readonly #searchClear: HTMLButtonElement;
  readonly #filters: HTMLElement;
  readonly #chips = new Map<string, HTMLButtonElement>();
  readonly #showAll: HTMLButtonElement;
  readonly list: HTMLElement;
  readonly #listInner: HTMLElement;
  /** Visually hidden group names the options are described by. */
  readonly #phases: HTMLElement = h('div', { class: 'sr-only' });
  readonly #sticky: HTMLElement;
  readonly #results: HTMLElement;
  readonly #handle: HTMLElement;
  #offsets: number[] = [];
  #rendered = new Map<number, HTMLElement>();
  #scrollQueued = false;
  #query = '';
  #hits: SearchHit[] = [];
  #activeHit = 0;

  readonly #ctx: UiContext;

  constructor(ctx: UiContext) {
    this.#ctx = ctx;
    const c = ctx.controller;
    this.#title = h('h2', { id: 'kg-changes-title' });
    this.#count = h('span', { class: 'count-badge' });
    this.#progressText = h('span');
    this.#progressBar = h('div');
    this.#progress = h(
      'div',
      { class: 'progress' },
      this.#progressText,
      h('span', { class: 'bar', 'aria-hidden': 'true' }, this.#progressBar),
    );
    this.searchInput = h('input', {
      type: 'search',
      autocomplete: 'off',
      spellcheck: 'false',
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': 'false',
      'aria-controls': 'kg-results',
      enterkeyhint: 'go',
    });
    this.#searchKbd = h('kbd', { 'aria-hidden': 'true', text: '/' });
    this.#searchClear = h(
      'button',
      { type: 'button', class: 'clear', hidden: true, onclick: () => this.#setQuery('', true) },
      icon('close'),
    );
    this.searchInput.addEventListener('input', () => this.#setQuery(this.searchInput.value));
    this.searchInput.addEventListener('keydown', (e) => this.#onSearchKey(e));
    this.searchInput.addEventListener('focus', () => this.#updateSearchChrome());
    this.searchInput.addEventListener('blur', () => this.#updateSearchChrome());
    this.#filters = h('div', { class: 'filters', role: 'group' });
    for (const f of FAMILIES) {
      const chip = h(
        'button',
        {
          type: 'button',
          class: 'fchip',
          'data-family': f,
          'aria-pressed': 'false',
          onclick: () => c.toggleFamily(f),
        },
        h('span', { class: 'dot', 'aria-hidden': 'true' }),
        h('span', { class: 'lbl' }),
        h('span', { class: 'n' }),
      );
      this.#chips.set(f, chip);
      this.#filters.appendChild(chip);
    }
    this.#showAll = h('button', {
      type: 'button',
      class: 'link-btn',
      hidden: true,
      onclick: () => c.setFamilies([]),
    });
    this.#filters.appendChild(this.#showAll);

    this.#listInner = h('div', { class: 'list-inner', role: 'presentation' });
    this.list = h(
      'div',
      {
        class: 'list scroll',
        role: 'listbox',
        tabindex: '0',
        'aria-labelledby': 'kg-changes-title',
        'aria-keyshortcuts': 'J K X Enter Home End',
      },
      this.#listInner,
    );
    this.list.addEventListener('scroll', () => this.#queueWindow(), { passive: true });
    this.list.addEventListener('click', (e) => this.#onListClick(e));
    this.list.addEventListener('dblclick', (e) => {
      const row = (e.target as Element).closest('.row');
      if (row) c.flyToSelection();
    });
    this.#sticky = h('div', { class: 'sticky', 'aria-hidden': 'true', hidden: true });
    this.#results = h('div', {
      class: 'results list scroll',
      id: 'kg-results',
      role: 'listbox',
      hidden: true,
    });
    this.#handle = h('div', {
      class: 'sheet-handle',
      role: 'separator',
      'aria-orientation': 'horizontal',
      tabindex: '0',
    });
    this.#bindSheet();
    this.detail = new Detail(ctx);
    const head = h(
      'div',
      { class: 'sb-head' },
      h('div', { class: 'sb-title' }, this.#title, this.#count, this.#progress),
      h(
        'div',
        { class: 'search' },
        icon('search'),
        this.searchInput,
        this.#searchKbd,
        this.#searchClear,
      ),
      this.#filters,
    );
    this.el = h(
      'aside',
      { class: 'sidebar', 'data-open': 'true' },
      h(
        'div',
        { class: 'sidebar-inner' },
        this.#handle,
        head,
        h('div', { class: 'list-wrap' }, this.#sticky, this.list, this.#results, this.#phases),
        this.detail.el,
      ),
    );
  }

  setOpen(open: boolean): void {
    attr(this.el, 'data-open', String(open));
    this.el.inert = !open;
  }

  update(topics: ReadonlySet<Topic>): void {
    const tr = this.#ctx.tr();
    const all = topics.has('status') || topics.has('data') || topics.has('locale');
    if (all) {
      attr(this.el, 'aria-label', tr.t('sidebar.label'));
      setText(this.#title, tr.t('sidebar.changes'));
      this.searchInput.placeholder = tr.t('sidebar.searchPlaceholder');
      attr(this.searchInput, 'aria-label', tr.t('sidebar.search'));
      attr(this.#searchClear, 'aria-label', tr.t('sidebar.searchClear'));
      attr(this.#filters, 'aria-label', tr.t('sidebar.filters'));
      attr(this.#handle, 'aria-label', tr.t('sidebar.sheet'));
      setText(this.#showAll, tr.t('sidebar.clearFilters'));
      this.searchInput.disabled = this.#ctx.controller.status !== 'ready';
      this.#renderChips();
      if (this.#query) this.#runSearch();
    }
    if (all || topics.has('filters')) {
      this.#renderChipState();
      this.#layoutList();
    }
    if (all || topics.has('review')) {
      this.#renderProgress();
      this.#refreshRows();
    }
    if (topics.has('selection')) {
      this.#refreshRows();
      this.#revealSelected();
    }
    this.detail.update(topics);
  }

  /** Move keyboard focus into the list (after choosing a search result). */
  focusList(): void {
    this.list.focus({ preventScroll: true });
  }

  focusSearch(): void {
    this.searchInput.focus();
    this.searchInput.select();
  }

  /** Esc inside the sidebar: clear the search first. Returns whether it handled the key. */
  escape(): boolean {
    if (this.#query) {
      this.#setQuery('', true);
      return true;
    }
    return false;
  }

  // ─── Header bits ─────────────────────────────────────────────────────────

  #renderChips(): void {
    const tr = this.#ctx.tr();
    const scene = this.#ctx.controller.scene;
    const counts = scene ? familyCounts(scene) : null;
    setText(this.#count, tr.num(scene?.hunks.length ?? 0));
    this.#count.hidden = !scene;
    this.#filters.hidden = !scene || scene.hunks.length === 0;
    for (const [f, chip] of this.#chips) {
      const n = counts ? counts[f as keyof typeof counts] : 0;
      setText(chip.querySelector('.lbl') as Element, tr.t(`family.${f as keyof typeof counts}`));
      setText(chip.querySelector('.n') as Element, tr.num(n));
      chip.hidden = n === 0;
      attr(chip, 'title', tr.t(`familyHint.${f as keyof typeof counts}`));
    }
  }

  #renderChipState(): void {
    const fams = this.#ctx.controller.families;
    for (const [f, chip] of this.#chips) {
      attr(chip, 'aria-pressed', String(fams.has(f as never)));
    }
    this.#showAll.hidden = fams.size === 0;
  }

  #renderProgress(): void {
    const tr = this.#ctx.tr();
    const state = this.#ctx.controller.reviewState();
    const done = state.reviewed.length;
    const total = state.total;
    this.#progress.hidden = total === 0;
    const complete = total > 0 && done === total;
    attr(this.#progress, 'data-complete', String(complete));
    setText(
      this.#progressText,
      complete ? tr.t('review.complete') : tr.t('review.progress', { done, total }),
    );
    this.#progressBar.style.transform = `scaleX(${total > 0 ? done / total : 0})`;
  }

  // ─── Virtual list ────────────────────────────────────────────────────────

  #layoutList(): void {
    const c = this.#ctx.controller;
    const tr = this.#ctx.tr();
    replace(
      this.#phases,
      c.list.items.map((it) =>
        it.kind === 'header'
          ? h('span', {
              id: `kg-phase-${it.phase}`,
              text: `${tr.t(`phase.${it.phase}`)} (${tr.num(it.count)})`,
            })
          : null,
      ),
    );
    for (const el of this.#rendered.values()) el.remove();
    this.#rendered.clear();
    const items = c.list.items;
    this.#offsets = new Array(items.length);
    let y = 0;
    for (let i = 0; i < items.length; i++) {
      this.#offsets[i] = y;
      y += itemHeight(items[i] as ListItem);
    }
    this.#listInner.style.height = `${y + 8}px`;
    this.#renderEmpty();
    this.renderWindow();
  }

  #renderEmpty(): void {
    const c = this.#ctx.controller;
    const tr = this.#ctx.tr();
    const existing = this.#listInner.querySelector('.list-empty, .skeleton');
    existing?.remove();
    if (c.status === 'loading' || c.status === 'idle') {
      const sk = h('div', { class: 'skeleton', 'aria-hidden': 'true' });
      if (c.status === 'loading') {
        for (let i = 0; i < 6; i++) {
          sk.appendChild(
            h(
              'div',
              { class: 'skeleton-row shimmer' },
              h('span', { class: 'g' }),
              h('span', { class: 'b' }),
            ),
          );
        }
      }
      this.#listInner.appendChild(sk);
      return;
    }
    if (c.status !== 'ready' || c.list.items.length > 0) return;
    const filtered = c.families.size > 0 && c.hunkCount > 0;
    this.#listInner.appendChild(
      h(
        'div',
        { class: 'list-empty' },
        icon(filtered ? 'search' : 'check-circle'),
        h('span', { text: tr.t(filtered ? 'sidebar.filteredEmpty' : 'sidebar.noChanges') }),
        filtered
          ? h('button', {
              type: 'button',
              class: 'btn',
              text: tr.t('sidebar.clearFilters'),
              onclick: () => c.setFamilies([]),
            })
          : null,
      ),
    );
  }

  #queueWindow(): void {
    if (this.#scrollQueued) return;
    this.#scrollQueued = true;
    requestAnimationFrame(() => {
      this.#scrollQueued = false;
      this.renderWindow();
    });
  }

  /** First item index whose bottom is below `y` (binary search over offsets). */
  #indexAt(y: number): number {
    let lo = 0;
    let hi = this.#offsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.#offsets[mid] as number) + ROW_SLOT <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  renderWindow(): void {
    const items = this.#ctx.controller.list.items;
    const top = this.list.scrollTop;
    const height = this.list.clientHeight || 640;
    const from = this.#indexAt(Math.max(0, top - OVERSCAN));
    const limit = top + height + OVERSCAN;
    const needed = new Set<number>();
    for (let i = from; i < items.length && (this.#offsets[i] as number) < limit; i++) needed.add(i);
    for (const [i, el] of this.#rendered) {
      if (!needed.has(i)) {
        el.remove();
        this.#rendered.delete(i);
      }
    }
    for (const i of needed) {
      if (this.#rendered.has(i)) continue;
      const el = this.#renderItem(items[i] as ListItem, this.#offsets[i] as number);
      this.#rendered.set(i, el);
      this.#listInner.appendChild(el);
    }
    this.#renderSticky(top);
  }

  #renderItem(item: ListItem, y: number): HTMLElement {
    const tr = this.#ctx.tr();
    const c = this.#ctx.controller;
    if (item.kind === 'header') {
      return h(
        'div',
        { class: 'group', role: 'presentation', style: `top: ${y}px` },
        h('span', { text: tr.t(`phase.${item.phase}`) }),
        h('span', { class: 'n', text: tr.num(item.count) }),
      );
    }
    const hunk = c.scene?.hunks[item.hunk] as SceneHunk;
    const reviewed = c.isReviewed(hunk.id);
    // Pointer shortcut only: options hold no interactive children. Keyboard users press `x` or
    // use the detail panel's "Reviewed" button.
    const rv = h(
      'span',
      {
        class: 'rv',
        'aria-hidden': 'true',
        'data-pressed': String(reviewed),
        title: tr.t(reviewed ? 'review.unmark' : 'review.mark'),
        'data-hunk': hunk.id,
      },
      h('span', { class: 'ring' }, icon('check')),
    );
    const rank = c.list.rank.get(item.hunk) ?? 0;
    const row = h(
      'div',
      {
        class: 'row',
        role: 'option',
        id: `kg-opt-${item.hunk}`,
        'data-index': String(item.hunk),
        'data-family': hunk.family,
        'data-reviewed': String(reviewed),
        'aria-selected': String(c.selectedHunk === item.hunk),
        'aria-setsize': String(c.list.order.length),
        'aria-posinset': String(rank + 1),
        'aria-describedby': `kg-phase-${hunk.phase}`,
        style: `top: ${y + 2}px`,
      },
      h('span', { class: 'glyph-box', 'aria-hidden': 'true', text: sceneHunkGlyph(hunk) }),
      h(
        'span',
        { class: 'txt' },
        h('span', { class: 'title', title: hunk.title, text: hunk.title }),
        h('span', { class: 'sub', text: hunk.subtitle }),
      ),
      rv,
    );
    this.#labelRow(row, hunk, reviewed);
    return row;
  }

  #labelRow(row: HTMLElement, hunk: SceneHunk, reviewed: boolean): void {
    const tr = this.#ctx.tr();
    const parts = [hunk.title];
    if (hunk.subtitle) parts.push(hunk.subtitle);
    if (reviewed) parts.push(tr.t('review.toggle'));
    attr(row, 'aria-label', parts.join('. '));
  }

  /** Update selection / reviewed state of the rendered rows in place. */
  #refreshRows(): void {
    const c = this.#ctx.controller;
    const tr = this.#ctx.tr();
    for (const el of this.#rendered.values()) {
      if (!el.classList.contains('row')) continue;
      const index = Number(el.dataset.index);
      const hunk = c.scene?.hunks[index];
      if (!hunk) continue;
      const reviewed = c.isReviewed(hunk.id);
      attr(el, 'aria-selected', String(index === c.selectedHunk));
      attr(el, 'data-reviewed', String(reviewed));
      const rv = el.querySelector('.rv') as HTMLElement;
      attr(rv, 'data-pressed', String(reviewed));
      attr(rv, 'title', tr.t(reviewed ? 'review.unmark' : 'review.mark'));
      this.#labelRow(el, hunk, reviewed);
    }
    const sel = c.selectedHunk;
    attr(
      this.list,
      'aria-activedescendant',
      sel >= 0 && c.list.rank.has(sel) ? `kg-opt-${sel}` : null,
    );
  }

  #revealSelected(): void {
    const c = this.#ctx.controller;
    const item = c.list.itemOf.get(c.selectedHunk);
    if (item === undefined) return;
    const y = this.#offsets[item] as number;
    const top = this.list.scrollTop;
    // Not laid out yet (hidden sheet): position it for when it shows.
    const height = this.list.clientHeight || 640;
    // The first row of a group scrolls its group header into view too.
    const above =
      c.list.items[item - 1]?.kind === 'header'
        ? (this.#offsets[item - 1] as number)
        : y - HEADER_SLOT;
    if (y < top + HEADER_SLOT) this.list.scrollTop = Math.max(0, above);
    else if (y + ROW_SLOT > top + height) this.list.scrollTop = y + ROW_SLOT - height + 8;
    this.renderWindow();
    this.#refreshRows();
  }

  #renderSticky(top: number): void {
    const items = this.#ctx.controller.list.items;
    let current = -1;
    let next = -1;
    for (let i = 0; i < items.length; i++) {
      if (items[i]?.kind !== 'header') continue;
      if ((this.#offsets[i] as number) <= top) current = i;
      else {
        next = i;
        break;
      }
    }
    if (current < 0 || top <= 0) {
      this.#sticky.hidden = true;
      return;
    }
    const item = items[current] as Extract<ListItem, { kind: 'header' }>;
    const tr = this.#ctx.tr();
    this.#sticky.hidden = false;
    const label = `${tr.t(`phase.${item.phase}`)}|${item.count}`;
    if (this.#sticky.dataset.key !== label) {
      this.#sticky.dataset.key = label;
      replace(
        this.#sticky,
        h(
          'div',
          { class: 'group' },
          h('span', { text: tr.t(`phase.${item.phase}`) }),
          h('span', { class: 'n', text: tr.num(item.count) }),
        ),
      );
    }
    const push = next >= 0 ? Math.min(0, (this.#offsets[next] as number) - top - HEADER_SLOT) : 0;
    this.#sticky.style.transform = `translateY(${push}px)`;
  }

  #onListClick(e: MouseEvent): void {
    const c = this.#ctx.controller;
    const target = e.target as Element;
    const rv = target.closest('.rv') as HTMLElement | null;
    if (rv?.dataset.hunk) {
      e.stopPropagation();
      c.toggleReviewed(rv.dataset.hunk);
      return;
    }
    const row = target.closest('.row') as HTMLElement | null;
    if (!row) return;
    const index = Number(row.dataset.index);
    if (Number.isInteger(index)) c.selectHunk(index);
  }

  // ─── Search ──────────────────────────────────────────────────────────────

  #setQuery(query: string, focus = false): void {
    this.#query = query;
    if (this.searchInput.value !== query) this.searchInput.value = query;
    this.#activeHit = 0;
    this.#runSearch();
    if (focus) this.searchInput.focus();
  }

  #runSearch(): void {
    const q = this.#query.trim();
    this.#hits = q ? this.#ctx.controller.search(q, SEARCH_LIMIT) : [];
    const searching = q !== '';
    this.#results.hidden = !searching;
    this.list.hidden = searching;
    this.#sticky.hidden = searching || this.#sticky.hidden;
    attr(this.searchInput, 'aria-expanded', String(searching));
    this.#updateSearchChrome();
    if (!searching) {
      replace(this.#results);
      this.renderWindow();
      return;
    }
    this.#renderResults();
  }

  #updateSearchChrome(): void {
    const focused = this.#ctx.root.activeElement === this.searchInput;
    this.#searchKbd.hidden = this.#query !== '' || focused;
    this.#searchClear.hidden = this.#query === '';
  }

  #renderResults(): void {
    const tr = this.#ctx.tr();
    const c = this.#ctx.controller;
    const q = this.#query.trim();
    if (this.#hits.length === 0) {
      replace(
        this.#results,
        h(
          'div',
          { class: 'list-empty' },
          icon('search'),
          h('span', { text: tr.t('sidebar.noResults', { q }) }),
        ),
      );
      attr(this.searchInput, 'aria-activedescendant', null);
      return;
    }
    const scene = c.scene;
    const rows = this.#hits.map((hit, i) => {
      const sceneIndex = scene?.nodeIndex.get(hit.node.id);
      const sn = sceneIndex !== undefined ? scene?.nodes[sceneIndex] : undefined;
      const family =
        sn?.family ??
        (hit.node.status === 'added'
          ? 'added'
          : hit.node.status === 'removed'
            ? 'removed'
            : hit.node.status === 'modified'
              ? 'content'
              : 'neutral');
      const sub =
        hit.field === 'label' ? hit.node.id : hit.field === 'alias' ? hit.matched : hit.matched;
      return h(
        'button',
        {
          type: 'button',
          class: 'result',
          role: 'option',
          id: `kg-hit-${i}`,
          tabindex: '-1',
          'data-family': family,
          'aria-selected': String(i === this.#activeHit),
          onclick: () => this.#choose(i),
          onpointermove: () => this.#setActiveHit(i),
        },
        h('span', { class: 'sdot', 'aria-hidden': 'true' }),
        h(
          'span',
          { class: 'txt' },
          h('span', { class: 'title' }, highlight(hit.node.label, hit.field === 'label' ? q : '')),
          h('span', { class: 'sub' }, highlight(sub, hit.field === 'label' ? '' : q)),
        ),
        h('span', { class: 'status', text: tr.t(`status.${hit.node.status}`) }),
      );
    });
    replace(
      this.#results,
      h('div', {
        class: 'results-head',
        text: tr.plural('sidebar.results', this.#hits.length),
      }),
      rows,
    );
    attr(this.searchInput, 'aria-activedescendant', `kg-hit-${this.#activeHit}`);
  }

  #setActiveHit(i: number): void {
    if (i === this.#activeHit || i < 0 || i >= this.#hits.length) return;
    this.#activeHit = i;
    for (const el of this.#results.querySelectorAll('.result')) {
      attr(el, 'aria-selected', String(el.id === `kg-hit-${i}`));
    }
    attr(this.searchInput, 'aria-activedescendant', `kg-hit-${i}`);
    this.#results.querySelector(`#kg-hit-${i}`)?.scrollIntoView?.({ block: 'nearest' });
  }

  #choose(i: number): void {
    const hit = this.#hits[i];
    if (!hit) return;
    this.#setQuery('');
    this.#ctx.controller.revealNode(hit.node.id);
    this.focusList();
  }

  #onSearchKey(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.#setActiveHit(Math.min(this.#hits.length - 1, this.#activeHit + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.#setActiveHit(Math.max(0, this.#activeHit - 1));
        break;
      case 'Enter':
        e.preventDefault();
        this.#choose(this.#activeHit);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (this.#query) this.#setQuery('');
        else this.focusList();
        break;
      default:
        return;
    }
  }

  // ─── Bottom sheet ────────────────────────────────────────────────────────

  /** Separator semantics: the sheet's height as a percentage of the available height. */
  #sheetValue(px: number, total: number): void {
    const pct = (v: number): number => Math.round((100 * v) / Math.max(1, total));
    attr(this.#handle, 'aria-valuemin', String(pct(120)));
    attr(this.#handle, 'aria-valuemax', String(pct(total - 96)));
    attr(this.#handle, 'aria-valuenow', String(pct(px)));
    attr(
      this.#handle,
      'aria-valuetext',
      this.#ctx.tr().t('sidebar.sheetValue', { p: `${pct(px)}%` }),
    );
  }

  /** Refresh the separator values (layout changes). */
  syncSheet(): void {
    const total = this.el.parentElement?.clientHeight ?? 0;
    if (total > 0) this.#sheetValue(this.el.getBoundingClientRect().height, total);
  }

  #bindSheet(): void {
    let start: { y: number; h: number; id: number } | null = null;
    const host = (): HTMLElement | null => this.el.parentElement;
    const setHeight = (px: number): void => {
      const total = host()?.clientHeight ?? 600;
      const clamped = Math.max(120, Math.min(total - 96, px));
      this.el.style.setProperty('--sheet-h', `${Math.round(clamped)}px`);
      this.#sheetValue(clamped, total);
    };
    this.#handle.addEventListener('pointerdown', (e) => {
      start = { y: e.clientY, h: this.el.getBoundingClientRect().height, id: e.pointerId };
      this.#handle.setPointerCapture?.(e.pointerId);
      this.el.classList.add('dragging');
    });
    this.#handle.addEventListener('pointermove', (e) => {
      if (start && e.pointerId === start.id) setHeight(start.h + (start.y - e.clientY));
    });
    const end = (e: PointerEvent): void => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      this.el.classList.remove('dragging');
    };
    this.#handle.addEventListener('pointerup', end);
    this.#handle.addEventListener('pointercancel', end);
    this.#handle.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      e.stopPropagation();
      const current = this.el.getBoundingClientRect().height;
      setHeight(current + (e.key === 'ArrowUp' ? 40 : -40));
    });
  }
}

/** The label with the first occurrence of `q` (case-insensitive) marked. */
function highlight(text: string, q: string): (string | HTMLElement)[] {
  if (!q) return [text];
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return [text];
  return [
    text.slice(0, at),
    h('mark', { text: text.slice(at, at + q.length) }),
    text.slice(at + q.length),
  ];
}
