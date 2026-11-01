# @kgdiff/renderer

A high-DPI Canvas 2D renderer for [`@kgdiff/scene`](../scene) frames: smooth camera (pan, zoom,
fly-to), level of detail, collision-free label placement, hit testing, swipe clipping and a
minimap. It draws pixels and knows nothing about diffs, so the same frames can also go to
[`@kgdiff/g6`](../g6) or your own renderer.

## Install

```sh
pnpm add @kgdiff/renderer @kgdiff/scene @kgdiff/layout @kgdiff/core
```

ESM only. Runs in evergreen browsers (it needs a DOM and Canvas 2D).

## Quick start

```ts
import { diff } from '@kgdiff/core';
import { layoutDiff } from '@kgdiff/layout';
import { createMinimap, createRenderer } from '@kgdiff/renderer';
import { buildScene, createViewState, createVisualResolver, getTheme } from '@kgdiff/scene';

const result = diff(before, after);
const scene = buildScene(result, layoutDiff(result), { theme: 'dark' });
const resolver = createVisualResolver(scene);

// The container needs a size (CSS); the canvas follows it through a ResizeObserver.
const container = document.getElementById('graph') as HTMLElement;
const renderer = createRenderer(container, { theme: getTheme('dark') });
let frame = resolver.resolve(createViewState());
renderer.setFrame(frame); // the first frame with content is fitted automatically

renderer.on('click', ({ pick }) => {
  if (pick?.type !== 'node') return;
  frame = resolver.resolve(createViewState({ selectedNode: pick.index }), frame);
  renderer.setFrame(frame);
});

createMinimap(document.getElementById('minimap') as HTMLElement, renderer).update(frame);
```

`setFrame` only marks the view dirty; drawing happens on the next animation frame and the loop
sleeps when nothing changes. Pass `{ split, before, after }` to `setFrame` for a swipe view.

## Learn more

- [Visual language § Level of detail and label placement](../../docs/visual-language.md#level-of-detail-and-label-placement)
  and [§ Rendering quality bars](../../docs/visual-language.md#rendering-quality-bars).
- [Interaction](../../docs/interaction.md): how the viewer drives the camera and picking.

## License

[MIT](../../LICENSE)
