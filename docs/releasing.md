# Releasing

kgdiff publishes eight packages from this repository: the `kgdiff` CLI and `@kgdiff/core`,
`formats`, `layout`, `scene`, `renderer`, `viewer` and `g6`. They share one version number (a
Changesets "fixed" group, `.changeset/config.json`): the CLI embeds the viewer bundle and the
report payload ties core, layout and scene together, so "kgdiff 0.3.1" names one consistent set.

## Day to day

1. A pull request that changes a published package adds a changeset: `pnpm changeset`, pick the
   bump, write one or two sentences for the changelog. Before 1.0, breaking changes are minor
   bumps. Docs-, test- and tooling-only changes need no changeset.
2. On every push to `main`, [`release.yml`](../.github/workflows/release.yml) collects the
   pending changesets into a "chore: release packages" pull request that bumps the versions and
   updates each `CHANGELOG.md`.
3. Merging that pull request publishes: the workflow runs `pnpm release` (`pnpm check`,
   `pnpm build`, `pnpm check:packages`, `changeset publish`), publishes every package whose
   version is not on npm yet, pushes the `<package>@<version>` tags and creates GitHub releases.

The version pull request is opened with the workflow's `GITHUB_TOKEN`, and GitHub does not run
other workflows for pull requests created that way, so CI does not start on it by itself. Its diff
only touches versions and changelogs; close and reopen it to run CI, or give
`changesets/action` a GitHub App token through `github-token`.

## Publishing: npm trusted publishing

`release.yml` holds no npm token. pnpm exchanges the job's GitHub OIDC token for a short-lived
publish token and, because the repository and the packages are public, attaches a provenance
attestation (built from this repository, by this workflow, at this commit) to every version. The job needs only `id-token: write`, plus
`contents: write` and `pull-requests: write` for the tags, releases and version pull request; it
restores no caches, and it runs in the `npm` environment, which can be limited to `main`.

npm checks that `repository.url` in each `package.json` matches the GitHub repository exactly.

## One-time setup

The repository is `iiwish/kgdiff` (package metadata, `release.yml`, `CITATION.cff`,
`SECURITY.md`, the issue and pull request templates); security reports and conduct issues go to
num2048@163.com.

1. **GitHub.** Create the repository. Under Settings → Actions → General, allow GitHub Actions to
   create and approve pull requests. Under Settings → Environments, create `npm` with deployment
   branches limited to `main` (add required reviewers if releases should wait for a click).
   Under Settings → Code security, enable private vulnerability reporting (see `SECURITY.md`).
2. **npm.** Create the `kgdiff` organization, which owns the `@kgdiff` scope, and turn on 2FA.
3. **First publish, by hand.** Trusted publishing can only be configured for a package that
   already exists, so the first version is published from a maintainer's machine (it has no
   provenance attestation; later versions do):

   ```sh
   npm login
   pnpm install
   pnpm release            # check, build, check:packages, changeset publish (asks for the 2FA code)
   git push --follow-tags
   ```

4. **Trusted publishers.** For each of the eight packages on npmjs.com, open Settings → Trusted
   publishing and add GitHub Actions with the owner `iiwish`, repository `kgdiff`, workflow
   `release.yml` and environment `npm`, allowing direct publishing (not only staged publishing).
   npm expires a configuration that has not completed a publish within two days, so do this
   shortly before merging the first version pull request.
5. **Turn on releases from CI.** Under Settings → Secrets and variables → Actions → Variables,
   set `RELEASE_ENABLED` to `true`. Until then the release workflow skips its job, so pushes to
   `main` before the first publish do not try to publish.
6. **Lock it down.** Once a release from CI has gone through, set each package to require 2FA and
   disallow tokens, and revoke publish tokens that are no longer needed.

## Website

The landing page, the playground and the documentation build together into static files
(`pnpm build:site` → `apps/site/dist`). Deploy them with either:

- **GitHub Pages**: [`pages.yml`](../.github/workflows/pages.yml) builds and deploys on every push
  to `main` that touches the site, the packages or the docs. Under Settings → Pages, set the source
  to GitHub Actions; the base path (`/<repo>/`, or `/` with a custom domain) comes from there.
- **Vercel**: import the repository. [`vercel.json`](../vercel.json) sets the install and build
  commands and the output directory; the production domain and the repository come from Vercel's
  environment. Set `KGDIFF_SITE_URL` for a custom domain, and `ENABLE_EXPERIMENTAL_COREPACK=1` so
  that Vercel installs with the pnpm version in `packageManager`. Pull requests get previews.

Choose one as the canonical address: canonical and Open Graph tags point at `KGDIFF_SITE_URL`.

## What ships

Each package publishes `dist` (JavaScript, declarations and their source maps), `src` (the
TypeScript the maps point to), `README.md`, `package.json` and the root `LICENSE`, which pnpm adds
to every package. Shipping `src` keeps both `.js.map` and `.d.ts.map` resolvable: stack traces,
debuggers and "Go to Source Definition" land in the TypeScript source. The alternative,
`inlineSources`, embeds the same text in every `.js.map` and makes the maps self-contained for
tools that copy them away from the package, but it cannot fix the declaration maps, which would
then point at files that are not there; the price of shipping `src` is about the same size.

`pnpm check:packages` (after `pnpm build`) packs every package as `pnpm publish` would and checks
the tarballs: `package.json`, `README.md` and `LICENSE` present, every source map and every map
source resolvable, [publint](https://publint.dev) clean in strict mode, and
[Are the Types Wrong?](https://arethetypeswrong.github.io) clean for ESM-only packages (the
viewer's `./standalone` scripts have no types and are excluded). CI runs it on every push.
