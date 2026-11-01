/**
 * The canvas area and its floating chrome: replay caption and transport, swipe divider,
 * changes-only context stepper, legend, zoom controls + minimap, hover tooltip and the
 * loading / identical / error / empty states. Overlays never cover the current hunk: the
 * element reserves their space through the renderer's safe area.
 */
import { KgdiffError, type Rect } from '@kgdiff/core';
import type { ChangeFamily, Family } from '@kgdiff/scene';
import type { Topic } from '../controller.js';
import {
  attr,
  h,
  icon,
  iconButton,
  relabel,
  replace,
  replaceKeepingFocus,
  setText,
} from '../dom.js';
import type { ChromeLayout } from '../framing.js';
import type { Translator } from '../i18n.js';
import { FAMILIES } from '../styles.js';
import { sceneHunkGlyph, type UiContext } from './context.js';

const TICK_W = 1000;

/** Legend swatch: the node cue of each family (docs/visual-language.md §Meaning families). */
function swatch(family: Family): SVGSVGElement {
  const v = (name: string) => `var(--kg-${name})`;
  const c = family === 'neutral' ? v('neutral') : v(family);
  let body: string;
  switch (family) {
    case 'added':
      body = `<circle cx="11" cy="11" r="8.5" fill="none" stroke="${c}" stroke-opacity=".35" stroke-width="2"/><circle cx="11" cy="11" r="5" fill="${c}"/>`;
      break;
    case 'removed':
      body = `<circle cx="11" cy="11" r="5.25" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="3 2.5"/>`;
      break;
    case 'identity':
      body = `<circle cx="11" cy="11" r="9.5" fill="none" stroke="${c}" stroke-opacity=".3" stroke-width="1.5"/><circle cx="11" cy="11" r="7.25" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="11" cy="11" r="4.25" fill="${c}"/>`;
      break;
    case 'content':
    case 'structure':
      body = `<circle cx="11" cy="11" r="7.75" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="11" cy="11" r="4.5" fill="${c}"/>`;
      break;
    default:
      body = `<circle cx="11" cy="11" r="3.5" fill="${c}"/>`;
  }
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="swatch" viewBox="0 0 22 22" aria-hidden="true" focusable="false">${body}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}

export class Stage {
  readonly el: HTMLElement;
  readonly canvasHost: HTMLElement;
  readonly minimapHost: HTMLElement;
  readonly #chrome: HTMLElement;
  readonly #liveCanvasLabel: HTMLElement;
  // Replay
  readonly #caption: HTMLElement;
  readonly #transport: HTMLElement;
  readonly #playButton: HTMLButtonElement;
  readonly #prevButton: HTMLButtonElement;
  readonly #nextButton: HTMLButtonElement;
  readonly #scrubber: HTMLElement;
  readonly #fill: HTMLElement;
  readonly #knob: HTMLElement;
  readonly #ticks: SVGSVGElement;
  readonly #scrubTip: HTMLElement;
  readonly #pos: HTMLElement;
  readonly #speed: HTMLButtonElement;
  readonly #finished: HTMLElement;
  // Swipe
  readonly #swipe: HTMLElement;
  readonly #divider: HTMLElement;
  readonly #chipBefore: HTMLElement;
  readonly #chipAfter: HTMLElement;
  // Changes
  readonly #stepper: HTMLElement;
  readonly #hopButtons: HTMLButtonElement[] = [];
  readonly #expandButton: HTMLButtonElement;
  // Chrome
  readonly #legend: HTMLElement;
  readonly #legendHead: HTMLButtonElement;
  readonly #legendBody: HTMLElement;
  readonly #zoomIn: HTMLButtonElement;
  readonly #zoomOut: HTMLButtonElement;
  readonly #fitButton: HTMLButtonElement;
  readonly #mapCluster: HTMLElement;
  readonly tooltip: HTMLElement;
  readonly #state: HTMLElement;
  #pointer: { x: number; y: number } | null = null;
  #scrubbing: number | null = null;
  #dragging: number | null = null;
  #legendOpen: boolean | null = null;
  #stateKey = '';

  readonly #ctx: UiContext;

  constructor(ctx: UiContext) {
    this.#ctx = ctx;
    const c = ctx.controller;
    this.canvasHost = h('div', { class: 'stage' });
    this.#liveCanvasLabel = h('div', { class: 'sr-only' });

    // Replay caption + transport
    this.#caption = h('div', {
      class: 'caption card',
      'aria-hidden': 'true',
      'data-empty': 'true',
    });
    this.#prevButton = iconButton('skip-back', '', () => c.stepReplay(-1), { class: 'icon-btn' });
    this.#playButton = iconButton('play', '', () => c.togglePlay(), { class: 'icon-btn play' });
    this.#nextButton = iconButton('skip-forward', '', () => c.stepReplay(1), { class: 'icon-btn' });
    this.#fill = h('div', { class: 'fill' });
    this.#knob = h('div', { class: 'knob' });
    this.#ticks = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.#ticks.setAttribute('class', 'ticks');
    this.#ticks.setAttribute('viewBox', `0 0 ${TICK_W} 14`);
    this.#ticks.setAttribute('preserveAspectRatio', 'none');
    this.#ticks.setAttribute('aria-hidden', 'true');
    this.#scrubTip = h('div', { class: 'scrub-tip card', hidden: true });
    this.#scrubber = h(
      'div',
      {
        class: 'scrubber',
        role: 'slider',
        tabindex: '0',
        'aria-valuemin': '0',
      },
      h('div', { class: 'track' }, this.#fill),
      this.#ticks,
      this.#knob,
      this.#scrubTip,
    );
    this.#bindScrubber();
    this.#pos = h('span', { class: 'pos', 'aria-hidden': 'true' });
    this.#speed = h('button', {
      type: 'button',
      class: 'speed',
      onclick: () => c.cycleSpeed(),
    });
    this.#transport = h(
      'div',
      { class: 'transport card', role: 'toolbar' },
      this.#prevButton,
      this.#playButton,
      this.#nextButton,
      this.#scrubber,
      this.#pos,
      this.#speed,
    );
    this.#finished = h('div', { class: 'finished card', role: 'status', hidden: true });

    // Swipe
    this.#chipBefore = h('div', { class: 'side-chip before chip card' });
    this.#chipAfter = h('div', { class: 'side-chip after chip card' });
    this.#divider = h(
      'div',
      {
        class: 'divider',
        role: 'slider',
        tabindex: '0',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-orientation': 'horizontal',
      },
      h(
        'span',
        { class: 'handle', 'aria-hidden': 'true' },
        icon('chevron-left'),
        icon('chevron-right'),
      ),
    );
    this.#bindDivider();
    this.#swipe = h(
      'div',
      { class: 'swipe', hidden: true },
      this.#chipBefore,
      this.#chipAfter,
      this.#divider,
    );

    // Changes-only context stepper
    const opts = h('span', { class: 'opts', role: 'radiogroup' });
    for (let n = 0; n <= 2; n++) {
      const b = h('button', {
        type: 'button',
        class: 'opt',
        role: 'radio',
        text: String(n),
        onclick: () => c.setHops(n),
      });
      this.#hopButtons.push(b);
      opts.appendChild(b);
    }
    opts.addEventListener('keydown', (e) => {
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
    this.#stepper = h(
      'div',
      { class: 'stepper card float top-left', hidden: true },
      h('span', { class: 'label' }),
      opts,
      this.#expandButton,
    );

    // Legend
    this.#legendHead = h(
      'button',
      {
        type: 'button',
        class: 'legend-head',
        onclick: () => this.#setLegend(!(this.#legendOpen ?? true)),
      },
      h('span', { class: 'lbl' }),
      icon('chevron-down'),
    );
    this.#legendBody = h('div', { class: 'legend-body', id: 'kg-legend' });
    attr(this.#legendHead, 'aria-controls', 'kg-legend');
    this.#legend = h(
      'div',
      { class: 'legend card float bottom-left', 'data-open': 'true' },
      this.#legendHead,
      this.#legendBody,
    );

    // Zoom + minimap
    this.#zoomIn = iconButton('plus', '', () => c.zoom(1));
    this.#zoomOut = iconButton('minus', '', () => c.zoom(-1));
    this.#fitButton = iconButton('fit', '', () => void c.fit());
    this.minimapHost = h('div', { class: 'minimap-host' });
    this.#mapCluster = h(
      'div',
      { class: 'map-cluster float bottom-right' },
      h(
        'div',
        { class: 'zoom-bar card', role: 'toolbar' },
        this.#zoomIn,
        this.#zoomOut,
        this.#fitButton,
      ),
      this.minimapHost,
    );

    this.tooltip = h('div', { class: 'tooltip card', role: 'tooltip', 'data-open': 'false' });
    this.#state = h('div', { class: 'state', hidden: true });
    this.#chrome = h(
      'div',
      { class: 'chrome' },
      this.#swipe,
      this.#caption,
      this.#stepper,
      this.#legend,
      this.#mapCluster,
      this.#finished,
      this.#transport,
      this.tooltip,
    );
    this.el = h(
      'main',
      { class: 'stage-wrap' },
      this.canvasHost,
      this.#liveCanvasLabel,
      this.#chrome,
      this.#state,
    );
    this.el.addEventListener('pointermove', (e) => {
      const r = this.el.getBoundingClientRect();
      this.#pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (this.tooltip.dataset.open === 'true') this.#placeTooltip();
    });
    this.el.addEventListener('pointerleave', () => {
      this.#pointer = null;
      c.clearHover();
    });
  }

  /**
   * The canvas size and the floating chrome currently drawn over it (canvas-relative rects),
   * for framing fits and flights around it.
   */
  chromeLayout(): ChromeLayout {
    const r = this.el.getBoundingClientRect();
    const obstacles: Rect[] = [];
    const parts = [
      this.#legend,
      this.#mapCluster,
      this.#transport,
      this.#finished,
      this.#stepper,
      this.#chipBefore,
      this.#chipAfter,
    ];
    if (this.#caption.dataset.empty !== 'true') parts.push(this.#caption);
    for (const el of parts) {
      if (el.hidden) continue;
      const b = el.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) continue;
      obstacles.push({ x: b.left - r.left, y: b.top - r.top, width: b.width, height: b.height });
    }
    return { width: r.width, height: r.height, obstacles };
  }

  /** Whether the stage is tall enough to show the legend expanded by default. */
  #defaultLegendOpen(): boolean {
    const hgt = this.el.clientHeight;
    return hgt === 0 || hgt >= 560;
  }

  #setLegend(open: boolean): void {
    this.#legendOpen = open;
    attr(this.#legend, 'data-open', String(open));
    attr(this.#legendHead, 'aria-expanded', String(open));
  }

  update(topics: ReadonlySet<Topic>): void {
    const c = this.#ctx.controller;
    const tr = this.#ctx.tr();
    const all = topics.has('status') || topics.has('data') || topics.has('locale');
    if (all) {
      this.#renderLabels(tr);
      this.#renderState(tr);
      this.#renderTicks();
      this.#renderCanvasLabel(tr);
      if (this.#legendOpen === null) this.#setLegend(this.#defaultLegendOpen());
    }
    if (all || topics.has('mode') || topics.has('focus') || topics.has('selection')) {
      this.#renderMode(tr);
    }
    if (all || topics.has('mode') || topics.has('replay')) this.#renderReplay(tr);
    if (all || topics.has('mode') || topics.has('swipe')) this.#renderSwipe();
    if (all || topics.has('hover') || topics.has('selection') || topics.has('focus')) {
      this.#renderTooltip(tr);
    }
    if (topics.has('theme')) this.#renderTicks();
    const ready = c.status === 'ready';
    this.#chrome.hidden = !ready;
  }

  #renderLabels(tr: Translator): void {
    relabel(this.#prevButton, `${tr.t('detail.prev')} (←)`);
    relabel(this.#nextButton, `${tr.t('detail.next')} (→)`);
    attr(this.#transport, 'aria-label', tr.t('replay.label'));
    attr(this.#scrubber, 'aria-label', tr.t('replay.scrubber'));
    setText(this.#chipBefore, tr.t('detail.before'));
    setText(this.#chipAfter, tr.t('detail.after'));
    attr(this.#divider, 'aria-label', tr.t('swipe.divider'));
    setText(this.#stepper.querySelector('.label') as Element, tr.t('focus.context'));
    attr(this.#stepper.querySelector('.opts') as Element, 'aria-label', tr.t('focus.hops'));
    setText(this.#legendHead.querySelector('.lbl') as Element, tr.t('legend.title'));
    attr(this.#legendHead, 'aria-label', tr.t('legend.toggle'));
    relabel(this.#zoomIn, `${tr.t('action.zoomIn')} (+)`);
    relabel(this.#zoomOut, `${tr.t('action.zoomOut')} (−)`);
    relabel(this.#fitButton, `${tr.t('action.fit')} (F)`);
    attr(this.minimapHost, 'aria-label', tr.t('minimap.label'));
    attr(this.minimapHost, 'title', tr.t('minimap.label'));
    const fams: Family[] = [...FAMILIES, 'neutral'];
    replace(
      this.#legendBody,
      fams.map((f) =>
        h(
          'div',
          { class: 'legend-row', 'data-family': f, title: tr.t(`familyHint.${f}`) },
          swatch(f),
          h('span', { class: 'name', text: tr.t(`family.${f}`) }),
        ),
      ),
    );
  }

  #renderCanvasLabel(tr: Translator): void {
    const stats = this.#ctx.controller.diff?.stats;
    const canvas = this.canvasHost.querySelector('canvas');
    if (!stats) return;
    const label = tr.t('aria.canvas', {
      nb: stats.before.nodes,
      eb: stats.before.edges,
      na: stats.after.nodes,
      ea: stats.after.edges,
      changes: tr.plural('aria.changes', this.#ctx.controller.hunkCount),
    });
    if (canvas) attr(canvas, 'aria-label', label);
    setText(this.#liveCanvasLabel, '');
  }

  #renderMode(tr: Translator): void {
    const c = this.#ctx.controller;
    const mode = c.mode;
    this.#stepper.hidden = mode !== 'changes';
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
    this.#transport.hidden = mode !== 'replay';
    this.#caption.hidden = mode !== 'replay';
    this.#swipe.hidden = mode !== 'swipe';
  }

  #renderReplay(tr: Translator): void {
    const c = this.#ctx.controller;
    const clock = c.clock;
    const scene = c.scene;
    if (c.mode !== 'replay' || !clock || !scene) {
      this.#finished.hidden = true;
      return;
    }
    const p = clock.progress;
    this.#fill.style.transform = `scaleX(${p})`;
    this.#knob.style.left = `${p * 100}%`;
    const position = clock.position();
    const total = clock.total;
    setText(this.#pos, tr.t('replay.position', { i: position, n: total }));
    attr(this.#scrubber, 'aria-valuemax', String(Math.round(clock.duration)));
    attr(this.#scrubber, 'aria-valuenow', String(Math.round(clock.t)));
    attr(this.#scrubber, 'aria-valuetext', tr.t('replay.position', { i: position, n: total }));
    const playing = clock.playing;
    const playLabel = `${tr.t(playing ? 'replay.pause' : 'replay.play')} (Space)`;
    if (this.#playButton.dataset.state !== String(playing)) {
      this.#playButton.dataset.state = String(playing);
      replace(this.#playButton, icon(playing ? 'pause' : 'play'));
    }
    relabel(this.#playButton, playLabel);
    setText(this.#speed, `${clock.speed}×`);
    relabel(this.#speed, tr.t('replay.speed', { s: `${clock.speed}×` }));
    this.#prevButton.disabled = clock.t <= 0;
    this.#nextButton.disabled = clock.t >= clock.duration;

    // Caption: the playing hunk (or chapter), else the last one played.
    let key = '';
    let content: (Node | string)[] = [];
    if (clock.t <= 0) {
      // Nothing has played yet: the canvas shows the before version.
    } else if (clock.timeline.mode === 'chapters') {
      const target = clock.activeTarget();
      const ch = target.index >= 0 ? clock.timeline.chapters[target.index] : undefined;
      if (ch) {
        key = `c${target.index}`;
        const first = scene.hunks[ch.hunks[0] ?? -1];
        content = [
          h('span', {
            class: 'glyph-box',
            'data-family': first?.family ?? 'neutral',
            text: first ? sceneHunkGlyph(first) : '·',
          }),
          h('span', { class: 'text', text: tr.t(`phase.${ch.phase}`) }),
          h('span', { class: 'count', text: tr.num(ch.hunks.length) }),
        ];
      }
    } else {
      let hIndex = clock.activeHunk();
      if (hIndex < 0 && position > 0) hIndex = clock.timeline.windows[position - 1]?.hunk ?? -1;
      const hunk = hIndex >= 0 ? scene.hunks[hIndex] : undefined;
      if (hunk) {
        key = `h${hIndex}|${position}`;
        content = [
          h('span', { class: 'glyph-box', 'data-family': hunk.family, text: sceneHunkGlyph(hunk) }),
          h('span', { class: 'text', text: hunk.title, title: hunk.title }),
          h('span', { class: 'count', text: `${position} / ${total}` }),
        ];
      }
    }
    if (this.#caption.dataset.key !== key) {
      this.#caption.dataset.key = key;
      attr(this.#caption, 'data-empty', String(key === ''));
      replace(this.#caption, ...content);
    }
    const finished = clock.finished;
    this.#finished.hidden = !finished;
    if (finished && this.#finished.childElementCount === 0) {
      replace(
        this.#finished,
        icon('check-circle'),
        h('span', { text: tr.t('replay.finished') }),
        h(
          'button',
          { type: 'button', class: 'btn', onclick: () => c.restart() },
          icon('restart'),
          tr.t('replay.restart'),
        ),
      );
    } else if (!finished && this.#finished.childElementCount > 0) {
      // Restart was pressed from the pill: keep focus in the transport.
      replaceKeepingFocus(this.#ctx.root, this.#finished, this.#playButton);
    }
  }

  #renderTicks(): void {
    const c = this.#ctx.controller;
    const clock = c.clock;
    const scene = c.scene;
    while (this.#ticks.firstChild) this.#ticks.removeChild(this.#ticks.firstChild);
    if (!clock || !scene || clock.duration <= 0) return;
    const paths = new Map<ChangeFamily, string[]>();
    for (const w of clock.timeline.windows) {
      const fam = scene.hunks[w.hunk]?.family;
      if (!fam) continue;
      const x = ((w.start / clock.duration) * TICK_W).toFixed(1);
      let list = paths.get(fam);
      if (!list) {
        list = [];
        paths.set(fam, list);
      }
      list.push(`M${x} 2V12`);
    }
    for (const [fam, d] of paths) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d.join(''));
      p.setAttribute('stroke', `var(--kg-${fam})`);
      p.setAttribute('stroke-width', '2');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      this.#ticks.appendChild(p);
    }
  }

  #bindScrubber(): void {
    const timeAt = (clientX: number): number => {
      const clock = this.#ctx.controller.clock;
      const r = this.#scrubber.getBoundingClientRect();
      if (!clock || r.width <= 0) return 0;
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * clock.duration;
    };
    this.#scrubber.addEventListener('pointerdown', (e) => {
      this.#scrubbing = e.pointerId;
      this.#scrubber.setPointerCapture?.(e.pointerId);
      this.#ctx.controller.pause();
      this.#ctx.controller.seek(timeAt(e.clientX));
    });
    this.#scrubber.addEventListener('pointermove', (e) => {
      if (this.#scrubbing === e.pointerId) this.#ctx.controller.seek(timeAt(e.clientX));
      this.#showScrubTip(e.clientX, timeAt(e.clientX));
    });
    const end = (e: PointerEvent): void => {
      if (this.#scrubbing === e.pointerId) this.#scrubbing = null;
    };
    this.#scrubber.addEventListener('pointerup', end);
    this.#scrubber.addEventListener('pointercancel', end);
    this.#scrubber.addEventListener('pointerleave', () => {
      this.#scrubTip.hidden = true;
    });
    this.#scrubber.addEventListener('keydown', (e) => {
      const c = this.#ctx.controller;
      if (e.key === 'Home') c.seek(0);
      else if (e.key === 'End') c.seek(c.clock?.duration ?? 0);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  #showScrubTip(clientX: number, t: number): void {
    const c = this.#ctx.controller;
    const clock = c.clock;
    const scene = c.scene;
    if (!clock || !scene) return;
    // Nearest window start: the tick under the pointer.
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (const w of clock.timeline.windows) {
      const d = Math.abs(w.start - t);
      if (d < bestD) {
        bestD = d;
        best = w.hunk;
      }
    }
    const hunk = scene.hunks[best];
    if (!hunk) {
      this.#scrubTip.hidden = true;
      return;
    }
    const r = this.#scrubber.getBoundingClientRect();
    this.#scrubTip.hidden = false;
    this.#scrubTip.style.left = `${clientX - r.left}px`;
    if (this.#scrubTip.dataset.hunk !== hunk.id) {
      this.#scrubTip.dataset.hunk = hunk.id;
      replace(
        this.#scrubTip,
        h('span', { class: 'glyph-box', 'data-family': hunk.family, text: sceneHunkGlyph(hunk) }),
        h('span', { text: hunk.title }),
      );
    }
  }

  #renderSwipe(): void {
    const c = this.#ctx.controller;
    if (c.mode !== 'swipe') return;
    const pct = c.split * 100;
    this.#divider.style.left = `${pct}%`;
    attr(this.#divider, 'aria-valuenow', String(Math.round(pct)));
    attr(this.#divider, 'aria-valuetext', `${Math.round(pct)}%`);
  }

  #bindDivider(): void {
    const splitAt = (clientX: number): number => {
      const r = this.el.getBoundingClientRect();
      return r.width > 0 ? (clientX - r.left) / r.width : 0.5;
    };
    this.#divider.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.#dragging = e.pointerId;
      this.#divider.setPointerCapture?.(e.pointerId);
      this.#divider.classList.add('dragging');
      this.#divider.focus({ preventScroll: true });
    });
    this.#divider.addEventListener('pointermove', (e) => {
      if (this.#dragging === e.pointerId) this.#ctx.controller.setSplit(splitAt(e.clientX));
    });
    const end = (e: PointerEvent): void => {
      if (this.#dragging !== e.pointerId) return;
      this.#dragging = null;
      this.#divider.classList.remove('dragging');
    };
    this.#divider.addEventListener('pointerup', end);
    this.#divider.addEventListener('pointercancel', end);
    this.#divider.addEventListener('dblclick', () => this.#ctx.controller.setSplit(0.5));
    this.#divider.addEventListener('keydown', (e) => {
      const c = this.#ctx.controller;
      const to: Record<string, number> = {
        Home: 0,
        End: 1,
        PageUp: c.split - 0.1,
        PageDown: c.split + 0.1,
      };
      const next = to[e.key];
      if (next === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      c.setSplit(next);
    });
  }

  // ─── Tooltip ─────────────────────────────────────────────────────────────

  #renderTooltip(tr: Translator): void {
    const c = this.#ctx.controller;
    const scene = c.scene;
    const diff = c.diff;
    if (!scene || !diff || this.#dragging !== null) {
      attr(this.tooltip, 'data-open', 'false');
      return;
    }
    const parts: (Node | null)[] = [];
    let family: Family = 'neutral';
    if (c.hoverNode >= 0) {
      const sn = scene.nodes[c.hoverNode];
      const un = sn ? diff.index.node(sn.id) : undefined;
      if (!sn || !un) return;
      family = sn.family;
      const hunk = sn.hunk >= 0 ? scene.hunks[sn.hunk] : undefined;
      const rekey = un.facets.find((f) => f.kind === 'rekey');
      const degree = Math.max(un.degree.before, un.degree.after);
      parts.push(
        h('div', { class: 't-label', text: sn.label }),
        sn.labelBefore ? h('div', { class: 't-old', text: sn.labelBefore }) : null,
        h('div', {
          class: 't-id',
          text: rekey && rekey.kind === 'rekey' ? `${rekey.from} → ${rekey.to}` : sn.id,
        }),
        h(
          'div',
          { class: 't-status', 'data-family': family },
          h('span', { class: 'dot' }),
          sn.status === 'unchanged'
            ? tr.t('status.unchanged')
            : `${tr.t(`status.${sn.status}`)} · ${tr.t(`family.${family}`)}`,
        ),
        h('div', {
          class: 't-sum',
          text: hunk ? hunk.title : tr.plural('tooltip.relations', degree),
        }),
        h('div', { class: 't-hint', text: tr.t('tooltip.select') }),
      );
    } else if (c.hoverEdge >= 0) {
      const se = scene.edges[c.hoverEdge];
      if (!se) return;
      family = se.family;
      const s = scene.nodes[se.s]?.label ?? '';
      const t = scene.nodes[se.t]?.label ?? '';
      const hunk = se.hunk >= 0 ? scene.hunks[se.hunk] : undefined;
      parts.push(
        h('div', { class: 't-label', text: `${s} —${se.label}→ ${t}` }),
        se.labelBefore ? h('div', { class: 't-old', text: se.labelBefore }) : null,
        h(
          'div',
          { class: 't-status', 'data-family': family },
          h('span', { class: 'dot' }),
          tr.t(`status.${se.status}`),
        ),
        hunk ? h('div', { class: 't-sum', text: hunk.title }) : null,
      );
    } else if (c.hoverGroup >= 0) {
      const g = c.focus?.collapsed[c.hoverGroup];
      if (!g) return;
      parts.push(
        h('div', { class: 't-label', text: g.label }),
        h('div', {
          class: 't-hint',
          text: tr.t(c.canExpand(c.hoverGroup) ? 'focus.expand' : 'focus.expandUnavailable'),
        }),
      );
    }
    if (parts.length === 0) {
      attr(this.tooltip, 'data-open', 'false');
      return;
    }
    replace(this.tooltip, ...parts);
    attr(this.tooltip, 'data-open', 'true');
    this.#placeTooltip();
  }

  #placeTooltip(): void {
    const p = this.#pointer;
    if (!p) {
      attr(this.tooltip, 'data-open', 'false');
      return;
    }
    const w = this.tooltip.offsetWidth;
    const hgt = this.tooltip.offsetHeight;
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    let x = p.x + 16;
    let y = p.y + 18;
    if (x + w > W - 8) x = Math.max(8, p.x - w - 12);
    if (y + hgt > H - 8) y = Math.max(8, p.y - hgt - 12);
    this.tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  // ─── States ──────────────────────────────────────────────────────────────

  #renderState(tr: Translator): void {
    const c = this.#ctx.controller;
    const stats = c.diff?.stats;
    let key: string = c.status;
    if (c.status === 'loading') key += `|${c.step}|${c.steps.join(',')}`;
    if (c.status === 'ready') key += stats?.identical ? '|identical' : '';
    key += `|${tr.locale}`;
    if (c.status === 'error') key += `|${c.error?.message}`;
    if (key === this.#stateKey) return;
    this.#stateKey = key;
    this.#state.classList.remove('blocking');
    if (c.status === 'ready' && !stats?.identical) {
      this.#state.hidden = true;
      replace(this.#state);
      return;
    }
    this.#state.hidden = false;
    if (c.status === 'loading') {
      this.#state.classList.add('blocking');
      const current = c.step ? c.steps.indexOf(c.step) : -1;
      replace(
        this.#state,
        h('div', { class: 'skeleton-grid', 'aria-hidden': 'true' }),
        h(
          'div',
          { class: 'state-card card', role: 'status', 'aria-live': 'polite' },
          h('h2', { text: tr.t('state.loading') }),
          h(
            'ol',
            { class: 'steps' },
            c.steps.map((s, i) =>
              h(
                'li',
                { 'data-state': i < current ? 'done' : i === current ? 'active' : 'pending' },
                h(
                  'span',
                  { class: 'mark', 'aria-hidden': 'true' },
                  i < current ? icon('check') : null,
                ),
                h('span', { text: `${tr.t(`step.${s}`)}${i === current ? '…' : ''}` }),
              ),
            ),
          ),
        ),
      );
    } else if (c.status === 'error') {
      this.#state.classList.add('blocking');
      const err = c.error;
      const code = err instanceof KgdiffError ? err.code : err?.name;
      const details = [code ? `[${code}]` : '', err?.message ?? '', err?.stack ?? '']
        .filter(Boolean)
        .join('\n');
      replace(
        this.#state,
        h(
          'div',
          { class: 'state-card card error', role: 'alert' },
          h('div', { class: 'state-icon' }, icon('alert')),
          h('h2', { text: tr.t('state.error.title') }),
          h('p', { text: err?.message ?? '' }),
          h(
            'details',
            null,
            h('summary', { text: tr.t('state.error.details') }),
            h('pre', { text: details }),
          ),
        ),
      );
    } else if (c.status === 'ready' && stats?.identical) {
      replace(
        this.#state,
        h(
          'div',
          { class: 'state-card card ok', role: 'status' },
          h('div', { class: 'state-icon' }, icon('check-circle')),
          h('h2', { text: tr.t('state.identical.title') }),
          h('p', {
            text: tr.t('state.identical.body', {
              nodes: tr.plural('count.nodes', stats.after.nodes),
              edges: tr.plural('count.edges', stats.after.edges),
            }),
          }),
        ),
      );
    } else {
      this.#state.classList.add('blocking');
      replace(
        this.#state,
        h(
          'div',
          { class: 'state-card' },
          h('div', { class: 'state-icon' }, icon('overlay')),
          h('h2', { text: tr.t('state.empty.title') }),
          h('p', { text: tr.t('state.empty.body') }),
        ),
      );
    }
  }
}
