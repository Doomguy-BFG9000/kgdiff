# kgdiff viewer interaction design

Behaviour of `<kgdiff-viewer>` (package `@kgdiff/viewer`). Visual tokens and encodings come
from [visual-language.md](visual-language.md).

## Layout

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ kgdiff   go.obo  v2026-09 → v2026-10     ⟨Overlay│Swipe│Replay│Changes⟩   +12 −3 ~8  ◐ ? │  header 52px
├──────────────────────────────────────────────────────────────────┬─────────────────────┤
│                                                                  │ Changes  23   ⌕     │
│                                                                  │ ●Added ●Removed …   │  filter chips
│                          canvas                                  │ ▍Merged “A” into “B”│
│                                                                  │ ▍Renamed “x” → “y”  │  hunk list
│                                                                  │ …                   │
│  ┌legend┐                                          ┌minimap┐     ├─────────────────────┤
│  └──────┘        ⟨ ◀  ▶‖  ▶  ━━━●━━━━━━━  3/23  1× ⟩ └───────┘     │ detail panel        │
└──────────────────────────────────────────────────────────────────┴─────────────────────┘
```

- Sidebar 360 px (collapsible with `\` or the header button). Below 760 px wide it becomes a
  bottom sheet (40% height, draggable handle) and the mode control shows icons only.
- Floating chrome (legend, minimap, transport) uses overlay surfaces and never covers the
  current hunk: the renderer's `safeArea` reserves their space when fitting.

## Header

- Brand mark + "before → after" names (from graph meta / file names), version tags.
- Mode segmented control: **Overlay** (`1`), **Swipe** (`2`), **Replay** (`3`), **Changes only**
  (`4`). Changing mode keeps the camera.
- Diffstat pills (family colors): `+N` added, `−N` removed, `~N` modified, `⇄N` restructured,
  each a filter shortcut.
- Theme toggle (auto / light / dark), palette toggle (default / color-blind safe) in a menu,
  fit-to-view, help (`?`).

## Modes

**Overlay.** Union layer. Hover a node: tooltip card (label, id, status, one-line summary).
Click: select its hunk (or the node if unchanged). Click empty canvas: clear selection.

**Swipe.** Before on the left, after on the right of a vertical divider (default 50%). Drag
the handle (or the divider anywhere along it), `←` / `→` move 2% (`Shift` 10%), double-click
resets. "Before" / "After" chips in the top corners. Selection still works on both sides.

**Replay.** The before graph morphs into the after graph hunk by hunk (timeline from the
scene). Transport: previous / play-pause / next, scrubber with one tick per hunk (family
color, hover shows the title), position `3 / 23`, speed `0.5× 1× 2× 4×`. `Space` play/pause,
`←` / `→` step. Selecting a hunk in the list seeks to the end of its window. The camera follows
the current hunk unless the user has panned/zoomed in the last 2 s. Reaching the end shows
"Replay finished · Restart".

**Changes only.** Focus view: changed elements + 1 hop of context (stepper 0 / 1 / 2 in the
canvas toolbar); hidden nodes summarized as "+38 unchanged" pills; click a pill to expand it
(positions via `extendLayout`, so nothing else moves). Default for graphs above the large-graph
threshold.

## Change list (sidebar)

- Header: "Changes" + count, search field (`/`): fuzzy match over node labels, aliases and ids
  across the whole graph; results show status dots; choosing one flies to the node and selects
  its hunk.
- Filter chips per family with counts (multi-select; none = all). Filtering dims non-matching
  hunks on the canvas and hides them from the list.
- Rows grouped by phase (Removed, Restructured, Modified, Added) with sticky group headers.
  Row: 3 px family bar, glyph (`+ − ~ ⇄ ⊕ ⑂`), title (one line, ellipsis, full on hover),
  subtitle (muted), and a round "reviewed" toggle. Selected row: raised surface + accent outline.
- Keyboard: `j` / `↓` next, `k` / `↑` previous, `Enter` fly to it, `x` toggle reviewed,
  `Home` / `End`. The list is a `listbox` with `aria-activedescendant`.
- Review progress bar under the header: "7 of 23 reviewed". Review state persists in
  `localStorage` keyed by `base.hash → target.hash` (wrapped in try/catch).

## Detail panel

For the selected hunk (or node), what changed comes first and the unchanged rest last:

- Title, family pill, prev / next arrows, reviewed toggle.
- Changes: one row per changed facet, before → after.
  - Name and id: character-level diff highlighting; a rekey adds its match confidence.
  - Attributes: one row per key. Text gets a word-level diff; values over 60 characters (both
    sides together) get a line per side, truncated with expand. `+` / `−` mark added and
    removed keys.
  - Synonyms, types, parents and list values: a lone removal and addition read as one edit
    (`老赖 → 失信人`). Otherwise removals and additions sharing at least half their characters
    pair up, closest first; the rest are chips with `+` / `−`.
  - Deprecation, and replacement links named by the nodes they point at.
- Merge / split composition: sources → target with confidence and "via hint / heuristic".
- Relations: changed edges as sentences — `→ holds → 上市公司 (was 企业)`, each clickable.
- Match evidence (rekeys and suggestions): bars for label / neighbours / types / attrs.
- Overview: id, types, synonyms and status that did not change. The unchanged attributes are
  folded behind a toggle.
- Added and removed nodes, and an unchanged node clicked on its own, lead with the overview and
  all their attributes, then their relations.

## Keyboard map

| Key               | Action                                  |
| ----------------- | --------------------------------------- |
| `1` `2` `3` `4`   | Overlay / Swipe / Replay / Changes only |
| `j` `↓` / `k` `↑` | Next / previous change                  |
| `Enter`           | Fly to the selected change              |
| `Esc`             | Clear selection, close popovers         |
| `Space`           | Play / pause (replay)                   |
| `←` `→`           | Step (replay) · move divider (swipe)    |
| `f`               | Fit everything                          |
| `+` `−`           | Zoom in / out                           |
| `/`               | Search                                  |
| `x`               | Toggle reviewed                         |
| `\`               | Toggle sidebar                          |
| `t`               | Cycle theme                             |
| `?`               | Shortcut help                           |

Shortcuts are ignored while typing in an input.

## Embedding API

```html
<kgdiff-viewer theme="auto" locale="zh-CN" mode="overlay"></kgdiff-viewer>
<script type="module">
  import '@kgdiff/viewer';
  const viewer = document.querySelector('kgdiff-viewer');
  await viewer.load({ before, after, options }); // GraphInput | KGraph | { text, filename }
  // or: viewer.payload = reportPayload;         // precomputed (CLI report)
</script>
```

Attributes / properties: `mode`, `theme` (`auto|light|dark`), `palette`, `locale` (`en|zh-CN`,
default from `navigator.language`), `sidebar` (`open|closed`), `sync-hash` (deep links
`#kgdiff=hunk:<id>;mode:<mode>`), `header` (`compact` leaves the brand and the compared names
out, for hosts that show their own). Methods: `load()`, `selectHunk(id)`, `next()`, `prev()`,
`play()`, `pause()`, `fit()`, `exportDelta()`, `reviewState()`. Events (`CustomEvent`, bubbling,
composed): `kgdiff-ready` `{ stats }`, `kgdiff-select` `{ hunk, node }`, `kgdiff-mode`
`{ mode }`, `kgdiff-review` `{ hunk, reviewed, progress }`, `kgdiff-error` `{ error }`.

## States

- **Loading**: skeleton canvas + step text ("Parsing… · Matching nodes… · Laying out…").
- **Identical**: calm empty state — "No differences. Both versions have 512 nodes and 1,490
  edges." with a subtle check glyph.
- **Error**: message + details disclosure; never a blank screen.

## Accessibility

- Every control is a real button / input with an accessible name; visible focus rings (accent).
- Canvas has `role="img"` and an `aria-label` summary (stats); a polite live region announces
  "Change 3 of 23: Renamed “x” to “y”" on navigation.
- Contrast tokens are tested; color is never the only cue; reduced motion respected.
- All features reachable by keyboard; pointer targets ≥ 28 px.

## Internationalization

UI strings in `en` and `zh-CN`; hunk titles from core `formatHunk`; numbers via
`Intl.NumberFormat`. Chinese UI uses 「」 quotes, English “ ”.
