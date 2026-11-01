/**
 * Dev harness for visual review of <kgdiff-viewer> (not published).
 *
 *   pnpm --filter @kgdiff/viewer dev          (http://localhost:5198)
 *
 * `@kgdiff/*` resolves to package sources, mirroring vitest.shared.ts; the example datasets are
 * imported straight from examples/ as raw text.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: [{ find: /^@kgdiff\/([\w-]+)$/, replacement: `${repo}packages/$1/src/index.ts` }],
  },
  server: { port: 5198, strictPort: false, fs: { allow: [repo] } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: true },
});
