/**
 * Payment commands: intent creation, simulation, owner approval, and durable submission.
 *
 * Three invariants shape this module:
 *
 * 1. **The backend signs nothing.** The agent signs the intent, the merchant signed the invoice,
 *    the owner signs the exception. The API only verifies and stores.
 * 2. **UNKNOWN is not BLOCK.** A provider failure produces an UNKNOWN decision, never a fabricated
 *    denial -- and never a fabricated executable quote either.
 * 3. **Submit queues; it does not complete.** Signing and broadcast belong to the Stage 5 worker.
 *    Nothing here reports a payment as executed.
 *
 * SPEC-017: `{id}` on these sub-routes is the INTENT resource UUID, and it must be the currently
 * active version (`retired_at IS NULL`); a retired intent is 409.
 */
import { randomUUID } from 'node:crypto';
import {
  createApproval,
  createIntentVersion,
  createOperation,
  createPaymentForInvoice,
  createSignedArtifact,
  enqueue,
  findOpenOperationForResource,
  getActiveIntent,
  getPaymentById,
  getPolicyMerchants,
  isExecutionStatusTransitionAllowed,
  updatePaymentState,
  withTransaction,
} from '@payguard/db';
import {
  approvalNonceFromIntentHash,
  domainFor,
  EIP712_TYPES,
  type ExceptionApproval,
  type Hash32,
  hashApproval,
  hashIntent,
  type Invoice,
  type PaymentIntent,
  type PolicyConfig,
  parseUIntOfWidth,
  parseUIntString,
} from '@payguard/domain';
import type { FastifyInstance } from 'fastify';
import { keccak256 } from 'viem';
import {
  addressToBuffer,
  bufferToAddress,
  requireIdempotencyKey,
  requireSession,
} from '../auth.js';
import { boundAgentPolicies } from '../authz.js';
import type { AppContext } from '../context.js';
import { ApiError, successEnvelope } from '../errors.js';
import { APPROVAL_BODY, EMPTY_BODY, ID_PARAM, PAYMENT_INTENT_BODY } from '../schemas.js';
import { verifyEoaTypedSignature, verifyOwnerApprovalSignature } from '../signatures.js';

interface IntentBody {
  invoiceResourceId: string;
  policyResourceId: string;
  intent: PaymentIntent;
  agentSignature: `0x${string}`;
}

interface LoadedIntent {
  intentId: string;
  paymentId: string;
  vaultId: string;
  vaultAddress: `0x${string}`;
  chainId: bigint;
  ownerWalletId: string;
  policyResourceId: string;
  onchainPolicyId: Hash32;
  policyConfig: PolicyConfig;
  intent: PaymentIntent;
  invoice: Invoice;
  intentDigest: Hash32;
  agentSignature: `0x${string}`;
  merchantSignature: `0x${string}`;
  retired: boolean;
}

/**
 * Loads an intent together with everything needed to re-evaluate it, reconstructing the signed
 * business objects from their stored artifact payloads (the normalized columns are the constraint
 * surface; the signed bytes are the evidence).
 */
async function loadIntent(context: AppContext, intentId: string): Promise<LoadedIntent | null> {
  const result = await context.pool.query(
    `SELECT
       pi.id AS intent_id, pi.payment_id, pi.vault_id, pi.policy_id, pi.intent_digest, pi.retired_at,
       ia.encoded_payload AS intent_payload, ia.signature AS intent_signature,
       v.address AS vault_address, v.owner_wallet_id,
       d.chain_id,
       p.onchain_policy_id, p.config_projection,
       inv.id AS invoice_resource_id,
       va.encoded_payload AS invoice_payload, va.signature AS invoice_signature
     FROM payment_intents pi
     JOIN signed_artifacts ia ON ia.id = pi.artifact_id
     JOIN vaults v ON v.id = pi.vault_id
     JOIN deployments d ON d.id = v.deployment_id
     JOIN policies p ON p.id = pi.policy_id
     JOIN payments pay ON pay.id = pi.payment_id
     JOIN invoices inv ON inv.id = pay.invoice_id
     JOIN signed_artifacts va ON va.id = inv.artifact_id
     WHERE pi.id = $1`,
    [intentId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    intentId: row.intent_id as string,
    paymentId: row.payment_id as string,
    vaultId: row.vault_id as string,
    vaultAddress: bufferToAddress(row.vault_address as Buffer),
    chainId: BigInt(row.chain_id as string),
    ownerWalletId: row.owner_wallet_id as string,
    policyResourceId: row.policy_id as string,
    onchainPolicyId: `0x${(row.onchain_policy_id as Buffer).toString('hex')}` as Hash32,
    policyConfig: row.config_projection as PolicyConfig,
    intent: JSON.parse((row.intent_payload as Buffer).toString('utf8')) as PaymentIntent,
    invoice: JSON.parse((row.invoice_payload as Buffer).toString('utf8')) as Invoice,
    intentDigest: `0x${(row.intent_digest as Buffer).toString('hex')}` as Hash32,
    agentSignature: `0x${(row.intent_signature as Buffer).toString('hex')}` as `0x${string}`,
    merchantSignature: `0x${(row.invoice_signature as Buffer).toString('hex')}` as `0x${string}`,
    retired: row.retired_at !== null,
  };
}

/** Owner or bound agent of the intent's vault; merchants have no access to payment commands. */
async function requireIntentAccess(
  context: AppContext,
  request: Parameters<typeof requireSession>[0],
  intentId: string,
): Promise<{ loaded: LoadedIntent; isOwner: boolean }> {
  const auth = requireSession(request);
  const loaded = await loadIntent(context, intentId);
  if (!loaded) throw new ApiError('RESOURCE_NOT_FOUND', 'payment intent not found');
  if (auth.chainId !== loaded.chainId) {
    throw new ApiError('DEPLOYMENT_MISMATCH', 'session chain does not match this resource');
  }
  if (loaded.retired) {
    // SPEC-017: sub-routes operate on the currently active intent version only.
    throw new ApiError('INTENT_RETIRED', 'this intent version has been retired by a newer version');
  }

  const isOwner = loaded.ownerWalletId === auth.walletId;
  if (!isOwner) {
    const agentPolicies = await boundAgentPolicies(context, auth, loaded.vaultId);
    if (agentPolicies.length === 0) {
      throw new ApiError('RESOURCE_FORBIDDEN', 'not an owner or bound agent of this vault');
    }
  }
  return { loaded, isOwner };
}

export function registerPaymentIntentRoutes(app: FastifyInstance, context: AppContext): void {
  // --- POST /v1/payment-intents ---------------------------------------------------------------
  app.post<{ Body: IntentBody }>(
    '/v1/payment-intents',
    { schema: { body: PAYMENT_INTENT_BODY } },
    async (request, reply) => {
      const auth = requireSession(request);
      requireIdempotencyKey(request);
      const { invoiceResourceId, policyResourceId, intent, agentSignature } = request.body;

      parseUIntOfWidth(intent.validUntil, 48);
      if (parseUIntString(intent.maxInputAmount) === 0n) {
        throw new ApiError('INVALID_SCHEMA', 'maxInputAmount must be greater than zero');
      }

      // One read pass to prove every referenced resource shares the same vault and deployment.
      const joined = await context.pool.query(
        `SELECT
           inv.id AS invoice_id, inv.vault_id AS invoice_vault, inv.invoice_digest,
           va.encoded_payload AS invoice_payload, va.signature AS invoice_signature,
           p.id AS policy_id, p.vault_id AS policy_vault, p.onchain_policy_id, p.agent,
           p.config_projection, p.observed_status,
           v.address AS vault_address, v.owner_wallet_id, v.deployment_id,
           d.chain_id
         FROM invoices inv
         JOIN signed_artifacts va ON va.id = inv.artifact_id
         JOIN policies p ON p.id = $2
         JOIN vaults v ON v.id = inv.vault_id
         JOIN deployments d ON d.id = v.deployment_id
         WHERE inv.id = $1`,
        [invoiceResourceId, policyResourceId],
      );
      const row = joined.rows[0];
      if (!row) throw new ApiError('RESOURCE_NOT_FOUND', 'invoice or policy not found');

      if (row.invoice_vault !== row.policy_vault) {
        throw new ApiError('RESOURCE_FORBIDDEN', 'invoice and policy belong to different vaults');
      }
      const vaultId = row.invoice_vault as string;
      const chainId = BigInt(row.chain_id as string);
      if (auth.chainId !== chainId) {
        throw new ApiError('DEPLOYMENT_MISMATCH', 'session chain does not match this vault');
      }

      const policyAgent = bufferToAddress(row.agent as Buffer);
      // The bound agent signs the intent. Authority comes from the policy, not from the session:
      // a session merely proves who is calling.
      if (policyAgent.toLowerCase() !== auth.walletAddress.toLowerCase()) {
        throw new ApiError(
          'RESOURCE_FORBIDDEN',
          'only the policy-bound agent may create this intent',
        );
      }
      if (row.observed_status !== 'ACTIVE') {
        throw new ApiError('POLICY_VALIDATION_FAILED', 'policy is not active');
      }

      const onchainPolicyId = `0x${(row.onchain_policy_id as Buffer).toString('hex')}` as Hash32;
      if (intent.policyId.toLowerCase() !== onchainPolicyId.toLowerCase()) {
        throw new ApiError(
          'POLICY_VALIDATION_FAILED',
          'intent.policyId is not this policy on-chain identity',
        );
      }

      const invoiceDigest = `0x${(row.invoice_digest as Buffer).toString('hex')}` as Hash32;
      if (intent.invoiceHash.toLowerCase() !== invoiceDigest.toLowerCase()) {
        throw new ApiError(
          'POLICY_VALIDATION_FAILED',
          'intent.invoiceHash does not match the stored invoice digest',
        );
      }

      const vaultAddress = bufferToAddress(row.vault_address as Buffer);
      const eip712Domain = { chainId: Number(chainId), verifyingContract: vaultAddress };
      const intentDigest = hashIntent(eip712Domain, intent);

      // Agent signature: ECDSA only, matching the vault's own check.
      const verdict = await verifyEoaTypedSignature({
        digest: intentDigest,
        signature: agentSignature,
        expectedSigner: policyAgent,
      });
      if (verdict.kind !== 'VALID') {
        throw new ApiError('INVALID_SIGNATURE', 'intent signature is not from the policy agent', {
          detail: verdict.kind === 'INVALID' ? verdict.detail : 'unknown',
        });
      }

      const invoice = JSON.parse((row.invoice_payload as Buffer).toString('utf8')) as Invoice;
      const merchantSignature = `0x${(row.invoice_signature as Buffer).toString(
        'hex',
      )}` as `0x${string}`;

      // The shared on-chain evaluate, run BEFORE opening the write transaction -- a SQL
      // transaction must never be held open across an RPC call.
      const reader = context.vaultReaderFor(vaultAddress);
      const evaluation = reader
        ? await reader.evaluate(invoice, intent, { agentSignature, merchantSignature })
        : {
            decision: 'UNKNOWN' as const,
            reasonCode: 'CHAIN_STATE_UNKNOWN',
            signaturesChecked: false,
            remainingOutputAtomic: null,
            remainingEpochOutputAtomic: null,
            remainingInputAtomic: null,
            simulatedAt: null,
          };

      const typedData = {
        domain: domainFor(eip712Domain),
        types: { PaymentIntent: EIP712_TYPES.PaymentIntent },
        primaryType: 'PaymentIntent',
        message: intent,
      };

      const created = await withTransaction(context.pool, async (client) => {
        const artifact = await createSignedArtifact(client, {
          id: randomUUID(),
          kind: 'INTENT',
          digest: Buffer.from(intentDigest.slice(2), 'hex'),
          signer: addressToBuffer(policyAgent),
          encodedPayload: Buffer.from(JSON.stringify(intent), 'utf8'),
          typedData,
          signature: Buffer.from(agentSignature.slice(2), 'hex'),
          signatureHash: Buffer.from(keccak256(agentSignature).slice(2), 'hex'),
          schemaVersion: '1',
        });

        // One invoice maps to one logical payment; DB uniqueness decides the race.
        const payment = await createPaymentForInvoice(client, {
          id: randomUUID(),
          vaultId,
          invoiceId: invoiceResourceId,
          policyDecision: evaluation.decision,
        });

        // `intent_digest` is UNIQUE across the whole table, so blindly versioning here would
        // raise a raw constraint violation on a byte-identical resubmit (e.g. an agent retrying
        // after a network blip) instead of the idempotent response the invoice-identity path
        // already gives. If the payment's currently active version already IS this exact signed
        // intent, return it rather than creating a new version.
        const active = await getActiveIntent(client, payment.row.id);
        const digestBuffer = Buffer.from(intentDigest.slice(2), 'hex');
        if (active && active.intentDigest.equals(digestBuffer)) {
          return { payment, intentRow: active };
        }

        const version = await client.query<{ next: string }>(
          'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM payment_intents WHERE payment_id = $1',
          [payment.row.id],
        );

        const intentRow = await createIntentVersion(client, {
          id: randomUUID(),
          paymentId: payment.row.id,
          vaultId,
          policyId: policyResourceId,
          version: BigInt(version.rows[0]?.next ?? '1'),
          intentDigest: digestBuffer,
          artifactId: artifact.id,
          agentNonce: parseUIntString(intent.nonce),
          maxInputAmount: parseUIntString(intent.maxInputAmount),
          validUntil: parseUIntString(intent.validUntil),
        });

        // SPEC-030: `payments.execution_status` was never driven past its initial DRAFT anywhere
        // in Stage 4 -- the Stage 5 worker needs it at READY (or AWAITING_APPROVAL, for ESCALATE)
        // before it can legally progress the state graph toward QUEUED/SIGNED/SUBMITTED. Only
        // attempted from a state where re-entering READY/AWAITING_APPROVAL is graph-legal; a
        // payment already mid-flight from an earlier intent version (QUEUED/SIGNED/SUBMITTED/...)
        // is deliberately left untouched here (CLAUDE.md: a fresh version must not retire
        // unresolved signed/broadcast authority just because the client requested a re-evaluation).
        const nextExecutionStatus: 'READY' | 'AWAITING_APPROVAL' | undefined =
          evaluation.decision === 'ALLOW'
            ? 'READY'
            : evaluation.decision === 'ESCALATE'
              ? 'AWAITING_APPROVAL'
              : undefined;
        if (
          nextExecutionStatus &&
          isExecutionStatusTransitionAllowed(payment.row.executionStatus, nextExecutionStatus)
        ) {
          // `createPaymentForInvoice` already set policyDecision to this exact value at INSERT
          // time for a brand-new payment -- only include it here (an existing payment being
          // re-evaluated on a new intent version) when it actually changed, since a same-to-same
          // policyDecision transition is illegal by design (state_transitions.ts: "a transition to
          // the same state is a no-op, not a transition").
          await updatePaymentState(client, {
            paymentId: payment.row.id,
            expectedVersion: payment.row.stateVersion,
            current: {
              policyDecision: payment.row.policyDecision,
              executionStatus: payment.row.executionStatus,
              confidence: payment.row.confidence,
              reconciliation: payment.row.reconciliation,
            },
            next: {
              executionStatus: nextExecutionStatus,
              ...(payment.row.policyDecision !== evaluation.decision
                ? { policyDecision: evaluation.decision }
                : {}),
            },
          });
        }

        return { payment, intentRow };
      });

      const body = {
        paymentId: created.payment.row.id,
        intentId: created.intentRow.id,
        intentVersion: created.intentRow.version.toString(10),
        evaluation,
      };
      return reply
        .status(created.payment.kind === 'created' ? 201 : 200)
        .send(successEnvelope(body, String(request.id)));
    },
  );

  // --- POST /v1/payment-intents/{id}/simulate --------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/payment-intents/:id/simulate',
    { schema: { params: ID_PARAM, body: EMPTY_BODY } },
    async (request, reply) => {
      const { loaded } = await requireIntentAccess(context, request, request.params.id);
      const reader = context.vaultReaderFor(loaded.vaultAddress);

      if (!reader) {
        throw new ApiError('CHAIN_STATE_UNKNOWN', 'chain client unavailable for simulation');
      }

      const stored = await context.pool.query(
        `SELECT aa.encoded_payload, aa.signature
         FROM approvals a JOIN signed_artifacts aa ON aa.id = a.artifact_id
         WHERE a.intent_id = $1 AND a.observed_cancelled = false
         ORDER BY aa.created_at DESC LIMIT 1`,
        [loaded.intentId],
      );
      const approvalRow = stored.rows[0];
      const approval = approvalRow
        ? (JSON.parse(
            (approvalRow.encoded_payload as Buffer).toString('utf8'),
          ) as ExceptionApproval)
        : undefined;

      // Built as two disjoint shapes (rather than spreading a possibly-undefined ownerSignature
      // in) so the approval-present case never carries an `ownerSignature: undefined` value into a
      // field the SignatureSet type declares as present-or-absent, never present-and-undefined.
      const signatures = approvalRow
        ? {
            agentSignature: loaded.agentSignature,
            merchantSignature: loaded.merchantSignature,
            approval: approval as ExceptionApproval,
            ownerSignature:
              `0x${(approvalRow.signature as Buffer).toString('hex')}` as `0x${string}`,
          }
        : {
            agentSignature: loaded.agentSignature,
            merchantSignature: loaded.merchantSignature,
          };

      const evaluation = await reader.evaluate(loaded.invoice, loaded.intent, signatures);

      // Full execution simulation uses the ACTUAL vault call from the intended relayer account --
      // never a standalone protocol quote standing in for the whole payment.
      const relayer = context.config.relayerAddress;
      let executionSimulation = {
        available: false,
        actualInputEstimateAtomic: null as string | null,
        gasEstimate: null as string | null,
        calldataHash: null as string | null,
        simulatedAt: null as unknown,
        unavailableReason: 'NO_RELAYER_CONFIGURED' as string | null,
      };

      if (evaluation.decision === 'ESCALATE' && !approval) {
        // Missing required owner approval: report unavailable rather than fabricate a quote.
        executionSimulation.unavailableReason = 'APPROVAL_REQUIRED';
      } else if (relayer) {
        const simulated = await reader.simulateExecutePayment({
          relayer: relayer as `0x${string}`,
          invoice: loaded.invoice,
          intent: loaded.intent,
          signatures,
        });
        executionSimulation = {
          available: simulated.available,
          actualInputEstimateAtomic: simulated.actualInputEstimateAtomic,
          gasEstimate: simulated.gasEstimate,
          calldataHash: simulated.calldataHash,
          simulatedAt: simulated.simulatedAt,
          unavailableReason: simulated.available
            ? null
            : simulated.infrastructureUnavailable
              ? 'CHAIN_STATE_UNKNOWN'
              : (simulated.rejectedReason ?? 'REJECTED'),
        };
      }

      return reply
        .status(200)
        .send(successEnvelope({ evaluation, executionSimulation }, String(request.id)));
    },
  );

  // --- GET /v1/payment-intents/{id}/approval-typed-data ---------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/payment-intents/:id/approval-typed-data',
    { schema: { params: ID_PARAM } },
    async (request, reply) => {
      const { loaded, isOwner } = await requireIntentAccess(context, request, request.params.id);
      if (!isOwner) {
        throw new ApiError(
          'RESOURCE_FORBIDDEN',
          'only the vault owner may sign an exception approval',
        );
      }

      // Deterministic derivation means this GET reserves nothing: nonce = uint256(intentHash) and
      // validUntil = the intent's own expiry. It is a pure read, not a hidden allocation.
      const nonce = approvalNonceFromIntentHash(loaded.intentDigest);
      const approval: ExceptionApproval = {
        intentHash: loaded.intentDigest,
        nonce,
        validUntil: loaded.intent.validUntil,
      };

      const reader = context.vaultReaderFor(loaded.vaultAddress);
      let nonceUsedOrCancelled: boolean | null = null;
      if (reader) {
        try {
          nonceUsedOrCancelled = await reader.isApprovalNonceUsedOrCancelled(
            parseUIntString(nonce),
          );
        } catch {
          nonceUsedOrCancelled = null; // unknown, not "available"
        }
      }

      const eip712Domain = {
        chainId: Number(loaded.chainId),
        verifyingContract: loaded.vaultAddress,
      };
      const digest = hashApproval(eip712Domain, approval);

      const ownerAddress = reader ? await reader.owner().catch(() => null) : null;
      const merchants = await getPolicyMerchants(context.pool, loaded.policyResourceId);
      const merchant = merchants.find(
        (m) =>
          `0x${m.merchantId.toString('hex')}`.toLowerCase() ===
          loaded.invoice.merchantId.toLowerCase(),
      );

      const body = {
        typedData: {
          domain: domainFor(eip712Domain),
          types: { ExceptionApproval: EIP712_TYPES.ExceptionApproval },
          primaryType: 'ExceptionApproval',
          message: approval,
        },
        expectedSigner: ownerAddress,
        computedDigest: digest,
        nonceUsedOrCancelled,
        review: {
          merchant: merchant ? bufferToAddress(merchant.recipient) : loaded.invoice.recipient,
          outputToken: loaded.invoice.settlementToken,
          exactOutputAtomic: loaded.invoice.outputAmount,
          inputToken: loaded.policyConfig.inputToken,
          maxInputAtomic: loaded.intent.maxInputAmount,
          routeId: loaded.intent.routeId,
          // The only thing an exact owner exception can bypass.
          override: 'AUTOMATIC_OUTPUT_CAP_ONLY' as const,
          validUntil: approval.validUntil,
        },
      };
      return reply.status(200).send(successEnvelope(body, String(request.id)));
    },
  );

  // --- POST /v1/payment-intents/{id}/approvals -------------------------------------------------
  app.post<{
    Params: { id: string };
    Body: { approval: ExceptionApproval; ownerSignature: `0x${string}` };
  }>(
    '/v1/payment-intents/:id/approvals',
    { schema: { params: ID_PARAM, body: APPROVAL_BODY } },
    async (request, reply) => {
      const { loaded, isOwner } = await requireIntentAccess(context, request, request.params.id);
      if (!isOwner) {
        throw new ApiError(
          'RESOURCE_FORBIDDEN',
          'only the vault owner may submit an exception approval',
        );
      }
      const { approval, ownerSignature } = request.body;

      parseUIntOfWidth(approval.validUntil, 48);
      if (approval.intentHash.toLowerCase() !== loaded.intentDigest.toLowerCase()) {
        throw new ApiError('INVALID_APPROVAL', 'approval does not name this intent digest');
      }
      const expectedNonce = approvalNonceFromIntentHash(loaded.intentDigest);
      if (approval.nonce !== expectedNonce) {
        throw new ApiError(
          'INVALID_APPROVAL',
          'approval nonce is not the deterministic value for this intent',
        );
      }

      const reader = context.vaultReaderFor(loaded.vaultAddress);
      if (!reader) {
        throw new ApiError(
          'CHAIN_STATE_UNKNOWN',
          'chain client unavailable to resolve the vault owner',
        );
      }
      // The expected signer is the vault's LIVE on-chain owner, not the database projection.
      const ownerAddress = await reader.owner();

      const eip712Domain = {
        chainId: Number(loaded.chainId),
        verifyingContract: loaded.vaultAddress,
      };
      const digest = hashApproval(eip712Domain, approval);

      // ERC-1271-capable, matching the vault's SignatureChecker path for owner approvals.
      const verdict = await verifyOwnerApprovalSignature({
        digest,
        signature: ownerSignature,
        ownerAddress,
        publicClient: context.publicClient,
      });
      if (verdict.kind === 'UNKNOWN') {
        throw new ApiError('CHAIN_STATE_UNKNOWN', 'could not complete the owner signature check', {
          detail: verdict.detail,
        });
      }
      if (verdict.kind === 'INVALID') {
        throw new ApiError('INVALID_APPROVAL', 'approval signature is not from the vault owner');
      }

      const approvalId = await withTransaction(context.pool, async (client) => {
        const artifact = await createSignedArtifact(client, {
          id: randomUUID(),
          kind: 'APPROVAL',
          digest: Buffer.from(digest.slice(2), 'hex'),
          signer: addressToBuffer(ownerAddress),
          encodedPayload: Buffer.from(JSON.stringify(approval), 'utf8'),
          typedData: {
            domain: domainFor(eip712Domain),
            types: { ExceptionApproval: EIP712_TYPES.ExceptionApproval },
            primaryType: 'ExceptionApproval',
            message: approval,
          },
          signature: Buffer.from(ownerSignature.slice(2), 'hex'),
          signatureHash: Buffer.from(keccak256(ownerSignature).slice(2), 'hex'),
          schemaVersion: '1',
        });
        // createApproval is idempotent on (intentId, approvalDigest): a concurrent/retried
        // identical submission returns the ORIGINAL row, whose id may differ from this fresh one.
        const row = await createApproval(client, {
          id: randomUUID(),
          intentId: loaded.intentId,
          vaultId: loaded.vaultId,
          approvalDigest: Buffer.from(digest.slice(2), 'hex'),
          approvalNonce: parseUIntString(approval.nonce),
          artifactId: artifact.id,
          validUntil: parseUIntString(approval.validUntil),
        });
        return row.id;
      });

      const body = {
        approvalId,
        signatureValidAt: null,
        // SIGNED means a stored signature, NOT an on-chain approval transaction. executePayment
        // revalidates it and consumes the nonce atomically with settlement.
        status: 'SIGNED' as const,
        onChainApprovalTransactionExists: false,
        revalidatedAtExecution: true,
      };
      return reply.status(201).send(successEnvelope(body, String(request.id)));
    },
  );

  // --- POST /v1/payment-intents/{id}/submit ----------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/payment-intents/:id/submit',
    { schema: { params: ID_PARAM, body: EMPTY_BODY } },
    async (request, reply) => {
      const auth = requireSession(request);
      requireIdempotencyKey(request);
      const { loaded } = await requireIntentAccess(context, request, request.params.id);

      // SPEC-020: submission is idempotent on INTENT IDENTITY, not on the principal. Owner-submit
      // and agent-submit of the same intent must return the SAME operation, so an existing open
      // operation short-circuits regardless of who created it.
      const existing = await findOpenOperationForResource(context.pool, {
        resourceKind: 'payment_intent',
        resourceId: loaded.intentId,
      });
      if (existing) {
        return reply.status(202).send(
          successEnvelope(
            {
              operationId: existing.id,
              resourceType: 'payment_intent',
              resourceId: loaded.intentId,
              status: existing.status,
              paymentId: loaded.paymentId,
              intentId: loaded.intentId,
              deduplicated: true,
            },
            String(request.id),
          ),
        );
      }

      const immutableRequest = Buffer.from(
        JSON.stringify({ intentId: loaded.intentId, intentDigest: loaded.intentDigest }),
        'utf8',
      );
      const requestDigest = Buffer.from(
        keccak256(`0x${immutableRequest.toString('hex')}`).slice(2),
        'hex',
      );

      const operationId = randomUUID();
      // Durable operation + outbox work commit together in ONE transaction. Nothing is signed or
      // broadcast here; the Stage 5 worker does that from the stored signed intent.
      await withTransaction(context.pool, async (client) => {
        // SPEC-030: submit is the READY|AWAITING_APPROVAL -> QUEUED moment. A payment not in
        // either state (already mid-flight from a prior submit, or never reached READY) is left
        // untouched -- the queued-only response below is unaffected either way.
        //
        // SPEC-031: a CANCELLED payment (the worker's normal outcome for a rejected attempt --
        // BLOCK, a still-missing ESCALATE approval, a reverted/dropped transaction) is exactly the
        // "fresh attempt" case the state graph's own CANCELLED -> READY edge exists for (see
        // stateTransitions.ts's comment on EXECUTION_STATUS_GRAPH), and the SPEC-028 comment above
        // this route already documents resubmitting the SAME intent once its prior operation went
        // terminal as the intended flow. Nothing previously drove CANCELLED back to READY, so that
        // legitimate resubmission silently stuck at CANCELLED and the worker's next QUEUED->SIGNED
        // transition would have thrown. Hop CANCELLED -> READY -> QUEUED in the same transaction.
        const payment = await getPaymentById(client, loaded.paymentId);
        if (payment) {
          let current = payment;
          // SPEC-034: a reorg-regressed UNKNOWN payment (reasonCode ORPHANED_BLOCK) gets the exact
          // same "fresh attempt is legitimate" treatment CANCELLED already gets -- but ONLY when
          // reconciliation isn't the sticky MISMATCH value (ARCH 3.4: "a mismatch ... never
          // triggers an automatic second payment"). A MISMATCH-flagged UNKNOWN payment is left
          // untouched here, same as today, pending explicit owner investigation.
          const readyEligible =
            current.executionStatus === 'CANCELLED' ||
            (current.executionStatus === 'UNKNOWN' && current.reconciliation !== 'MISMATCH');
          if (readyEligible) {
            const result = await updatePaymentState(client, {
              paymentId: current.id,
              expectedVersion: current.stateVersion,
              current: {
                policyDecision: current.policyDecision,
                executionStatus: current.executionStatus,
                confidence: current.confidence,
                reconciliation: current.reconciliation,
              },
              next: { executionStatus: 'READY' },
            });
            if (result.row) current = result.row;
          }
          if (isExecutionStatusTransitionAllowed(current.executionStatus, 'QUEUED')) {
            await updatePaymentState(client, {
              paymentId: current.id,
              expectedVersion: current.stateVersion,
              current: {
                policyDecision: current.policyDecision,
                executionStatus: current.executionStatus,
                confidence: current.confidence,
                reconciliation: current.reconciliation,
              },
              next: { executionStatus: 'QUEUED' },
            });
          }
        }
        await createOperation(client, {
          id: operationId,
          principalWalletId: auth.walletId,
          deploymentId: (
            await client.query('SELECT deployment_id FROM vaults WHERE id = $1', [loaded.vaultId])
          ).rows[0].deployment_id as string,
          operationKind: 'SUBMIT_PAYMENT',
          resourceKind: 'payment_intent',
          resourceId: loaded.intentId,
          immutableRequest,
          requestDigest,
        });
        await enqueue(client, {
          id: randomUUID(),
          // SPEC-028: keyed by OPERATION, not bare intent. `findOpenOperationForResource` above
          // is what makes replaying the SAME still-open command idempotent (it short-circuits
          // before this call is ever reached again); this key only needs to stop a concurrent
          // double-enqueue for the operation just created a few lines up. An intent-only key
          // would additionally collide with a LATER, legitimate resubmission of the same intent
          // once the first operation has reached a terminal status (e.g. FAILED after an
          // ESCALATE decision with no approval yet) -- `ON CONFLICT (event_key) DO NOTHING` would
          // silently swallow that second, real submit command instead of queuing it.
          eventKey: `submit:${loaded.intentId}:${operationId}`,
          aggregateKind: 'payment_intent',
          aggregateId: loaded.intentId,
          eventType: 'PAYMENT_SUBMISSION_REQUESTED',
          payload: { intentId: loaded.intentId, paymentId: loaded.paymentId, operationId },
        });
      });

      const body = {
        operationId,
        resourceType: 'payment_intent',
        resourceId: loaded.intentId,
        status: 'QUEUED' as const,
        paymentId: loaded.paymentId,
        intentId: loaded.intentId,
        note: 'Queued only. Signing and broadcast are performed by the Stage 5 worker from the stored signed intent; no payment has been executed.',
      };
      return reply.status(202).send(successEnvelope(body, String(request.id)));
    },
  );
}
