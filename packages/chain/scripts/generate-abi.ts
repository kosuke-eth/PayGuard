#!/usr/bin/env tsx
/**
 * Generates `src/generated/abi.ts` from the ACTUAL compiled Foundry artifact, so the TypeScript
 * side can never drift from the deployed bytecode's interface. Stage 4 drift check
 * (`packages/chain/test/abi-drift.test.ts`) re-runs this generator in memory and fails if the
 * committed file differs -- a recompiled contract with a changed signature breaks the test rather
 * than silently producing calldata the chain will reject.
 *
 * Run: pnpm --filter @payguard/chain abi:generate
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const ARTIFACTS = {
  PAYGUARD_VAULT_ABI: 'contracts/core-v4/out/PayGuardVault.sol/PayGuardVault.json',
} as const;

/** Minimal ERC-20 surface the API actually uses: balance reads and the finite deposit approval. */
const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

export function renderAbiModule(): string {
  const vaultArtifactPath = path.join(REPO_ROOT, ARTIFACTS.PAYGUARD_VAULT_ABI);
  const vaultArtifact = JSON.parse(readFileSync(vaultArtifactPath, 'utf8')) as { abi: unknown[] };
  if (!Array.isArray(vaultArtifact.abi) || vaultArtifact.abi.length === 0) {
    throw new Error(`no ABI in compiled artifact ${ARTIFACTS.PAYGUARD_VAULT_ABI}`);
  }

  return `/**
 * GENERATED FILE -- DO NOT EDIT BY HAND.
 * Source: ${ARTIFACTS.PAYGUARD_VAULT_ABI} (the actual compiled Foundry artifact).
 * Regenerate: pnpm --filter @payguard/chain abi:generate
 * Drift guard: packages/chain/test/abi-drift.test.ts
 */

export const PAYGUARD_VAULT_ABI = ${JSON.stringify(vaultArtifact.abi, null, 2)} as const;

export const ERC20_ABI = ${JSON.stringify(ERC20_ABI, null, 2)} as const;
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
