/**
 * Header: brand, compared versions, mode segmented control, diffstat pills (filter shortcuts),
 * appearance menu, fit, help and sidebar toggle.
 */
import type { ChangeFamily } from '@kgdiff/scene';
import type { Topic } from '../controller.js';
import { attr, h, icon, iconButton, relabel, replace, setText } from '../dom.js';
import type { IconName } from '../icons.js';
import type { ViewerMode } from '../index.js';
import { familyCounts } from '../list-model.js';
import type { UiContext } from './context.js';

const MODES: readonly { mode: ViewerMode; icon: IconName; key: string }[] = [
  { mode: 'overlay', icon: 'overlay', key: '1' },
  { mode: 'swipe', icon: 'swipe', key: '2' },
  { mode: 'replay', icon: 'replay', key: '3' },
  { mode: 'changes', icon: 'changes', key: '4' },
];

interface StatDef {
  readonly id: 'added' | 'removed' | 'modified' | 'restructured';
  readonly family: ChangeFamily;
  readonly families: readonly ChangeFamily[];
  readonly glyph: string;
}

const STATS: readonly StatDef[] = [
  { id: 'added', family: 'added', families: ['added'], glyph: '+' },
  { id: 'removed', family: 'removed', families: ['removed'], glyph: '−' },
  { id: 'modified', family: 'content', families: ['content'], glyph: '~' },
  { id: 'restructured', family: 'structure', families: ['structure', 'identity'], glyph: '⇄' },
];

/** The kgdiff mark: a soft accent diamond holding a node. */
function brandMark(): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML =
    '<svg class="brand-mark" viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
    '<rect x="4.1" y="4.1" width="11.8" height="11.8" rx="3.2" transform="rotate(45 10 10)" ' +
    'fill="var(--kg-accent-soft)" stroke="var(--kg-accent)" stroke-width="1.5"/>' +
    '<circle cx="10" cy="10" r="2.4" fill="var(--kg-accent)"/></svg>';
  return tpl.content.firstElementChild as SVGSVGElement;
}

export class Header {
  readonly el: HTMLElement;
  readonly #versions: HTMLElement;
  readonly #seg: HTMLElement;
  readonly #thumb: HTMLElement;
  readonly #segButtons = new Map<ViewerMode, HTMLButtonElement>();
  readonly #stats: HTMLElement;
  readonly #statButtons = new Map<StatDef['id'], HTMLButtonElement>();
  readonly menuButton: HTMLButtonElement;
  readonly #fitButton: HTMLButtonElement;
  readonly #helpButton: HTMLButtonElement;
  readonly #sidebarButton: HTMLButtonElement;
  readonly #brand: HTMLElement;

  readonly #ctx: UiContext;

  constructor(ctx: UiContext) {
    this.#ctx = ctx;
    const c = ctx.controller;
    this.#brand = h(
      'div',
      { class: 'brand' },
      brandMark(),
      h('span', { class: 'brand-name', text: 'kgdiff' }),
    );
    this.#versions = h('div', { class: 'versions' });
    this.#thumb = h('span', { class: 'thumb', 'aria-hidden': 'true' });
    this.#seg = h('div', { class: 'segmented', role: 'radiogroup' }, this.#thumb);
    for (const m of MODES) {
      const b = h(
        'button',
        {
          type: 'button',
          class: 'seg',
          role: 'radio',
          'data-mode': m.mode,
          onclick: () => ctx.setMode(m.mode),
        },
        icon(m.icon),
        h('span', { class: 'lbl' }),
      );
      this.#segButtons.set(m.mode, b);
      this.#seg.appendChild(b);
    }
    this.#seg.addEventListener('keydown', (e) => this.#onSegKey(e));
    this.#stats = h('div', { class: 'stats', role: 'group' });
    for (const s of STATS) {
      const b = h(
        'button',
        {
          type: 'button',
          class: 'pill stat',
          'data-family': s.family,
          'aria-pressed': 'false',
          onclick: () => c.setFamilies(s.families),
        },
        h('span', { class: 'glyph', 'aria-hidden': 'true', text: s.glyph }),
        h('span', { class: 'n' }),
      );
      this.#statButtons.set(s.id, b);
      this.#stats.appendChild(b);
    }
    this.menuButton = iconButton('contrast', '', () => ctx.toggleMenu(), {
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
    });
    this.#fitButton = iconButton('fit', '', () => void c.fit());
    this.#helpButton = iconButton('help', '', () => ctx.openHelp());
    this.#sidebarButton = iconButton('sidebar', '', () => ctx.toggleSidebar());
    this.el = h(
      'header',
      { class: 'header' },
      this.#brand,
      h('span', { class: 'header-sep', 'aria-hidden': 'true' }),
      this.#versions,
      h('div', { class: 'header-center' }, this.#seg),
      h(
        'div',
        { class: 'header-end' },
        this.#stats,
        this.menuButton,
        this.#fitButton,
        this.#helpButton,
        this.#sidebarButton,
      ),
    );
  }

  update(topics: ReadonlySet<Topic>): void {
    const tr = this.#ctx.tr();
    if (topics.has('locale') || topics.has('data') || topics.has('status')) {
      attr(this.#brand, 'title', `kgdiff — ${tr.t('brand.tagline')}`);
      attr(this.#seg, 'aria-label', tr.t('mode.label'));
      attr(this.#stats, 'aria-label', tr.t('stat.label'));
      for (const m of MODES) {
        const b = this.#segButtons.get(m.mode) as HTMLButtonElement;
        const label = tr.t(`mode.${m.mode}`);
        setText(b.querySelector('.lbl') as Element, label);
        attr(b, 'title', `${label} (${m.key})`);
        attr(b, 'aria-label', label);
      }
      relabel(this.menuButton, tr.t('action.settings'));
      relabel(this.#fitButton, `${tr.t('action.fit')} (F)`);
      relabel(this.#helpButton, `${tr.t('action.help')} (?)`);
      relabel(this.#sidebarButton, `${tr.t('action.sidebar')} (\\)`);
      this.#renderVersions();
      this.#renderStats();
    }
    if (topics.has('mode') || topics.has('status') || topics.has('locale')) this.#renderMode();
    if (topics.has('filters') || topics.has('data')) this.#renderFilterState();
  }

  /** Re-measure the segmented thumb (fonts / size changes). */
  layout(): void {
    this.#renderMode();
  }

  setSidebarState(open: boolean): void {
    attr(this.#sidebarButton, 'aria-pressed', String(open));
  }

  setMenuState(open: boolean): void {
    attr(this.menuButton, 'aria-expanded', String(open));
  }

  #renderVersions(): void {
    const data = this.#ctx.controller.data;
    if (!data) {
      replace(this.#versions);
      return;
    }
    const tr = this.#ctx.tr();
    const { names, versions } = data;
    const tag = (v: string | undefined) =>
      v ? h('span', { class: 'tag', title: v, text: v }) : null;
    const arrow = () => h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' });
    attr(this.#versions, 'aria-label', tr.t('header.compare'));
    attr(this.#versions, 'role', 'group');
    if (names.before === names.after) {
      replace(
        this.#versions,
        h('span', {
          class: 'name',
          title: data.title ?? names.after,
          text: data.title ?? names.after,
        }),
        versions.before || versions.after
          ? h(
              'span',
              { class: 'side' },
              tag(versions.before ?? '—'),
              arrow(),
              tag(versions.after ?? '—'),
            )
          : null,
      );
      return;
    }
    replace(
      this.#versions,
      h(
        'span',
        { class: 'side' },
        h('span', { class: 'name', title: names.before, text: names.before }),
        tag(versions.before),
      ),
      arrow(),
      h(
        'span',
        { class: 'side' },
        h('span', { class: 'name', title: names.after, text: names.after }),
        tag(versions.after),
      ),
    );
  }

  #renderStats(): void {
    const c = this.#ctx.controller;
    const scene = c.scene;
    const tr = this.#ctx.tr();
    // Hunks per family: the same numbers as the sidebar's filter chips.
    const f = scene ? familyCounts(scene) : null;
    const counts = {
      added: f?.added ?? 0,
      removed: f?.removed ?? 0,
      modified: f?.content ?? 0,
      restructured: (f?.structure ?? 0) + (f?.identity ?? 0),
    };
    this.#stats.hidden = !scene || scene.hunks.length === 0;
    for (const s of STATS) {
      const b = this.#statButtons.get(s.id) as HTMLButtonElement;
      const n = counts[s.id];
      b.hidden = n === 0;
      setText(b.querySelector('.n') as Element, tr.num(n));
      const label = `${tr.t(`stat.${s.id}`, { n })} — ${tr.t('stat.filter')}`;
      attr(b, 'aria-label', label);
      attr(b, 'title', label);
    }
  }

  #renderFilterState(): void {
    const fams = this.#ctx.controller.families;
    this.#stats.classList.toggle('filtering', fams.size > 0);
    for (const s of STATS) {
      const on = fams.size === s.families.length && s.families.every((f) => fams.has(f));
      attr(this.#statButtons.get(s.id) as Element, 'aria-pressed', String(on));
    }
  }

  #renderMode(): void {
    const mode = this.#ctx.controller.mode;
    for (const [m, b] of this.#segButtons) {
      const on = m === mode;
      attr(b, 'aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    const active = this.#segButtons.get(mode);
    if (active && active.offsetWidth > 0) {
      this.#thumb.style.width = `${active.offsetWidth}px`;
      this.#thumb.style.transform = `translateX(${active.offsetLeft}px)`;
    }
  }

  #onSegKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const i = MODES.findIndex((m) => m.mode === this.#ctx.controller.mode);
    const next = MODES[(i + (e.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length];
    if (!next) return;
    this.#ctx.setMode(next.mode);
    this.#segButtons.get(next.mode)?.focus();
  }
}
