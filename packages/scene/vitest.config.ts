import { defineProject } from 'vitest/config';
import { alias } from '../../vitest.shared.ts';

export default defineProject({
  resolve: { alias },
  test: {
    name: 'scene',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Benchmarks (`pnpm bench`) run the source through Vite's module runner, whose export
    // getters sit in the resolver's hot loops: its timings are upper bounds, about 4× those of
    // the built code (buildScene: a few percent). The bounds asserted there allow for that.
    benchmark: { suppressExportGetterWarnings: true },
  },
});
