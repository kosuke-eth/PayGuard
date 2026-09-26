/**
 * Typed read/simulation surface over the deployed PayGuardVault, built on the GENERATED ABI.
 *
 * Everything here is a read or an `eth_call`. Nothing in this module signs, broadcasts, waits for
 * a receipt, or polls -- HTTP handlers call into it synchronously and must stay that way
 * (CLAUDE.md: no polling loops / relayer signing / indefinite receipt waits in request handlers).
 *
 * The single most important behaviour: an RPC that cannot answer produces `UNKNOWN`, never a
 * BLOCK. A false denial and a real denial are different facts and the caller is given both the
 * kind and the decoded contract Reason so it can tell them apart.
 */

import {
  type Address,
  type ExceptionApproval,
  type Hash32,
  type HexBytes,
  type Invoice,
  type MerchantPermission,
  type Observation,
  type PaymentIntent,
  type PolicyConfig,
  type PolicyDecisionWire,
  type ReasonWire,
  reasonFromOnChain,
  type UIntString,
  ZERO_APPROVAL,
  ZERO_APPROVAL_SIGNATURE,
} from '@payguard/domain';
import { encodeFunctionData, type Hex, type PublicClient, type Address as ViemAddress } from 'viem';
import { classifyChainFailure } from './errors.js';
import { ERC20_ABI, PAYGUARD_VAULT_ABI } from './generated/abi.js';
import {
  type AbiMerchantPermission,
  type AbiPolicyConfig,
  fromAbiMerchants,
  fromAbiPolicyConfig,
  toAbiApproval,
  toAbiInvoice,
  toAbiPaymentIntent,
} from './structs.js';

export interface SignatureSet {
  agentSignature: HexBytes;
  merchantSignature: HexBytes;
  approval?: ExceptionApproval;
  ownerSignature?: HexBytes;
}

export interface EvaluationResult {
  decision: PolicyDecisionWire;
  reasonCode: ReasonWire | string;
  signaturesChecked: boolean;
  remainingOutputAtomic: UIntString | null;
  remainingEpochOutputAtomic: UIntString | null;
  remainingInputAtomic: UIntString | null;
  simulatedAt: Observation | null;
}

export interface PolicyStateResult {
  active: boolean;
  revoked: boolean;
  agentRevoked: boolean;
  executionPaused: boolean;
  epoch: UIntString;
  outputSpent: UIntString;
  epochOutputSpent: UIntString;
  inputSpent: UIntString;
}

export interface ExecutionSimulationResult {
  available: boolean;
  actualInputEstimateAtomic: UIntString | null;
  gasEstimate: UIntString | null;
  calldataHash: Hash32 | null;
  simulatedAt: Observation | null;
  /** Set when the contract deliberately rejected; null when it succeeded or RPC was unavailable. */
  rejectedReason: ReasonWire | null;
  /** True only when the failure was infrastructure, not a contract answer. */
  infrastructureUnavailable: boolean;
}

const DECISION_FROM_ONCHAIN = ['ALLOW', 'ESCALATE', 'BLOCK'] as const;

export interface VaultReaderOptions {
  publicClient: PublicClient;
  vaultAddress: Address;
}

/** Captures the block a read was answered at, so stale/offline data is distinguishable. */
async function observeBlock(publicClient: PublicClient): Promise<Observation> {
  const block = await publicClient.getBlock();
  return {
    blockNumber: block.number.toString(10),
    blockHash: block.hash as Hash32,
    canonical: true,
    observedAt: new Date().toISOString(),
  };
}

export function createVaultReader(options: VaultReaderOptions) {
  const { publicClient, vaultAddress } = options;
  const address = vaultAddress as ViemAddress;
  const abi = PAYGUARD_VAULT_ABI;

  // The ABI is a generated `as const` tuple, so viem narrows `functionName` to a literal union.
  // Reads here are dispatched by name from typed wrappers below, which is the check that matters;
  // the cast keeps that dispatch in one place instead of repeating it at every call site.
  async function read<T>(functionName: string, args: readonly unknown[]): Promise<T> {
    return (await publicClient.readContract({
      address,
      abi,
      functionName,
      args,
    } as never)) as T;
  }

  return {
    vaultAddress,

    async owner(): Promise<Address> {
      return read<Address>('owner', []);
    },

    async isSupportedToken(token: Address): Promise<boolean> {
      return read<boolean>('isSupportedToken', [token]);
    },

    async hashInvoice(invoice: Invoice): Promise<Hash32> {
      return read<Hash32>('hashInvoice', [toAbiInvoice(invoice)]);
    },

    async hashIntent(intent: PaymentIntent): Promise<Hash32> {
      return read<Hash32>('hashIntent', [toAbiPaymentIntent(intent)]);
    },

    async hashApproval(approval: ExceptionApproval): Promise<Hash32> {
      return read<Hash32>('hashApproval', [toAbiApproval(approval)]);
    },

    async getPolicy(onchainPolicyId: Hash32): Promise<PolicyConfig> {
      const raw = await read<AbiPolicyConfig>('getPolicy', [onchainPolicyId]);
      return fromAbiPolicyConfig(raw);
    },

    async getMerchantPermission(
      onchainPolicyId: Hash32,
      merchantId: Hash32,
    ): Promise<MerchantPermission> {
      const raw = await read<AbiMerchantPermission>('getMerchantPermission', [
        onchainPolicyId,
        merchantId,
      ]);
      return fromAbiMerchants([raw])[0] as MerchantPermission;
    },

    /**
     * SPEC-015: the vault exposes no standalone `executionPaused()` getter -- the flag is only
     * reachable through `getPolicyState(...).executionPaused`, which
     * `PayGuardVault.sol:637-648` assigns unconditionally and never reverts on an unknown policy
     * id. So this is total for any input, including the zero hash on a vault with no policies.
     */
    async getPolicyState(onchainPolicyId: Hash32): Promise<PolicyStateResult> {
      const raw = await read<{
        active: boolean;
        revoked: boolean;
        agentRevoked: boolean;
        executionPaused: boolean;
        epoch: bigint;
        outputSpent: bigint;
        epochOutputSpent: bigint;
        inputSpent: bigint;
      }>('getPolicyState', [onchainPolicyId]);
      return {
        active: raw.active,
        revoked: raw.revoked,
        agentRevoked: raw.agentRevoked,
        executionPaused: raw.executionPaused,
        epoch: raw.epoch.toString(10),
        outputSpent: raw.outputSpent.toString(10),
        epochOutputSpent: raw.epochOutputSpent.toString(10),
        inputSpent: raw.inputSpent.toString(10),
      };
    },

    async isInvoiceConsumed(recipient: Address, invoiceId: Hash32): Promise<boolean> {
      return read<boolean>('isInvoiceConsumed', [recipient, invoiceId]);
    },

    async isAgentNonceUsed(agent: Address, nonce: bigint): Promise<boolean> {
      return read<boolean>('isAgentNonceUsed', [agent, nonce]);
    },

    async isApprovalNonceUsedOrCancelled(nonce: bigint): Promise<boolean> {
      return read<boolean>('isApprovalNonceUsedOrCancelled', [nonce]);
    },

    async tokenBalance(token: Address, holder: Address): Promise<bigint> {
      return (await publicClient.readContract({
        address: token as ViemAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [holder as ViemAddress],
      })) as bigint;
    },

    async tokenAllowance(token: Address, owner: Address, spender: Address): Promise<bigint> {
      return (await publicClient.readContract({
        address: token as ViemAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [owner as ViemAddress, spender as ViemAddress],
      })) as bigint;
    },

    /**
     * The shared policy decision used by BOTH payment-intent creation and /simulate, so the two
     * can never disagree. Infrastructure failure yields decision UNKNOWN with a distinct reason
     * code -- API_CONTRACT.md: "A provider failure returns UNKNOWN rather than a false BLOCK".
     */
    async evaluate(
      invoice: Invoice,
      intent: PaymentIntent,
      signatures: SignatureSet,
    ): Promise<EvaluationResult> {
      try {
        const observation = await observeBlock(publicClient);
        const raw = await read<{
          decision: number;
          reason: number;
          remainingOutput: bigint;
          remainingEpochOutput: bigint;
          remainingInput: bigint;
          signaturesChecked: boolean;
        }>('evaluate', [
          toAbiInvoice(invoice),
          toAbiPaymentIntent(intent),
          signatures.agentSignature,
          signatures.merchantSignature,
          toAbiApproval(signatures.approval ?? ZERO_APPROVAL),
          signatures.ownerSignature ?? ZERO_APPROVAL_SIGNATURE,
        ]);
        return {
          decision: DECISION_FROM_ONCHAIN[raw.decision] ?? 'UNKNOWN',
          reasonCode: reasonFromOnChain(raw.reason),
          signaturesChecked: raw.signaturesChecked,
          remainingOutputAtomic: raw.remainingOutput.toString(10),
          remainingEpochOutputAtomic: raw.remainingEpochOutput.toString(10),
          remainingInputAtomic: raw.remainingInput.toString(10),
          simulatedAt: observation,
        };
      } catch (error) {
        const failure = classifyChainFailure(error);
        if (failure.kind === 'CONTRACT_REVERT' && failure.decoded?.reason) {
          // The contract answered by reverting -- that IS a real rejection, not an outage.
          return {
            decision: 'BLOCK',
            reasonCode: failure.decoded.reason,
            signaturesChecked: true,
            remainingOutputAtomic: null,
            remainingEpochOutputAtomic: null,
            remainingInputAtomic: null,
            simulatedAt: null,
          };
        }
        return {
          decision: 'UNKNOWN',
          reasonCode: 'CHAIN_STATE_UNKNOWN',
          signaturesChecked: false,
          remainingOutputAtomic: null,
          remainingEpochOutputAtomic: null,
          remainingInputAtomic: null,
          simulatedAt: null,
        };
      }
    },

    /**
     * Full execution simulation: an `eth_call` of the ACTUAL `executePayment` with the complete
     * signature set, sent from the intended relayer account. API_CONTRACT.md forbids substituting
     * a standalone protocol quote as evidence that the whole payment can execute.
     */
    async simulateExecutePayment(params: {
      relayer: Address;
      invoice: Invoice;
      intent: PaymentIntent;
      signatures: SignatureSet;
    }): Promise<ExecutionSimulationResult> {
      const args = [
        toAbiInvoice(params.invoice),
        toAbiPaymentIntent(params.intent),
        params.signatures.agentSignature,
        params.signatures.merchantSignature,
        toAbiApproval(params.signatures.approval ?? ZERO_APPROVAL),
        params.signatures.ownerSignature ?? ZERO_APPROVAL_SIGNATURE,
      ] as const;

      const data = encodeFunctionData({
        abi,
        functionName: 'executePayment',
        args: args as never,
      });
      const { keccak256 } = await import('viem');
      const calldataHash = keccak256(data) as Hash32;

      try {
        const observation = await observeBlock(publicClient);
        const { result } = await publicClient.simulateContract({
          address,
          abi,
          functionName: 'executePayment',
          args: args as never,
          account: params.relayer as ViemAddress,
        });
        const tuple = result as readonly [Hash32, bigint, bigint];
        let gasEstimate: bigint | null = null;
        try {
          gasEstimate = await publicClient.estimateGas({
            account: params.relayer as ViemAddress,
            to: address,
            data,
          });
        } catch {
          gasEstimate = null; // a gas-estimate failure must not invalidate a successful simulation
        }
        return {
          available: true,
          actualInputEstimateAtomic: tuple[1].toString(10),
          gasEstimate: gasEstimate === null ? null : gasEstimate.toString(10),
          calldataHash,
          simulatedAt: observation,
          rejectedReason: null,
          infrastructureUnavailable: false,
        };
      } catch (error) {
        const failure = classifyChainFailure(error);
        return {
          available: false,
          actualInputEstimateAtomic: null,
          gasEstimate: null,
          calldataHash,
          simulatedAt: null,
          rejectedReason: failure.decoded?.reason ?? null,
          infrastructureUnavailable: failure.kind === 'INFRASTRUCTURE_UNAVAILABLE',
        };
      }
    },
  };
}

export type VaultReader = ReturnType<typeof createVaultReader>;

export type { Hex };
/** Re-exported so the API layer can encode without importing viem directly. */
export { encodeFunctionData };
