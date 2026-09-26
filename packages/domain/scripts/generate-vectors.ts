/**
 * Generates docs/implementation/evidence/eip712-vectors.json: the TypeScript-computed half of
 * the Stage 1 cross-language EIP-712 vector. contracts/core-v4/test/Eip712Vectors.t.sol reads
 * the raw field values from this file (or from its own hardcoded duplicate, see that file's
 * header) and independently recomputes each digest in Solidity, asserting equality.
 *
 * Run: pnpm vectors:generate
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashApproval, hashIntent, hashInvoice } from '../src/eip712.js';
import {
  FIXTURE_APPROVAL,
  FIXTURE_APPROVAL_CHANGED_NONCE,
  FIXTURE_INTENT,
  FIXTURE_INVOICE,
  FIXTURE_INVOICE_CHANGED_AMOUNT,
  TEST_DOMAIN,
  WRONG_DOMAIN_CHAIN,
  WRONG_DOMAIN_CONTRACT,
} from '../test/fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '../../../docs/implementation/evidence/eip712-vectors.json');

const vectors = {
  generatedBy: 'packages/domain/scripts/generate-vectors.ts',
  domain: TEST_DOMAIN,
  vectors: {
    invoice: {
      input: FIXTURE_INVOICE,
      expectedDigest: hashInvoice(TEST_DOMAIN, FIXTURE_INVOICE),
    },
    intent: {
      input: FIXTURE_INTENT,
      expectedDigest: hashIntent(TEST_DOMAIN, FIXTURE_INTENT),
    },
    approval: {
      input: FIXTURE_APPROVAL,
      expectedDigest: hashApproval(TEST_DOMAIN, FIXTURE_APPROVAL),
    },
  },
  negativeCases: {
    invoiceChangedAmountDiffersFromBase: {
      input: FIXTURE_INVOICE_CHANGED_AMOUNT,
      digest: hashInvoice(TEST_DOMAIN, FIXTURE_INVOICE_CHANGED_AMOUNT),
      mustDifferFrom: 'vectors.invoice.expectedDigest',
    },
    approvalChangedNonceDiffersFromBase: {
      input: FIXTURE_APPROVAL_CHANGED_NONCE,
      digest: hashApproval(TEST_DOMAIN, FIXTURE_APPROVAL_CHANGED_NONCE),
      mustDifferFrom: 'vectors.approval.expectedDigest',
    },
    invoiceWrongDomainChainDiffersFromBase: {
      domain: WRONG_DOMAIN_CHAIN,
      digest: hashInvoice(WRONG_DOMAIN_CHAIN, FIXTURE_INVOICE),
      mustDifferFrom: 'vectors.invoice.expectedDigest',
    },
    invoiceWrongDomainContractDiffersFromBase: {
      domain: WRONG_DOMAIN_CONTRACT,
      digest: hashInvoice(WRONG_DOMAIN_CONTRACT, FIXTURE_INVOICE),
      mustDifferFrom: 'vectors.invoice.expectedDigest',
    },
  },
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`wrote ${outPath}`);
