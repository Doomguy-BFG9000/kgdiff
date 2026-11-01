/**
 * Example dataset metadata (`examples/datasets/index.json` + each `meta.json`), bundled at build
 * time. The files themselves are loaded on demand by the playground.
 */
import type { DiffOptions, Locale } from '@kgdiff/core';

export interface DatasetMeta {
  readonly id: string;
  readonly title: Readonly<Record<Locale, string>>;
  readonly description: Readonly<Record<Locale, string>>;
  readonly format: string;
  readonly files: { readonly before: string; readonly after: string };
  readonly versions?: { readonly before?: string; readonly after?: string };
  readonly options?: DiffOptions;
  readonly featured?: boolean;
  readonly license?: string;
}

interface IndexEntry {
  readonly id: string;
  readonly format: string;
  readonly featured?: boolean;
  readonly tags?: readonly string[];
}

export interface Dataset extends DatasetMeta {
  readonly tags: readonly string[];
}

const index = import.meta.glob<{ readonly datasets: readonly IndexEntry[] }>(
  '../../../../examples/datasets/index.json',
  { eager: true, import: 'default' },
);
const metas = import.meta.glob<DatasetMeta>('../../../../examples/datasets/*/meta.json', {
  eager: true,
  import: 'default',
});

function load(): Dataset[] {
  const byId = new Map<string, DatasetMeta>();
  for (const meta of Object.values(metas)) byId.set(meta.id, meta);
  const entries = Object.values(index)[0]?.datasets ?? [];
  const out: Dataset[] = [];
  for (const entry of entries) {
    const meta = byId.get(entry.id);
    if (meta) out.push({ ...meta, tags: entry.tags ?? [] });
  }
  return out;
}

/** All example datasets, in display order. */
export const DATASETS: readonly Dataset[] = load();

export function datasetById(id: string | null | undefined): Dataset | undefined {
  return id ? DATASETS.find((d) => d.id === id) : undefined;
}

/** The dataset featured first for a language: Chinese → enterprise KG, English → ontology. */
export function featuredFor(locale: Locale): Dataset {
  const id = locale === 'zh-CN' ? 'enterprise-kg' : 'ontology-release';
  const d = datasetById(id) ?? DATASETS[0];
  if (!d) throw new Error('No example datasets were bundled.');
  return d;
}

/** Human label of a dataset's file format. */
export function formatLabel(format: string): string {
  switch (format) {
    case 'json':
      return 'JSON';
    case 'turtle':
      return 'Turtle';
    case 'obo':
      return 'OBO';
    case 'ntriples':
      return 'N-Triples';
    case 'nquads':
      return 'N-Quads';
    case 'trig':
      return 'TriG';
    default:
      return format;
  }
}
