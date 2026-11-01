/**
 * Scope the viewers' keyboard shortcuts to the viewer the user is working with.
 *
 * `<kgdiff-viewer>` listens for shortcuts on `document` and, when nothing is focused, lets the
 * first viewer on the page answer them (↑ ↓ Home End, Space in replay, 1–4…). That suits a
 * full-page viewer (the playground, HTML reports) but hijacks scrolling on a page that merely
 * embeds viewers. Here keys that reach <body> are stopped before they bubble to `document`,
 * and a click on a viewer's canvas focuses that viewer, so its shortcuts work while it is in
 * use.
 */
export function scopeViewerShortcuts(viewers: readonly HTMLElement[]): void {
  document.body.addEventListener('keydown', (event) => {
    const path = event.composedPath();
    if (!viewers.some((v) => path.includes(v))) event.stopPropagation();
  });
  for (const viewer of viewers) {
    if (!viewer.hasAttribute('tabindex')) viewer.tabIndex = -1;
    viewer.addEventListener('pointerdown', (event) => {
      const first = event.composedPath()[0];
      if (first instanceof HTMLCanvasElement && document.activeElement !== viewer) {
        viewer.focus({ preventScroll: true });
      }
    });
  }
}
