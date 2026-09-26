/**
 * The read contract: payment views, timelines, and transaction lookups.
 *
 * Four axes (policyDecision/executionStatus/confidence/reconciliation) are returned SEPARATELY,
 * never collapsed into one status. `settlement` stays null until a verified canonical receipt/
 * event exists -- a queued or simulated payment must never look executed.
 *
 * Merchant access is per-payment (see authz.ts): being an invoiceSigner on some policy snapshot of
 * a vault grants nothing by itself. `GET /v1/payments`'s merchant variant is scoped through
 * `getPaymentsKeysetForInvoiceSigner`, never through the vault-wide primitive.
 */

import {
  getActivePoliciesForAgent,
  getPaymentById,
  getPaymentsKeysetForInvoiceSigner,
  getPaymentsKeysetForVaults,
  getPaymentTimelineKeyset,
  getTransactionAttemptByHash,
  getVaultsKeysetForOwner,
} from '@payguard/db';
import type { Hash32 } from '@payguard/domain';
import type { FastifyInstance } from 'fastify';
import { addressToBuffer, bufferToAddress, requireSession } from '../auth.js';
import { assertActiveDeployment, resolvePaymentRole } from '../authz.js';
import type { AppContext } from '../context.js';
import { ApiError, successEnvelope } from '../errors.js';
import { HASH_PARAM, ID_PARAM, KEYSET_QUERY, TRANSACTION_QUERY } from '../schemas.js';

interface KeysetQuery {
  cursor?: string;
  limit?: string;
  status?: string;
}

const MAX_PAGE_LIMIT = 100;

function parseCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id] = cursor.split('|');
  if (!iso || !id) return null;
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

async function loadPaymentDetail(
  context: AppContext,
  paymentId: string,
): Promise<Record<string, unknown> | null> {
  const payment = await getPaymentById(context.pool, paymentId);
  if (!payment) return null;

  const result = await context.pool.query(
    `SELECT
       inv.invoice_id, inv.recipient, inv.settlement_token, inv.output_amount,
       v.deployment_id, d.chain_id,
       pi.max_input_amount, pi.id AS active_intent_id,
       pol.input_token AS policy_input_token, pol.route_id AS policy_route_id,
       ta.tx_hash AS attempt_tx_hash,
       rep.tx_hash AS replacement_of,
       ce.decoded_payload AS executed_payload,
       cb.block_number AS observed_block_number,
       cb.canonical AS observed_block_canonical
     FROM payments p
     JOIN invoices inv ON inv.id = p.invoice_id
     JOIN vaults v ON v.id = p.vault_id
     JOIN deployments d ON d.id = v.deployment_id
     -- B1 (item 1, INT-007): the intent resolved here is NOT simply "whichever version is
     -- currently active." A payment that actually settled must keep showing the intent it
     -- ACTUALLY settled under, even after that intent is later retired by a re-versioning
     -- (SPEC-030/031) -- a historical receipt must never be reassembled from whatever policy/intent
     -- happens to be active now. Preference order: (1) the intent whose own attempt actually
     -- SUCCEEDED (the true historical record); (2) failing that, the currently active
     -- (non-retired) intent, for a payment that hasn't settled yet; (3) failing that, the most
     -- recent intent version at all, so an old retired-without-ever-settling payment still shows
     -- something rather than nothing.
     LEFT JOIN LATERAL (
       SELECT pi2.*
       FROM payment_intents pi2
       WHERE pi2.payment_id = p.id
       ORDER BY
         (EXISTS (
            SELECT 1 FROM nonce_families nf2
            JOIN transaction_attempts ta2
              ON ta2.nonce_family_id = nf2.id AND ta2.state = 'SUCCEEDED'
            WHERE nf2.intent_id = pi2.id
          )) DESC,
         (pi2.retired_at IS NULL) DESC,
         pi2.version DESC
       LIMIT 1
     ) pi ON true
     LEFT JOIN policies pol ON pol.id = pi.policy_id
     LEFT JOIN nonce_families nf ON nf.intent_id = pi.id
     LEFT JOIN transaction_attempts ta
       ON ta.nonce_family_id = nf.id
       -- SPEC-036: REVERTED must stay visible here too -- this is the read path a reviewer uses to
       -- find the transaction hash/evidence for exactly the case CLAUDE.md calls out (gas/nonce
       -- spent, invoice NOT consumed); hiding it made a real on-chain revert look like no attempt
       -- ever happened.
       AND ta.state IN ('SUBMITTED','UNKNOWN','INCLUDED','SUCCEEDED','REVERTED')
     -- B1 (item 2): nf.canonical_tx_hash and ta.replacement_of_id are NOT the same kind of
     -- value -- the latter is a UUID foreign key to another transaction_attempts row, not a tx
     -- hash. Resolve it to that row's real hash before it ever reaches a wire field.
     LEFT JOIN transaction_attempts rep ON rep.id = ta.replacement_of_id
     LEFT JOIN chain_events ce
       ON ce.deployment_id = v.deployment_id
       AND ce.tx_hash = ta.tx_hash
       AND ce.decoded_name = 'PaymentExecuted'
       AND ce.canonical = true
     -- B1 (item 1, INT-007): real block number + real current canonicality for the payment's
     -- observed block, instead of a hardcoded null/true.
     LEFT JOIN chain_blocks cb
       ON cb.deployment_id = v.deployment_id
       AND cb.block_hash = p.observed_block_hash
     WHERE p.id = $1
     ORDER BY ta.created_at DESC NULLS LAST
     LIMIT 1`,
    [paymentId],
  );
  const row = result.rows[0];
  const executedPayload = row?.executed_payload as
    | { actualInput?: string; exactOutput?: string; subsidyAmount?: string }
    | null
    | undefined;

  // Only a verified canonical SUCCEEDED payment gets real settlement numbers. Everything else is
  // null -- estimates live only in explicitly-named estimate fields elsewhere, never here.
  // SPEC-036: these are the ACTUAL decoded `PaymentExecuted` amounts, not the authorized ceiling --
  // `pi.max_input_amount` is what the intent PERMITTED, not what the vault actually pulled (CLAUDE.md:
  // "Observe actual vault input/output and merchant receipt").
  const settlement =
    payment.executionStatus === 'SUCCEEDED' && payment.confidence !== 'UNOBSERVED'
      ? {
          actualInputAtomic: executedPayload?.actualInput ?? null,
          outputDeliveredAtomic:
            executedPayload?.exactOutput ?? (row ? String(row.output_amount) : null),
          subsidyAmountAtomic: executedPayload?.subsidyAmount ?? '0',
        }
      : null;

  return {
    paymentId: payment.id,
    intentId: row?.active_intent_id ?? null,
    deploymentId: row?.deployment_id ?? null,
    chainId: row ? String(row.chain_id) : null,
    invoice: row
      ? {
          invoiceId: `0x${(row.invoice_id as Buffer).toString('hex')}`,
          recipient: bufferToAddress(row.recipient as Buffer),
          outputToken: bufferToAddress(row.settlement_token as Buffer),
          outputAmountAtomic: String(row.output_amount),
        }
      : null,
    authorized: row
      ? {
          inputToken: row.policy_input_token
            ? bufferToAddress(row.policy_input_token as Buffer)
            : null,
          maxInputAtomic: row.max_input_amount ? String(row.max_input_amount) : null,
          routeId: row.policy_route_id
            ? `0x${(row.policy_route_id as Buffer).toString('hex')}`
            : null,
        }
      : null,
    policyDecision: payment.policyDecision,
    executionStatus: payment.executionStatus,
    confidence: payment.confidence,
    reconciliation: payment.reconciliation,
    reasonCode: payment.reasonCode,
    settlement,
    transaction: row?.attempt_tx_hash
      ? {
          hash: `0x${(row.attempt_tx_hash as Buffer).toString('hex')}`,
          replacementOf: row.replacement_of
            ? `0x${(row.replacement_of as Buffer).toString('hex')}`
            : null,
        }
      : null,
    observedAt: payment.observedBlockHash
      ? {
          blockNumber:
            row?.observed_block_number != null ? String(row.observed_block_number) : null,
          blockHash: `0x${payment.observedBlockHash.toString('hex')}`,
          // B1 (item 1, INT-007): real current canonicality, not an assumed constant -- a reorg
          // flips `chain_blocks.canonical` to false for this exact block without erasing the
          // historical observation (see reorg regression tests).
          canonical: row?.observed_block_canonical === true,
          observedAt: payment.updatedAt.toISOString(),
        }
      : null,
    vaultId: payment.vaultId,
  };
}

export function registerPaymentReadRoutes(app: FastifyInstance, context: AppContext): void {
  // --- GET /v1/payments -------------------------------------------------------------------------
  app.get<{ Querystring: KeysetQuery }>(
    '/v1/payments',
    { schema: { querystring: KEYSET_QUERY } },
    async (request, reply) => {
      const auth = requireSession(request);
      const limit = Math.min(
        request.query.limit ? Number.parseInt(request.query.limit, 10) : 25,
        MAX_PAGE_LIMIT,
      );
      const cursor = parseCursor(request.query.cursor);

      // Owner-scoped vault set.
      const ownedVaults = await getVaultsKeysetForOwner(context.pool, {
        ownerWalletId: auth.walletId,
        limit: 1000,
      });
      // Agent-scoped vault set (through active policy bindings).
      const agentPolicies = await getActivePoliciesForAgent(context.pool, {
        agent: addressToBuffer(auth.walletAddress),
      });
      const vaultIds = Array.from(
        new Set([...ownedVaults.map((v) => v.id), ...agentPolicies.map((p) => p.vaultId)]),
      );

      // exactOptionalPropertyTypes: only include afterCreatedAt/afterId/status when actually
      // present, rather than passing an explicit `undefined` for an optional field.
      const cursorParams = cursor ? { afterCreatedAt: cursor.createdAt, afterId: cursor.id } : {};
      const statusParam = request.query.status ? { status: request.query.status } : {};

      let rows: Awaited<ReturnType<typeof getPaymentsKeysetForVaults>>;
      if (vaultIds.length > 0) {
        rows = await getPaymentsKeysetForVaults(context.pool, {
          vaultIds,
          ...cursorParams,
          ...statusParam,
          limit: limit + 1,
        });
      } else {
        // No owned/bound vaults: fall back to the merchant scope, never the vault-wide one.
        rows = await getPaymentsKeysetForInvoiceSigner(context.pool, {
          invoiceSigner: addressToBuffer(auth.walletAddress),
          ...cursorParams,
          ...statusParam,
          limit: limit + 1,
        });
      }

      const page = rows.slice(0, limit);
      const nextCursor =
        rows.length > limit && page.length > 0 ? encodeCursor(page[page.length - 1]!) : null;

      const items = page.map((row) => ({
        paymentId: row.id,
        vaultId: row.vaultId,
        executionStatus: row.executionStatus,
        createdAt: row.createdAt.toISOString(),
      }));

      return reply.status(200).send(successEnvelope({ items, nextCursor }, String(request.id)));
    },
  );

  // --- GET /v1/payments/{id} --------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/payments/:id',
    { schema: { params: ID_PARAM } },
    async (request, reply) => {
      const auth = requireSession(request);
      const payment = await getPaymentById(context.pool, request.params.id);
      if (!payment) throw new ApiError('RESOURCE_NOT_FOUND', 'payment not found');

      // resolvePaymentRole checks OWNER, AGENT, then the per-payment MERCHANT predicate. A known
      // UUID belonging to someone else's payment throws 403 here, never falls through to a read.
      await resolvePaymentRole(context, auth, { paymentId: payment.id, vaultId: payment.vaultId });

      const body = await loadPaymentDetail(context, payment.id);
      return reply.status(200).send(successEnvelope(body, String(request.id)));
    },
  );

  // --- GET /v1/payments/{id}/timeline -------------------------------------------------------------
  app.get<{ Params: { id: string }; Querystring: KeysetQuery }>(
    '/v1/payments/:id/timeline',
    { schema: { params: ID_PARAM, querystring: KEYSET_QUERY } },
    async (request, reply) => {
      const auth = requireSession(request);
      const payment = await getPaymentById(context.pool, request.params.id);
      if (!payment) throw new ApiError('RESOURCE_NOT_FOUND', 'payment not found');
      await resolvePaymentRole(context, auth, { paymentId: payment.id, vaultId: payment.vaultId });

      const limit = Math.min(
        request.query.limit ? Number.parseInt(request.query.limit, 10) : 25,
        MAX_PAGE_LIMIT,
      );
      const cursor = parseCursor(request.query.cursor);
      const rows = await getPaymentTimelineKeyset(context.pool, {
        paymentId: payment.id,
        ...(cursor ? { afterCreatedAt: cursor.createdAt, afterId: cursor.id } : {}),
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      const nextCursor =
        rows.length > limit && page.length > 0
          ? encodeCursor({
              createdAt: page[page.length - 1]!.createdAt,
              id: page[page.length - 1]!.id,
            })
          : null;

      const items = page.map((row) => ({
        eventId: row.id,
        type: row.eventType,
        createdAt: row.createdAt.toISOString(),
        body: row.body,
      }));
      return reply.status(200).send(successEnvelope({ items, nextCursor }, String(request.id)));
    },
  );

  // --- GET /v1/transactions/{hash} ----------------------------------------------------------------
  app.get<{ Params: { hash: string }; Querystring: { deploymentId: string } }>(
    '/v1/transactions/:hash',
    { schema: { params: HASH_PARAM, querystring: TRANSACTION_QUERY } },
    async (request, reply) => {
      const auth = requireSession(request);
      // SPEC-018: validated against the single active deployment, never used to select one.
      assertActiveDeployment(context, request.query.deploymentId);

      const txHashBuffer = Buffer.from(request.params.hash.slice(2), 'hex');
      const attempt = await getTransactionAttemptByHash(context.pool, {
        deploymentId: request.query.deploymentId,
        txHash: txHashBuffer,
      });
      if (!attempt) {
        throw new ApiError(
          'RESOURCE_NOT_FOUND',
          'no known transaction with this hash on this deployment',
        );
      }

      // Trace attempt -> nonce family -> intent -> payment, then re-check payment access. Every
      // nonce_families row is NOT NULL on intent_id (a Stage 4 transaction attempt exists only for
      // payment-intent submissions), so this join is expected to always resolve; if it somehow
      // doesn't, that is a data-integrity condition, not a public transaction -- refuse rather than
      // fall back to returning the base fields unauthenticated. This is a bare-id read (any known
      // txHash is effectively guessable, since it is public Ethereum data once broadcast), so the
      // WHOLE response -- not just the nested payment detail -- is gated on the caller actually
      // having a relationship to the underlying payment.
      const linked = await context.pool.query(
        // B1 (item 2, INT-008): pull the actual sender/nonce identity of this attempt's nonce
        // family, the real replacement-attempt hash (not the UUID FK), and this tx's canonical
        // receipt identity (block hash/number) if one currently exists, alongside the
        // attempt->intent->payment trace used for access control.
        `SELECT
           nf.intent_id, nf.sender, nf.nonce,
           pi.payment_id, p.vault_id,
           rep.tx_hash AS replacement_of_tx_hash,
           r.block_hash AS receipt_block_hash, r.canonical AS receipt_canonical,
           cb.block_number AS receipt_block_number
         FROM nonce_families nf
         JOIN payment_intents pi ON pi.id = nf.intent_id
         JOIN payments p ON p.id = pi.payment_id
         LEFT JOIN transaction_attempts rep ON rep.id = $2
         LEFT JOIN receipts r
           ON r.deployment_id = nf.deployment_id AND r.tx_hash = $3 AND r.canonical = true
         LEFT JOIN chain_blocks cb
           ON cb.deployment_id = r.deployment_id AND cb.block_hash = r.block_hash
         WHERE nf.id = $1`,
        [attempt.nonceFamilyId, attempt.replacementOfId, attempt.txHash],
      );
      const linkRow = linked.rows[0];
      if (!linkRow) {
        throw new ApiError(
          'RESOURCE_NOT_FOUND',
          'this transaction attempt is not linked to a readable payment',
        );
      }

      await resolvePaymentRole(context, auth, {
        paymentId: linkRow.payment_id as string,
        vaultId: linkRow.vault_id as string,
      });
      const authorizedPayment = await loadPaymentDetail(context, linkRow.payment_id as string);
      const confidence =
        authorizedPayment &&
        typeof authorizedPayment === 'object' &&
        'confidence' in authorizedPayment
          ? ((authorizedPayment as Record<string, unknown>).confidence as string | null)
          : null;

      const body = {
        hash: `0x${attempt.txHash.toString('hex')}` as Hash32,
        from: bufferToAddress(linkRow.sender as Buffer),
        nonce: String(linkRow.nonce),
        state: attempt.state,
        // B1 fix (INT-008): the wire value is the REPLACED attempt's tx hash, never the UUID row
        // it points to.
        replacementOf: linkRow.replacement_of_tx_hash
          ? `0x${(linkRow.replacement_of_tx_hash as Buffer).toString('hex')}`
          : null,
        canonicalReceiptIdentity: linkRow.receipt_block_hash
          ? {
              blockHash: `0x${(linkRow.receipt_block_hash as Buffer).toString('hex')}`,
              blockNumber:
                linkRow.receipt_block_number != null ? String(linkRow.receipt_block_number) : null,
              canonical: linkRow.receipt_canonical === true,
            }
          : null,
        // Reuse the same confidence axis already computed for the linked payment -- there is one
        // confidence value per observation, not a separately-invented one for the tx view.
        confidence,
        authorizedPayment,
      };
      return reply.status(200).send(successEnvelope(body, String(request.id)));
    },
  );
}
