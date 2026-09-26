/**
 * Policy drafts: ownership, business-rule validation, draft-edit races (concurrent PUT racing on
 * expectedVersion), and the compile route's immutable-artifact round-trip (recompiling the same
 * draft version returns the SAME archived bytes rather than silently re-encoding). Also GET
 * /v1/policies/:id and the revocation-transaction route against a directly-seeded policy row
 * (Stage 5's worker, which would normally populate `policies` from a verified receipt, does not
 * exist yet).
 */

import { randomBytes } from 'node:crypto';
import { computePolicyConfigHash } from '@payguard/chain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authHeaders,
  createTestHarness,
  seedOwnerVault,
  seedPolicy,
  seedSession,
  seedWallet,
  type TestHarness,
} from './helpers/testApp.js';

function randomAddress(): `0x${string}` {
  return `0x${randomBytes(20).toString('hex')}`;
}

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
}, 60_000);

afterAll(async () => {
  await harness.stopAnvil();
}, 30_000);

function validConfig(overrides: Partial<Record<string, string>> = {}) {
  return {
    agent: undefined as unknown as `0x${string}`, // filled per-test with fixture.agentAccount.address
    inputToken: undefined as unknown as `0x${string}`,
    settlementToken: undefined as unknown as `0x${string}`,
    adapter: '0x0000000000000000000000000000000000000000',
    routeId: `0x${'0'.repeat(64)}`,
    totalOutputBudget: '1000000000',
    epochOutputBudget: '500000000',
    automaticOutputCap: '100000000',
    escalationOutputCap: '200000000',
    totalInputBudget: '1000000000',
    maxInputPerPayment: '50000000',
    validAfter: '0',
    validUntil: '99999999999',
    allowedCategoryBitmap: '1', // bit 0 set
    subsidyMode: 'NONE' as const,
    ...overrides,
  };
}

describe('POST /v1/policy-drafts', () => {
  it('403s creating a draft for a vault the caller does not own', async () => {
    const { vaultId } = await seedOwnerVault(harness);
    const strangerWalletId = await seedWallet(harness, randomAddress());
    const strangerSession = await seedSession(harness, {
      walletId: strangerWalletId,
      sessionKind: 'AGENT',
    });
    const config = validConfig();
    config.agent = harness.fixture.agentAccount.address;
    config.inputToken = harness.fixture.tokenAddress;
    config.settlementToken = harness.fixture.tokenAddress;

    const response = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/policy-drafts',
      headers: authHeaders(strangerSession),
      payload: { vaultId, config, merchants: [] },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects a config that fails business-rule validation (automaticCap > escalationCap)', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const config = validConfig({ automaticOutputCap: '999999999', escalationOutputCap: '1' });
    config.agent = harness.fixture.agentAccount.address;
    config.inputToken = harness.fixture.tokenAddress;
    config.settlementToken = harness.fixture.tokenAddress;

    const response = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/policy-drafts',
      headers: authHeaders(session),
      payload: { vaultId, config, merchants: [] },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('POLICY_VALIDATION_FAILED');
  });

  it('creates a valid draft at version 1 and grants no chain authority', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const config = validConfig();
    config.agent = harness.fixture.agentAccount.address;
    config.inputToken = harness.fixture.tokenAddress;
    config.settlementToken = harness.fixture.tokenAddress;

    const response = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/policy-drafts',
      headers: authHeaders(session),
      payload: { vaultId, config, merchants: [] },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json().data;
    expect(body.draftVersion).toBe('1');
    expect(body.chainAuthorityCreated).toBe(false);
  });
});

describe('PUT /v1/policy-drafts/:id -- draft edit races', () => {
  it('concurrent edits at the same expectedVersion: exactly one succeeds, the other 409s', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const config = validConfig();
    config.agent = harness.fixture.agentAccount.address;
    config.inputToken = harness.fixture.tokenAddress;
    config.settlementToken = harness.fixture.tokenAddress;

    const created = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/policy-drafts',
      headers: authHeaders(session),
      payload: { vaultId, config, merchants: [] },
    });
    const draftId = created.json().data.draftId;

    const attempt = (totalOutputBudget: string) =>
      harness.built.app.inject({
        method: 'PUT',
        url: `/v1/policy-drafts/${draftId}`,
        headers: authHeaders(session),
        payload: {
          expectedVersion: '1',
          config: { ...config, totalOutputBudget },
          merchants: [],
        },
      });

    const [a, b] = await Promise.all([attempt('1111111111'), attempt('2222222222')]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const winner = a.statusCode === 200 ? a : b;
    expect(winner.json().data.draftVersion).toBe('2');
    const loser = a.statusCode === 409 ? a : b;
    expect(loser.json().error.code).toBe('DRAFT_VERSION_CONFLICT');
  });

  it('rejects a stale expectedVersion after the draft already moved on', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const config = validConfig();
    config.agent = harness.fixture.agentAccount.address;
    config.inputToken = harness.fixture.tokenAddress;
    config.settlementToken = harness.fixture.tokenAddress;

    const created = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/policy-drafts',
      headers: authHeaders(session),
      payload: { vaultId, config, merchants: [] },
    });
    const draftId = created.json().data.draftId;

    const first = await harness.built.app.inject({
      method: 'PUT',
      url: `/v1/policy-drafts/${draftId}`,
      headers: authHeaders(session),
      payload: { expectedVersion: '1', config, merchants: [] },
    });
    expect(first.statusCode).toBe(200);

    const stale = await harness.built.app.inject({
      method: 'PUT',
      url: `/v1/policy-drafts/${draftId}`,
      headers: authHeaders(session),
      payload: { expectedVersion: '1', config, merchants: [] },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('DRAFT_VERSION_CONFLICT');
  });
});

describe('POST /v1/policy-drafts/:id/transaction -- immutable artifact round-trip', () => {
  it('recompiling the same draft version returns byte-identical archived transaction data', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const config = validConfig();
    config.agent = harness.fixture.agentAccount.address;
    config.inputToken = harness.fixture.tokenAddress;
    config.settlementToken = harness.fixture.tokenAddress;

    const created = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/policy-drafts',
      headers: authHeaders(session),
      payload: { vaultId, config, merchants: [] },
    });
    const draftId = created.json().data.draftId;

    const first = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/policy-drafts/${draftId}/transaction`,
      headers: authHeaders(session),
      payload: { expectedVersion: '1' },
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json().data;
    expect(firstBody.previouslyCompiled).toBe(false);

    const second = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/policy-drafts/${draftId}/transaction`,
      headers: authHeaders(session),
      payload: { expectedVersion: '1' },
    });
    expect(second.statusCode).toBe(201);
    const secondBody = second.json().data;
    expect(secondBody.previouslyCompiled).toBe(true);

    expect(secondBody.transaction.data).toBe(firstBody.transaction.data);
    expect(secondBody.draftDigest).toBe(firstBody.draftDigest);
    expect(secondBody.draftVersion).toBe(firstBody.draftVersion);
  });

  it('compiling against a stale expectedVersion after an edit 409s', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const config = validConfig();
    config.agent = harness.fixture.agentAccount.address;
    config.inputToken = harness.fixture.tokenAddress;
    config.settlementToken = harness.fixture.tokenAddress;

    const created = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/policy-drafts',
      headers: authHeaders(session),
      payload: { vaultId, config, merchants: [] },
    });
    const draftId = created.json().data.draftId;

    await harness.built.app.inject({
      method: 'PUT',
      url: `/v1/policy-drafts/${draftId}`,
      headers: authHeaders(session),
      payload: { expectedVersion: '1', config, merchants: [] },
    });

    const staleCompile = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/policy-drafts/${draftId}/transaction`,
      headers: authHeaders(session),
      payload: { expectedVersion: '1' },
    });
    expect(staleCompile.statusCode).toBe(409);
    expect(staleCompile.json().error.code).toBe('DRAFT_VERSION_CONFLICT');
  });
});

describe('GET /v1/policies/:id + revocation-transaction (seeded policy)', () => {
  it('round-trips the seeded config/merchants and matches the independently-computed configHash', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const config = validConfig();
    config.agent = harness.fixture.agentAccount.address;
    config.inputToken = harness.fixture.tokenAddress;
    config.settlementToken = harness.fixture.tokenAddress;

    const onchainPolicyId = `0x${'1'.repeat(64)}` as `0x${string}`;
    const { policyId } = await seedPolicy(harness, {
      vaultId,
      onchainPolicyId,
      // biome-ignore lint/suspicious/noExplicitAny: local test fixture shape matches seedPolicy's config param exactly
      config: config as any,
      merchants: [
        {
          merchantId: `0x${'2'.repeat(64)}`,
          recipient: harness.fixture.merchantAccount.address,
          invoiceSigner: harness.fixture.merchantAccount.address,
          category: 0,
        },
      ],
    });

    const response = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/policies/${policyId}`,
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.onchainPolicyId).toBe(onchainPolicyId);
    expect(body.merchants).toHaveLength(1);
    expect(body.merchants[0].recipient.toLowerCase()).toBe(
      harness.fixture.merchantAccount.address.toLowerCase(),
    );
    // biome-ignore lint/suspicious/noExplicitAny: same local fixture shape
    expect(body.configHash).toBe(computePolicyConfigHash(config as any));
  });

  it('prepares a real revocation transaction whose decoded review names the seeded onchainPolicyId', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const config = validConfig();
    config.agent = harness.fixture.agentAccount.address;
    config.inputToken = harness.fixture.tokenAddress;
    config.settlementToken = harness.fixture.tokenAddress;

    const onchainPolicyId = `0x${'3'.repeat(64)}` as `0x${string}`;
    const { policyId } = await seedPolicy(harness, {
      vaultId,
      onchainPolicyId,
      // biome-ignore lint/suspicious/noExplicitAny: local test fixture shape matches seedPolicy's config param exactly
      config: config as any,
    });

    const response = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/policies/${policyId}/revocation-transaction`,
      headers: authHeaders(session),
      payload: {},
    });
    expect(response.statusCode).toBe(201);
    const body = response.json().data;
    expect(body.review.onchainPolicyId).toBe(onchainPolicyId);
    expect(body.effectiveAfterChainExecution).toBe(true);
    expect(body.transaction.to.toLowerCase()).toBe(harness.fixture.vaultAddress.toLowerCase());
  });
});
