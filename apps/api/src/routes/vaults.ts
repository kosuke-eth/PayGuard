/**
 * Vault discovery, detail, owner transaction preparation, and operation reads.
 *
 * The backend NEVER signs for the owner and never accepts a caller-supplied target, selector or
 * calldata: the request is a narrow discriminated action and every byte of the resulting
 * transaction is generated here. The returned `review` is decoded back out of those bytes, so it
 * describes what the wallet will actually sign rather than restating the request.
 */
import { randomUUID } from 'node:crypto';
import {
  type OwnerAction,
  type PreparedStep,
  prepareApprove,
  prepareOwnerAction,
} from '@payguard/chain';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  createOperation,
  getDeploymentById,
  getOperationById,
  getPoliciesByVault,
  getVaultsKeysetForOwner,
  withTransaction,
} from '@payguard/db';
import { type Address, type Hash32, parseUIntString } from '@payguard/domain';
import type { FastifyInstance } from 'fastify';
import { keccak256 } from 'viem';
import {
  addressToBuffer,
  bufferToAddress,
  requireIdempotencyKey,
  requireSession,
} from '../auth.js';
import { requireVaultOwner, requireVaultOwnerOrAgent, resolveOperationVaultId } from '../authz.js';
import type { AppContext } from '../context.js';
import { ApiError, successEnvelope } from '../errors.js';
import { ID_PARAM, KEYSET_QUERY, VAULT_TRANSACTION_BODY } from '../schemas.js';

const ZERO_POLICY_ID = `0x${'0'.repeat(64)}` as Hash32;

interface KeysetQuery {
  cursor?: string;
  limit?: string;
  status?: string;
}

export function registerVaultRoutes(app: FastifyInstance, context: AppContext): void {
  // --- GET /v1/vaults -------------------------------------------------------------------------
  app.get<{ Querystring: KeysetQuery }>(
    '/v1/vaults',
    { schema: { querystring: KEYSET_QUERY } },
    async (request, reply) => {
      const auth = requireSession(request);
      const limit = request.query.limit ? Number.parseInt(request.query.limit, 10) : 25;

      // `vaults` has no created_at column, so the keyset is (owner_wallet_id, id) -- exactly the
      // existing vaults_owner index. The owner id comes from the session, never from the cursor,
      // so a cursor can only move forward within the caller's own set and can never widen it.
      const rows = await getVaultsKeysetForOwner(context.pool, {
        ownerWalletId: auth.walletId,
        ...(request.query.cursor ? { afterId: request.query.cursor } : {}),
        limit: limit + 1,
      });

      const page = rows.slice(0, limit);
      const nextCursor = rows.length > limit ? (page.at(-1)?.id ?? null) : null;

      const items = await Promise.all(
        page.map(async (vault) => {
          const deployment = await getDeploymentById(context.pool, vault.deploymentId);
          return {
            vaultId: vault.id,
            ownerAddress: auth.walletAddress,
            address: bufferToAddress(vault.address),
            deploymentId: vault.deploymentId,
            chainId: deployment ? deployment.chainId.toString(10) : null,
          };
        }),
      );

      return reply.status(200).send(successEnvelope({ items, nextCursor }, String(request.id)));
    },
  );

  // --- GET /v1/vaults/{id} --------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/vaults/:id',
    { schema: { params: ID_PARAM } },
    async (request, reply) => {
      const auth = requireSession(request);
      // A merchant reaches neither branch and gets 403: this owner balance view is not theirs.
      const { vault } = await requireVaultOwnerOrAgent(context, auth, request.params.id);

      // This route is reachable by a bound AGENT too (SPEC-019), so the caller's own session
      // address is NOT necessarily the vault owner's -- resolve the actual owner wallet rather
      // than mislabeling whichever role the caller happens to hold.
      const ownerWalletRow = await context.pool.query('SELECT address FROM wallets WHERE id = $1', [
        vault.ownerWalletId,
      ]);
      const ownerAddress = bufferToAddress(ownerWalletRow.rows[0].address as Buffer);

      const vaultAddress = bufferToAddress(vault.address);
      const reader = context.vaultReaderFor(vaultAddress);
      const policies = await getPoliciesByVault(context.pool, vault.id);

      let executionPaused: boolean | null = null;
      let observation = null;
      const balances: Array<{ token: string; symbol: string; amountAtomic: string }> = [];

      if (reader) {
        try {
          // SPEC-015: the vault exposes no executionPaused() getter. getPolicyState() assigns the
          // live flag unconditionally and never reverts on an unknown policy id, so a real policy
          // id (or the zero id when none exist) reads it correctly. ONLY this field is taken from
          // a zero-id read -- active/revoked/counters from a zero struct would be meaningless.
          const probeId =
            policies.length > 0
              ? (`0x${policies[0]?.onchainPolicyId.toString('hex')}` as Hash32)
              : ZERO_POLICY_ID;
          const state = await reader.getPolicyState(probeId);
          executionPaused = state.executionPaused;

          const deployment = await getDeploymentById(context.pool, vault.deploymentId);
          const tokens =
            (deployment?.configuration as { tokens?: Array<{ address: string; symbol: string }> })
              ?.tokens ?? [];
          for (const token of tokens) {
            const amount = await reader.tokenBalance(token.address as Address, vaultAddress);
            balances.push({
              token: token.address,
              symbol: token.symbol,
              amountAtomic: amount.toString(10),
            });
          }
          if (context.publicClient) {
            const block = await context.publicClient.getBlock();
            observation = {
              blockNumber: block.number.toString(10),
              blockHash: block.hash,
              canonical: true,
              observedAt: context.now().toISOString(),
            };
          }
        } catch {
          // A degraded RPC yields nulls that are visibly unobserved, not fabricated values.
          executionPaused = null;
        }
      }

      const body = {
        vaultId: vault.id,
        ownerAddress,
        address: vaultAddress,
        deploymentId: vault.deploymentId,
        chainId: vault.chainId.toString(10),
        executionPaused,
        balances,
        activePolicies: policies
          .filter((policy) => policy.observedStatus === 'ACTIVE')
          .map((policy) => ({
            policyResourceId: policy.id,
            onchainPolicyId: `0x${policy.onchainPolicyId.toString('hex')}`,
            agent: bufferToAddress(policy.agent),
          })),
        observation,
      };
      return reply.status(200).send(successEnvelope(body, String(request.id)));
    },
  );

  // --- POST /v1/vaults/{id}/transactions ------------------------------------------------------
  app.post<{ Params: { id: string }; Body: OwnerAction }>(
    '/v1/vaults/:id/transactions',
    { schema: { params: ID_PARAM, body: VAULT_TRANSACTION_BODY } },
    async (request, reply) => {
      const auth = requireSession(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const vault = await requireVaultOwner(context, auth, request.params.id);

      const vaultAddress = bufferToAddress(vault.address);
      const prepareContext = {
        chainId: vault.chainId.toString(10),
        ownerAddress: auth.walletAddress,
        vaultAddress,
      };

      const action = request.body;
      const steps: PreparedStep[] = [];

      if (action.action === 'DEPOSIT') {
        // Approval and deposit are two SEPARATE wallet transactions -- never an atomic pair.
        // Whether the approval step is needed is decided from the CURRENT on-chain allowance, so a
        // stale assumption cannot produce a one-step flow that reverts.
        const reader = context.vaultReaderFor(vaultAddress);
        const required = parseUIntString(action.amountAtomic);
        let allowance: bigint | null = null;
        if (reader) {
          try {
            allowance = await reader.tokenAllowance(action.token, auth.walletAddress, vaultAddress);
          } catch {
            allowance = null; // unknown allowance -> include the approval step rather than guess
          }
        }
        if (allowance === null || allowance < required) {
          steps.push(prepareApprove(prepareContext, action.token, action.amountAtomic));
        }
      }

      steps.push(prepareOwnerAction(prepareContext, action));

      const immutableRequest = Buffer.from(JSON.stringify(action), 'utf8');
      const requestDigest = Buffer.from(
        keccak256(`0x${immutableRequest.toString('hex')}`).slice(2),
        'hex',
      );

      const operationId = randomUUID();
      // A resubmit of the identical prepared-transaction request (same Idempotency-Key AND the
      // same canonical action body) must return the SAME response -- never a freshly re-prepared
      // transaction. Owner automations retry on timeout trusting exactly this contract; without it
      // a retried WITHDRAW/DEPOSIT could be independently signed and broadcast twice.
      const body = await withTransaction(context.pool, async (client) => {
        const idempotent = await beginIdempotentRequest(client, {
          id: randomUUID(),
          principalWalletId: auth.walletId,
          operation: `vault_transaction:${vault.id}`,
          clientKey: idempotencyKey,
          requestDigest,
        });
        if (idempotent.kind === 'conflict') {
          throw new ApiError(
            'IDEMPOTENCY_KEY_REUSED',
            'this Idempotency-Key was already used for a different request body',
          );
        }
        if (idempotent.kind === 'existing') {
          return idempotent.row.responseBody as Record<string, unknown>;
        }

        await createOperation(client, {
          id: operationId,
          principalWalletId: auth.walletId,
          deploymentId: vault.deploymentId,
          operationKind: action.action,
          resourceKind: 'vault',
          resourceId: vault.id,
          immutableRequest,
          requestDigest,
          // Multi-step deposits are ONE operation with an ordered step array (SPEC-006). The
          // operation completes only when the final DEPOSIT step succeeds -- an approval alone is
          // never deposit completion.
          ...(steps.length > 1 ? { stepKinds: steps.map((step) => step.stepKind) } : {}),
        });

        const freshBody = {
          operationId,
          transactions: steps.map((step) => step.transaction),
          review: {
            steps: steps.map((step, index) => ({
              index,
              stepKind: step.stepKind,
              decoded: step.review,
            })),
            // Explicit so a client cannot mistake the two-transaction flow for an atomic one.
            multiStep: steps.length > 1,
            approvalIsNotDeposit: steps.length > 1,
            invalidatedBy: [
              'account change',
              'chain change',
              'allowance change',
              'deployment change',
            ],
          },
        };
        await completeIdempotentRequest(client, {
          id: idempotent.row.id,
          status: 'COMPLETED',
          resourceKind: 'vault',
          resourceId: vault.id,
          responseStatus: 201,
          responseBody: freshBody,
        });
        return freshBody;
      });

      return reply.status(201).send(successEnvelope(body, String(request.id)));
    },
  );

  // --- GET /v1/operations/{id} ----------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/operations/:id',
    { schema: { params: ID_PARAM } },
    async (request, reply) => {
      const auth = requireSession(request);

      // Bare-id read, so it is immediately paired with an ownership predicate before anything is
      // returned. `operations.(resource_kind, resource_id)` is polymorphic and FK-less, so agent
      // access goes through the explicit dispatch table rather than a guessed join.
      const operation = await getOperationById(context.pool, request.params.id);
      if (!operation) {
        throw new ApiError('RESOURCE_NOT_FOUND', 'operation not found');
      }

      if (operation.principalWalletId !== auth.walletId) {
        const vaultId = await resolveOperationVaultId(context, {
          resourceKind: operation.resourceKind,
          resourceId: operation.resourceId,
        });
        await requireVaultOwnerOrAgent(context, auth, vaultId);
      }

      const body = {
        operationId: operation.id,
        resourceType: operation.resourceKind,
        resourceId: operation.resourceId,
        status: operation.status,
        result: operation.result,
        transactionHash: operation.transactionHash
          ? `0x${operation.transactionHash.toString('hex')}`
          : null,
      };
      return reply.status(200).send(successEnvelope(body, String(request.id)));
    },
  );
}

export { addressToBuffer };
