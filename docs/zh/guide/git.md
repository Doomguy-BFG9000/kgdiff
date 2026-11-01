# 配合 git 使用

## 比较两个版本

用 `git show` 通过管道传入一侧。`-` 表示从标准输入读取，格式根据内容判断：

```sh
git show main:ontology/onto.ttl | kgdiff - ontology/onto.ttl
```

如果要比较两个更早的版本，或者要打开报告，就先把它们写成文件。保留扩展名，格式判断最简单：

```sh
git show v1.0:onto.owl > /tmp/onto-v1.0.owl
git show v2.0:onto.owl > /tmp/onto-v2.0.owl
kgdiff /tmp/onto-v1.0.owl /tmp/onto-v2.0.owl -o report.html --open
```

## git difftool

先注册一次：

```sh
git config --global difftool.kgdiff.cmd 'kgdiff --title "$MERGED" "$LOCAL" "$REMOTE"'
```

然后对图谱文件使用它：

```sh
git difftool --tool=kgdiff --no-prompt main -- ontology/onto.ttl
```

git 会把旧版本写到一个保留原文件名的临时文件里，所以格式照常能判断出来；`$MERGED` 把文件路径放进标题。如果想打开交互式报告而不是打印摘要，再注册一个工具：

```sh
git config --global difftool.kgdiff-report.cmd \
  'kgdiff --title "$MERGED" "$LOCAL" "$REMOTE" --open -q'
```

`--open` 不带 `-o` 时，会把报告写到一个新建的临时目录并打开。

## git diff、git show 和 git log -p

要让 `git diff` 本身对图谱文件使用 kgdiff，需要声明一个 diff 驱动。先在 `.gitattributes` 里标记这些文件：

```
*.ttl diff=kgdiff
*.obo diff=kgdiff
*.owl diff=kgdiff
```

再定义驱动，写在 `.git/config` 里只对这个仓库生效，写在 `~/.gitconfig` 里对所有仓库生效：

```ini
[diff "kgdiff"]
	command = sh -c 'kgdiff --allow-empty --title \"$0\" \"$1\" \"$4\"'
```

git 调用这个命令时传入七个参数（路径、旧文件、旧哈希、旧权限、新文件、新哈希、新权限），在 `sh -c` 里依次是 `$0` 到 `$6`：kgdiff 比较旧文件和新文件，并把路径用作标题。新增或删除的文件，git 会用 `/dev/null` 代替缺失的一侧，`--allow-empty` 让它按空图比较。

现在 `git diff` 会对这些文件显示 kgdiff 的摘要：

```
$ git diff -- vocab.ttl
kgdiff  vocab.ttl                                          节点 66 → 71 · 关系 105 → 112

  +3 新增   ~6 修改   ⇄5 结构调整                                      14 组共 27 处变化
  …
```

- `git log -p` 和 `git show` 只有加上 `--ext-diff` 才使用 diff 驱动；`git diff --no-ext-diff` 可以重新看到文本 diff。
- 输出到 git 分页器时不是终端，所以 kgdiff 不带颜色输出。如果你的分页器能显示 ANSI 颜色（git 默认的 `less -R` 可以），可以在命令里加上 `--color=always`。

## 合并

kgdiff 比较两个版本，不做三方合并。图谱文件请继续使用 git 默认的合并方式。带冲突可视化的三方合并已列入路线图。
