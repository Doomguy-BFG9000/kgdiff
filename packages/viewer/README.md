# @kgdiff/viewer

`<kgdiff-viewer>`, a framework-agnostic web component for reviewing graph diffs. Four views
(Overlay, Swipe, Replay and Changes only), a searchable change list, a detail panel with
character-level diffs, review progress, deep links, keyboard shortcuts, light and dark themes, and
an English and Chinese UI.

## Install

```sh
pnpm add @kgdiff/viewer
```

ESM only. Runs in evergreen browsers.

## Quick start

```html
<kgdiff-viewer theme="auto" locale="en" style="height: 640px"></kgdiff-viewer>
<script type="module">
  import '@kgdiff/viewer'; // defines <kgdiff-viewer>

  const viewer = document.querySelector('kgdiff-viewer');
  viewer.addEventListener('kgdiff-ready', (event) => console.log(event.detail.stats));
  await viewer.load({
    before: { text: await (await fetch('v1.ttl')).text(), filename: 'v1.ttl' },
    after: { text: await (await fetch('v2.ttl')).text(), filename: 'v2.ttl' },
  });
</script>
```

- `load()` also takes structured graphs (`{ nodes, edges }`). The parsers, the diff engine and the
  force layout are imported on demand, so they stay out of your initial bundle.
- To show a precomputed diff without any work in the browser, set `viewer.payload` to a report
  payload: that is what the `kgdiff` CLI embeds in its HTML reports.
- Without a bundler, `@kgdiff/viewer/standalone` (`dist/standalone/kgdiff-viewer.js`) is a
  self-contained script that defines the element and shows embedded payloads. The optional
  `@kgdiff/viewer/standalone/compute` add-on brings the diff engine and force layout for `load()`.

Attributes: `mode` (`overlay` | `swipe` | `replay` | `changes`), `theme`, `palette`, `locale`,
`sidebar`, `sync-hash`, `global-shortcuts`. Methods: `load`, `selectHunk`, `next`, `prev`, `play`, `pause`,
`fit`, `exportDelta`, `reviewState`, `setReviewed`. Events: `kgdiff-ready`, `kgdiff-select`,
`kgdiff-mode`, `kgdiff-review`, `kgdiff-error`.

## Learn more

- [Interaction](../../docs/interaction.md): views, change list, keyboard map and the
  [embedding API](../../docs/interaction.md#embedding-api).
- [Visual language](../../docs/visual-language.md): what every color, ring and glyph means.

## License

[MIT](../../LICENSE)
