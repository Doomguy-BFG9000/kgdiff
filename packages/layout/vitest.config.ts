import { defineProject } from 'vitest/config';
import { alias } from '../../vitest.shared.ts';

export default defineProject({
  resolve: { alias },
  test: {
    name: 'layout',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Benchmarks (`pnpm bench`) run the source through Vite's module runner, whose export
    // getters sit in the simulation's hot loops. They add a few percent here, so the warning
    // about them is noise.
    benchmark: { suppressExportGetterWarnings: true },
  },
});
