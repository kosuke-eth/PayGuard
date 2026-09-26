/**
 * POST /v1/chain-observations -- bounded, authenticated tracking intake.
 *
 * A client-supplied `txHash` is an INDEXING HINT and nothing else. This endpoint deliberately
 * performs no activation, no status assignment and no success claim: it writes a QUEUED operation
 * plus one outbox job and returns. API_CONTRACT.md: "A caller cannot assert success using a
 * made-up transaction hash."
 *
 * At Stage 4 there is no durable observer, so these observations genuinely remain QUEUED. That is
 * reported honestly in the response rather than being papered over with a fabricated result --
 * validating the receipt and deciding the outcome is Stage 5's work, using the shared
 * `packages/chain/receipts.ts` primitive this stage exports for it.
 */
import { randomUUID } from 'node:crypto';
import {
  createOperation,
  enqueue,
  findOpenOperationForResource,
  withTransaction,
} from '@payguard/db';
import type { FastifyInstance } from 'fastify';
import { keccak256 } from 'viem';
import { requireSession } from '../auth.js';
import {
  assertActiveDeployment,
  requireVaultOwnerOrAgent,
  resolveOperationVaultId,
} from '../authz.js';
import type { AppContext } from '../context.js';
import { ApiError, successEnvelope } from '../errors.js';
import { CHAIN_OBSERVATION_BODY } from '../schemas.js';

interface ObservationBody {
  deploymentId: string;
  txHash: string;
  relatedResourceId: string;
}

/**
 * Determines what kind of resource `relatedResourceId` names and which vault it belongs to, so
 * access can be checked. A UUID that matches nothing the caller can reach is refused -- the
 * observation endpoint must not become a way to probe for foreign resource ids.
 */
async function classifyRelatedResource(
  context: AppContext,
  relatedResourceId: string,
): Promise<{ resourceKind: string; vaultId: string }> {
  const candidates: Array<{ resourceKind: string; table: string }> = [
    { resourceKind: 'policy_draft', table: 'policy_drafts' },
    { resourceKind: 'policy', table: 'policies' },
    { resourceKind: 'payment_intent', table: 'payment_intents' },
    { resourceKind: 'vault', table: 'vaults' },
  ];

  for (const candidate of candidates) {
    const column = candidate.table === 'vaults' ? 'id' : 'vault_id';
    const result = await context.pool.query(
      `SELECT ${column} AS vault_id FROM ${candidate.table} WHERE id = $1`,
      [relatedResourceId],
    );
    const row = result.rows[0];
    if (row) return { resourceKind: candidate.resourceKind, vaultId: row.vault_id as string };
  }

  throw new ApiError('RESOURCE_NOT_FOUND', 'relatedResourceId does not name a trackable resource');
}

export function registerObservationRoutes(app: FastifyInstance, context: AppContext): void {
  app.post<{ Body: ObservationBody }>(
    '/v1/chain-observations',
    { schema: { body: CHAIN_OBSERVATION_BODY } },
    async (request, reply) => {
      const auth = requireSession(request);

      // SPEC-018: the supplied deploymentId is VALIDATED against the single active deployment,
      // never used to select one -- otherwise it would be a way to reach another instance.
      assertActiveDeployment(context, request.body.deploymentId);

      const related = await classifyRelatedResource(context, request.body.relatedResourceId);
      // The caller must genuinely be able to reach the related resource.
      await requireVaultOwnerOrAgent(context, auth, related.vaultId);

      const txHashBuffer = Buffer.from(request.body.txHash.slice(2), 'hex');

      // SPEC-005: persist the linkage to the PREPARED operation (when one exists) so Stage 5 has a
      // stored request-digest to compare the observed transaction against, instead of being forced
      // to trust relatedResourceId.
      const preparedOperation = await findOpenOperationForResource(context.pool, {
        resourceKind: related.resourceKind,
        resourceId: request.body.relatedResourceId,
      });

      const immutableRequest = Buffer.from(JSON.stringify(request.body), 'utf8');
      const requestDigest = Buffer.from(
        keccak256(`0x${immutableRequest.toString('hex')}`).slice(2),
        'hex',
      );

      const operationId = randomUUID();
      await withTransaction(context.pool, async (client) => {
        await createOperation(client, {
          id: operationId,
          principalWalletId: auth.walletId,
          deploymentId: request.body.deploymentId,
          operationKind: 'TRACK_CHAIN_OBSERVATION',
          resourceKind: 'observation',
          resourceId: operationId,
          immutableRequest,
          requestDigest,
        });
        await enqueue(client, {
          id: randomUUID(),
          // Deterministic: re-submitting the same hint for the same resource is one job, not many.
          eventKey: `observation:${request.body.relatedResourceId}:${request.body.txHash}`,
          aggregateKind: related.resourceKind,
          aggregateId: request.body.relatedResourceId,
          eventType: 'CHAIN_OBSERVATION_REQUESTED',
          payload: {
            txHash: request.body.txHash,
            relatedResourceId: request.body.relatedResourceId,
            relatedResourceKind: related.resourceKind,
            deploymentId: request.body.deploymentId,
            preparedOperationId: preparedOperation?.id ?? null,
            preparedRequestDigest: preparedOperation
              ? `0x${preparedOperation.requestDigest.toString('hex')}`
              : null,
            observedTxHashIsHintOnly: true,
          },
        });
      });

      const body = {
        operationId,
        resourceType: 'observation',
        resourceId: operationId,
        status: 'QUEUED' as const,
        // Stated plainly so no client mistakes acceptance for verification.
        note: 'txHash is an indexing hint. No status, activation or settlement is assigned here; the durable observer that validates the receipt arrives in Stage 5, so this observation remains QUEUED.',
        txHashHex: `0x${txHashBuffer.toString('hex')}`,
        linkedPreparedOperationId: preparedOperation?.id ?? null,
      };
      return reply.status(202).send(successEnvelope(body, String(request.id)));
    },
  );

  // Exported for symmetry with the other resource-kind consumers.
  void resolveOperationVaultId;
}
