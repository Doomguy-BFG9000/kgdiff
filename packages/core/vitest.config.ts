import { defineProject } from 'vitest/config';
import { alias } from '../../vitest.shared.ts';

export default defineProject({
  resolve: { alias },
  test: {
    name: 'core',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
