# Contributing to kgdiff

Thanks for helping make graph changes reviewable.

## Setup

```sh
pnpm install
pnpm check        # lint + typecheck + test
pnpm dev:site     # landing page and playground
```

Node ≥ 22 and pnpm ≥ 11 are recommended for development.

## Where things live

- `packages/core`: the diff engine. Start with `src/types.ts` and `docs/algorithms.md`.
- `packages/formats`: RDF / OBO / JSON parsers.
- `packages/layout`, `packages/scene`, `packages/renderer`: layout, visual model, Canvas engine.
- `packages/viewer`: the `<kgdiff-viewer>` web component.
- `packages/g6`: the AntV G6 adapter.
- `packages/cli`: the `kgdiff` command.
- `apps/site`: landing page and playground. `examples/datasets`: demo and acceptance data.
- `docs/`: architecture, algorithms, visual language, interaction, delta format, CLI.

## Ground rules

- Read `docs/architecture.md` first; contracts in each package's `src/index.ts` change only
  together with the docs.
- Every change passes `docs/review-checklist.md`.
- Determinism is a feature: no `Math.random` or wall-clock time in results.
- Tests are the specification: name them after behaviour, cover edge cases, add property tests
  where an invariant exists.
- No new runtime dependency without a short justification in the PR.

## Commit messages

Conventional style: `feat(core): detect splits from replaces hints`, `fix(renderer): …`,
`docs: …`, `test(layout): …`.
