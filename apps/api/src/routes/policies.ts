/**
 * Policy preparation: drafts, immutable compiled revisions, and the prepared owner transactions.
 *
 * Nothing here creates chain authority. A draft is owner-editable working state; compiling it
 * archives the exact transaction bytes as an immutable revision; the OWNER's wallet signs and
 * broadcasts. A policy only becomes real when a verified receipt says so, which is Stage 5's job.
 */
import { randomUUID } from 'node:crypto';
import { computePolicyConfigHash, prepareCreatePolicy, prepareRevokePolicy } from '@payguard/chain';
import {
  archiveDraftRevision,
  createPolicyDraft,
  getPolicyDraftById,
  getPolicyMerchants,
  markDraftCompiled,
  updatePolicyDraft,
  withTransaction,
} from '@payguard/db';
import {
  type Hash32,
  type MerchantPermission,
  type PolicyConfig,
  parseUIntOfWidth,
  parseUIntString,
} from '@payguard/domain';
import type { FastifyInstance } from 'fastify';
import { keccak256 } from 'viem';
import { bufferToAddress, requireSession } from '../auth.js';
import { requirePolicyAccess, requireVaultOwner } from '../authz.js';
import type { AppContext } from '../context.js';
import { ApiError, successEnvelope } from '../errors.js';
import {
  EMPTY_BODY,
  ID_PARAM,
  POLICY_DRAFT_BODY,
  POLICY_DRAFT_TRANSACTION_BODY,
  POLICY_DRAFT_UPDATE_BODY,
} from '../schemas.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const MAX_MERCHANTS = 32;

interface DraftBody {
  vaultId: string;
  config: PolicyConfig;
  merchants: MerchantPermission[];
}

/**
 * Validates a draft against the same rules the contract and schema enforce, so an owner learns
 * about a bad configuration here rather than from a reverted transaction they paid gas for.
 * Widths are checked in bigint at each field's REAL Solidity width (uint48 validity bounds,
 * uint32 categories), never by coercing through Number.
 */
export function validatePolicyDraft(config: PolicyConfig, merchants: MerchantPermission[]): void {
  const problems: string[] = [];

  let validAfter = 0n;
  let validUntil = 0n;
  try {
    validAfter = parseUIntOfWidth(config.validAfter, 48);
    validUntil = parseUIntOfWidth(config.validUntil, 48);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : 'invalid validity window');
  }
  if (validUntil <= validAfter) problems.push('validUntil must be greater than validAfter');

  const totalOutput = parseUIntString(config.totalOutputBudget);
  const epochOutput = parseUIntString(config.epochOutputBudget);
  const automaticCap = parseUIntString(config.automaticOutputCap);
  const escalationCap = parseUIntString(config.escalationOutputCap);
  const totalInput = parseUIntString(config.totalInputBudget);
  const maxInputPerPayment = parseUIntString(config.maxInputPerPayment);

  if (automaticCap > escalationCap) {
    problems.push('automaticOutputCap must be <= escalationOutputCap');
  }
  if (escalationCap > totalOutput) {
    problems.push('escalationOutputCap must be <= totalOutputBudget');
  }
  if (epochOutput > totalOutput) {
    problems.push('epochOutputBudget must be <= totalOutputBudget');
  }
  if (maxInputPerPayment > totalInput) {
    problems.push('maxInputPerPayment must be <= totalInputBudget');
  }

  // A policy fixes ONE input asset and ONE route. The direct-transfer reference path is defined by
  // input == settlement, zero adapter and the zero route id; anything else must name an adapter.
  const isDirect = config.routeId === ZERO_HASH;
  if (isDirect) {
    if (config.inputToken.toLowerCase() !== config.settlementToken.toLowerCase()) {
      problems.push('direct route requires inputToken to equal settlementToken');
    }
    if (config.adapter !== ZERO_ADDRESS) {
      problems.push('direct route requires a zero adapter');
    }
  } else if (config.adapter === ZERO_ADDRESS) {
    problems.push('a non-direct route requires a non-zero adapter');
  }

  if (merchants.length > MAX_MERCHANTS) {
    problems.push(`at most ${MAX_MERCHANTS} merchant snapshots are allowed`);
  }

  const bitmap = parseUIntString(config.allowedCategoryBitmap);
  const seen = new Set<string>();
  for (const merchant of merchants) {
    if (seen.has(merchant.merchantId.toLowerCase())) {
      problems.push(`duplicate merchantId ${merchant.merchantId}`);
    }
    seen.add(merchant.merchantId.toLowerCase());

    const category = parseUIntOfWidth(merchant.category, 32);
    if (category > 255n) {
      problems.push(`category ${merchant.category} exceeds the wire bound of 255`);
    } else if ((bitmap & (1n << category)) === 0n) {
      problems.push(`category ${merchant.category} is not set in allowedCategoryBitmap`);
    }
    if (merchant.recipient === ZERO_ADDRESS) problems.push('merchant recipient must be non-zero');
    if (merchant.invoiceSigner === ZERO_ADDRESS) {
      problems.push('merchant invoiceSigner must be non-zero');
    }
  }

  if (problems.length > 0) {
    throw new ApiError('POLICY_VALIDATION_FAILED', 'policy draft is not valid', { problems });
  }
}

export function registerPolicyRoutes(app: FastifyInstance, context: AppContext): void {
  // --- POST /v1/policy-drafts -----------------------------------------------------------------
  app.post<{ Body: DraftBody }>(
    '/v1/policy-drafts',
    { schema: { body: POLICY_DRAFT_BODY } },
    async (request, reply) => {
      const auth = requireSession(request);
      await requireVaultOwner(context, auth, request.body.vaultId);
      validatePolicyDraft(request.body.config, request.body.merchants);

      const draftId = randomUUID();
      const body = { config: request.body.config, merchants: request.body.merchants };
      const draft = await withTransaction(context.pool, (client) =>
        createPolicyDraft(client, { id: draftId, vaultId: request.body.vaultId, body }),
      );

      return reply.status(201).send(
        successEnvelope(
          {
            draftId: draft.id,
            draftVersion: draft.draftVersion.toString(10),
            review: body,
            // Stated explicitly: preparing a draft grants nothing on chain.
            chainAuthorityCreated: false,
          },
          String(request.id),
        ),
      );
    },
  );

  // --- PUT /v1/policy-drafts/{id} -------------------------------------------------------------
  app.put<{ Params: { id: string }; Body: { expectedVersion: string } & DraftBody }>(
    '/v1/policy-drafts/:id',
    { schema: { params: ID_PARAM, body: POLICY_DRAFT_UPDATE_BODY } },
    async (request, reply) => {
      const auth = requireSession(request);
      const draft = await getPolicyDraftById(context.pool, request.params.id);
      if (!draft) throw new ApiError('RESOURCE_NOT_FOUND', 'policy draft not found');
      await requireVaultOwner(context, auth, draft.vaultId);

      validatePolicyDraft(request.body.config, request.body.merchants);

      const body = { config: request.body.config, merchants: request.body.merchants };
      const result = await withTransaction(context.pool, (client) =>
        updatePolicyDraft(client, {
          id: draft.id,
          expectedVersion: parseUIntString(request.body.expectedVersion),
          body,
        }),
      );
      if (!result.updated || !result.row) {
        // Someone else advanced the draft between this caller's read and write.
        throw new ApiError('DRAFT_VERSION_CONFLICT', 'draft version conflict; reload the draft');
      }

      return reply.status(200).send(
        successEnvelope(
          {
            draftId: result.row.id,
            draftVersion: result.row.draftVersion.toString(10),
            review: body,
          },
          String(request.id),
        ),
      );
    },
  );

  // --- POST /v1/policy-drafts/{id}/transaction ------------------------------------------------
  app.post<{ Params: { id: string }; Body: { expectedVersion: string } }>(
    '/v1/policy-drafts/:id/transaction',
    { schema: { params: ID_PARAM, body: POLICY_DRAFT_TRANSACTION_BODY } },
    async (request, reply) => {
      const auth = requireSession(request);
      const draft = await getPolicyDraftById(context.pool, request.params.id);
      if (!draft) throw new ApiError('RESOURCE_NOT_FOUND', 'policy draft not found');
      const vault = await requireVaultOwner(context, auth, draft.vaultId);

      // expectedVersion is required here too, so a compile cannot race an edit and archive bytes
      // for a configuration the owner never reviewed.
      const expectedVersion = parseUIntString(request.body.expectedVersion);
      if (draft.draftVersion !== expectedVersion) {
        throw new ApiError('DRAFT_VERSION_CONFLICT', 'draft version conflict; reload the draft');
      }

      const body = draft.body as { config: PolicyConfig; merchants: MerchantPermission[] };
      validatePolicyDraft(body.config, body.merchants);

      const prepared = prepareCreatePolicy(
        {
          chainId: vault.chainId.toString(10),
          ownerAddress: auth.walletAddress,
          vaultAddress: bufferToAddress(vault.address),
        },
        body.config,
        body.merchants,
      );

      const encoded = Buffer.from(prepared.transaction.data.slice(2), 'hex');
      const digest = Buffer.from(prepared.transaction.calldataHash.slice(2), 'hex');

      // The (draft_id, draft_version) primary key IS the compare-and-set: recompiling the same
      // version returns the ORIGINAL bytes rather than overwriting what the owner already saw.
      const archived = await withTransaction(context.pool, async (client) => {
        const revision = await archiveDraftRevision(client, {
          draftId: draft.id,
          draftVersion: draft.draftVersion,
          canonicalBody: body,
          encodedTransaction: encoded,
          transactionDigest: digest,
        });
        await markDraftCompiled(client, {
          id: draft.id,
          compiledBytes: revision.row.encodedTransaction,
          compiledHash: revision.row.transactionDigest,
        });
        return revision;
      });

      const archivedData = `0x${archived.row.encodedTransaction.toString('hex')}` as `0x${string}`;

      return reply.status(201).send(
        successEnvelope(
          {
            transaction: { ...prepared.transaction, data: archivedData },
            review: prepared.review,
            draftDigest: `0x${archived.row.transactionDigest.toString('hex')}`,
            draftVersion: archived.row.draftVersion.toString(10),
            // True on a recompile: the archived bytes are returned unchanged.
            previouslyCompiled: archived.kind === 'existing',
          },
          String(request.id),
        ),
      );
    },
  );

  // --- GET /v1/policies/{id} ------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/policies/:id',
    { schema: { params: ID_PARAM } },
    async (request, reply) => {
      const auth = requireSession(request);
      // SPEC-019: ARCH's table says owner-only, API_CONTRACT says owner-or-bound-agent. The API
      // contract specifies the boundary, so both are allowed; recorded rather than silently chosen.
      const { policy, vault } = await requirePolicyAccess(context, auth, request.params.id);
      const merchants = await getPolicyMerchants(context.pool, policy.id);

      // `canonical_config_bytes` is the authoritative configuration -- notably
      // allowedCategoryBitmap has no normalized column at all, so the projection is a convenience
      // read and the stored bytes are the evidence.
      const config = policy.configProjection as PolicyConfig;

      const reader = context.vaultReaderFor(bufferToAddress(vault.address));
      const onchainPolicyId = `0x${policy.onchainPolicyId.toString('hex')}` as Hash32;
      let counters = null;
      let status = policy.observedStatus;
      let observation = null;

      if (reader) {
        try {
          const state = await reader.getPolicyState(onchainPolicyId);
          counters = {
            outputSpent: state.outputSpent,
            epochOutputSpent: state.epochOutputSpent,
            inputSpent: state.inputSpent,
          };
          status = state.revoked ? 'REVOKED' : state.active ? 'ACTIVE' : 'SUPERSEDED';
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
          // Leave counters null and the observation absent: stale/offline is distinguishable from
          // current authority rather than being silently presented as current.
          counters = null;
        }
      }

      const body = {
        policyId: policy.id,
        onchainPolicyId,
        vault: bufferToAddress(vault.address),
        config,
        merchants: merchants.map((merchant) => ({
          merchantId: `0x${merchant.merchantId.toString('hex')}`,
          recipient: bufferToAddress(merchant.recipient),
          invoiceSigner: bufferToAddress(merchant.invoiceSigner),
          category: merchant.category.toString(10),
        })),
        status,
        counters,
        observation,
        configHash: computePolicyConfigHash(config),
      };
      return reply.status(200).send(successEnvelope(body, String(request.id)));
    },
  );

  // --- POST /v1/policies/{id}/revocation-transaction ------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/policies/:id/revocation-transaction',
    { schema: { params: ID_PARAM, body: EMPTY_BODY } },
    async (request, reply) => {
      const auth = requireSession(request);
      const { policy } = await requirePolicyAccess(context, auth, request.params.id);
      const vault = await requireVaultOwner(context, auth, policy.vaultId);

      const prepared = prepareRevokePolicy(
        {
          chainId: vault.chainId.toString(10),
          ownerAddress: auth.walletAddress,
          vaultAddress: bufferToAddress(vault.address),
        },
        `0x${policy.onchainPolicyId.toString('hex')}` as Hash32,
      );

      return reply.status(201).send(
        successEnvelope(
          {
            transaction: prepared.transaction,
            review: prepared.review,
            // Revocation takes effect only after this transaction executes on chain.
            effectiveAfterChainExecution: true,
          },
          String(request.id),
        ),
      );
    },
  );
}

export { keccak256 };
