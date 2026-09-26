/**
 * ABI drift guard. `src/generated/abi.ts` is a generated artifact (`scripts/generate-abi.ts`),
 * committed so the package builds without a Foundry step. This test regenerates it in memory from
 * the ACTUAL compiled contract artifact and fails if the committed file has drifted -- a
 * recompiled contract with a changed function/event/error signature must break this test, not
 * silently ship stale calldata encoding.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GENERATED_ABI_PATH, renderAbiModule } from '../scripts/generate-abi.js';

describe('generated ABI drift', () => {
  it('src/generated/abi.ts matches a fresh render of the compiled Foundry artifact', () => {
    const committed = readFileSync(GENERATED_ABI_PATH, 'utf8');
    const fresh = renderAbiModule();
    expect(committed).toBe(fresh);
  });

  it('exports a non-empty ABI containing the core PayGuardVault functions', async () => {
    const { PAYGUARD_VAULT_ABI } = await import('../src/generated/abi.js');
    const functionNames = PAYGUARD_VAULT_ABI.filter(
      (entry: { type: string; name?: string }) => entry.type === 'function',
    ).map((entry: { name?: string }) => entry.name);
    for (const required of ['deposit', 'withdraw', 'createPolicy', 'evaluate', 'executePayment']) {
      expect(functionNames).toContain(required);
    }
  });
});
