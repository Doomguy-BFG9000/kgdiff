/**
 * kgdiff documentation site: VitePress over the Markdown in docs/, published at `<base>docs/`
 * next to the landing page and the playground (apps/site).
 *
 *   pnpm dev:docs                       (dev server, http://localhost:5195/docs/)
 *   pnpm build:docs                     (→ docs/.vitepress/dist, copied into apps/site/dist/docs)
 *
 * Environment, shared with apps/site/vite.config.ts:
 *
 *   KGDIFF_SITE_BASE   public base path of the whole site, e.g. `/kgdiff/` on GitHub Pages
 *   KGDIFF_SITE_URL    absolute URL of the deployed site, for canonical and Open Graph tags
 *   KGDIFF_REPO_URL    GitHub repository (source, edit links)
 */
import { existsSync, readFileSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { type DefaultTheme, defineConfig } from 'vitepress';

const withSlash = (s: string): string => (s.endsWith('/') ? s : `${s}/`);
const base = withSlash(process.env.KGDIFF_SITE_BASE ?? '/');
const siteUrl = process.env.KGDIFF_SITE_URL ? withSlash(process.env.KGDIFF_SITE_URL) : undefined;
const repoUrl = (process.env.KGDIFF_REPO_URL ?? 'https://github.com/iiwish/kgdiff').replace(
  /\/+$/,
  '',
);
const repo = resolve(import.meta.dirname, '../..');
const docs = join(repo, 'docs');
// All packages share one version (a Changesets "fixed" group).
const { version } = JSON.parse(readFileSync(join(repo, 'packages/cli/package.json'), 'utf8')) as {
  version: string;
};

const description =
  'Documentation for kgdiff, git diff for knowledge graphs: install the CLI, review graph ' +
  'changes in CI, embed the viewer and use the diff engine in code.';

const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Introduction',
    items: [
      { text: 'What is kgdiff?', link: '/docs/' },
      { text: 'Getting started', link: '/docs/getting-started' },
    ],
  },
  {
    text: 'Guides',
    items: [
      { text: 'Review changes in CI', link: '/docs/guide/ci' },
      { text: 'Use kgdiff with git', link: '/docs/guide/git' },
      { text: 'Ontologies: OBO and OWL', link: '/docs/guide/ontologies' },
      { text: 'Graphs without stable ids', link: '/docs/guide/llm-graphs' },
      { text: 'Embed the viewer', link: '/docs/guide/viewer' },
      { text: 'Use the engine in code', link: '/docs/guide/library' },
      { text: 'Deltas: apply and invert', link: '/docs/guide/deltas' },
    ],
  },
  {
    text: 'Reference',
    items: [
      { text: 'CLI', link: '/docs/cli' },
      { text: 'Formats', link: '/docs/formats' },
      { text: 'Viewer: interaction and API', link: '/docs/interaction' },
      { text: 'Delta format', link: '/docs/delta-format' },
    ],
  },
  {
    text: 'Concepts',
    items: [
      { text: 'Architecture', link: '/docs/architecture' },
      { text: 'Algorithms', link: '/docs/algorithms' },
      { text: 'Visual language', link: '/docs/visual-language' },
    ],
  },
  { text: 'FAQ', link: '/docs/faq' },
];

export default defineConfig({
  base,
  // Every page lives under docs/, so the landing page and the playground are plain root-relative
  // links (`/playground.html`) whatever the base, and the build output drops into apps/site/dist.
  rewrites: (page) => `docs/${page}`,
  srcExclude: ['releasing.md', 'review-checklist.md'],
  assetsDir: 'docs/assets',
  title: 'kgdiff',
  titleTemplate: ':title · kgdiff',
  description,
  lang: 'en-US',
  // Dark first, like the site; the switch stays available.
  appearance: 'dark',
  head: [
    ['link', { rel: 'icon', href: `${base}favicon.svg`, type: 'image/svg+xml' }],
    ['link', { rel: 'apple-touch-icon', href: `${base}apple-touch-icon.png` }],
    ['meta', { property: 'og:site_name', content: 'kgdiff' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ...(siteUrl
      ? ([
          ['meta', { property: 'og:image', content: `${siteUrl}og.png` }],
          ['meta', { name: 'twitter:image', content: `${siteUrl}og.png` }],
        ] as const)
      : []),
  ],
  transformPageData(page) {
    const title = `${page.title} · kgdiff`;
    page.frontmatter.head ??= [];
    page.frontmatter.head.push(
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: page.description || description }],
    );
    if (siteUrl) {
      const path = page.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '.html');
      page.frontmatter.head.push(
        ['link', { rel: 'canonical', href: `${siteUrl}${path}` }],
        ['meta', { property: 'og:url', content: `${siteUrl}${path}` }],
      );
    }
  },
  themeConfig: {
    logo: '/favicon.svg',
    // The logo leads back to the landing page, which is not a VitePress page: load it in full.
    logoLink: { link: base, target: '_self' },
    nav: [
      {
        text: 'Guide',
        link: '/docs/getting-started',
        activeMatch: '^/docs/(getting-started|guide/)',
      },
      {
        text: 'Reference',
        link: '/docs/cli',
        activeMatch: '^/docs/(cli|formats|interaction|delta-format)$',
      },
      { text: 'Playground', link: '/playground.html', target: '_self' },
      {
        text: `v${version}`,
        items: [
          { text: 'Changelog', link: `${repoUrl}/blob/main/packages/cli/CHANGELOG.md` },
          { text: 'Contributing', link: `${repoUrl}/blob/main/CONTRIBUTING.md` },
        ],
      },
    ],
    sidebar,
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: repoUrl }],
    editLink: { pattern: `${repoUrl}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    footer: {
      message: 'Released under the MIT License. Example data CC0-1.0.',
      copyright: '© 2026 kgdiff contributors',
    },
  },
  markdown: {
    config(md) {
      // Links are written for the Markdown as GitHub shows it. On the site, `../packages/…`
      // (outside docs/) points at the repository and `/playground.html` (outside /docs/) at the
      // site page, loaded in full since it is not a VitePress page.
      md.core.ruler.push('kgdiff-links', (state) => {
        // `path` is the rewritten one (docs/docs/…); `realPath` the source file.
        const file: unknown = state.env.realPath ?? state.env.path;
        for (const block of state.tokens) {
          for (const token of block.children ?? []) {
            const href = token.type === 'link_open' ? token.attrGet('href') : null;
            if (href?.startsWith('/') && !href.startsWith('/docs/')) {
              token.attrSet('href', `${base}${href.slice(1)}`);
              token.attrSet('target', '_self');
            } else if (href?.startsWith('../') && typeof file === 'string') {
              const [path = '', hash] = href.split('#');
              const target = resolve(dirname(file), path);
              if (!relative(docs, target).startsWith('..')) continue;
              const inRepo = relative(repo, target).split(sep).join('/');
              token.attrSet('href', `${repoUrl}/blob/main/${inRepo}${hash ? `#${hash}` : ''}`);
            }
          }
        }
      });
    },
  },
  vite: {
    server: { port: 5195, open: `${base}docs/` },
  },
  async buildEnd({ outDir }) {
    // Next to the landing page and the playground when they have been built. VitePress writes
    // the social icon styles to the root of its output, which is where the pages load them from.
    const site = join(repo, 'apps/site/dist');
    if (!existsSync(site)) return;
    await rm(join(site, 'docs'), { recursive: true, force: true });
    await cp(join(outDir, 'docs'), join(site, 'docs'), { recursive: true });
    const icons = join(outDir, 'vp-icons.css');
    if (existsSync(icons)) await cp(icons, join(site, 'vp-icons.css'));
  },
});
