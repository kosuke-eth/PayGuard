/**
 * B2 demo bridge: scenario catalog and profile discovery.
 *
 * A DemoProfile is derived from the caller's OWN real `policies` rows -- never a separate "profiles"
 * table -- so a profile can never drift from what the policy actually authorizes on-chain. `available`
 * comes from the deployment's real configured+enabled route list (`docs/API_CONTRACT.md`'s "Only
 * configured, tested routes are advertised"), the exact same source `GET /v1/config` uses, so a
 * profile can never claim a route works when the public config itself says it does not.
 *
 * Amounts below match `docs/PAYGUARD_ACCEPTANCE_AND_DEMO.md`'s main narrative budgets (300 mUSDC
 * total / 100 automatic cap / 200 escalation cap, 6-decimal mock token): compute (0.50 mUSDC) stays
 * under the automatic cap -> ALLOW; hotel (180 mUSDC) exceeds the automatic cap but not the
 * escalation cap -> ESCALATE; over-budget (500 mUSDC) exceeds the total budget -> BLOCK.
 */
import {
  getDeploymentById,
  getPoliciesByVault,
  getPolicyById,
  getVaultById,
  getVaultsKeysetForOwner,
  type PolicyRow,
} from '@payguard/db';
import { bufferToAddress } from '../auth.js';
import type { AppContext } from '../context.js';

export type ScenarioId =
  | 'compute'
  | 'hotel'
  | 'over_budget'
  | 'unauthorized_merchant'
  | 'duplicate';

export interface DemoScenario {
  scenarioId: ScenarioId;
  label: string;
  description: string;
  /** Which signing identity the bridge uses for the INVOICE side of this scenario. */
  invoiceSigner: 'merchant' | 'unauthorizedMerchant';
  invoiceAmountAtomic: string;
  requiresSourcePayment: boolean;
}

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    scenarioId: 'compute',
    label: 'Demo Compute',
    description:
      'A small, ordinary invoice safely inside the automatic cap. Expected outcome: ALLOW, real settlement.',
    invoiceSigner: 'merchant',
    invoiceAmountAtomic: '500000', // 0.50 mUSDC @ 6 decimals
    requiresSourcePayment: false,
  },
  {
    scenarioId: 'hotel',
    label: 'Demo Hotel',
    description:
      'An invoice above the automatic cap but within the escalation cap. Expected outcome: ESCALATE, paused pending a real owner approval -- the bridge never auto-approves it.',
    invoiceSigner: 'merchant',
    invoiceAmountAtomic: '180000000', // 180 mUSDC
    requiresSourcePayment: false,
  },
  {
    scenarioId: 'over_budget',
    label: 'Over Hard Budget',
    description:
      "An invoice exceeding the policy's total output budget. Expected outcome: real BLOCK from the vault's own evaluation, recorded as the actual rejection stage/reason, never fabricated.",
    invoiceSigner: 'merchant',
    invoiceAmountAtomic: '500000000', // 500 mUSDC
    requiresSourcePayment: false,
  },
  {
    scenarioId: 'unauthorized_merchant',
    label: 'Unauthorized Merchant',
    description:
      'An invoice signed by an identity this vault has never registered as an invoiceSigner. Expected outcome: real INVALID_SIGNATURE rejection from POST /v1/invoices itself -- no payment is ever created.',
    invoiceSigner: 'unauthorizedMerchant',
    invoiceAmountAtomic: '500000',
    requiresSourcePayment: false,
  },
  {
    scenarioId: 'duplicate',
    label: 'Duplicate Attempt',
    description:
      "Deliberately reuses an existing settled payment's own invoice identity via a fresh signed intent. Expected outcome: the same business obligation, not a second payment -- proven by the real API/contract path, never a client-side skip.",
    invoiceSigner: 'merchant',
    invoiceAmountAtomic: '0', // unused -- the source payment's own invoice is reused verbatim
    requiresSourcePayment: true,
  },
] as const;

export function findScenario(scenarioId: string): DemoScenario | null {
  return DEMO_SCENARIOS.find((s) => s.scenarioId === scenarioId) ?? null;
}

/** Catalog invoice amounts are written at 6 decimals (the mUSDC narrative). */
export const CATALOG_AMOUNT_DECIMALS = 6;

/** Scale a catalog amount to the settlement token's real decimals (Aqua AQOUT is 18). */
export function catalogAmountForDecimals(atomicAt6dp: string, decimals: number): string {
  if (!atomicAt6dp || atomicAt6dp === '0') return atomicAt6dp;
  if (decimals === CATALOG_AMOUNT_DECIMALS) return atomicAt6dp;
  if (decimals > CATALOG_AMOUNT_DECIMALS) {
    return `${atomicAt6dp}${'0'.repeat(decimals - CATALOG_AMOUNT_DECIMALS)}`;
  }
  return atomicAt6dp;
}

function tokenDecimals(configuration: unknown, address: string): number {
  const tokens =
    ((configuration as { tokens?: Array<{ address?: string; decimals?: number }> } | null)?.tokens ??
    []);
  const match = tokens.find((token) => (token.address ?? '').toLowerCase() === address.toLowerCase());
  const decimals = Number(match?.decimals);
  return Number.isFinite(decimals) && decimals >= 0 ? decimals : CATALOG_AMOUNT_DECIMALS;
}

export interface DemoProfile {
  profileId: string;
  label: string;
  deploymentId: string;
  vaultId: string;
  policyResourceId: string;
  onchainPolicyId: `0x${string}`;
  agentAddress: `0x${string}`;
  routeId: `0x${string}`;
  routeKind: string;
  inputToken: `0x${string}`;
  outputToken: `0x${string}`;
  outputDecimals: number;
  maxInputPerPayment: string;
  available: boolean;
}

interface StoredRoute {
  routeId?: string;
  adapter?: string;
  kind?: string;
  enabled?: boolean;
}

function routeInfoFor(
  configuration: unknown,
  routeId: `0x${string}`,
): { kind: string; available: boolean } {
  const routes = ((configuration as { routes?: StoredRoute[] } | null)?.routes ??
    []) as StoredRoute[];
  const match = routes.find((r) => (r.routeId ?? '').toLowerCase() === routeId.toLowerCase());
  if (!match) return { kind: 'UNKNOWN', available: false };
  return { kind: match.kind ?? 'UNKNOWN', available: match.enabled === true };
}

function toProfile(policy: PolicyRow, deploymentId: string, configuration: unknown): DemoProfile {
  const routeId = `0x${policy.routeId.toString('hex')}` as `0x${string}`;
  const { kind, available } = routeInfoFor(configuration, routeId);
  return {
    profileId: policy.id,
    label: `${kind} route (policy ${policy.id.slice(0, 8)})`,
    deploymentId,
    vaultId: policy.vaultId,
    policyResourceId: policy.id,
    onchainPolicyId: `0x${policy.onchainPolicyId.toString('hex')}` as `0x${string}`,
    agentAddress: bufferToAddress(policy.agent),
    routeId,
    routeKind: kind,
    inputToken: bufferToAddress(policy.inputToken),
    outputToken: bufferToAddress(policy.settlementToken),
    outputDecimals: tokenDecimals(configuration, bufferToAddress(policy.settlementToken)),
    maxInputPerPayment: policy.maxInputPerPayment.toString(10),
    // Both the route being configured+enabled AND the policy still being ACTIVE are required --
    // a REVOKED/EXPIRED/SUPERSEDED/ORPHANED policy is never presented as a usable demo profile,
    // regardless of what the route list says.
    available: available && policy.observedStatus === 'ACTIVE',
  };
}

/** Every demo profile derivable from vaults the caller OWNS, for the deployment this API serves. */
export async function getDemoProfilesForOwner(
  context: AppContext,
  ownerWalletId: string,
): Promise<DemoProfile[]> {
  const deployment = await getDeploymentById(context.pool, context.config.deploymentId);
  if (!deployment) return [];
  const vaults = await getVaultsKeysetForOwner(context.pool, { ownerWalletId, limit: 1000 });
  const profiles: DemoProfile[] = [];
  for (const vault of vaults) {
    // `getVaultsKeysetForOwner` is owner-scoped only, not deployment-scoped -- an owner wallet
    // could in principle own vaults across more than one deployment. A profile is only ever
    // derived from a vault that actually belongs to the deployment THIS API instance serves;
    // otherwise its route/config availability would be evaluated against the wrong deployment's
    // configuration, which is exactly the kind of mismatch a demo profile must never present.
    if (vault.deploymentId !== deployment.id) continue;
    const policies = await getPoliciesByVault(context.pool, vault.id);
    for (const policy of policies) {
      profiles.push(toProfile(policy, deployment.id, deployment.configuration));
    }
  }
  return profiles;
}

export async function getDemoProfileById(
  context: AppContext,
  profileId: string,
): Promise<DemoProfile | null> {
  const deployment = await getDeploymentById(context.pool, context.config.deploymentId);
  if (!deployment) return null;
  const policy = await getPolicyById(context.pool, profileId);
  if (!policy) return null;
  // Same deployment-binding requirement as above: `getPolicyById` is a bare-id lookup with no
  // deployment scoping, so a profileId naming a policy on a DIFFERENT deployment's vault must be
  // treated as not found here -- never silently evaluated against this deployment's route config.
  const vault = await getVaultById(context.pool, policy.vaultId);
  if (!vault || vault.deploymentId !== deployment.id) return null;
  return toProfile(policy, deployment.id, deployment.configuration);
}
