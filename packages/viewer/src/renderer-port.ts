/**
 * The seam between the viewer and `@kgdiff/renderer`. The controller only talks to the
 * `Renderer` / `Minimap` interfaces, and tests swap in a recording mock (there is no canvas in
 * happy-dom) with `setRenderBackend`.
 */
import {
  createMinimap,
  createRenderer,
  type Minimap,
  type MinimapOptions,
  type Renderer,
  type RendererOptions,
} from '@kgdiff/renderer';

export interface RenderBackend {
  createRenderer(container: HTMLElement, options: RendererOptions): Renderer;
  createMinimap(container: HTMLElement, renderer: Renderer, options?: MinimapOptions): Minimap;
}

const defaultBackend: RenderBackend = { createRenderer, createMinimap };

let backend: RenderBackend = defaultBackend;

export function renderBackend(): RenderBackend {
  return backend;
}

/** Replace the rendering backend (tests). `null` restores the canvas renderer. */
export function setRenderBackend(next: RenderBackend | null): void {
  backend = next ?? defaultBackend;
}
