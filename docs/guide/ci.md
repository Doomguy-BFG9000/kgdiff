# Review changes in CI

Put a readable account of every graph change where reviewers already look: a summary on the pull
request, the interactive report one click away and, if you want, a failing check.

## GitHub Actions

This workflow runs on pull requests that edit `ontology/onto.ttl`. It compares the file with its
version on the base branch, appends the Markdown summary to the job summary and uploads the HTML
report as an artifact:

```yaml
# .github/workflows/graph-diff.yml
name: Graph diff

on:
  pull_request:
    paths: [ontology/onto.ttl]

permissions:
  contents: read

jobs:
  kgdiff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # the base branch too
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Diff against the base branch
        env:
          BASE: ${{ github.base_ref }}
        run: |
          git show "origin/$BASE:ontology/onto.ttl" > "$RUNNER_TEMP/onto.ttl"
          npx --yes kgdiff@0.1 "$RUNNER_TEMP/onto.ttl" ontology/onto.ttl \
            --title "onto.ttl: $BASE → pull request" \
            -o kgdiff-report.html --reproducible \
            --markdown >> "$GITHUB_STEP_SUMMARY"
      - uses: actions/upload-artifact@v4
        with:
          name: kgdiff-report
          path: kgdiff-report.html
```

- `fetch-depth: 0` fetches the base branch so that `git show` can read the file as it was. In a
  large repository, fetch just that branch instead: `git fetch --depth=1 origin "$BASE"`, then
  `git show "FETCH_HEAD:ontology/onto.ttl"`.
- The branch name reaches the script through `env`, not by expanding
  <code v-pre>${{ github.base_ref }}</code> inside `run`, so a crafted branch name cannot inject
  shell code.
- `npx --yes kgdiff@0.1` runs the 0.1 release line without a prompt; pinning keeps a new release
  from changing your CI output unannounced. Alternatively, add kgdiff to your devDependencies and
  run `npx kgdiff`.
- One run writes both outputs: the Markdown goes to standard output, appended to the job
  summary, and `-o` writes the report. `--title` names both. `--reproducible` leaves the
  timestamp out of the report, so identical inputs give identical files.

Reviewers read the change list in the run's summary and download `kgdiff-report` from the run's
artifacts to explore it. The summary escapes every label and defuses GitHub's autolinking, so a
label never mentions people, links issues or renders as HTML.

### When the file is new

If the base branch does not have the file yet, `git show` fails. Compare with an empty graph
instead:

```sh
git show "origin/$BASE:ontology/onto.ttl" > "$RUNNER_TEMP/onto.ttl" 2>/dev/null \
  || : > "$RUNNER_TEMP/onto.ttl"
npx --yes kgdiff@0.1 "$RUNNER_TEMP/onto.ttl" ontology/onto.ttl --allow-empty --markdown
```

`--allow-empty` reads an empty input as an empty graph instead of failing. For several files, run
kgdiff once per file; each run appends its own section to the job summary.

### Comment on the pull request

The job summary needs no extra permissions and works for pull requests from forks. To post the
summary in the conversation instead, give the job `pull-requests: write` and use the GitHub CLI:

```yaml
permissions:
  contents: read
  pull-requests: write

# …the checkout and setup-node steps as above, then:
      - name: Diff against the base branch
        env:
          BASE: ${{ github.base_ref }}
        run: |
          git show "origin/$BASE:ontology/onto.ttl" > "$RUNNER_TEMP/onto.ttl"
          npx --yes kgdiff@0.1 "$RUNNER_TEMP/onto.ttl" ontology/onto.ttl \
            --markdown kgdiff.md -q
      - name: Comment
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
        run: gh pr comment "$PR" --body-file kgdiff.md
```

Each run adds a new comment. Pull requests from forks get a read-only token, so the comment step
fails there; the job summary does not.

## Fail the check when a graph changes

`--exit-code` turns any difference into exit code 1, which fails the step and prints what
changed. For example, to require that a generated graph is committed up to date:

```sh
./build-graph.sh > "$RUNNER_TEMP/graph.json"
npx --yes kgdiff@0.1 graph.json "$RUNNER_TEMP/graph.json" --exit-code
```

## Other CI systems

Anywhere else, the recipe is the same: get the old version of the file, run kgdiff, keep the
report as an artifact and put the Markdown where reviewers look. In GitLab CI, for example:

```yaml
graph-diff:
  image: node:22
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes: [ontology/onto.ttl]
  script:
    - git fetch --depth=1 origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    - git show "FETCH_HEAD:ontology/onto.ttl" > base.ttl
    - npx --yes kgdiff@0.1 base.ttl ontology/onto.ttl -o kgdiff-report.html --markdown kgdiff.md
  artifacts:
    paths: [kgdiff-report.html, kgdiff.md]
    expose_as: kgdiff report
```

## Tips

- Use the same options locally and in CI (`--match`, `--hierarchy`, `--lang`, `--ignore-attr`),
  so reviewers see the diff you saw.
- For very large graphs, `--stat` and `--markdown` are the lightest outputs and the HTML report
  the heaviest. Inputs are limited to 1 GB after decompression; `KGDIFF_MAX_INPUT=4G` raises the
  limit.
- [CLI reference](../cli.md) lists every option.
