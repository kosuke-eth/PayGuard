/**
 * CHAIN_OBSERVATION_REQUESTED: validate a hinted owner transaction and, for a policy draft,
 * persist the PolicyCreated observation so the owner panel can select the new ACTIVE policy.
 * A successful receipt alone never activates anything — validatePolicyCreation must pass.
 */
import { randomUUID } from 'node:crypto';
import {
  createVaultReader,
  PAYGUARD_VAULT_ABI,
  toAbiPolicyConfig,
  validatePolicyCreation,
} from '@payguard/chain';
import {
  completeJob,
  getLatestDraftRevision,
  getPolicyDraftById,
  getVaultById,
  insertPolicyMerchants,
  recordObservedPolicy,
  supersedeActivePoliciesForAgent,
  withTransaction,
} from '@payguard/db';
import type { Address, Hash32, HexBytes, MerchantPermission, PolicyConfig } from '@payguard/domain';
import type pg from 'pg';
import {
  decodeEventLog,
  encodeAbiParameters,
  type PublicClient,
  parseAbiParameters,
} from 'viem';
import { addressToBuffer, hexToBuffer } from './encoding.js';

export interface ObservationJobPayload {
  txHash: string;
  relatedResourceId: string;
  relatedResourceKind: string;
  deploymentId: string;
}

export interface ObservationJob {
  id: string;
  leaseOwner: string;
  leaseVersion: bigint;
  payload: ObservationJobPayload;
}

export interface ObserveDeps {
  pool: pg.Pool;
  publicClient: PublicClient;
  chainId: string;
}

function encodeConfigBytes(config: PolicyConfig): Buffer {
  const abiConfig = toAbiPolicyConfig(config);
  const encoded = encodeAbiParameters(
    parseAbiParameters(
      '(address,address,address,address,bytes32,uint256,uint256,uint256,uint256,uint256,uint256,uint48,uint48,uint256,uint8)',
    ),
    [
      [
        abiConfig.agent,
        abiConfig.inputToken,
        abiConfig.settlementToken,
        abiConfig.adapter,
        abiConfig.routeId,
        abiConfig.totalOutputBudget,
        abiConfig.epochOutputBudget,
        abiConfig.automaticOutputCap,
        abiConfig.escalationOutputCap,
        abiConfig.totalInputBudget,
        abiConfig.maxInputPerPayment,
        abiConfig.validAfter,
        abiConfig.validUntil,
        abiConfig.allowedCategoryBitmap,
        abiConfig.subsidyMode,
      ],
    ] as never,
  );
  return hexToBuffer(encoded);
}

function policyIdFromReceipt(receipt: { logs: readonly { data: HexBytes; topics: readonly HexBytes[] }[] }): Hash32 | null {
  for (const log of receipt.logs) {
    try {
      const parsed = decodeEventLog({
        abi: PAYGUARD_VAULT_ABI,
        data: log.data,
        topics: log.topics as [HexBytes, ...HexBytes[]],
      });
      if (parsed.eventName === 'PolicyCreated') {
        return (parsed.args as { policyId: Hash32 }).policyId;
      }
    } catch {
      // not a vault event we know
    }
  }
  return null;
}

export async function handleChainObservationJob(
  deps: ObserveDeps,
  job: ObservationJob,
): Promise<{ kind: 'DONE' } | { kind: 'RETRY'; reason: string }> {
  const { txHash, relatedResourceKind } = job.payload;
  const receipt = await deps.publicClient.getTransactionReceipt({ hash: txHash as Hash32 });
  const transaction = await deps.publicClient.getTransaction({ hash: txHash as Hash32 });
  if (!receipt || !transaction) {
    return { kind: 'RETRY', reason: 'receipt not yet available' };
  }

  if (relatedResourceKind === 'policy_draft') {
    const recorded = await recordPolicyDraftCreation(deps, job, receipt, transaction);
    if (!recorded.ok) return { kind: 'RETRY', reason: recorded.reason };
  }

  await completeJob(deps.pool, {
    id: job.id,
    leaseOwner: job.leaseOwner,
    expectedLeaseVersion: job.leaseVersion,
  });
  return { kind: 'DONE' };
}

async function recordPolicyDraftCreation(
  deps: ObserveDeps,
  job: ObservationJob,
  receipt: {
    status: 'success' | 'reverted';
    transactionHash: Hash32;
    blockNumber: bigint;
    blockHash: Hash32;
    from: Address;
    to: Address | null;
    logs: readonly { data: HexBytes; topics: readonly HexBytes[] }[];
  },
  transaction: { chainId?: number; from: Address; to: Address | null; input: HexBytes },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const draft = await getPolicyDraftById(deps.pool, job.payload.relatedResourceId);
  if (!draft) return { ok: false, reason: 'policy draft not found' };
  const revision = await getLatestDraftRevision(deps.pool, draft.id);
  if (!revision) return { ok: false, reason: 'draft has no compiled revision' };
  const vault = await getVaultById(deps.pool, draft.vaultId);
  if (!vault) return { ok: false, reason: 'vault not found' };

  const body = draft.body as { config: PolicyConfig; merchants: MerchantPermission[] };
  const config = body.config;
  const vaultAddress = `0x${vault.address.toString('hex')}` as Address;
  const reader = createVaultReader({ publicClient: deps.publicClient, vaultAddress });
  const onchainPolicyId = policyIdFromReceipt(receipt);
  if (!onchainPolicyId) return { ok: false, reason: 'no PolicyCreated log' };

  const onChainConfig = await reader.getPolicy(onchainPolicyId);
  const validation = validatePolicyCreation(
    {
      status: receipt.status === 'success' ? 'success' : 'reverted',
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      from: receipt.from,
      to: receipt.to,
      logs: receipt.logs as never,
    },
    {
      chainId: transaction.chainId ?? Number(deps.chainId),
      from: transaction.from,
      to: transaction.to,
      input: transaction.input,
    },
    {
      expectedChainId: deps.chainId,
      expectedTo: vaultAddress,
      expectedVault: vaultAddress,
      expectedConfig: config,
      onChainConfig,
      expectedCalldata: `0x${revision.encodedTransaction.toString('hex')}` as HexBytes,
    },
  );
  if (!validation.valid || !validation.onchainPolicyId) {
    return {
      ok: false,
      reason: validation.failed.map((check) => `${check.name}: ${check.detail}`).join('; '),
    };
  }

  const policyId = randomUUID();
  const agent = addressToBuffer(config.agent);
  await withTransaction(deps.pool, async (client) => {
    await recordObservedPolicy(client, {
      id: policyId,
      vaultId: draft.vaultId,
      onchainPolicyId: hexToBuffer(validation.onchainPolicyId as string),
      agent,
      inputToken: addressToBuffer(config.inputToken),
      settlementToken: addressToBuffer(config.settlementToken),
      adapter: addressToBuffer(config.adapter),
      routeId: hexToBuffer(config.routeId),
      totalOutputBudget: BigInt(config.totalOutputBudget),
      epochOutputBudget: BigInt(config.epochOutputBudget),
      automaticOutputCap: BigInt(config.automaticOutputCap),
      escalationOutputCap: BigInt(config.escalationOutputCap),
      totalInputBudget: BigInt(config.totalInputBudget),
      maxInputPerPayment: BigInt(config.maxInputPerPayment),
      validAfter: BigInt(config.validAfter),
      validUntil: BigInt(config.validUntil),
      subsidyMode: 0,
      canonicalConfigBytes: encodeConfigBytes(config),
      configProjection: config,
      observedStatus: 'ACTIVE',
      observedBlockHash: hexToBuffer(receipt.blockHash),
    });
    await supersedeActivePoliciesForAgent(client, {
      vaultId: draft.vaultId,
      agent,
      exceptPolicyId: policyId,
    });
    await insertPolicyMerchants(client, {
      policyId,
      merchants: (body.merchants ?? []).map((merchant) => ({
        merchantId: hexToBuffer(merchant.merchantId),
        recipient: addressToBuffer(merchant.recipient),
        invoiceSigner: addressToBuffer(merchant.invoiceSigner),
        category: Number(merchant.category),
      })),
    });
  });
  return { ok: true };
}
