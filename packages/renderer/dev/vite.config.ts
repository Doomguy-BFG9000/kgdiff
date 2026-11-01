/**
 * Dev harness for visual review of @kgdiff/renderer (not published).
 *
 *   pnpm vite --config packages/renderer/dev/vite.config.ts
 *   pnpm vite build --config packages/renderer/dev/vite.config.ts --outDir <scratch dir>
 *
 * `@kgdiff/*` resolves to package sources, mirroring vitest.shared.ts.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: [{ find: /^@kgdiff\/([\w-]+)$/, replacement: `${repo}packages/$1/src/index.ts` }],
  },
  server: { port: 5199, strictPort: false },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: true },
});
