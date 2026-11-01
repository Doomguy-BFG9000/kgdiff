# 在 CI 中审阅变更

把每一次图谱变化的说明放到审阅者本来就会看的地方：PR 上有一份摘要，点一下就能打开交互式报告；需要的话，还可以让检查失败。

## GitHub Actions

下面的工作流在修改了 `ontology/onto.ttl` 的 PR 上运行。它把这个文件和基准分支上的版本做比较，把 Markdown 摘要追加到作业摘要（job summary），并把 HTML 报告作为工件（artifact）上传：

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
          fetch-depth: 0 # 同时取回基准分支
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

- `fetch-depth: 0` 会取回基准分支，这样 `git show` 才能读到文件原来的样子。仓库很大时，可以只取这一个分支：`git fetch --depth=1 origin "$BASE"`，然后用 `git show "FETCH_HEAD:ontology/onto.ttl"`。
- 分支名通过 `env` 传给脚本，而不是在 `run` 里直接展开 <code v-pre>${{ github.base_ref }}</code>，这样精心构造的分支名就无法注入 shell 代码。
- `npx --yes kgdiff@0.1` 不经确认就运行 0.1 系列的版本；固定版本可以避免新版本在你不知情时改变 CI 的输出。也可以把 kgdiff 加进 devDependencies，然后运行 `npx kgdiff`。
- 一次运行写出两种输出：Markdown 写到标准输出，追加进作业摘要；`-o` 写出报告。`--title` 同时用作两者的标题。`--reproducible` 不在报告里写时间戳，输入相同，文件就完全相同。

审阅者在这次运行的摘要页里阅读变更列表，从运行的工件里下载 `kgdiff-report` 进一步查看。摘要会转义所有标签，并让 GitHub 的自动链接失效，所以标签永远不会 @ 到别人、链接到 issue，也不会被渲染成 HTML。

### 文件是新增的

如果基准分支上还没有这个文件，`git show` 会失败。这时改为和空图比较：

```sh
git show "origin/$BASE:ontology/onto.ttl" > "$RUNNER_TEMP/onto.ttl" 2>/dev/null \
  || : > "$RUNNER_TEMP/onto.ttl"
npx --yes kgdiff@0.1 "$RUNNER_TEMP/onto.ttl" ontology/onto.ttl --allow-empty --markdown
```

`--allow-empty` 把空输入当作空图，而不是报错。要比较多个文件，就每个文件运行一次 kgdiff，每次运行都会在作业摘要里追加自己的一节。

### 在 PR 上评论

作业摘要不需要额外权限，来自 fork 的 PR 也能用。如果想把摘要发到 PR 的讨论区，就给作业加上 `pull-requests: write` 权限，并使用 GitHub CLI：

```yaml
permissions:
  contents: read
  pull-requests: write

# ……checkout 和 setup-node 步骤同上，然后：
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

每次运行都会新增一条评论。来自 fork 的 PR 拿到的是只读令牌，所以评论这一步会失败，作业摘要则不受影响。

## 图谱有变化时让检查失败

`--exit-code` 让任何差异都以退出码 1 结束，于是这一步失败，并打印出变了什么。比如，要求提交到仓库的生成图谱始终是最新的：

```sh
./build-graph.sh > "$RUNNER_TEMP/graph.json"
npx --yes kgdiff@0.1 graph.json "$RUNNER_TEMP/graph.json" --exit-code
```

## 其他 CI 系统

换成别的 CI，做法也一样：取出文件的旧版本，运行 kgdiff，把报告保存为工件，把 Markdown 放到审阅者会看的地方。以 GitLab CI 为例：

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

## 提示

- 本地和 CI 使用相同的选项（`--match`、`--hierarchy`、`--lang`、`--ignore-attr`），这样审阅者看到的就是你看到的 diff。
- 图非常大时，`--stat` 和 `--markdown` 最省资源，HTML 报告最耗资源。输入解压后的大小上限是 1 GB，可以用 `KGDIFF_MAX_INPUT=4G` 调高。
- [命令行参考](../cli.md)列出了全部选项。
