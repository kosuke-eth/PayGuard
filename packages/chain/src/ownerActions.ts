/**
 * Owner transaction preparation: the backend generates the target, selector, calldata and value.
 * A caller can never supply arbitrary transaction bytes, an arbitrary target, or a selector --
 * every function here takes a narrow typed action and emits exactly one encoding
 * (API_CONTRACT.md: "The backend never signs for the owner and never accepts caller-supplied
 * targets or selectors").
 *
 * Each preparation returns the exact bytes AND a `review` built by decoding those same bytes back
 * through the ABI. The review is therefore evidence about the calldata the wallet will actually
 * sign, not a restatement of the request object -- if encoding and decoding ever disagreed, the
 * review would visibly differ, and `test/owner-actions.test.ts` asserts the equivalence.
 */

import {
  type Address,
  type Hash32,
  type HexBytes,
  type MerchantPermission,
  type PolicyConfig,
  parseUIntString,
  type UIntString,
  type UnsignedTransaction,
} from '@payguard/domain';
import { decodeFunctionData, encodeFunctionData, keccak256 } from 'viem';
import { ERC20_ABI, PAYGUARD_VAULT_ABI } from './generated/abi.js';
import {
  type AbiMerchantPermission,
  type AbiPolicyConfig,
  fromAbiMerchants,
  fromAbiPolicyConfig,
  toAbiMerchants,
  toAbiPolicyConfig,
} from './structs.js';

export type OwnerAction =
  | { action: 'DEPOSIT'; token: Address; amountAtomic: UIntString }
  | { action: 'WITHDRAW'; token: Address; amountAtomic: UIntString; recipient: Address }
  | { action: 'REVOKE_AGENT'; agent: Address }
  | { action: 'SET_EXECUTION_PAUSED'; paused: boolean }
  | { action: 'CANCEL_APPROVAL_NONCE'; nonce: UIntString };

export interface PreparedStep {
  /** Distinguishes the ERC-20 approval step from the vault call it enables. */
  stepKind:
    | 'APPROVE'
    | 'DEPOSIT'
    | 'WITHDRAW'
    | 'REVOKE_AGENT'
    | 'SET_EXECUTION_PAUSED'
    | 'CANCEL_APPROVAL_NONCE'
    | 'CREATE_POLICY'
    | 'REVOKE_POLICY';
  transaction: UnsignedTransaction;
  /** Decoded back out of `transaction.data` -- never copied from the request. */
  review: Record<string, unknown>;
}

function unsignedTransaction(params: {
  chainId: UIntString;
  from: Address;
  to: Address;
  data: HexBytes;
  value?: UIntString;
}): UnsignedTransaction {
  return {
    chainId: params.chainId,
    from: params.from,
    to: params.to,
    data: params.data,
    value: params.value ?? '0',
    calldataHash: keccak256(params.data) as Hash32,
    abiSchemaVersion: '1',
  };
}

/** Decodes prepared calldata back through the ABI so the review describes the real bytes. */
function decodeVaultCall(data: HexBytes): { functionName: string; args: readonly unknown[] } {
  const decoded = decodeFunctionData({ abi: PAYGUARD_VAULT_ABI, data });
  return { functionName: decoded.functionName, args: (decoded.args ?? []) as readonly unknown[] };
}

function decodeErc20Call(data: HexBytes): { functionName: string; args: readonly unknown[] } {
  const decoded = decodeFunctionData({ abi: ERC20_ABI, data });
  return { functionName: decoded.functionName, args: (decoded.args ?? []) as readonly unknown[] };
}

export interface PrepareContext {
  chainId: UIntString;
  ownerAddress: Address;
  vaultAddress: Address;
}

/**
 * ERC-20 approval for a deposit. The amount is FINITE (exactly the deposit amount, never an
 * unlimited approval) and the spender is the selected vault -- both required by API_CONTRACT.md.
 */
export function prepareApprove(
  context: PrepareContext,
  token: Address,
  amountAtomic: UIntString,
): PreparedStep {
  const amount = parseUIntString(amountAtomic);
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [context.vaultAddress, amount],
  }) as HexBytes;
  const decoded = decodeErc20Call(data);
  return {
    stepKind: 'APPROVE',
    transaction: unsignedTransaction({
      chainId: context.chainId,
      from: context.ownerAddress,
      to: token,
      data,
    }),
    review: {
      call: 'approve',
      token,
      spender: decoded.args[0] as Address,
      amountAtomic: (decoded.args[1] as bigint).toString(10),
      finite: true,
    },
  };
}

/**
 * Prepares one owner action. DEPOSIT returns only the vault `deposit` call here; the caller
 * decides whether a preceding `approve` step is required by reading the CURRENT allowance, so a
 * stale allowance cannot silently produce a one-step flow that reverts.
 */
export function prepareOwnerAction(context: PrepareContext, action: OwnerAction): PreparedStep {
  switch (action.action) {
    case 'DEPOSIT': {
      const amount = parseUIntString(action.amountAtomic);
      const data = encodeFunctionData({
        abi: PAYGUARD_VAULT_ABI,
        functionName: 'deposit',
        args: [action.token, amount],
      }) as HexBytes;
      const decoded = decodeVaultCall(data);
      return {
        stepKind: 'DEPOSIT',
        transaction: unsignedTransaction({
          chainId: context.chainId,
          from: context.ownerAddress,
          to: context.vaultAddress,
          data,
        }),
        review: {
          call: decoded.functionName,
          token: decoded.args[0] as Address,
          amountAtomic: (decoded.args[1] as bigint).toString(10),
        },
      };
    }
    case 'WITHDRAW': {
      const amount = parseUIntString(action.amountAtomic);
      const data = encodeFunctionData({
        abi: PAYGUARD_VAULT_ABI,
        functionName: 'withdraw',
        args: [action.token, amount, action.recipient],
      }) as HexBytes;
      const decoded = decodeVaultCall(data);
      return {
        stepKind: 'WITHDRAW',
        transaction: unsignedTransaction({
          chainId: context.chainId,
          from: context.ownerAddress,
          to: context.vaultAddress,
          data,
        }),
        review: {
          call: decoded.functionName,
          token: decoded.args[0] as Address,
          amountAtomic: (decoded.args[1] as bigint).toString(10),
          recipient: decoded.args[2] as Address,
        },
      };
    }
    case 'REVOKE_AGENT': {
      const data = encodeFunctionData({
        abi: PAYGUARD_VAULT_ABI,
        functionName: 'revokeAgent',
        args: [action.agent],
      }) as HexBytes;
      const decoded = decodeVaultCall(data);
      return {
        stepKind: 'REVOKE_AGENT',
        transaction: unsignedTransaction({
          chainId: context.chainId,
          from: context.ownerAddress,
          to: context.vaultAddress,
          data,
        }),
        review: { call: decoded.functionName, agent: decoded.args[0] as Address, terminal: true },
      };
    }
    case 'SET_EXECUTION_PAUSED': {
      const data = encodeFunctionData({
        abi: PAYGUARD_VAULT_ABI,
        functionName: 'setExecutionPaused',
        args: [action.paused],
      }) as HexBytes;
      const decoded = decodeVaultCall(data);
      return {
        stepKind: 'SET_EXECUTION_PAUSED',
        transaction: unsignedTransaction({
          chainId: context.chainId,
          from: context.ownerAddress,
          to: context.vaultAddress,
          data,
        }),
        review: {
          call: decoded.functionName,
          paused: decoded.args[0] as boolean,
          // Explicit so a reviewer sees the pause does NOT disable owner withdrawal/revocation.
          doesNotAffect: ['withdraw', 'revokePolicy', 'revokeAgent', 'cancelApprovalNonce'],
        },
      };
    }
    case 'CANCEL_APPROVAL_NONCE': {
      const nonce = parseUIntString(action.nonce);
      const data = encodeFunctionData({
        abi: PAYGUARD_VAULT_ABI,
        functionName: 'cancelApprovalNonce',
        args: [nonce],
      }) as HexBytes;
      const decoded = decodeVaultCall(data);
      return {
        stepKind: 'CANCEL_APPROVAL_NONCE',
        transaction: unsignedTransaction({
          chainId: context.chainId,
          from: context.ownerAddress,
          to: context.vaultAddress,
          data,
        }),
        review: { call: decoded.functionName, nonce: (decoded.args[0] as bigint).toString(10) },
      };
    }
  }
}

/** Encodes the real `createPolicy(config, merchants)` owner call from a compiled draft. */
export function prepareCreatePolicy(
  context: PrepareContext,
  config: PolicyConfig,
  merchants: readonly MerchantPermission[],
): PreparedStep {
  const data = encodeFunctionData({
    abi: PAYGUARD_VAULT_ABI,
    functionName: 'createPolicy',
    args: [toAbiPolicyConfig(config), toAbiMerchants(merchants)],
  }) as HexBytes;
  const decoded = decodeVaultCall(data);
  return {
    stepKind: 'CREATE_POLICY',
    transaction: unsignedTransaction({
      chainId: context.chainId,
      from: context.ownerAddress,
      to: context.vaultAddress,
      data,
    }),
    review: {
      call: decoded.functionName,
      config: fromAbiPolicyConfig(decoded.args[0] as AbiPolicyConfig),
      merchants: fromAbiMerchants(decoded.args[1] as readonly AbiMerchantPermission[]),
    },
  };
}

export function prepareRevokePolicy(
  context: PrepareContext,
  onchainPolicyId: Hash32,
): PreparedStep {
  const data = encodeFunctionData({
    abi: PAYGUARD_VAULT_ABI,
    functionName: 'revokePolicy',
    args: [onchainPolicyId],
  }) as HexBytes;
  const decoded = decodeVaultCall(data);
  return {
    stepKind: 'REVOKE_POLICY',
    transaction: unsignedTransaction({
      chainId: context.chainId,
      from: context.ownerAddress,
      to: context.vaultAddress,
      data,
    }),
    review: { call: decoded.functionName, onchainPolicyId: decoded.args[0] as Hash32 },
  };
}
