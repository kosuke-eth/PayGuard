/**
 * OpenAPI drift guard. Regenerates the document from the actual registered route table (no live
 * DB/chain needed -- registration never executes a handler) and compares it to the committed
 * artifact. A route added, removed, or given a different schema without regenerating fails this.
 */
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { generateOpenApiDocument, OPENAPI_PATH } from '../scripts/generate-openapi.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createAppContext } from '../src/context.js';

describe('OpenAPI artifact drift', () => {
  it('docs/implementation/evidence/openapi.json matches a fresh render of the registered routes', () => {
    const context = createAppContext({
      config: loadConfig({
        DATABASE_URL: 'postgresql://unused/unused',
        PAYGUARD_DEPLOYMENT_ID: '00000000-0000-0000-0000-000000000000',
      }),
      pool: {} as pg.Pool,
      publicClient: null,
    });
    const { routes } = buildApp(context);
    const fresh = generateOpenApiDocument(routes);

    const committed = JSON.parse(readFileSync(OPENAPI_PATH, 'utf8'));
    expect(fresh).toEqual(committed);
  });

  it("every route from API_CONTRACT.md's endpoint inventory is present", () => {
    const committed = JSON.parse(readFileSync(OPENAPI_PATH, 'utf8'));
    const required = [
      ['get', '/v1/config'],
      ['post', '/v1/auth/challenges'],
      ['post', '/v1/auth/verify'],
      ['post', '/v1/auth/logout'],
      ['get', '/v1/operations/{id}'],
      ['get', '/v1/vaults'],
      ['get', '/v1/vaults/{id}'],
      ['post', '/v1/vaults/{id}/transactions'],
      ['post', '/v1/policy-drafts'],
      ['put', '/v1/policy-drafts/{id}'],
      ['post', '/v1/policy-drafts/{id}/transaction'],
      ['post', '/v1/chain-observations'],
      ['get', '/v1/policies/{id}'],
      ['post', '/v1/policies/{id}/revocation-transaction'],
      ['post', '/v1/invoices'],
      ['post', '/v1/payment-intents'],
      ['post', '/v1/payment-intents/{id}/simulate'],
      ['get', '/v1/payment-intents/{id}/approval-typed-data'],
      ['post', '/v1/payment-intents/{id}/approvals'],
      ['post', '/v1/payment-intents/{id}/submit'],
      ['get', '/v1/payments/{id}'],
      ['get', '/v1/payments/{id}/timeline'],
      ['get', '/v1/payments'],
      ['get', '/v1/transactions/{hash}'],
      ['get', '/health/live'],
      ['get', '/health/ready'],
    ];
    for (const [method, path] of required) {
      expect(committed.paths[path]?.[method], `${method.toUpperCase()} ${path}`).toBeDefined();
    }
  });
});
