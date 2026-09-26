/**
 * Contract drift guard: every strict wire schema this API actually validates against must be
 * byte-identical to the copy published in `@payguard/integration`. A handler's schema changing
 * without the published contract changing (or vice versa) fails this test -- the two are not
 * allowed to silently diverge.
 */

import * as publishedSchemas from '@payguard/integration';
import { PUBLIC_CONFIG_SCHEMA } from '@payguard/integration';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { projectPublicConfig } from '../src/routes/config.js';
import * as apiSchemas from '../src/schemas.js';

const SHARED_SCHEMA_NAMES = [
  'UINT_STRING',
  'ADDRESS',
  'HASH32',
  'HEX_BYTES',
  'UUID',
  'SUBSIDY_MODE',
  'INVOICE_SCHEMA',
  'PAYMENT_INTENT_SCHEMA',
  'EXCEPTION_APPROVAL_SCHEMA',
  'POLICY_CONFIG_SCHEMA',
  'MERCHANT_PERMISSION_SCHEMA',
  'AUTH_CHALLENGE_BODY',
  'AUTH_VERIFY_BODY',
  'EMPTY_BODY',
  'VAULT_TRANSACTION_BODY',
  'POLICY_DRAFT_BODY',
  'POLICY_DRAFT_UPDATE_BODY',
  'POLICY_DRAFT_TRANSACTION_BODY',
  'CHAIN_OBSERVATION_BODY',
  'INVOICE_BODY',
  'PAYMENT_INTENT_BODY',
  'APPROVAL_BODY',
  'ID_PARAM',
  'HASH_PARAM',
  'KEYSET_QUERY',
  'TRANSACTION_QUERY',
  'DEMO_RUN_START_BODY',
] as const;

describe('handler schemas match the published contract exactly', () => {
  for (const name of SHARED_SCHEMA_NAMES) {
    it(`${name} is identical in apps/api and @payguard/integration`, () => {
      const apiSchema = (apiSchemas as Record<string, unknown>)[name];
      const publishedSchema = (publishedSchemas as Record<string, unknown>)[name];
      expect(apiSchema, `apps/api/src/schemas.ts is missing ${name}`).toBeDefined();
      expect(publishedSchema, `@payguard/integration is missing ${name}`).toBeDefined();
      expect(apiSchema).toEqual(publishedSchema);
    });
  }
});

describe('GET /v1/config response satisfies the published PUBLIC_CONFIG_SCHEMA', () => {
  it('a representative projected config validates against the published schema', () => {
    const config = projectPublicConfig({
      deploymentId: '11111111-1111-1111-1111-111111111111',
      environment: 'LOCAL_DEMO',
      chainId: 31337n,
      configuration: {
        tokens: [
          {
            address: '0x2222222222222222222222222222222222222222',
            symbol: 'mUSDC',
            decimals: 6,
            isMock: true,
          },
        ],
        routes: [
          {
            routeId: `0x${'33'.repeat(32)}`,
            adapter: '0x4444444444444444444444444444444444444444',
            kind: 'DIRECT',
            inputToken: '0x2222222222222222222222222222222222222222',
            outputToken: '0x2222222222222222222222222222222222222222',
            subsidyModes: ['NONE'],
            enabled: true,
          },
        ],
        confidencePolicy: { mode: 'LOCAL_DEMO', confirmationDepth: null },
      },
    });

    const ajv = new Ajv({ strict: true });
    const validate = ajv.compile(PUBLIC_CONFIG_SCHEMA);
    expect(validate(config), JSON.stringify(validate.errors)).toBe(true);
  });
});
