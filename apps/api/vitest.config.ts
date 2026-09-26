import { defineConfig } from 'vitest/config';

// Every test file here spins up its own real local Anvil instance and shares one real Postgres
// database (payguard_test), truncating it at the start of its own harness. Running test files
// concurrently would race both the Anvil port allocation and the shared-table truncation between
// files (see packages/db/vitest.config.ts for the same reasoning). fileParallelism:false makes
// vitest run this package's test files one at a time.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
