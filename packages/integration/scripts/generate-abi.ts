#!/usr/bin/env tsx
/**
 * Independent ABI copy for the public integration package.
 *
 * This package must never depend on @payguard/chain (the boundary test in
 * test/boundary.test.ts checks its package.json for exactly that) -- a future frontend consumes
 * this package alone, never the backend's chain-RPC client. So the ABI is generated here by its
 * own script reading the same compiled Foundry artifact directly, rather than importing
 * packages/chain's copy. `test/abi-drift.test.ts` in THIS package regenerates and compares. The
 * cross-package identity check (both copies must stay byte-identical to each other) lives in
 * packages/chain/test/cross-package-abi.test.ts instead of here, since the dependency direction
 * this package -> @payguard/chain is exactly what test/boundary.test.ts forbids.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const ARTIFACT_PATH = 'contracts/core-v4/out/PayGuardVault.sol/PayGuardVault.json';

export function renderAbiModule(): string {
  const artifactPath = path.join(REPO_ROOT, ARTIFACT_PATH);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { abi: unknown[] };
  if (!Array.isArray(artifact.abi) || artifact.abi.length === 0) {
    throw new Error(`no ABI in compiled artifact ${ARTIFACT_PATH}`);
  }
  return `/**
 * GENERATED FILE -- DO NOT EDIT BY HAND.
 * Source: ${ARTIFACT_PATH} (the actual compiled Foundry artifact).
 * Regenerate: pnpm --filter @payguard/integration abi:generate
 * Drift guard: packages/integration/test/abi-drift.test.ts
 */

export const PAYGUARD_VAULT_ABI = ${JSON.stringify(artifact.abi, null, 2)} as const;
`;
}

export const GENERATED_ABI_PATH = path.join(__dirname, '../src/generated/abi.ts');

function main(): void {
  const rendered = renderAbiModule();
  mkdirSync(path.dirname(GENERATED_ABI_PATH), { recursive: true });
  writeFileSync(GENERATED_ABI_PATH, rendered);
  console.log(`wrote ${path.relative(REPO_ROOT, GENERATED_ABI_PATH)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
