/// <reference types="vite/client" />
/**
 * Dev harness: every example dataset (examples/datasets + the synthetic 10k graph) with its
 * meta.json options, locale / theme / palette / width toggles, an 800 × 320 looping replay strip
 * (`chrome="none" loop`), payload import / export and a report round-trip through an embedded
 * gzip-base64 payload. Choices persist in the URL.
 */
import { diffToJSON, type GraphInput, type Locale } from '@kgdiff/core';
import { layoutToJSON } from '@kgdiff/layout';
import type { PaletteName } from '@kgdiff/scene';
import {
  type GraphSource,
  hydrateEmbeddedPayloads,
  type ReportPayload,
  type ThemePreference,
} from '@kgdiff/viewer';
import type { KgdiffViewer } from '../src/element.js';

interface DatasetMeta {
  readonly id: string;
  readonly title: Readonly<Record<Locale, string>>;
  readonly format: string;
  readonly files: { readonly before: string; readonly after: string };
  readonly versions?: { readonly before?: string; readonly after?: string };
  readonly options?: Record<string, unknown>;
}

interface IndexEntry {
  readonly id: string;
  readonly path: string;
}

const metas = import.meta.glob<DatasetMeta>(
  ['../../../examples/datasets/*/meta.json', '../../../examples/generated/*/meta.json'],
  { eager: true, import: 'default' },
);
const files = import.meta.glob<string>(
  [
    '../../../examples/datasets/*/before.*',
    '../../../examples/datasets/*/after.*',
    '../../../examples/generated/*/before.json',
    '../../../examples/generated/*/after.json',
  ],
  { query: '?raw', import: 'default' },
);
const index = import.meta.glob<{ datasets: IndexEntry[] }>(
  '../../../examples/datasets/index.json',
  {
    eager: true,
    import: 'default',
  },
);

interface Dataset {
  readonly key: string;
  readonly dir: string;
  readonly meta: DatasetMeta;
}

function datasets(): Dataset[] {
  const out: Dataset[] = [];
  for (const [path, meta] of Object.entries(metas)) {
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    const key = dir.split('/').slice(-2, -1)[0] ?? meta.id;
    out.push({ key, dir, meta });
  }
  const order = Object.values(index)[0]?.datasets.map((d) => d.id) ?? [];
  const rank = (d: Dataset): number => {
    const i = order.indexOf(d.key);
    return i < 0 ? order.length : i;
  };
  return out.sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));
}

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing`);
  return el as T;
}

const viewer = $<KgdiffViewer>('viewer');
const params = new URLSearchParams(location.search);
const all = datasets();

const datasetSelect = $<HTMLSelectElement>('dataset');
const localeSelect = $<HTMLSelectElement>('locale');
const themeSelect = $<HTMLSelectElement>('theme');
const paletteSelect = $<HTMLSelectElement>('palette');
const widthSelect = $<HTMLSelectElement>('width');
const embedSelect = $<HTMLSelectElement>('embed');

function syncUrl(): void {
  const p = new URLSearchParams();
  p.set('dataset', datasetSelect.value);
  p.set('locale', localeSelect.value);
  p.set('theme', themeSelect.value);
  if (paletteSelect.value !== 'default') p.set('palette', paletteSelect.value);
  if (widthSelect.value !== 'full') p.set('width', widthSelect.value);
  if (embedSelect.value !== 'off') p.set('embed', embedSelect.value);
  history.replaceState(null, '', `?${p.toString()}${location.hash}`);
}

for (const d of all) {
  const generated = d.dir.includes('/generated/');
  const opt = new Option(`${d.meta.title.en}${generated ? ' (large)' : ''}`, d.key);
  datasetSelect.appendChild(opt);
}

localeSelect.value = params.get('locale') ?? (navigator.language.startsWith('zh') ? 'zh-CN' : 'en');
themeSelect.value = params.get('theme') ?? 'auto';
paletteSelect.value = params.get('palette') ?? 'default';
widthSelect.value = params.get('width') ?? 'full';
embedSelect.value = params.get('embed') ?? 'off';
datasetSelect.value = params.get('dataset') ?? all[0]?.key ?? '';

viewer.locale = localeSelect.value as Locale;
viewer.theme = themeSelect.value as ThemePreference;
viewer.palette = paletteSelect.value as PaletteName;

function applyWidth(): void {
  const frame = $('frame');
  frame.classList.toggle('phone', widthSelect.value === 'phone');
  frame.classList.toggle('tablet', widthSelect.value === 'tablet');
}
applyWidth();

function applyEmbed(): void {
  const strip = embedSelect.value === 'strip';
  $('frame').classList.toggle('strip', strip);
  viewer.chrome = strip ? 'none' : 'full';
  viewer.loop = strip;
  if (strip) viewer.mode = 'replay';
}
applyEmbed();

async function source(d: Dataset, side: 'before' | 'after'): Promise<GraphSource> {
  const file = d.meta.files[side];
  const loader = files[`${d.dir}${file}`];
  if (!loader) throw new Error(`Missing ${d.dir}${file}`);
  const text = await loader();
  if (d.meta.format === 'json') return JSON.parse(text) as GraphInput;
  return { text, filename: file };
}

async function loadDataset(key: string): Promise<void> {
  const d = all.find((x) => x.key === key);
  if (!d) return;
  const [before, after] = await Promise.all([source(d, 'before'), source(d, 'after')]);
  const locale = localeSelect.value as Locale;
  const title = d.meta.title[locale] ?? d.meta.title.en;
  const large = d.dir.includes('/generated/');
  await viewer.load({
    before,
    after,
    diff: d.meta.options as never,
    title,
    names: { before: title, after: title },
    // The synthetic graph is laid out without extra context to keep the layout fast.
    ...(large ? { layout: { contextHops: 0 } } : {}),
  });
}

/** A newer load superseded this one (AbortError): nothing to report. */
function ignoreAbort(error: unknown): void {
  if ((error as Error | null)?.name !== 'AbortError') console.error(error);
}

function currentPayload(): ReportPayload | null {
  const data = viewer.controller.data;
  if (!data) return null;
  return {
    format: 'kgdiff.report',
    version: 1,
    diff: diffToJSON(data.diff),
    layout: layoutToJSON(data.layout),
    meta: {
      generator: 'kgdiff viewer harness',
      ...(data.title ? { title: data.title } : {}),
      before: { name: data.names.before },
      after: { name: data.names.after },
    },
  };
}

async function gzipBase64(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

datasetSelect.addEventListener('change', () => {
  syncUrl();
  history.replaceState(null, '', location.pathname + location.search);
  loadDataset(datasetSelect.value).catch(ignoreAbort);
});
localeSelect.addEventListener('change', () => {
  viewer.locale = localeSelect.value as Locale;
  syncUrl();
});
themeSelect.addEventListener('change', () => {
  viewer.theme = themeSelect.value as ThemePreference;
  syncUrl();
});
paletteSelect.addEventListener('change', () => {
  viewer.palette = paletteSelect.value as PaletteName;
  syncUrl();
});
widthSelect.addEventListener('change', () => {
  applyWidth();
  syncUrl();
});
embedSelect.addEventListener('change', () => {
  applyEmbed();
  syncUrl();
});

$('load-payload').addEventListener('click', () => $('file').click());
$<HTMLInputElement>('file').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    viewer.payload = JSON.parse(await file.text()) as ReportPayload;
  } catch (error) {
    viewer.showError(error as Error);
  }
});
$('export-payload').addEventListener('click', () => {
  const payload = currentPayload();
  if (!payload) return;
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${datasetSelect.value || 'kgdiff'}.report.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('roundtrip').addEventListener('click', async () => {
  const payload = currentPayload();
  if (!payload) return;
  const script = document.createElement('script');
  script.type = 'application/kgdiff+json';
  script.dataset.encoding = 'gzip-base64';
  script.dataset.for = 'viewer';
  script.textContent = await gzipBase64(JSON.stringify(payload));
  const host = document.createElement('div');
  host.appendChild(script);
  document.body.appendChild(host);
  await hydrateEmbeddedPayloads(document);
  host.remove();
  log('harness', `round-trip: ${(script.textContent.length / 1024).toFixed(1)} kB gzip-base64`);
});

// Event log
const logEl = $('log');
$('toggle-log').addEventListener('click', () => logEl.classList.toggle('open'));
function log(type: string, text: string): void {
  const row = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = type;
  row.append(b, ` ${text}`);
  logEl.prepend(row);
  while (logEl.childElementCount > 80) logEl.lastElementChild?.remove();
}
for (const type of [
  'kgdiff-ready',
  'kgdiff-select',
  'kgdiff-mode',
  'kgdiff-review',
  'kgdiff-error',
  'kgdiff-replay-end',
]) {
  viewer.addEventListener(type, (e) => {
    const detail = (e as CustomEvent).detail as Record<string, unknown>;
    const text = JSON.stringify(detail, (k, v) =>
      k === 'stats' ? '…' : v instanceof Error ? v.message : v,
    );
    log(type.replace('kgdiff-', ''), text);
    if (type === 'kgdiff-error') console.error(detail.error);
  });
}

loadDataset(datasetSelect.value).catch(ignoreAbort);
