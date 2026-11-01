/** Small DOM helpers shared by both pages. */

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from the page`);
  return el as T;
}

type Child = Node | string | null | undefined | false;

/** `h('a', { class: 'x', href: '#' }, 'text', child)`: attributes are set as attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Readonly<Record<string, string | boolean | undefined>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

/** An inline `<svg><use href="#id"/></svg>` icon from the page sprite. */
export function useIcon(id: string, className = 'i'): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable (insecure context, permissions): select-and-copy fallback.
    const area = h('textarea', { readonly: true, 'aria-hidden': 'true' });
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

let toastTimer = 0;

/** Show a short status message in `#toast` (role=status, polite). */
export function toast(text: string, kind: 'ok' | 'error' = 'ok', ms = 2600): void {
  const el = document.getElementById('toast');
  if (!el) return;
  const label = el.querySelector('.toast-text');
  if (label) label.textContent = text;
  el.dataset.kind = kind;
  el.setAttribute('data-open', '');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.removeAttribute('data-open'), ms);
}

/**
 * Wire every `[data-copy]` (literal text) and `[data-copy-from]` (text of an element id)
 * button under `root`. The button shows a check for a moment; `onCopied` announces it.
 */
export function wireCopyButtons(root: ParentNode, onCopied: (ok: boolean) => void): void {
  root.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLButtonElement>('[data-copy], [data-copy-from]');
    if (!button) return;
    const from = button.dataset.copyFrom;
    const text = from ? (document.getElementById(from)?.textContent ?? '') : button.dataset.copy;
    if (!text) return;
    void copyText(text).then((ok) => {
      if (ok) {
        button.setAttribute('data-copied', '');
        window.setTimeout(() => button.removeAttribute('data-copied'), 1600);
      }
      onCopied(ok);
    });
  });
}

/** Whether the user asked for reduced motion. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Arrow-key navigation for an ARIA tablist (roving tabindex, automatic activation).
 * `select(tab)` is called for clicks and keyboard moves.
 */
export function wireTablist(list: HTMLElement, select: (tab: HTMLButtonElement) => void): void {
  const tabs = (): HTMLButtonElement[] => [
    ...list.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ];
  list.addEventListener('click', (event) => {
    const tab = (event.target as Element | null)?.closest<HTMLButtonElement>('[role="tab"]');
    if (tab) select(tab);
  });
  list.addEventListener('keydown', (event) => {
    const all = tabs();
    const current = all.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % all.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = (current - 1 + all.length) % all.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = all.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const tab = all[next];
    if (!tab) return;
    tab.focus();
    select(tab);
  });
}

/** Mark the selected tab (aria-selected + roving tabindex). */
export function setSelectedTab(list: HTMLElement, selected: HTMLButtonElement): void {
  for (const tab of list.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
    const on = tab === selected;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
}
