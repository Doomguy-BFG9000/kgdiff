import { defineProject } from 'vitest/config';
import { alias } from '../../vitest.shared.ts';

export default defineProject({
  resolve: { alias },
  test: {
    name: 'viewer',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
});
