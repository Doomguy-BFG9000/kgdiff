/**
 * Dev harness for visual review of @kgdiff/g6 (not published).
 *
 *   pnpm vite --config packages/g6/dev/vite.config.ts              → http://localhost:5197
 *   pnpm vite build --config packages/g6/dev/vite.config.ts --outDir <scratch dir>
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
  server: { port: 5197, strictPort: false, fs: { allow: [repo] } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: true },
});
