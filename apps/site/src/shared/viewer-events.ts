import type { KgdiffViewerElement, KgdiffViewerEventMap } from '@kgdiff/viewer';

/** Typed `addEventListener` for the viewer's `kgdiff-*` events. */
export function onViewer<K extends keyof KgdiffViewerEventMap>(
  viewer: KgdiffViewerElement,
  type: K,
  listener: (event: KgdiffViewerEventMap[K]) => void,
): void {
  viewer.addEventListener(type, (event) => listener(event as KgdiffViewerEventMap[K]));
}
