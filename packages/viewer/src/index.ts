/**
 * @kgdiff/viewer: the drop-in `<kgdiff-viewer>` web component.
 *
 * Importing this module defines `<kgdiff-viewer>` (if not yet defined).
 * Behaviour: docs/interaction.md. Visuals: docs/visual-language.md.
 *
 * Modules: `element.ts` (the custom element), `controller.ts` (state, load pipeline, replay
 * clock, camera follow), `ui/*` (header, sidebar, detail panel, canvas chrome, popovers),
 * `i18n.ts`, `styles.ts`, `review-store.ts`, `hash-sync.ts`, `payload.ts`, `text-diff.ts`,
 * `keyboard.ts`.
 */
import type {
  Delta,
  DiffJSON,
  DiffOptions,
  DiffStats,
  GraphInput,
  KGraph,
  Locale,
} from '@kgdiff/core';
import type { ParseOptions } from '@kgdiff/formats';
import type { LayoutJSON, LayoutOptions } from '@kgdiff/layout';
import type { PaletteName } from '@kgdiff/scene';
import { KgdiffViewer } from './element.js';
import { hydrate } from './payload.js';
import { viewerTags } from './registry.js';

export type ViewerMode = 'overlay' | 'swipe' | 'replay' | 'changes';
export type ThemePreference = 'auto' | 'light' | 'dark';

/** A precomputed diff + layout: what the CLI embeds in HTML reports. Deterministic. */
export interface ReportPayload {
  readonly format: 'kgdiff.report';
  readonly version: 1;
  readonly diff: DiffJSON;
  readonly layout: LayoutJSON;
  readonly meta: {
    readonly title?: string;
    /** e.g. `kgdiff 0.1.0`. */
    readonly generator: string;
    /** ISO timestamp; omitted for reproducible reports. */
    readonly generatedAt?: string;
    readonly before: { readonly name: string; readonly format?: string };
    readonly after: { readonly name: string; readonly format?: string };
  };
  /** Initial view preferences. */
  readonly view?: {
    readonly mode?: ViewerMode;
    readonly theme?: ThemePreference;
    readonly palette?: PaletteName;
    readonly locale?: Locale;
  };
}

/** A graph to load: already structured, or text to parse with @kgdiff/formats. */
export type GraphSource =
  | GraphInput
  | KGraph
  | { readonly text: string; readonly filename?: string; readonly parse?: ParseOptions };

export interface LoadOptions {
  readonly before: GraphSource;
  readonly after: GraphSource;
  readonly diff?: DiffOptions;
  readonly layout?: LayoutOptions;
  readonly names?: { readonly before?: string; readonly after?: string };
  readonly title?: string;
}

export interface ReviewState {
  /** Reviewed hunk ids, in review order. */
  readonly reviewed: readonly string[];
  readonly total: number;
}

export interface KgdiffViewerEventMap {
  'kgdiff-ready': CustomEvent<{ readonly stats: DiffStats }>;
  'kgdiff-select': CustomEvent<{ readonly hunk: string | null; readonly node: string | null }>;
  'kgdiff-mode': CustomEvent<{ readonly mode: ViewerMode }>;
  'kgdiff-review': CustomEvent<{
    readonly hunk: string;
    readonly reviewed: boolean;
    readonly progress: ReviewState;
  }>;
  'kgdiff-error': CustomEvent<{ readonly error: Error }>;
}

/**
 * Public surface of the `<kgdiff-viewer>` element.
 *
 * Boolean attributes: `sync-hash` (deep links `#kgdiff=hunk:<id>;mode:<mode>`) and
 * `global-shortcuts`: keyboard shortcuts normally apply only while focus is inside the viewer;
 * with this attribute they also apply when nothing on the page has focus (for full-page
 * viewers such as HTML reports), except the keys pages scroll with (arrows, Home / End, Page
 * Up / Down, Space).
 */
export interface KgdiffViewerElement extends HTMLElement {
  /** Reflected to the `mode` attribute. Default `overlay` (`changes` for large graphs). */
  mode: ViewerMode;
  /** Reflected to the `theme` attribute. Default `auto`. */
  theme: ThemePreference;
  /** Reflected to the `palette` attribute. Default `default`. */
  palette: PaletteName;
  /** Reflected to the `locale` attribute. Default from `navigator.language`. */
  locale: Locale;
  /** Set a precomputed report (no diff / layout work in the browser). */
  payload: ReportPayload | null;
  /** Parse (if needed), diff, lay out and show two graphs. Rejects with a KgdiffError on bad input. */
  load(options: LoadOptions): Promise<void>;
  /** Select a hunk by id (null clears) and bring it into view. */
  selectHunk(id: string | null): void;
  next(): void;
  prev(): void;
  play(): void;
  pause(): void;
  fit(): Promise<void>;
  /** The full delta of the current diff. */
  exportDelta(): Delta;
  reviewState(): ReviewState;
  setReviewed(hunkId: string, reviewed: boolean): void;
}

/**
 * Global through which the optional compute add-on (`@kgdiff/viewer/standalone/compute`, i.e.
 * `kgdiff-viewer-compute.js`) hands the diff engine and force layout to the standalone viewer:
 * the add-on assigns `globalThis[COMPUTE_GLOBAL]`. The viewer reads it lazily, each time it needs
 * them (`load()`, expanding a group outside a `changes`-scoped layout), so the add-on can be
 * inlined right after the viewer bundle — or loaded later — without a reload. Without it,
 * reports work fully except those two features (the expand pill says why). The ES module build
 * does not need it: it imports the same code on demand.
 */
export { COMPUTE_GLOBAL } from './compute-loader.js';

/** MIME type of the `<script>` element that carries an embedded report payload. */
export const PAYLOAD_SCRIPT_TYPE = 'application/kgdiff+json';

let constructorUsed = false;

/** Define the custom element under `tagName` (idempotent). Called automatically on import. */
export function defineViewer(tagName = 'kgdiff-viewer'): void {
  if (typeof customElements === 'undefined') return;
  const name = tagName.toLowerCase();
  if (customElements.get(name) === undefined) {
    // A constructor can be registered once: further names get a trivial subclass.
    const ctor = constructorUsed ? class extends KgdiffViewer {} : KgdiffViewer;
    customElements.define(name, ctor);
    constructorUsed = true;
  }
  viewerTags.add(name);
}

/**
 * Read embedded payloads: every `<script type="application/kgdiff+json">` (optionally with
 * `data-encoding="gzip-base64"`) is decoded and assigned to the `<kgdiff-viewer>` it targets
 * (`data-for="<element id>"`, else the first viewer in the document).
 */
export function hydrateEmbeddedPayloads(root?: ParentNode): Promise<void> {
  const scope = root ?? (typeof document !== 'undefined' ? document : undefined);
  return scope ? hydrate(scope) : Promise.resolve();
}

declare global {
  interface HTMLElementTagNameMap {
    'kgdiff-viewer': KgdiffViewerElement;
  }
}

defineViewer();
