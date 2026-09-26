/**
 * Reusable receipt / transaction validation. Shared by the Stage 4 API (chain-observation intake)
 * and exported for the Stage 5 worker so both judge "did this transaction really do what we
 * expect?" by exactly the same rules.
 *
 * The rule this module enforces, from CLAUDE.md and API_CONTRACT.md: a successful receipt is NOT
 * by itself evidence of a PayGuard outcome. "A successful transaction receipt for a different
 * contract or a recordAttempt call is not a PayGuard payment success." So every check is explicit
 * and independently reported -- chain, status, destination, sender, calldata, event emitter,
 * resource binding, and (for policy activation) the actual configuration, not just its hash.
 *
 * Nothing here polls or waits. Callers pass a receipt they already have.
 */

import type { Address, Hash32, HexBytes, PolicyConfig, UIntString } from '@payguard/domain';
import { decodeEventLog, encodeAbiParameters, keccak256, type Log, parseAbiParameters } from 'viem';
import { PAYGUARD_VAULT_ABI } from './generated/abi.js';
import { toAbiPolicyConfig } from './structs.js';

export interface ReceiptLike {
  status: 'success' | 'reverted';
  transactionHash: Hash32;
  blockNumber: bigint;
  blockHash: Hash32;
  from: Address;
  to: Address | null;
  logs: readonly Log[];
}

export interface TransactionLike {
  chainId?: number;
  from: Address;
  to: Address | null;
  input: HexBytes;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ValidationOutcome {
  valid: boolean;
  checks: CheckResult[];
  failed: CheckResult[];
}

function check(name: string, passed: boolean, detail: string): CheckResult {
  return { name, passed, detail };
}

function outcome(checks: CheckResult[]): ValidationOutcome {
  const failed = checks.filter((c) => !c.passed);
  return { valid: failed.length === 0, checks, failed };
}

function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

export interface BaseExpectation {
  /** The chain the observation must belong to. A right-looking tx on another chain is invalid. */
  expectedChainId: UIntString;
  /** Contract the transaction must target. */
  expectedTo: Address;
  /** Required only where the caller's identity is part of the authorization story. */
  expectedFrom?: Address;
  /** When supplied, the transaction input must match these exact bytes. */
  expectedCalldata?: HexBytes;
}

/** Chain/status/destination/sender/calldata checks shared by every observation kind. */
export function validateTransactionShape(
  receipt: ReceiptLike,
  transaction: TransactionLike,
  expectation: BaseExpectation,
): CheckResult[] {
  const checks: CheckResult[] = [];

  checks.push(check('receipt.status', receipt.status === 'success', `status=${receipt.status}`));

  if (transaction.chainId !== undefined) {
    checks.push(
      check(
        'chainId',
        transaction.chainId.toString(10) === expectation.expectedChainId,
        `observed=${transaction.chainId} expected=${expectation.expectedChainId}`,
      ),
    );
  }

  checks.push(
    check(
      'transaction.to',
      sameAddress(transaction.to, expectation.expectedTo),
      `observed=${transaction.to} expected=${expectation.expectedTo}`,
    ),
  );

  if (expectation.expectedFrom !== undefined) {
    checks.push(
      check(
        'transaction.from',
        sameAddress(transaction.from, expectation.expectedFrom),
        `observed=${transaction.from} expected=${expectation.expectedFrom}`,
      ),
    );
  }

  if (expectation.expectedCalldata !== undefined) {
    checks.push(
      check(
        'transaction.calldata',
        transaction.input.toLowerCase() === expectation.expectedCalldata.toLowerCase(),
        'exact calldata comparison',
      ),
    );
  }

  return checks;
}

export interface DecodedVaultEvent {
  eventName: string;
  args: Record<string, unknown>;
  emitter: Address;
  logIndex: number;
}

/**
 * Decodes only those logs actually emitted BY the expected vault. A log with the right shape from
 * the wrong emitter is ignored, which is what stops an unrelated contract from impersonating a
 * PayGuard event (CLAUDE.md: "a log with the wrong emitter cannot prove settlement").
 */
export function decodeVaultEvents(
  receipt: ReceiptLike,
  expectedEmitter: Address,
): DecodedVaultEvent[] {
  const events: DecodedVaultEvent[] = [];
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, expectedEmitter)) continue;
    try {
      const decoded = decodeEventLog({
        abi: PAYGUARD_VAULT_ABI,
        data: log.data,
        topics: log.topics,
      });
      events.push({
        eventName: decoded.eventName as string,
        args: (decoded.args ?? {}) as Record<string, unknown>,
        emitter: log.address as Address,
        logIndex: Number(log.logIndex ?? 0),
      });
    } catch {
      // Not a vault event we know; ignore rather than guess.
    }
  }
  return events;
}

/** The vault's own derivation: `keccak256(abi.encode(config))` (PayGuardVault.sol:145). */
export function computePolicyConfigHash(config: PolicyConfig): Hash32 {
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
  return keccak256(encoded) as Hash32;
}

export interface PolicyCreationExpectation extends BaseExpectation {
  /** The vault that must have emitted PolicyCreated. */
  expectedVault: Address;
  /** The configuration the draft actually compiled to. */
  expectedConfig: PolicyConfig;
  /**
   * The on-chain config read back via `getPolicy(policyId)`. Supplying it is what turns this from
   * "the hash matched" into "the stored configuration really is what we expect" -- the stage
   * instruction forbids activating a policy from a configHash alone.
   */
  onChainConfig?: PolicyConfig;
}

export interface PolicyCreationResult extends ValidationOutcome {
  onchainPolicyId: Hash32 | null;
  agent: Address | null;
  configHash: Hash32 | null;
}

/**
 * Validates that a receipt really created the policy a draft describes. Returns the discovered
 * on-chain policy id only when every check passes; a caller must not activate anything otherwise.
 */
export function validatePolicyCreation(
  receipt: ReceiptLike,
  transaction: TransactionLike,
  expectation: PolicyCreationExpectation,
): PolicyCreationResult {
  const checks = validateTransactionShape(receipt, transaction, expectation);

  const events = decodeVaultEvents(receipt, expectation.expectedVault);
  const created = events.find((e) => e.eventName === 'PolicyCreated');
  checks.push(
    check(
      'event.PolicyCreated',
      created !== undefined,
      created ? `emitter=${created.emitter}` : 'no PolicyCreated log from the expected vault',
    ),
  );

  if (!created) {
    return { ...outcome(checks), onchainPolicyId: null, agent: null, configHash: null };
  }

  const onchainPolicyId = (created.args.policyId as Hash32) ?? null;
  const agent = (created.args.agent as Address) ?? null;
  const configHash = (created.args.configHash as Hash32) ?? null;

  const expectedConfigHash = computePolicyConfigHash(expectation.expectedConfig);
  checks.push(
    check(
      'event.configHash',
      configHash !== null && configHash.toLowerCase() === expectedConfigHash.toLowerCase(),
      `observed=${configHash} expected=${expectedConfigHash}`,
    ),
  );

  checks.push(
    check(
      'event.agent',
      sameAddress(agent, expectation.expectedConfig.agent),
      `observed=${agent} expected=${expectation.expectedConfig.agent}`,
    ),
  );

  // The configHash proves the emitted bytes; reading the stored config proves what the contract
  // actually kept. Both are required before a policy is treated as active.
  if (expectation.onChainConfig !== undefined) {
    const storedHash = computePolicyConfigHash(expectation.onChainConfig);
    checks.push(
      check(
        'chain.getPolicy matches expected config',
        storedHash.toLowerCase() === expectedConfigHash.toLowerCase(),
        `stored=${storedHash} expected=${expectedConfigHash}`,
      ),
    );
  } else {
    checks.push(
      check(
        'chain.getPolicy matches expected config',
        false,
        'on-chain configuration was not supplied; a configHash alone cannot activate a policy',
      ),
    );
  }

  return { ...outcome(checks), onchainPolicyId, agent, configHash };
}

export interface PaymentExecutionExpectation extends BaseExpectation {
  expectedVault: Address;
  expectedIntentHash: Hash32;
  expectedMerchant: Address;
  expectedOutputToken: Address;
  expectedExactOutput: UIntString;
  expectedMaxInput: UIntString;
  expectedRouteId: Hash32;
}

export interface PaymentExecutionResult extends ValidationOutcome {
  actualInputAtomic: UIntString | null;
  outputDeliveredAtomic: UIntString | null;
  subsidyAmountAtomic: UIntString | null;
}

/**
 * Validates a PaymentExecuted observation against the authorized intent. Exported now because the
 * Stage 5 worker needs exactly these checks; the Stage 4 API only ever reaches it through a
 * queued observation, never to assert a payment succeeded.
 */
export function validatePaymentExecution(
  receipt: ReceiptLike,
  transaction: TransactionLike,
  expectation: PaymentExecutionExpectation,
): PaymentExecutionResult {
  const checks = validateTransactionShape(receipt, transaction, expectation);
  const events = decodeVaultEvents(receipt, expectation.expectedVault);
  const executed = events.find((e) => e.eventName === 'PaymentExecuted');

  checks.push(
    check(
      'event.PaymentExecuted',
      executed !== undefined,
      executed ? `emitter=${executed.emitter}` : 'no PaymentExecuted log from the expected vault',
    ),
  );
  if (!executed) {
    return {
      ...outcome(checks),
      actualInputAtomic: null,
      outputDeliveredAtomic: null,
      subsidyAmountAtomic: null,
    };
  }

  const intentHash = executed.args.intentHash as Hash32;
  const merchant = executed.args.merchant as Address;
  const outputToken = executed.args.outputToken as Address;
  const exactOutput = executed.args.exactOutput as bigint;
  const actualInput = executed.args.actualInput as bigint;
  const routeId = executed.args.routeId as Hash32;
  const subsidyAmount = executed.args.subsidyAmount as bigint;

  checks.push(
    check(
      'event.intentHash',
      intentHash?.toLowerCase() === expectation.expectedIntentHash.toLowerCase(),
      `observed=${intentHash} expected=${expectation.expectedIntentHash}`,
    ),
  );
  checks.push(
    check(
      'event.merchant',
      sameAddress(merchant, expectation.expectedMerchant),
      `observed=${merchant} expected=${expectation.expectedMerchant}`,
    ),
  );
  checks.push(
    check(
      'event.outputToken',
      sameAddress(outputToken, expectation.expectedOutputToken),
      `observed=${outputToken} expected=${expectation.expectedOutputToken}`,
    ),
  );
  checks.push(
    check(
      'event.exactOutput',
      exactOutput?.toString(10) === expectation.expectedExactOutput,
      `observed=${exactOutput} expected=${expectation.expectedExactOutput}`,
    ),
  );
  checks.push(
    check(
      'event.routeId',
      routeId?.toLowerCase() === expectation.expectedRouteId.toLowerCase(),
      `observed=${routeId} expected=${expectation.expectedRouteId}`,
    ),
  );
  // Input is bounded by what was signed, never merely "some input happened".
  checks.push(
    check(
      'event.actualInput within signed ceiling',
      actualInput !== undefined &&
        actualInput > 0n &&
        actualInput <= BigInt(expectation.expectedMaxInput),
      `observed=${actualInput} ceiling=${expectation.expectedMaxInput}`,
    ),
  );

  return {
    ...outcome(checks),
    actualInputAtomic: actualInput?.toString(10) ?? null,
    outputDeliveredAtomic: exactOutput?.toString(10) ?? null,
    subsidyAmountAtomic: subsidyAmount?.toString(10) ?? null,
  };
}
