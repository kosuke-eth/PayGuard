/**
 * Resource authorization. Roles are DERIVED from ownership and on-chain policy bindings; no field
 * in any request can create authority (API_CONTRACT.md: "Roles are derived from resource ownership
 * and policy bindings, not an arbitrary user-provided role flag").
 *
 * Global rule enforced here, carried forward from Stage 3's deferred IDOR finding (DECISIONS.md
 * SPEC-013): no handler may return data derived from a bare-id repository read until an ownership
 * predicate has been evaluated against the session wallet. The helpers below are the only
 * sanctioned way to cross that line, and each has a negative test using a valid UUID owned by
 * somebody else.
 */
import {
  getActivePoliciesForAgent,
  getPolicyById,
  getVaultWithDeployment,
  isInvoiceSignerOfPayment,
  type PolicyRow,
  type VaultWithDeployment,
} from '@payguard/db';
import { type AuthenticatedSession, addressToBuffer } from './auth.js';
import type { AppContext } from './context.js';
import { ApiError } from './errors.js';

export type VaultRole = 'OWNER' | 'AGENT';

export interface VaultAccess {
  vault: VaultWithDeployment;
  role: VaultRole;
}

/**
 * The session's verified SIWE chain must match the chain reached THROUGH the resource. Comparing
 * against a request-supplied deploymentId instead would let a caller satisfy the check by naming
 * any matching-chain deployment, including one they do not own.
 */
function assertSessionChainMatches(auth: AuthenticatedSession, vault: VaultWithDeployment): void {
  if (auth.chainId !== vault.chainId) {
    throw new ApiError(
      'DEPLOYMENT_MISMATCH',
      'session chain does not match this resource deployment chain; re-authenticate for that chain',
      { sessionChainId: auth.chainId.toString(10), resourceChainId: vault.chainId.toString(10) },
    );
  }
}

/** Owner-only access to a vault. A vault owned by someone else is 403, never a leaked row. */
export async function requireVaultOwner(
  context: AppContext,
  auth: AuthenticatedSession,
  vaultId: string,
): Promise<VaultWithDeployment> {
  const vault = await getVaultWithDeployment(context.pool, vaultId);
  if (!vault) {
    throw new ApiError('RESOURCE_NOT_FOUND', 'vault not found');
  }
  assertSessionChainMatches(auth, vault);
  if (vault.ownerWalletId !== auth.walletId) {
    throw new ApiError('RESOURCE_FORBIDDEN', 'only the vault owner may perform this action');
  }
  return vault;
}

/** Returns the active policies that bind this session wallet as an agent of the given vault. */
export async function boundAgentPolicies(
  context: AppContext,
  auth: AuthenticatedSession,
  vaultId: string,
): Promise<PolicyRow[]> {
  const policies = await getActivePoliciesForAgent(context.pool, {
    agent: addressToBuffer(auth.walletAddress),
  });
  return policies.filter((policy) => policy.vaultId === vaultId);
}

/** Owner OR bound agent. Used by reads the contract grants to both. */
export async function requireVaultOwnerOrAgent(
  context: AppContext,
  auth: AuthenticatedSession,
  vaultId: string,
): Promise<VaultAccess> {
  const vault = await getVaultWithDeployment(context.pool, vaultId);
  if (!vault) {
    throw new ApiError('RESOURCE_NOT_FOUND', 'vault not found');
  }
  assertSessionChainMatches(auth, vault);

  if (vault.ownerWalletId === auth.walletId) {
    return { vault, role: 'OWNER' };
  }
  const agentPolicies = await boundAgentPolicies(context, auth, vaultId);
  if (agentPolicies.length > 0) {
    return { vault, role: 'AGENT' };
  }
  throw new ApiError('RESOURCE_FORBIDDEN', 'not an owner or bound agent of this vault');
}

export type PaymentRole = 'OWNER' | 'AGENT' | 'MERCHANT';

/**
 * Payment access, including the MERCHANT role.
 *
 * The merchant predicate is deliberately PER-PAYMENT: the caller must be the signer of THIS
 * payment's own invoice artifact. An earlier draft resolved merchants vault-wide (anyone listed as
 * an `invoice_signer` in any policy snapshot of the vault), which would have handed merchant A
 * every payment of merchant B in the same vault. Being in a merchant snapshot is an invoice
 * *validity* fact, never a read grant.
 */
export async function resolvePaymentRole(
  context: AppContext,
  auth: AuthenticatedSession,
  params: { paymentId: string; vaultId: string },
): Promise<{ vault: VaultWithDeployment; role: PaymentRole }> {
  const vault = await getVaultWithDeployment(context.pool, params.vaultId);
  if (!vault) {
    throw new ApiError('RESOURCE_NOT_FOUND', 'vault not found');
  }
  assertSessionChainMatches(auth, vault);

  if (vault.ownerWalletId === auth.walletId) return { vault, role: 'OWNER' };

  const agentPolicies = await boundAgentPolicies(context, auth, params.vaultId);
  if (agentPolicies.length > 0) return { vault, role: 'AGENT' };

  const isMerchant = await isInvoiceSignerOfPayment(context.pool, {
    paymentId: params.paymentId,
    signer: addressToBuffer(auth.walletAddress),
  });
  if (isMerchant) return { vault, role: 'MERCHANT' };

  throw new ApiError('RESOURCE_FORBIDDEN', 'not authorized to view this payment');
}

/** Owner or bound agent of the policy's vault (SPEC-019 resolves this in API_CONTRACT's favour). */
export async function requirePolicyAccess(
  context: AppContext,
  auth: AuthenticatedSession,
  policyResourceId: string,
): Promise<{ policy: PolicyRow; vault: VaultWithDeployment; role: VaultRole }> {
  const policy = await getPolicyById(context.pool, policyResourceId);
  if (!policy) {
    throw new ApiError('RESOURCE_NOT_FOUND', 'policy not found');
  }
  const access = await requireVaultOwnerOrAgent(context, auth, policy.vaultId);
  return { policy, vault: access.vault, role: access.role };
}

/**
 * `operations.(resource_kind, resource_id)` is polymorphic and carries no foreign key, so an
 * operation cannot be authorized by a bare id alone. This is the explicit dispatch table mapping
 * each ALLOWED resource kind to the join that reaches a vault. An unrecognized kind is refused
 * (403) rather than crashing or, worse, defaulting to permissive.
 */
export const OPERATION_RESOURCE_KINDS = [
  'vault',
  'policy',
  'policy_draft',
  'payment_intent',
] as const;
export type OperationResourceKind = (typeof OPERATION_RESOURCE_KINDS)[number];

export function isKnownOperationResourceKind(kind: string): kind is OperationResourceKind {
  return (OPERATION_RESOURCE_KINDS as readonly string[]).includes(kind);
}

export async function resolveOperationVaultId(
  context: AppContext,
  params: { resourceKind: string; resourceId: string },
): Promise<string> {
  if (!isKnownOperationResourceKind(params.resourceKind)) {
    throw new ApiError(
      'RESOURCE_FORBIDDEN',
      'operation resource kind is not readable through this API',
      {
        resourceKind: params.resourceKind,
      },
    );
  }

  switch (params.resourceKind) {
    case 'vault':
      return params.resourceId;
    case 'policy': {
      const result = await context.pool.query('SELECT vault_id FROM policies WHERE id = $1', [
        params.resourceId,
      ]);
      const row = result.rows[0];
      if (!row) throw new ApiError('RESOURCE_NOT_FOUND', 'operation resource no longer exists');
      return row.vault_id as string;
    }
    case 'policy_draft': {
      const result = await context.pool.query('SELECT vault_id FROM policy_drafts WHERE id = $1', [
        params.resourceId,
      ]);
      const row = result.rows[0];
      if (!row) throw new ApiError('RESOURCE_NOT_FOUND', 'operation resource no longer exists');
      return row.vault_id as string;
    }
    case 'payment_intent': {
      const result = await context.pool.query(
        'SELECT vault_id FROM payment_intents WHERE id = $1',
        [params.resourceId],
      );
      const row = result.rows[0];
      if (!row) throw new ApiError('RESOURCE_NOT_FOUND', 'operation resource no longer exists');
      return row.vault_id as string;
    }
  }
}

/**
 * SPEC-018: a request-supplied `deploymentId` is validated as EQUAL to the single active
 * deployment. It is never used to SELECT a deployment, so it cannot be used to reach another
 * instance's projections.
 */
export function assertActiveDeployment(context: AppContext, deploymentId: string): void {
  if (deploymentId !== context.config.deploymentId) {
    throw new ApiError(
      'DEPLOYMENT_MISMATCH',
      'deploymentId does not match the deployment this API serves',
      { expected: context.config.deploymentId },
    );
  }
}
