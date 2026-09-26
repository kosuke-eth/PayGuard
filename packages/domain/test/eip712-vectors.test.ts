import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hashApproval, hashIntent, hashInvoice } from '../src/eip712.js';
import { isHash32 } from '../src/primitives.js';
import {
  FIXTURE_APPROVAL,
  FIXTURE_APPROVAL_CHANGED_NONCE,
  FIXTURE_INTENT,
  FIXTURE_INVOICE,
  FIXTURE_INVOICE_CHANGED_AMOUNT,
  TEST_DOMAIN,
  WRONG_DOMAIN_CHAIN,
  WRONG_DOMAIN_CONTRACT,
} from './fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const evidencePath = resolve(
  __dirname,
  '../../../docs/implementation/evidence/eip712-vectors.json',
);

describe('EIP-712 digests: shape and determinism', () => {
  it('hashInvoice returns a well-formed 32-byte hash', () => {
    const digest = hashInvoice(TEST_DOMAIN, FIXTURE_INVOICE);
    expect(isHash32(digest)).toBe(true);
  });

  it('hashIntent returns a well-formed 32-byte hash', () => {
    const digest = hashIntent(TEST_DOMAIN, FIXTURE_INTENT);
    expect(isHash32(digest)).toBe(true);
  });

  it('hashApproval returns a well-formed 32-byte hash', () => {
    const digest = hashApproval(TEST_DOMAIN, FIXTURE_APPROVAL);
    expect(isHash32(digest)).toBe(true);
  });

  it('is deterministic: same input twice yields the identical digest', () => {
    const a = hashInvoice(TEST_DOMAIN, FIXTURE_INVOICE);
    const b = hashInvoice(TEST_DOMAIN, { ...FIXTURE_INVOICE });
    expect(a).toBe(b);
  });
});

describe('EIP-712 digests: negative cases (wrong-domain / changed-field must NOT match)', () => {
  it('a changed invoice field produces a different digest', () => {
    const base = hashInvoice(TEST_DOMAIN, FIXTURE_INVOICE);
    const changed = hashInvoice(TEST_DOMAIN, FIXTURE_INVOICE_CHANGED_AMOUNT);
    expect(changed).not.toBe(base);
  });

  it('a changed approval nonce produces a different digest', () => {
    const base = hashApproval(TEST_DOMAIN, FIXTURE_APPROVAL);
    const changed = hashApproval(TEST_DOMAIN, FIXTURE_APPROVAL_CHANGED_NONCE);
    expect(changed).not.toBe(base);
  });

  it('a wrong chainId in the domain produces a different digest for the same struct', () => {
    const base = hashInvoice(TEST_DOMAIN, FIXTURE_INVOICE);
    const wrong = hashInvoice(WRONG_DOMAIN_CHAIN, FIXTURE_INVOICE);
    expect(wrong).not.toBe(base);
  });

  it('a wrong verifyingContract in the domain produces a different digest for the same struct', () => {
    const base = hashInvoice(TEST_DOMAIN, FIXTURE_INVOICE);
    const wrong = hashInvoice(WRONG_DOMAIN_CONTRACT, FIXTURE_INVOICE);
    expect(wrong).not.toBe(base);
  });
});

describe('EIP-712 digests: committed evidence file has not drifted from current code', () => {
  it('docs/implementation/evidence/eip712-vectors.json exists (run `pnpm vectors:generate` first)', () => {
    expect(existsSync(evidencePath)).toBe(true);
  });

  it('the checked-in expectedDigest values match what the current encoder produces right now', () => {
    if (!existsSync(evidencePath)) return; // covered by the existence test above
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    expect(hashInvoice(TEST_DOMAIN, FIXTURE_INVOICE)).toBe(evidence.vectors.invoice.expectedDigest);
    expect(hashIntent(TEST_DOMAIN, FIXTURE_INTENT)).toBe(evidence.vectors.intent.expectedDigest);
    expect(hashApproval(TEST_DOMAIN, FIXTURE_APPROVAL)).toBe(
      evidence.vectors.approval.expectedDigest,
    );
  });
});
