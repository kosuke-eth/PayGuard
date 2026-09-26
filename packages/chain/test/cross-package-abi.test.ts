/**
 * This package and @payguard/integration each generate their OWN copy of `PAYGUARD_VAULT_ABI`
 * from the same compiled Foundry artifact, deliberately without a runtime dependency between them
 * (packages/integration/test/boundary.test.ts forbids @payguard/integration from depending on this
 * package at all, even as a devDependency -- so this cross-check lives here instead, where the
 * dependency direction is unrestricted). Both self-check against their own source artifact
 * (each package's own abi-drift.test.ts), but nothing previously checked that the two
 * independently generated copies actually agree with EACH OTHER, despite a comment in
 * packages/integration/scripts/generate-abi.ts claiming they did.
 */
import { PAYGUARD_VAULT_ABI as INTEGRATION_ABI } from '@payguard/integration';
import { describe, expect, it } from 'vitest';
import { PAYGUARD_VAULT_ABI as CHAIN_ABI } from '../src/generated/abi.js';

describe('cross-package ABI identity', () => {
  it('this package and @payguard/integration generate byte-identical PAYGUARD_VAULT_ABI content', () => {
    expect(CHAIN_ABI).toEqual(INTEGRATION_ABI);
  });
});
