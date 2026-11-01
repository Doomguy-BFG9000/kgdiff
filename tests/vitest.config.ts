import { defineProject } from 'vitest/config';
import { alias } from '../vitest.shared.ts';

export default defineProject({
  resolve: { alias },
  test: {
    name: 'acceptance',
    environment: 'node',
    include: ['**/*.test.ts'],
    testTimeout: 60_000,
  },
});
