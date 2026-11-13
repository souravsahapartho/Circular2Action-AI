import { defineConfig } from 'vitest/config';

// Database tests run against a real TiDB (local container or a Starter instance); never against MySQL 8 (DBC-09).
// TEST_DATABASE_URL points at a server root, e.g. mysql://root@127.0.0.1:4100/ ; each file creates its own database.
export default defineConfig({
  test: {
    include: ['test-db/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
