/**
 * The view dock, floating at the bottom of the canvas. It holds two independent choices: how
 * the versions are compared (overlay / swipe / replay, one at a time, keys `1`–`3`) and whether
 * only the changes are shown (key `4`, in any mode). The latter brings its context hops and the
 * nearest “+N” expansion along. Replay's caption and transport stack above it (`stage.ts`).
 */
import type { Topic } from '../controller.js';
import { attr, h, icon, relabel, setText } from '../dom.js';
import type { IconName } from '../icons.js';
import type { ViewerMode } from '../index.js';
import type { UiContext } from './context.js';

const MODES: readonly { mode: ViewerMode; icon: IconName; key: string }[] = [
  { mode: 'overlay', icon: 'overlay', key: '1' },
  { mode: 'swipe', icon: 'swipe', key: '2' },
  { mode: 'replay', icon: 'replay', key: '3' },
];

export class Dock {
  readonly el: HTMLElement;
  readonly #seg: HTMLElement;
  readonly #thumb: HTMLElement;
  readonly #segButtons = new Map<ViewerMode, HTMLButtonElement>();
  readonly #scopeButton: HTMLButtonElement;
  readonly #context: HTMLElement;
  readonly #opts: HTMLElement;
  readonly #hopButtons: HTMLButtonElement[] = [];
  readonly #expandButton: HTMLButtonElement;

  readonly #ctx: UiContext;

  constructor(ctx: UiContext) {
    this.#ctx = ctx;
    const c = ctx.controller;
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

    this.#scopeButton = h(
      'button',
      {
        type: 'button',
        class: 'scope-btn',
        'aria-pressed': 'false',
        'aria-keyshortcuts': '4',
        onclick: () => ctx.toggleScope(),
      },
      icon('changes'),
      h('span', { class: 'lbl' }),
    );

    // Context hops (0 / 1 / 2) and the nearest collapsed group: only with the changes scope.
    this.#opts = h('span', { class: 'opts', role: 'radiogroup' });
    for (let n = 0; n <= 2; n++) {
      const b = h('button', {
        type: 'button',
        class: 'opt',
        role: 'radio',
        text: String(n),
        onclick: () => c.setHops(n),
      });
      this.#hopButtons.push(b);
      this.#opts.appendChild(b);
    }
    this.#opts.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      const next = Math.max(0, Math.min(2, c.hops + (e.key === 'ArrowRight' ? 1 : -1)));
      c.setHops(next);
      this.#hopButtons[next]?.focus();
    });
    this.#expandButton = h(
      'button',
      { type: 'button', class: 'expand', onclick: () => c.expandNearest() },
      icon('plus'),
      h('span', { class: 'n' }),
    );
    this.#context = h(
      'div',
      { class: 'context', hidden: true },
      h('span', { class: 'label' }),
      this.#opts,
      this.#expandButton,
    );

    this.el = h(
      'div',
      { class: 'dock-bar card', role: 'group' },
      this.#seg,
      h('span', { class: 'dock-sep', 'aria-hidden': 'true' }),
      this.#scopeButton,
      this.#context,
    );
  }

  update(topics: ReadonlySet<Topic>): void {
    const all = topics.has('status') || topics.has('data') || topics.has('locale');
    if (all) this.#renderLabels();
    if (all || topics.has('mode')) this.#renderMode();
    if (all || topics.has('mode') || topics.has('focus') || topics.has('selection')) {
      this.#renderScope();
    }
  }

  /** Re-measure the segmented thumb (fonts / size changes). */
  layout(): void {
    this.#renderMode();
  }

  #renderLabels(): void {
    const tr = this.#ctx.tr();
    attr(this.el, 'aria-label', tr.t('dock.label'));
    attr(this.#seg, 'aria-label', tr.t('mode.label'));
    for (const m of MODES) {
      const b = this.#segButtons.get(m.mode) as HTMLButtonElement;
      const label = tr.t(`mode.${m.mode}`);
      setText(b.querySelector('.lbl') as Element, label);
      attr(b, 'title', `${label} (${m.key})`);
      attr(b, 'aria-label', label);
    }
    setText(this.#scopeButton.querySelector('.lbl') as Element, tr.t('mode.changes'));
    attr(this.#scopeButton, 'aria-label', tr.t('mode.changes'));
    setText(this.#context.querySelector('.label') as Element, tr.t('focus.context'));
    attr(this.#opts, 'aria-label', tr.t('focus.hops'));
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

  #renderScope(): void {
    const c = this.#ctx.controller;
    const tr = this.#ctx.tr();
    const on = c.scope === 'changes';
    const locked = c.scopeLocked;
    attr(this.#scopeButton, 'aria-pressed', String(on));
    attr(this.#scopeButton, 'aria-disabled', locked ? 'true' : null);
    attr(this.#scopeButton, 'title', locked ? tr.t('scope.locked') : `${tr.t('scope.hint')} (4)`);
    this.#context.hidden = !on;
    // The dock's width changed: keep the thumb under the active mode.
    this.#renderMode();
    if (!on) return;
    this.#hopButtons.forEach((b, n) => {
      attr(b, 'aria-checked', String(n === c.hops));
      b.tabIndex = n === c.hops ? 0 : -1;
      attr(b, 'aria-label', `${tr.t('focus.hops')}: ${n}`);
    });
    const group = c.focus?.collapsed[c.nearestGroup()];
    this.#expandButton.hidden = !group;
    if (group) {
      const usable = c.canExpand(c.nearestGroup()) || group.nodes.length > 0;
      this.#expandButton.disabled = !usable;
      setText(this.#expandButton.querySelector('.n') as Element, tr.num(group.count));
      relabel(
        this.#expandButton,
        `${usable ? tr.t('focus.expandNearest') : tr.t('focus.expandUnavailable')}: ${group.label} (E)`,
      );
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
