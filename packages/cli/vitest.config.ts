import { defineProject } from 'vitest/config';
import { alias } from '../../vitest.shared.ts';

export default defineProject({
  resolve: { alias },
  test: {
    name: 'cli',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
