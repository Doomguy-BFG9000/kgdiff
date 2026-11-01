import { defineProject } from 'vitest/config';
import { alias } from '../../vitest.shared.ts';

export default defineProject({
  resolve: { alias },
  test: {
    name: 'scene',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
