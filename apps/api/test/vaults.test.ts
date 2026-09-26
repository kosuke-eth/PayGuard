/**
 * Vault discovery/detail ownership + pagination-bypass, owner-transaction preparation with real
 * calldata decoding executed against the real deployed vault (multi-step deposit: approve then
 * deposit, confirmed via real receipts and a real balance read), and operation read authorization.
 */
import { randomBytes } from 'node:crypto';
import { mintTokens } from '@payguard/test-utils';
import type { Address } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authHeaders,
  createTestHarness,
  seedOwnerVault,
  seedPolicy,
  seedSession,
  seedVaultForWallet,
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

describe('GET /v1/vaults/:id ownership', () => {
  it('403s when the vault belongs to a different owner', async () => {
    const strangerWalletId = await seedWallet(harness, randomAddress());
    const { vaultId: strangerVaultId } = await seedVaultForWallet(harness, {
      ownerWalletId: strangerWalletId,
      address: randomAddress(),
    });

    const { walletId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });

    const response = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/vaults/${strangerVaultId}`,
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('RESOURCE_FORBIDDEN');
  });

  it('404s for an unknown vault id', async () => {
    const { walletId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const response = await harness.built.app.inject({
      method: 'GET',
      url: '/v1/vaults/00000000-0000-4000-8000-000000000000',
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('200s and returns the caller own vault detail', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const response = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/vaults/${vaultId}`,
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.vaultId).toBe(vaultId);
  });

  it('reports the ACTUAL vault owner address, not the caller own, when read by a bound agent', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const agentWalletId = await seedWallet(harness, harness.fixture.agentAccount.address);
    await seedPolicy(harness, {
      vaultId,
      onchainPolicyId: `0x${randomBytes(32).toString('hex')}`,
      config: {
        agent: harness.fixture.agentAccount.address,
        inputToken: harness.fixture.tokenAddress,
        settlementToken: harness.fixture.tokenAddress,
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
        allowedCategoryBitmap: '1',
        subsidyMode: 'NONE',
      },
    });
    const agentSession = await seedSession(harness, {
      walletId: agentWalletId,
      sessionKind: 'AGENT',
    });

    const response = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/vaults/${vaultId}`,
      headers: authHeaders(agentSession),
    });
    expect(response.statusCode).toBe(200);
    // The caller is the AGENT, but ownerAddress must name the actual owner wallet, never the
    // agent's own session address.
    expect(response.json().data.ownerAddress.toLowerCase()).toBe(
      harness.fixture.ownerAccount.address.toLowerCase(),
    );
    expect(response.json().data.ownerAddress.toLowerCase()).not.toBe(
      harness.fixture.agentAccount.address.toLowerCase(),
    );
    void walletId;
  });
});

describe('GET /v1/vaults pagination', () => {
  it('paginates within the caller own set and a cursor cannot widen scope to another owner', async () => {
    const ownerWalletId = await seedWallet(harness, randomAddress());
    const vaultIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { vaultId } = await seedVaultForWallet(harness, {
        ownerWalletId,
        address: randomAddress(),
      });
      vaultIds.push(vaultId);
    }
    const session = await seedSession(harness, { walletId: ownerWalletId, sessionKind: 'AGENT' });

    const firstPage = await harness.built.app.inject({
      method: 'GET',
      url: '/v1/vaults?limit=2',
      headers: authHeaders(session),
    });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json().data;
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).toBeTruthy();

    const secondPage = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/vaults?limit=2&cursor=${firstBody.nextCursor}`,
      headers: authHeaders(session),
    });
    expect(secondPage.statusCode).toBe(200);
    const secondBody = secondPage.json().data;
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.nextCursor).toBeNull();

    const seenIds = [...firstBody.items, ...secondBody.items].map(
      (v: { vaultId: string }) => v.vaultId,
    );
    expect(new Set(seenIds)).toEqual(new Set(vaultIds));

    // Bypass attempt: use a DIFFERENT owner's own vault id as the cursor. The keyset query filters
    // by session-derived owner_wallet_id first, so this can only ever narrow *this* caller's own
    // set (or return nothing) -- it can never surface the stranger's vaults.
    const strangerWalletId = await seedWallet(harness, randomAddress());
    const { vaultId: strangerVaultId } = await seedVaultForWallet(harness, {
      ownerWalletId: strangerWalletId,
      address: randomAddress(),
    });
    const bypassAttempt = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/vaults?cursor=${strangerVaultId}`,
      headers: authHeaders(session),
    });
    expect(bypassAttempt.statusCode).toBe(200);
    const bypassIds = bypassAttempt.json().data.items.map((v: { vaultId: string }) => v.vaultId);
    expect(bypassIds).not.toContain(strangerVaultId);
    for (const id of bypassIds) expect(vaultIds).toContain(id);
  });
});

describe('POST /v1/vaults/:id/transactions -- schema strictness', () => {
  it('rejects a request with no Idempotency-Key header', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const response = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: authHeaders(session),
      payload: { action: 'SET_EXECUTION_PAUSED', paused: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('rejects a DEPOSIT body carrying an extra field not on that action branch', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const response = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-extra-field' },
      payload: {
        action: 'DEPOSIT',
        token: harness.fixture.tokenAddress,
        amountAtomic: '1000',
        recipient: harness.fixture.ownerAccount.address,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_SCHEMA');
  });

  it('rejects a non-canonical decimal string amount (leading zero)', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const response = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-leading-zero' },
      payload: { action: 'DEPOSIT', token: harness.fixture.tokenAddress, amountAtomic: '01000' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_SCHEMA');
  });

  it('rejects a coercible-but-wrong-type paused field (string instead of boolean)', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const response = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-coerce' },
      payload: { action: 'SET_EXECUTION_PAUSED', paused: 'true' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_SCHEMA');
  });

  it('resubmitting the same Idempotency-Key with the SAME body returns the identical operation, not a freshly re-prepared one', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const payload = { action: 'CANCEL_APPROVAL_NONCE', nonce: '99' };

    const first = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-idem-replay' },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json().data;

    const second = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-idem-replay' },
      payload,
    });
    expect(second.statusCode).toBe(201);
    const secondBody = second.json().data;
    expect(secondBody.operationId).toBe(firstBody.operationId);
    expect(secondBody.transactions).toEqual(firstBody.transactions);

    const operations = await harness.pool.query(
      "SELECT count(*)::int AS n FROM operations WHERE resource_id = $1 AND operation_kind = 'CANCEL_APPROVAL_NONCE'",
      [vaultId],
    );
    expect(operations.rows[0].n).toBe(1);
  });

  it('reusing the same Idempotency-Key with a DIFFERENT body is refused, not silently accepted as the old request', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });

    const first = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-idem-conflict' },
      payload: { action: 'CANCEL_APPROVAL_NONCE', nonce: '1' },
    });
    expect(first.statusCode).toBe(201);

    const second = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-idem-conflict' },
      payload: { action: 'CANCEL_APPROVAL_NONCE', nonce: '2' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('POST /v1/vaults/:id/transactions -- real prepared calldata, executed on-chain', () => {
  it('a fresh DEPOSIT with zero allowance prepares two steps (approve, deposit); executing both actually moves funds', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });

    const depositAmount = 5_000_000n; // 5 mUSDC (6 decimals)
    await mintTokens(harness.fixture, harness.fixture.ownerAccount.address, depositAmount);

    const response = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-deposit-1' },
      payload: {
        action: 'DEPOSIT',
        token: harness.fixture.tokenAddress,
        amountAtomic: depositAmount.toString(10),
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json().data;
    expect(body.transactions).toHaveLength(2);
    expect(body.review.multiStep).toBe(true);
    expect(body.review.approvalIsNotDeposit).toBe(true);
    expect(body.review.steps[0].stepKind).toBe('APPROVE');
    expect(body.review.steps[0].decoded.spender.toLowerCase()).toBe(
      harness.fixture.vaultAddress.toLowerCase(),
    );
    expect(body.review.steps[0].decoded.amountAtomic).toBe(depositAmount.toString(10));
    expect(body.review.steps[1].stepKind).toBe('DEPOSIT');
    expect(body.review.steps[1].decoded.token.toLowerCase()).toBe(
      harness.fixture.tokenAddress.toLowerCase(),
    );
    expect(body.review.steps[1].decoded.amountAtomic).toBe(depositAmount.toString(10));

    // Execute the REAL prepared bytes against the REAL deployed vault -- prove the calldata this
    // route emits is not just internally-consistent-looking JSON but actually executable, and that
    // an approval alone is not deposit completion (SPEC-006).
    const balanceBefore = await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.vaultAddress],
    });
    expect(balanceBefore as bigint).toBe(0n);

    for (const tx of body.transactions) {
      const hash = await harness.fixture.ownerWalletClient.sendTransaction({
        to: tx.to as Address,
        data: tx.data as `0x${string}`,
        value: BigInt(tx.value),
        chain: null,
        account: harness.fixture.ownerAccount,
      });
      const receipt = await harness.fixture.publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe('success');
    }

    const balanceAfter = await harness.fixture.publicClient.readContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'balanceOf',
      args: [harness.fixture.vaultAddress],
    });
    expect(balanceAfter as bigint).toBe(depositAmount);

    const operation = await harness.pool.query('SELECT result FROM operations WHERE id = $1', [
      body.operationId,
    ]);
    const steps = operation.rows[0].result.steps as Array<{ kind: string; status: string }>;
    expect(steps.map((s) => s.kind)).toEqual(['APPROVE', 'DEPOSIT']);
    expect(steps.every((s) => s.status === 'PENDING')).toBe(true);
  }, 20_000);

  it('a DEPOSIT with sufficient existing allowance prepares a single step', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });

    const depositAmount = 1_000_000n;
    await mintTokens(harness.fixture, harness.fixture.ownerAccount.address, depositAmount * 2n);
    const approveHash = await harness.fixture.ownerWalletClient.writeContract({
      address: harness.fixture.tokenAddress,
      abi: harness.fixture.erc20Abi,
      functionName: 'approve',
      args: [harness.fixture.vaultAddress, depositAmount * 2n],
      chain: null,
      account: harness.fixture.ownerAccount,
    });
    await harness.fixture.publicClient.waitForTransactionReceipt({ hash: approveHash });

    const response = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-deposit-2' },
      payload: {
        action: 'DEPOSIT',
        token: harness.fixture.tokenAddress,
        amountAtomic: depositAmount.toString(10),
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json().data;
    expect(body.transactions).toHaveLength(1);
    expect(body.review.multiStep).toBe(false);
    expect(body.review.steps[0].stepKind).toBe('DEPOSIT');
  }, 20_000);

  it('prepares a real WITHDRAW, REVOKE_AGENT, SET_EXECUTION_PAUSED and CANCEL_APPROVAL_NONCE with decoded review matching the request', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });

    const withdraw = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-withdraw' },
      payload: {
        action: 'WITHDRAW',
        token: harness.fixture.tokenAddress,
        amountAtomic: '42',
        recipient: harness.fixture.merchantAccount.address,
      },
    });
    expect(withdraw.statusCode).toBe(201);
    const withdrawDecoded = withdraw.json().data.review.steps[0].decoded;
    expect(withdrawDecoded.amountAtomic).toBe('42');
    expect(withdrawDecoded.recipient.toLowerCase()).toBe(
      harness.fixture.merchantAccount.address.toLowerCase(),
    );

    const revoke = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-revoke' },
      payload: { action: 'REVOKE_AGENT', agent: harness.fixture.agentAccount.address },
    });
    expect(revoke.statusCode).toBe(201);
    expect(revoke.json().data.review.steps[0].decoded.terminal).toBe(true);

    const pause = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-pause' },
      payload: { action: 'SET_EXECUTION_PAUSED', paused: true },
    });
    expect(pause.statusCode).toBe(201);
    expect(pause.json().data.review.steps[0].decoded.paused).toBe(true);

    const cancelNonce = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-cancel-nonce' },
      payload: { action: 'CANCEL_APPROVAL_NONCE', nonce: '7' },
    });
    expect(cancelNonce.statusCode).toBe(201);
    expect(cancelNonce.json().data.review.steps[0].decoded.nonce).toBe('7');
  });
});

describe('GET /v1/operations/:id ownership', () => {
  it('the operation-creating owner can read it back', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const created = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-op-owner-read' },
      payload: { action: 'SET_EXECUTION_PAUSED', paused: false },
    });
    const operationId = created.json().data.operationId;

    const response = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/operations/${operationId}`,
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.operationId).toBe(operationId);
    expect(response.json().data.resourceType).toBe('vault');
    expect(response.json().data.resourceId).toBe(vaultId);
  });

  it('a stranger cannot read another owner operation', async () => {
    const { walletId, vaultId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const created = await harness.built.app.inject({
      method: 'POST',
      url: `/v1/vaults/${vaultId}/transactions`,
      headers: { ...authHeaders(session), 'idempotency-key': 'k-op-stranger' },
      payload: { action: 'SET_EXECUTION_PAUSED', paused: false },
    });
    const operationId = created.json().data.operationId;

    const strangerWalletId = await seedWallet(harness, randomAddress());
    const strangerSession = await seedSession(harness, {
      walletId: strangerWalletId,
      sessionKind: 'AGENT',
    });
    const response = await harness.built.app.inject({
      method: 'GET',
      url: `/v1/operations/${operationId}`,
      headers: authHeaders(strangerSession),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('RESOURCE_FORBIDDEN');
  });

  it('404s for an unknown operation id', async () => {
    const { walletId } = await seedOwnerVault(harness);
    const session = await seedSession(harness, { walletId, sessionKind: 'AGENT' });
    const response = await harness.built.app.inject({
      method: 'GET',
      url: '/v1/operations/00000000-0000-4000-8000-000000000000',
      headers: authHeaders(session),
    });
    expect(response.statusCode).toBe(404);
  });
});
