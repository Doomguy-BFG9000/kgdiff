# Use kgdiff with git

## Compare two revisions

Pipe one side from `git show`. `-` reads it from standard input, and the format is detected from
the content:

```sh
git show main:ontology/onto.ttl | kgdiff - ontology/onto.ttl
```

To compare two older revisions, or to open the report, write them to files. Keeping the
extension keeps format detection simple:

```sh
git show v1.0:onto.owl > /tmp/onto-v1.0.owl
git show v2.0:onto.owl > /tmp/onto-v2.0.owl
kgdiff /tmp/onto-v1.0.owl /tmp/onto-v2.0.owl -o report.html --open
```

## git difftool

Register kgdiff once:

```sh
git config --global difftool.kgdiff.cmd 'kgdiff --title "$MERGED" "$LOCAL" "$REMOTE"'
```

and use it for graph files:

```sh
git difftool --tool=kgdiff --no-prompt main -- ontology/onto.ttl
```

git writes the old version to a temporary file that keeps the original file name, so formats are
detected as usual, and `$MERGED` puts the path in the title. To open the interactive report
instead of printing the summary, register a second tool:

```sh
git config --global difftool.kgdiff-report.cmd \
  'kgdiff --title "$MERGED" "$LOCAL" "$REMOTE" --open -q'
```

`--open` without `-o` writes the report to a new temporary directory and opens it.

## git diff, git show and git log -p

To have `git diff` itself use kgdiff for graph files, declare a diff driver. Mark the files in
`.gitattributes`:

```
*.ttl diff=kgdiff
*.obo diff=kgdiff
*.owl diff=kgdiff
```

and define the driver, in `.git/config` for one repository or in `~/.gitconfig` for all of
them:

```ini
[diff "kgdiff"]
	command = sh -c 'kgdiff --allow-empty --title \"$0\" \"$1\" \"$4\"'
```

git calls the command with seven arguments (path, old file, old hash, old mode, new file, new
hash, new mode), which `sh -c` sees as `$0` to `$6`: kgdiff compares the old and the new file
and uses the path as the title. `--allow-empty` compares an added or deleted file with an empty
graph, since git passes `/dev/null` for the missing side.

Now `git diff` shows kgdiff's summary for those files:

```
$ git diff -- vocab.ttl
kgdiff  vocab.ttl                                        66 → 71 nodes · 105 → 112 edges

  +3 added   ~6 modified   ⇄5 restructured                        27 changes in 14 hunks
  …
```

- `git log -p` and `git show` use diff drivers only with `--ext-diff`; `git diff --no-ext-diff`
  shows the text diff again.
- Output going to git's pager is not a terminal, so kgdiff prints it without color. Add
  `--color=always` to the command if your pager shows ANSI colors, as git's default `less -R`
  does.

## Merging

kgdiff compares two versions; it does not merge three. Keep git's default merge for graph files.
Three-way merge with conflict visualization is on the roadmap.
