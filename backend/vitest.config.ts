import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Each integration worker owns a Prisma pool against the same PostgreSQL instance.
    // Bound suite parallelism; race scenarios still run concurrent requests within each test.
    maxWorkers: 2,
  },
});
