/**
 * The keyboard map (docs/interaction.md §Keyboard map), as a pure function from a key event to
 * an action, so it can be tested without a DOM.
 */
import type { ViewerMode, ViewerScope } from './index.js';

export type KeyAction =
  | { readonly type: 'mode'; readonly mode: ViewerMode }
  | { readonly type: 'scope' }
  | { readonly type: 'next' }
  | { readonly type: 'prev' }
  | { readonly type: 'first' }
  | { readonly type: 'last' }
  | { readonly type: 'fly' }
  | { readonly type: 'escape' }
  | { readonly type: 'play-pause' }
  | { readonly type: 'step'; readonly direction: 1 | -1 }
  | { readonly type: 'divider'; readonly delta: number }
  | { readonly type: 'fit' }
  | { readonly type: 'zoom'; readonly direction: 1 | -1 }
  | { readonly type: 'search' }
  | { readonly type: 'review' }
  | { readonly type: 'sidebar' }
  | { readonly type: 'theme' }
  | { readonly type: 'expand' }
  | { readonly type: 'help' };

export interface KeyLike {
  readonly key: string;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}

const MODE_KEYS: Readonly<Record<string, ViewerMode>> = {
  '1': 'overlay',
  '2': 'swipe',
  '3': 'replay',
};

/** Divider steps for swipe, as a fraction of the width. */
export const DIVIDER_STEP = 0.02;
export const DIVIDER_STEP_LARGE = 0.1;

/**
 * Map a key press to an action in `mode` and `scope`, or null when the key means nothing here.
 * Chords with Ctrl / Meta / Alt are never handled (they belong to the browser and the host page).
 */
export function keyAction(
  e: KeyLike,
  mode: ViewerMode,
  scope: ViewerScope = 'all',
): KeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const key = e.key;
  const mapped = MODE_KEYS[key];
  if (mapped !== undefined) return { type: 'mode', mode: mapped };
  switch (key) {
    case '4':
      return { type: 'scope' };
    case 'j':
    case 'ArrowDown':
      return { type: 'next' };
    case 'k':
    case 'ArrowUp':
      return { type: 'prev' };
    case 'Home':
      return { type: 'first' };
    case 'End':
      return { type: 'last' };
    case 'Enter':
      return { type: 'fly' };
    case 'Escape':
      return { type: 'escape' };
    case ' ':
    case 'Spacebar':
      return mode === 'replay' ? { type: 'play-pause' } : null;
    case 'ArrowLeft':
    case 'ArrowRight': {
      const direction = key === 'ArrowRight' ? 1 : -1;
      if (mode === 'replay') return { type: 'step', direction };
      if (mode === 'swipe') {
        return {
          type: 'divider',
          delta: direction * (e.shiftKey ? DIVIDER_STEP_LARGE : DIVIDER_STEP),
        };
      }
      return null;
    }
    case 'f':
    case 'F':
      return { type: 'fit' };
    case '+':
    case '=':
      return { type: 'zoom', direction: 1 };
    case '-':
    case '_':
    case '−':
      return { type: 'zoom', direction: -1 };
    case '/':
      return { type: 'search' };
    case 'x':
    case 'X':
      return { type: 'review' };
    case '\\':
      return { type: 'sidebar' };
    case 't':
    case 'T':
      return { type: 'theme' };
    case 'e':
    case 'E':
      return scope === 'changes' ? { type: 'expand' } : null;
    case '?':
      return { type: 'help' };
    default:
      return null;
  }
}

/** Whether a key event comes from a place where the user types (shortcuts must not fire). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || typeof (target as Element).tagName !== 'string') return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = ((el as HTMLInputElement).type ?? 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(
      type,
    );
  }
  return el.isContentEditable === true || el.getAttribute?.('contenteditable') === 'true';
}
