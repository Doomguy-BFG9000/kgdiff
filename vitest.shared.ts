import { fileURLToPath } from 'node:url';

/** Repository root (absolute, with trailing slash). */
export const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * During development and tests every `@kgdiff/*` import resolves to the package's
 * TypeScript source, so no package has to be built before another can be tested.
 */
export const alias = [
  {
    find: /^@kgdiff\/([\w-]+)$/,
    replacement: `${root}packages/$1/src/index.ts`,
  },
];
