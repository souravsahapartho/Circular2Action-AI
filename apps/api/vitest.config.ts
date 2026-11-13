import { defineConfig } from 'vitest/config';

// Unit tests only. Database tests live in test-db/ and run with `pnpm test:db` against a real TiDB.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
