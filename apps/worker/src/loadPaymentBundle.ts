/**
 * Loads everything the worker needs to (re-)execute a queued payment intent, reconstructing the
 * signed business objects from their stored artifact payloads -- the same pattern
 * `apps/api/src/routes/paymentIntents.ts`'s `loadIntent` uses for `/simulate`, extended with the
 * policy's OBSERVED status and the owning deployment id (item 2: "Recheck deployment, policy
 * binding, current consumption/cancellation state").
 */

import type { ObservedPolicyStatus, Queryable } from '@payguard/db';
import type {
  Address,
  ExceptionApproval,
  Hash32,
  HexBytes,
  Invoice,
  PaymentIntent,
} from '@payguard/domain';
import { bufferToAddress, bufferToHash32 } from './encoding.js';

export interface PaymentExecutionBundle {
  paymentId: string;
  intentId: string;
  intentVersion: bigint;
  vaultId: string;
  vaultAddress: Address;
  deploymentId: string;
  chainId: bigint;
  policyResourceId: string;
  onchainPolicyId: Hash32;
  policyObservedStatus: ObservedPolicyStatus;
  intent: PaymentIntent;
  invoice: Invoice;
  intentDigest: Hash32;
  agentSignature: HexBytes;
  merchantSignature: HexBytes;
  approval?: ExceptionApproval;
  ownerSignature?: HexBytes;
  retired: boolean;
}

export async function loadPaymentExecutionBundle(
  db: Queryable,
  intentId: string,
): Promise<PaymentExecutionBundle | null> {
  const result = await db.query(
    `SELECT
       pi.id AS intent_id, pi.payment_id, pi.vault_id, pi.policy_id, pi.intent_digest,
       pi.retired_at, pi.version,
       ia.encoded_payload AS intent_payload, ia.signature AS intent_signature,
       v.address AS vault_address, v.deployment_id,
       d.chain_id,
       p.onchain_policy_id, p.observed_status,
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

  const approvalResult = await db.query(
    `SELECT aa.encoded_payload, aa.signature
     FROM approvals a JOIN signed_artifacts aa ON aa.id = a.artifact_id
     WHERE a.intent_id = $1 AND a.observed_cancelled = false
     ORDER BY aa.created_at DESC LIMIT 1`,
    [intentId],
  );
  const approvalRow = approvalResult.rows[0];
  const approval = approvalRow
    ? (JSON.parse((approvalRow.encoded_payload as Buffer).toString('utf8')) as ExceptionApproval)
    : undefined;

  const base = {
    intentId: row.intent_id as string,
    intentVersion: BigInt(row.version as string),
    paymentId: row.payment_id as string,
    vaultId: row.vault_id as string,
    vaultAddress: bufferToAddress(row.vault_address as Buffer),
    deploymentId: row.deployment_id as string,
    chainId: BigInt(row.chain_id as string),
    policyResourceId: row.policy_id as string,
    onchainPolicyId: bufferToHash32(row.onchain_policy_id as Buffer),
    policyObservedStatus: row.observed_status as ObservedPolicyStatus,
    intent: JSON.parse((row.intent_payload as Buffer).toString('utf8')) as PaymentIntent,
    invoice: JSON.parse((row.invoice_payload as Buffer).toString('utf8')) as Invoice,
    intentDigest: bufferToHash32(row.intent_digest as Buffer),
    agentSignature: `0x${(row.intent_signature as Buffer).toString('hex')}` as HexBytes,
    merchantSignature: `0x${(row.invoice_signature as Buffer).toString('hex')}` as HexBytes,
    retired: row.retired_at !== null,
  };

  // Disjoint shapes (rather than spreading a possibly-undefined approval/ownerSignature in) so
  // the approval-present case never carries an `approval: undefined` value under
  // exactOptionalPropertyTypes -- same discipline as apps/api's own loadIntent-adjacent code.
  return approvalRow
    ? {
        ...base,
        approval: approval as ExceptionApproval,
        ownerSignature: `0x${(approvalRow.signature as Buffer).toString('hex')}` as HexBytes,
      }
    : base;
}
