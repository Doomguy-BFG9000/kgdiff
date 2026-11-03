# kgdiff viewer interaction design

Behaviour of `<kgdiff-viewer>` (package `@kgdiff/viewer`). Visual tokens and encodings come
from [visual-language.md](visual-language.md).

## Layout

```
┌──────────────────────────────────────────────────────────────────┬─────────────────────┐
│ ⟨◆ kgdiff │ go.obo  v2026-09 → v2026-10⟩                ⟨◐ ? ▥⟩ │ Changes  23   ⌕     │
│                                                                  │ ◉Added ◌Removed …   │  filter chips
│                                                                  │ ▍Merged “A” into “B”│
│                          canvas                                  │ ▍Renamed “x” → “y”  │  hunk list
│                                                                  │ …                   │
│               ⟨ ◀  ▶‖  ▶  ━━━●━━━━━━━  3/23  1× ⟩    (replay)   │                     │
│ ⟨Legend ▾⟩  ⟨Overlay│Swipe│Replay ┊ ◎ Changes only  0 1 2⟩  ┌map┐├─────────────────────┤
│                                                         ⟨+−⤢⟩└───┘│ detail panel        │
└──────────────────────────────────────────────────────────────────┴─────────────────────┘
```

- Sidebar 360 px, full height (collapsible with `\` or the sidebar button). Below 760 px wide it
  becomes a bottom sheet (40% height, draggable handle).
- Everything else floats over the canvas on overlay surfaces and never covers the current hunk:
  fits and flights frame it in the free part of the canvas.

## Canvas chrome

- **Title** (top left): brand mark + "before → after" names (from graph meta / file names),
  version tags. `header="compact"` leaves it out, for hosts that show their own.
- **Actions** (top right): appearance menu (theme auto / light / dark, palette default /
  color-blind safe, language), help (`?`), sidebar toggle.
- **View dock** (bottom center) holds two independent choices:
  - **Mode**: **Overlay** (`1`), **Swipe** (`2`), **Replay** (`3`). They tell before from after
    by color, by space and by time, so exactly one is active. Changing mode keeps the camera.
  - **Changes only** (`4`): a scope that works with any mode. While on, the dock shows the
    context hops 0 / 1 / 2 and “+N”, which expands the hidden context nearest the selection
    (`e`). It stays on when the layout covers only the changes (large graphs); the toggle
    then says why.
  - Replay's caption (the playing hunk) and transport stack above the dock; at the end
    "Replay finished · Restart" takes the caption's place.
  - Narrower canvases drop the labels (each control keeps its name as a tooltip).
- **Legend** (bottom left), collapsed by default: the sidebar's filter chips wear the same
  swatches.
- **Zoom** (+ / − / fit) bottom right. The **minimap** next to it appears only while part of
  the content is out of view.

## Modes

**Overlay.** Union layer. Hover a node: tooltip card (label, id, status, one-line summary).
Click: select its hunk (or the node if unchanged). Click empty canvas: clear selection.

**Swipe.** Before on the left, after on the right of a vertical divider (default 50%). Drag
the handle (or the divider anywhere along it), `←` / `→` move 2% (`Shift` 10%), double-click
resets. "Before" / "After" chips under the title and the actions. Selection still works on both
sides.

**Replay.** The before graph morphs into the after graph hunk by hunk (timeline from the
scene). Transport: previous / play-pause / next, scrubber with one tick per hunk (family
color, hover shows the title), position `3 / 23`, speed `0.5× 1× 2× 4×`. `Space` play/pause,
`←` / `→` step. Selecting a hunk in the list seeks to the end of its window. The camera follows
the current hunk unless the user has panned/zoomed in the last 2 s. Reaching the end shows
"Replay finished · Restart".

**Changes only (scope).** Focus view in any mode: changed elements + 1 hop of context (0 / 1 /
2 in the dock); hidden nodes summarized as "+38 unchanged" pills; click a pill to expand it
(positions via `extendLayout`, so nothing else moves). Swipe focuses both sides; replay plays
within the focus. Default for graphs above the large-graph threshold.

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

| Key               | Action                               |
| ----------------- | ------------------------------------ |
| `1` `2` `3`       | Overlay / Swipe / Replay             |
| `4`               | Changes only (on / off, in any mode) |
| `e`               | Expand hidden context (changes only) |
| `j` `↓` / `k` `↑` | Next / previous change               |
| `Enter`           | Fly to the selected change           |
| `Esc`             | Clear selection, close popovers      |
| `Space`           | Play / pause (replay)                |
| `←` `→`           | Step (replay) · move divider (swipe) |
| `f`               | Fit everything                       |
| `+` `−`           | Zoom in / out                        |
| `/`               | Search                               |
| `x`               | Toggle reviewed                      |
| `\`               | Toggle sidebar                       |
| `t`               | Cycle theme                          |
| `?`               | Shortcut help                        |

Shortcuts are ignored while typing in an input.

## Embedding API

```html
<kgdiff-viewer theme="auto" locale="zh-CN" mode="replay" scope="changes"></kgdiff-viewer>
<script type="module">
  import '@kgdiff/viewer';
  const viewer = document.querySelector('kgdiff-viewer');
  await viewer.load({ before, after, options }); // GraphInput | KGraph | { text, filename }
  // or: viewer.payload = reportPayload;         // precomputed (CLI report)
</script>
```

Attributes / properties: `mode` (`overlay|swipe|replay`; the legacy `changes` reads as
`overlay` + `scope="changes"`), `scope` (`all|changes`, default `changes` for large graphs),
`theme` (`auto|light|dark`), `palette`, `locale` (`en|zh-CN`, default from
`navigator.language`), `sidebar` (`open|closed`), `sync-hash` (deep links
`#kgdiff=hunk:<id>;mode:<mode>;scope:<scope>`; old `mode:changes` links still work), `header`
(`compact` leaves the brand and the compared names out, for hosts that show their own),
`chrome` (`none` shows the graph alone for small embeds: no title, actions, view dock with its
step caption and playback bar, change list, zoom buttons, minimap or legend card; the hover
tooltip and a one-line legend stay, clicks and shortcuts do nothing, the minimum height drops
to 120px and the view stays fitted on resize and at each loop), `legend`
(`auto|full|mini|none`), `loop` (the replay plays by itself and starts again after `loop-delay`
ms, default 1200), `pause-on-hover` (`false` keeps a looping replay playing under the mouse).
Methods: `load()`, `selectHunk(id)`, `next()`, `prev()`, `play()`, `pause()`,
`fit({ animate, padding })` (labels included), `exportDelta()`, `reviewState()`. Events
(`CustomEvent`, bubbling, composed): `kgdiff-ready` `{ stats }`, `kgdiff-select`
`{ hunk, node }`, `kgdiff-mode` `{ mode, scope }`, `kgdiff-review`
`{ hunk, reviewed, progress }`, `kgdiff-error` `{ error }`, `kgdiff-replay-end` `{ loop }`
(playback reached the end; `loop`: it starts again).

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
