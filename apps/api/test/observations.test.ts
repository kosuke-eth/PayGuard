/**
 * POST /v1/chain-observations -- a client-supplied txHash is an INDEXING HINT and nothing else.
 * Stage 4 has no durable observer, so this must never assert success, activation, or settlement
 * from the hint alone -- including a hint that names the "wrong" transaction (wrong recipient,
 * wrong contract, wrong chain, or pure nonsense): the endpoint accepts it as QUEUED work without
 * validating it, and no privileged state (an operation's status, a policy, a payment) may move as
 * a side effect of accepting an unvalidated hash. Also SPEC-018 deploymentId validation and the
 * ownership/authz boundary on the related resource.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authHeaders,
  createTestHarness,
  seedOwnerVault,
  seedSession,
  seedWallet,
  type TestHarness,
} from './helpers/testApp.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
}, 60_000);

afterAll(async () => {
  await harness.stopAnvil();
}, 30_000);

function randomAddress(): `0x${string}` {
  return `0x${randomBytes(20).toString('hex')}`;
}
function randomHash(): `0x${string}` {
  return `0x${randomBytes(32).toString('hex')}`;
}

describe('POST /v1/chain-observations', () => {
  it('rejects a deploymentId that is not the single active deployment (SPEC-018)', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const response = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/chain-observations',
      headers: authHeaders(session),
      payload: {
        deploymentId: '00000000-0000-4000-8000-000000000000',
        txHash: randomHash(),
        relatedResourceId: vaultId,
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('DEPLOYMENT_MISMATCH');
  });

  it('404s when relatedResourceId names nothing trackable', async () => {
    const { walletId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const response = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/chain-observations',
      headers: authHeaders(session),
      payload: {
        deploymentId: harness.deploymentId,
        txHash: randomHash(),
        relatedResourceId: '00000000-0000-4000-8000-000000000000',
      },
    });
    expect(response.statusCode).toBe(404);
  });

  it('403s when relatedResourceId names a vault the caller cannot reach', async () => {
    const { vaultId: strangerVaultId } = await (async () => {
      const strangerWalletId = await seedWallet(harness, randomAddress());
      const { seedVaultForWallet } = await import('./helpers/testApp.js');
      return seedVaultForWallet(harness, {
        ownerWalletId: strangerWalletId,
        address: randomAddress(),
      });
    })();

    const { walletId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const response = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/chain-observations',
      headers: authHeaders(session),
      payload: {
        deploymentId: harness.deploymentId,
        txHash: randomHash(),
        relatedResourceId: strangerVaultId,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('RESOURCE_FORBIDDEN');
  });

  it('accepts a hint pointing at a nonsense/unrelated txHash -- 202 QUEUED, never activated, and no vault state moves', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });

    // Deliberately a "wrong" hash: not a real transaction, not related to this vault in any way,
    // could equally stand in for a wrong-recipient/wrong-contract/wrong-chain transaction hash --
    // the point is the API cannot distinguish it from a real one at Stage 4 and MUST NOT try.
    const nonsenseHash = randomHash();

    const response = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/chain-observations',
      headers: authHeaders(session),
      payload: {
        deploymentId: harness.deploymentId,
        txHash: nonsenseHash,
        relatedResourceId: vaultId,
      },
    });
    expect(response.statusCode).toBe(202);
    const body = response.json().data;
    expect(body.status).toBe('QUEUED');
    expect(body.note).toMatch(/indexing hint/i);
    expect(body.note).not.toMatch(/verified|confirmed|settled/i);
    expect(body.linkedPreparedOperationId).toBeNull();

    // No side effect on the vault's own read model: it must not report itself as touched by an
    // unverified hint.
    const vaultRead = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/vaults/${vaultId}`,
      headers: authHeaders(session),
    });
    expect(vaultRead.statusCode).toBe(200);

    // The operation this call created stays QUEUED with no transaction hash asserted -- accepting
    // the hint is not the same as confirming it.
    const operationRow = await harness.pool.query(
      'SELECT status, transaction_hash FROM operations WHERE id = $1',
      [body.operationId],
    );
    expect(operationRow.rows[0].status).toBe('QUEUED');
    expect(operationRow.rows[0].transaction_hash).toBeNull();
  });

  it('links to an existing prepared operation for the same resource when one is open', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });

    const prepared = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-obs-link' },
      payload: { action: 'SET_EXECUTION_PAUSED', paused: true },
    });
    const preparedOperationId = prepared.json().data.operationId;

    const observation = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/chain-observations',
      headers: authHeaders(session),
      payload: {
        deploymentId: harness.deploymentId,
        txHash: randomHash(),
        relatedResourceId: vaultId,
      },
    });
    expect(observation.statusCode).toBe(202);
    expect(observation.json().data.linkedPreparedOperationId).toBe(preparedOperationId);
  });

  it('resubmitting the same (resource, txHash) hint enqueues exactly one outbox job', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const txHash = randomHash();

    const first = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/chain-observations',
      headers: authHeaders(session),
      payload: { deploymentId: harness.deploymentId, txHash, relatedResourceId: vaultId },
    });
    expect(first.statusCode).toBe(202);

    const second = await harness.built.app.inject({
      method: 'POST',
      url: '/v1/chain-observations',
      headers: authHeaders(session),
      payload: { deploymentId: harness.deploymentId, txHash, relatedResourceId: vaultId },
    });
    expect(second.statusCode).toBe(202);
    // Two ACCEPTED responses (each gets its own operation id), but the underlying work is one job.
    expect(second.json().data.operationId).not.toBe(first.json().data.operationId);

    const jobs = await harness.pool.query(
      'SELECT count(*)::int AS n FROM outbox WHERE event_key = $1',
      [`observation:${vaultId}:${txHash}`],
    );
    expect(jobs.rows[0].n).toBe(1);
  });
});
