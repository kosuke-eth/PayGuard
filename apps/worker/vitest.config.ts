import { defineConfig } from 'vitest/config';

// Same reasoning as apps/api/vitest.config.ts: every test file here spins up its own real local
// Anvil instance and/or shares one real Postgres database (payguard_test), so running test files
// concurrently would race Anvil port allocation and shared-table truncation between files.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
