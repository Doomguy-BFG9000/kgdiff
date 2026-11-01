/**
 * The real pipeline for tests: example dataset → formats `parseGraph` → core `diff` →
 * layout `layoutDiff` → scene `buildScene`. Diff and layout are memoized per dataset.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type DiffOptions, type DiffResult, diff } from '@kgdiff/core';
import { parseGraph } from '@kgdiff/formats';
import { type LayoutResult, layoutDiff } from '@kgdiff/layout';
import { buildScene, type Scene, type SceneOptions } from '@kgdiff/scene';

// `import.meta.dirname`, not `new URL(…, import.meta.url)`: Vite rewrites the latter as an asset.
const ROOT = `${resolve(import.meta.dirname, '../../../../examples/datasets')}/`;

interface Meta {
  readonly files: { readonly before: string; readonly after: string };
  readonly options?: DiffOptions;
}

const cache = new Map<string, { diff: DiffResult; layout: LayoutResult }>();

function load(id: string): { diff: DiffResult; layout: LayoutResult } {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const read = (name: string): string => readFileSync(`${ROOT}${id}/${name}`, 'utf8');
  const meta = JSON.parse(read('meta.json')) as Meta;
  const before = parseGraph(read(meta.files.before), { filename: meta.files.before }).graph;
  const after = parseGraph(read(meta.files.after), { filename: meta.files.after }).graph;
  const result = diff(before, after, meta.options);
  const entry = { diff: result, layout: layoutDiff(result) };
  cache.set(id, entry);
  return entry;
}

/** Scene of an example dataset (default: the featured enterprise-kg). */
export function datasetScene(id = 'enterprise-kg', options: SceneOptions = {}): Scene {
  const { diff: result, layout } = load(id);
  return buildScene(result, layout, options);
}
