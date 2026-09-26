import { defineConfig } from 'vitest/config';

// All tests in this package share one real local PostgreSQL database (payguard_test). Some
// tests reset the schema entirely (the migration-reentry proof) or truncate shared tables
// between cases -- running test files concurrently against that one database would race.
// fileParallelism:false makes vitest run this package's test files one at a time.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
