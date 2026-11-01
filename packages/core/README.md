# @kgdiff/core

The semantic diff engine behind [kgdiff](../../README.md). It matches nodes across two versions
of a knowledge graph, classifies what changed (rename, rekey, merge, split, hierarchy move,
retarget, …), groups the changes into reviewable hunks and emits an invertible delta.
Deterministic, zero dependencies, and it runs unchanged in browsers, Node, Deno, Bun and workers.

## Install

```sh
pnpm add @kgdiff/core
```

ESM only. Node.js ≥ 22 or any evergreen browser.

## Quick start

```ts
import { applyDelta, diff, formatHunk, hashGraph, invertDelta } from '@kgdiff/core';

const v1 = {
  nodes: [
    { id: 'org', label: 'Organization' },
    { id: 'company', label: 'Company' },
    { id: 'ngo', label: 'NGO' },
  ],
  edges: [
    { source: 'company', target: 'org', predicate: 'subClassOf' },
    { source: 'ngo', target: 'org', predicate: 'subClassOf' },
  ],
};
const v2 = {
  nodes: [
    { id: 'org', label: 'Organisation' },
    { id: 'company', label: 'Company' },
    { id: 'startup', label: 'Startup' },
  ],
  edges: [
    { source: 'company', target: 'org', predicate: 'subClassOf' },
    { source: 'startup', target: 'company', predicate: 'subClassOf' },
  ],
};

const result = diff(v1, v2);
for (const hunk of result.hunks) console.log(formatHunk(hunk, result).title);
// Removed “NGO” and 1 relation
// Renamed “Organization” → “Organisation”
// Added “Startup” and 1 relation

result.stats.nodes; // { added: 1, removed: 1, modified: 1, unchanged: 1 }

// The delta is invertible: undoing it gives the first version back.
const undone = applyDelta(result.after, invertDelta(result.delta));
hashGraph(undone) === hashGraph(result.before); // true
```

- Graph files (RDF, OBO, JSON graph formats): parse them with [`@kgdiff/formats`](../formats).
- Ids that mean nothing across versions, such as two LLM extraction runs: match by label and
  neighbourhood with `diff(a, b, { match: { strategy: 'similarity' } })`.
- `formatHunk(hunk, result, 'zh-CN')` gives Chinese titles.

## Learn more

- [Algorithms](../../docs/algorithms.md): normalization, matching, classification, hunks, delta.
- [Delta format](../../docs/delta-format.md): the JSON patch format and its guarantees.
- [Architecture](../../docs/architecture.md): how the kgdiff packages fit together.

## License

[MIT](../../LICENSE)
