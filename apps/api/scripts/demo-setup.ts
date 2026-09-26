/**
 * B2 demo bridge: local-only operator provisioning script (docs/PAYGUARD_INTEGRATION_BOUNDARY.md
 * section 5, docs/implementation/checkpoints/B2.md).
 *
 * This is the ONLY place the vault owner's private key exists in the whole demo pipeline -- it is
 * read here (via `@payguard/test-utils`'s well-known local Anvil dev key #0, deliberately never a
 * real credential) to deploy the vault and sign the one on-chain `createPolicy` transaction, then
 * this process exits. The running API/worker never import this file and never see this key; their
 * own `PAYGUARD_DEMO_ENABLED` config only holds the SEPARATE, low-value agent/merchant/
 * unauthorized-merchant demo signing keys used at request time.
 *
 * `provisionFreshDemoDeployment` (exported) does the actual chain-deploy + DB-seed work and is
 * reused verbatim by `demo-reset.ts` for an explicit destructive reset -- the only difference
 * between "setup" and "reset" is which instance_label they provision under and whether an
 * existing one is reused. Safe to rerun as `demo-setup`: if a deployment row already exists under
 * `PAYGUARD_DEMO_INSTANCE_LABEL` and its vault still has live on-chain code, this prints the
 * existing identifiers and exits without reseeding, redeploying, or touching any existing
 * payment.
 *
 * Run: `pnpm --filter @payguard/api exec tsx scripts/demo-setup.ts` (or `./scripts/payguard
 * demo:setup`), against a running local Anvil (`RPC_URL`, default http://127.0.0.1:8545) and a
 * migrated local Postgres (`DATABASE_URL`).
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAYGUARD_VAULT_ABI, prepareCreatePolicy } from '@payguard/chain';
import {
  createDeployment,
  createPool,
  createVault,
  findOrCreateWallet,
  getPoliciesByVault,
  getVaultsByDeployment,
  insertPolicyMerchants,
  recordObservedPolicy,
  withTransaction,
} from '@payguard/db';
import {
  deployAquaVaultFixture,
  deployV4VaultFixture,
  deployVaultFixture,
  mintTokens,
} from '@payguard/test-utils';
import type pg from 'pg';
import { createPublicClient, decodeEventLog, http, keccak256 } from 'viem';

const repoEnvPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (existsSync(repoEnvPath)) process.loadEnvFile(repoEnvPath);

export const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
export const CHAIN_ID = 31337;
export const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://payguard:payguard_local_dev@127.0.0.1:5432/payguard_dev';
const DEPOSIT_AMOUNT_ATOMIC = 500_000_000n; // 500 mUSDC @ 6 decimals

// Matches docs/PAYGUARD_ACCEPTANCE_AND_DEMO.md's narrative budgets: compute (0.50 mUSDC) stays
// under the automatic cap -> ALLOW; hotel (180 mUSDC) exceeds it but not the escalation cap ->
// ESCALATE; over_budget (500 mUSDC) exceeds the total budget -> BLOCK. One policy serves every
// catalog scenario (apps/api/src/demo/catalog.ts).
const DEMO_BUDGET = {
  totalOutputBudget: 300_000_000n,
  epochOutputBudget: 300_000_000n,
  automaticOutputCap: 100_000_000n,
  escalationOutputCap: 200_000_000n,
  totalInputBudget: 300_000_000n,
  maxInputPerPayment: 300_000_000n,
};

// B3: same output-side (mUSDC) budgets as DEMO_BUDGET, but input exposure is in mRWA (18
// decimals) -- a generous ceiling well above what any catalog scenario's real v4 swap needs.
const V4_DEMO_BUDGET = {
  ...DEMO_BUDGET,
  totalInputBudget: 1_000_000_000000000000000000n, // 1e6 * 1e18
  maxInputPerPayment: 500_000_000000000000000000n, // 5e5 * 1e18
};
const V4_DEPOSIT_AMOUNT_ATOMIC = 1_000_000_000000000000000000n; // 1e6 mRWA, matches the input budget headroom

// B4: the Aqua/SwapVM route's own budgets -- both tokens 18dp (TokenMock default), so output-side
// budgets are scaled up to match the invoice sizes used in the compute/hotel/over_budget catalog
// narrative (0.50/180/500 mUSDC-equivalent at 6dp becomes 500e18/180000e18/500000e18 at 18dp).
const AQUA_DEMO_BUDGET = {
  totalOutputBudget: 300_000_000000000000000000n, // 300_000e18
  epochOutputBudget: 300_000_000000000000000000n,
  automaticOutputCap: 100_000_000000000000000000n,
  escalationOutputCap: 200_000_000000000000000000n,
  totalInputBudget: 1_000_000_000000000000000000n, // generous input ceiling, same as V4_DEMO_BUDGET
  maxInputPerPayment: 500_000_000000000000000000n,
};
const AQUA_DEPOSIT_AMOUNT_ATOMIC = 1_000_000_000000000000000000n; // 1e6 aqInput, matches the input budget headroom

export interface ProvisionedDemoDeployment {
  deploymentId: string;
  vaultId: string;
  policyId: string;
  vaultAddress: `0x${string}`;
  agentAddress: `0x${string}`;
  merchantAddress: `0x${string}`;
  unauthorizedMerchantAddress: `0x${string}`;
  /** B3: the real v4 fixed-pool route's own vault/policy -- null only if v4 provisioning itself failed. */
  v4: {
    vaultId: string;
    policyId: string;
    vaultAddress: `0x${string}`;
    adapterAddress: `0x${string}`;
    poolManagerAddress: `0x${string}`;
    routeId: `0x${string}`;
  };
  /** B4: the real Aqua/SwapVM maker-liquidation route's own vault/policy. */
  aqua: {
    vaultId: string;
    policyId: string;
    vaultAddress: `0x${string}`;
    adapterAddress: `0x${string}`;
    aquaAddress: `0x${string}`;
    routerAddress: `0x${string}`;
    routeId: `0x${string}`;
    strategyHash: `0x${string}`;
  };
}

/**
 * Deploys a fresh vault + mock token, records one demo policy covering every catalog scenario,
 * and deposits owner funds -- under the given `instanceLabel`, unconditionally (no idempotency
 * check here; the caller decides whether reuse is appropriate).
 */
export async function provisionFreshDemoDeployment(
  pool: pg.Pool,
  instanceLabel: string,
): Promise<ProvisionedDemoDeployment> {
  // The owner's private key lives ONLY inside `deployVaultFixture`/`deployV4VaultFixture`'s
  // local Anvil dev-key constants, read here and nowhere else in this pipeline.
  const fixture = await deployVaultFixture({ rpcUrl: RPC_URL, chainId: CHAIN_ID });
  // B3: a second, real Uniswap v4 fixed-pool exact-output route, its own fresh vault (the
  // direct-route vault's supportedTokenMap is immutable and mUSDC-only) under the SAME
  // deployment -- one owner, two selectable demo profiles.
  const v4Fixture = await deployV4VaultFixture({ rpcUrl: RPC_URL, chainId: CHAIN_ID });
  // B4: a third, real 1inch Aqua/SwapVM maker-liquidation route, its own fresh vault, under the
  // SAME deployment -- one owner, three selectable demo profiles (direct/v4/Aqua).
  const aquaFixture = await deployAquaVaultFixture({ rpcUrl: RPC_URL, chainId: CHAIN_ID });

  const deploymentId = randomUUID();
  const vaultId = randomUUID();
  const walletId = randomUUID();
  const v4VaultId = randomUUID();
  const aquaVaultId = randomUUID();
  const merchantId =
    `0x${keccak256(new TextEncoder().encode(`payguard-demo-merchant:${instanceLabel}`)).slice(2)}` as `0x${string}`;
  const v4MerchantId =
    `0x${keccak256(new TextEncoder().encode(`payguard-demo-v4-merchant:${instanceLabel}`)).slice(2)}` as `0x${string}`;
  const aquaMerchantId =
    `0x${keccak256(new TextEncoder().encode(`payguard-demo-aqua-merchant:${instanceLabel}`)).slice(2)}` as `0x${string}`;

  await withTransaction(pool, async (client) => {
    await createDeployment(client, {
      id: deploymentId,
      chainId: BigInt(CHAIN_ID),
      instanceLabel,
      environment: 'LOCAL_DEMO',
      startBlock: 0n,
      genesisOrAnchorHash: Buffer.alloc(32, 1),
      configuration: {
        tokens: [
          { address: fixture.tokenAddress, symbol: 'mUSDC', decimals: 6, isMock: true },
          { address: v4Fixture.usdcAddress, symbol: 'mUSDC', decimals: 6, isMock: true },
          { address: v4Fixture.rwaAddress, symbol: 'mRWA', decimals: 18, isMock: true },
          { address: aquaFixture.aqInputAddress, symbol: 'AQIN', decimals: 18, isMock: true },
          { address: aquaFixture.aqOutputAddress, symbol: 'AQOUT', decimals: 18, isMock: true },
        ],
        routes: [
          {
            routeId: `0x${'0'.repeat(64)}`,
            adapter: '0x0000000000000000000000000000000000000000',
            kind: 'DIRECT',
            inputToken: fixture.tokenAddress,
            outputToken: fixture.tokenAddress,
            subsidyModes: ['NONE'],
            enabled: true,
          },
          {
            routeId: v4Fixture.v4RouteId,
            adapter: v4Fixture.v4AdapterAddress,
            kind: 'UNISWAP_V4',
            inputToken: v4Fixture.rwaAddress,
            outputToken: v4Fixture.usdcAddress,
            subsidyModes: ['NONE'],
            enabled: true,
          },
          {
            routeId: aquaFixture.aquaRouteId,
            adapter: aquaFixture.aquaAdapterAddress,
            kind: 'AQUA',
            inputToken: aquaFixture.aqInputAddress,
            outputToken: aquaFixture.aqOutputAddress,
            subsidyModes: ['NONE'],
            enabled: true,
          },
        ],
        confidencePolicy: { mode: 'LOCAL_DEMO', confirmationDepth: null },
      },
    });
    const wallet = await findOrCreateWallet(client, {
      id: walletId,
      address: Buffer.from(fixture.ownerAccount.address.slice(2), 'hex'),
    });
    const deployedCode = await fixture.publicClient.getCode({ address: fixture.vaultAddress });
    if (!deployedCode)
      throw new Error('demo-setup: no code observed at freshly deployed vault address');
    await createVault(client, {
      id: vaultId,
      deploymentId,
      ownerWalletId: wallet.id,
      address: Buffer.from(fixture.vaultAddress.slice(2), 'hex'),
      runtimeCodeHash: Buffer.from(keccak256(deployedCode).slice(2), 'hex'),
      abiSchemaVersion: '1',
    });

    const v4DeployedCode = await v4Fixture.publicClient.getCode({
      address: v4Fixture.vaultAddress,
    });
    if (!v4DeployedCode)
      throw new Error('demo-setup: no code observed at freshly deployed v4 vault address');
    await createVault(client, {
      id: v4VaultId,
      deploymentId,
      ownerWalletId: wallet.id,
      address: Buffer.from(v4Fixture.vaultAddress.slice(2), 'hex'),
      runtimeCodeHash: Buffer.from(keccak256(v4DeployedCode).slice(2), 'hex'),
      abiSchemaVersion: '1',
    });

    const aquaDeployedCode = await aquaFixture.publicClient.getCode({
      address: aquaFixture.vaultAddress,
    });
    if (!aquaDeployedCode)
      throw new Error('demo-setup: no code observed at freshly deployed Aqua vault address');
    await createVault(client, {
      id: aquaVaultId,
      deploymentId,
      ownerWalletId: wallet.id,
      address: Buffer.from(aquaFixture.vaultAddress.slice(2), 'hex'),
      runtimeCodeHash: Buffer.from(keccak256(aquaDeployedCode).slice(2), 'hex'),
      abiSchemaVersion: '1',
    });
  });

  const policyConfig = {
    agent: fixture.agentAccount.address,
    inputToken: fixture.tokenAddress,
    settlementToken: fixture.tokenAddress,
    adapter: '0x0000000000000000000000000000000000000000' as const,
    routeId: `0x${'0'.repeat(64)}` as const,
    totalOutputBudget: DEMO_BUDGET.totalOutputBudget.toString(10),
    epochOutputBudget: DEMO_BUDGET.epochOutputBudget.toString(10),
    automaticOutputCap: DEMO_BUDGET.automaticOutputCap.toString(10),
    escalationOutputCap: DEMO_BUDGET.escalationOutputCap.toString(10),
    totalInputBudget: DEMO_BUDGET.totalInputBudget.toString(10),
    maxInputPerPayment: DEMO_BUDGET.maxInputPerPayment.toString(10),
    validAfter: '0',
    validUntil: '99999999999',
    allowedCategoryBitmap: '1',
    subsidyMode: 'NONE' as const,
  };
  const prepared = prepareCreatePolicy(
    {
      chainId: String(CHAIN_ID),
      ownerAddress: fixture.ownerAccount.address,
      vaultAddress: fixture.vaultAddress,
    },
    // biome-ignore lint/suspicious/noExplicitAny: fixture shape matches PolicyConfig exactly
    policyConfig as any,
    [
      {
        merchantId,
        recipient: fixture.merchantAccount.address,
        invoiceSigner: fixture.merchantAccount.address,
        category: '0',
      },
    ] as never,
  );
  const createPolicyHash = await fixture.ownerWalletClient.sendTransaction({
    to: prepared.transaction.to as `0x${string}`,
    data: prepared.transaction.data as `0x${string}`,
    value: 0n,
    chain: null,
    account: fixture.ownerAccount,
  });
  const receipt = await fixture.publicClient.waitForTransactionReceipt({ hash: createPolicyHash });
  let onchainPolicyId: `0x${string}` | null = null;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: PAYGUARD_VAULT_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'PolicyCreated') {
        onchainPolicyId = (decoded.args as { policyId: `0x${string}` }).policyId;
      }
    } catch {
      // not this event
    }
  }
  if (!onchainPolicyId)
    throw new Error('demo-setup: PolicyCreated event not found in receipt logs');

  const policyId = randomUUID();
  await withTransaction(pool, async (client) => {
    await recordObservedPolicy(client, {
      id: policyId,
      vaultId,
      onchainPolicyId: Buffer.from((onchainPolicyId as `0x${string}`).slice(2), 'hex'),
      agent: Buffer.from(policyConfig.agent.slice(2), 'hex'),
      inputToken: Buffer.from(policyConfig.inputToken.slice(2), 'hex'),
      settlementToken: Buffer.from(policyConfig.settlementToken.slice(2), 'hex'),
      adapter: Buffer.from(policyConfig.adapter.slice(2), 'hex'),
      routeId: Buffer.from(policyConfig.routeId.slice(2), 'hex'),
      totalOutputBudget: DEMO_BUDGET.totalOutputBudget,
      epochOutputBudget: DEMO_BUDGET.epochOutputBudget,
      automaticOutputCap: DEMO_BUDGET.automaticOutputCap,
      escalationOutputCap: DEMO_BUDGET.escalationOutputCap,
      totalInputBudget: DEMO_BUDGET.totalInputBudget,
      maxInputPerPayment: DEMO_BUDGET.maxInputPerPayment,
      validAfter: 0n,
      validUntil: 99999999999n,
      subsidyMode: 0,
      canonicalConfigBytes: Buffer.alloc(32),
      configProjection: policyConfig,
      observedStatus: 'ACTIVE',
      observedBlockHash: Buffer.from(receipt.blockHash.slice(2), 'hex'),
    });
    await insertPolicyMerchants(client, {
      policyId,
      merchants: [
        {
          merchantId: Buffer.from(merchantId.slice(2), 'hex'),
          recipient: Buffer.from(fixture.merchantAccount.address.slice(2), 'hex'),
          invoiceSigner: Buffer.from(fixture.merchantAccount.address.slice(2), 'hex'),
          category: 0,
        },
      ],
    });
  });

  await mintTokens(fixture, fixture.ownerAccount.address, DEPOSIT_AMOUNT_ATOMIC);
  const approveHash = await fixture.ownerWalletClient.writeContract({
    address: fixture.tokenAddress,
    abi: fixture.erc20Abi,
    functionName: 'approve',
    args: [fixture.vaultAddress, DEPOSIT_AMOUNT_ATOMIC],
    chain: null,
    account: fixture.ownerAccount,
  } as never);
  await fixture.publicClient.waitForTransactionReceipt({ hash: approveHash });
  const depositHash = await fixture.ownerWalletClient.writeContract({
    address: fixture.vaultAddress,
    abi: PAYGUARD_VAULT_ABI,
    functionName: 'deposit',
    args: [fixture.tokenAddress, DEPOSIT_AMOUNT_ATOMIC],
    chain: null,
    account: fixture.ownerAccount,
  } as never);
  await fixture.publicClient.waitForTransactionReceipt({ hash: depositHash });

  // ---- B3: the real v4 fixed-pool route's own policy, on its own fresh vault -----------------
  const v4PolicyConfig = {
    agent: v4Fixture.agentAccount.address,
    inputToken: v4Fixture.rwaAddress,
    settlementToken: v4Fixture.usdcAddress,
    adapter: v4Fixture.v4AdapterAddress,
    routeId: v4Fixture.v4RouteId,
    totalOutputBudget: V4_DEMO_BUDGET.totalOutputBudget.toString(10),
    epochOutputBudget: V4_DEMO_BUDGET.epochOutputBudget.toString(10),
    automaticOutputCap: V4_DEMO_BUDGET.automaticOutputCap.toString(10),
    escalationOutputCap: V4_DEMO_BUDGET.escalationOutputCap.toString(10),
    totalInputBudget: V4_DEMO_BUDGET.totalInputBudget.toString(10),
    maxInputPerPayment: V4_DEMO_BUDGET.maxInputPerPayment.toString(10),
    validAfter: '0',
    validUntil: '99999999999',
    allowedCategoryBitmap: '1',
    subsidyMode: 'NONE' as const,
  };
  const v4Prepared = prepareCreatePolicy(
    {
      chainId: String(CHAIN_ID),
      ownerAddress: v4Fixture.ownerAccount.address,
      vaultAddress: v4Fixture.vaultAddress,
    },
    // biome-ignore lint/suspicious/noExplicitAny: fixture shape matches PolicyConfig exactly
    v4PolicyConfig as any,
    [
      {
        merchantId: v4MerchantId,
        recipient: v4Fixture.merchantAccount.address,
        invoiceSigner: v4Fixture.merchantAccount.address,
        category: '0',
      },
    ] as never,
  );
  const v4CreatePolicyHash = await v4Fixture.ownerWalletClient.sendTransaction({
    to: v4Prepared.transaction.to as `0x${string}`,
    data: v4Prepared.transaction.data as `0x${string}`,
    value: 0n,
    chain: null,
    account: v4Fixture.ownerAccount,
  });
  const v4Receipt = await v4Fixture.publicClient.waitForTransactionReceipt({
    hash: v4CreatePolicyHash,
  });
  let v4OnchainPolicyId: `0x${string}` | null = null;
  for (const log of v4Receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: v4Fixture.vaultAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'PolicyCreated') {
        v4OnchainPolicyId = (decoded.args as { policyId: `0x${string}` }).policyId;
      }
    } catch {
      // not this event
    }
  }
  if (!v4OnchainPolicyId)
    throw new Error('demo-setup: v4 PolicyCreated event not found in receipt logs');

  const v4PolicyId = randomUUID();
  await withTransaction(pool, async (client) => {
    await recordObservedPolicy(client, {
      id: v4PolicyId,
      vaultId: v4VaultId,
      onchainPolicyId: Buffer.from((v4OnchainPolicyId as `0x${string}`).slice(2), 'hex'),
      agent: Buffer.from(v4PolicyConfig.agent.slice(2), 'hex'),
      inputToken: Buffer.from(v4PolicyConfig.inputToken.slice(2), 'hex'),
      settlementToken: Buffer.from(v4PolicyConfig.settlementToken.slice(2), 'hex'),
      adapter: Buffer.from(v4PolicyConfig.adapter.slice(2), 'hex'),
      routeId: Buffer.from(v4PolicyConfig.routeId.slice(2), 'hex'),
      totalOutputBudget: V4_DEMO_BUDGET.totalOutputBudget,
      epochOutputBudget: V4_DEMO_BUDGET.epochOutputBudget,
      automaticOutputCap: V4_DEMO_BUDGET.automaticOutputCap,
      escalationOutputCap: V4_DEMO_BUDGET.escalationOutputCap,
      totalInputBudget: V4_DEMO_BUDGET.totalInputBudget,
      maxInputPerPayment: V4_DEMO_BUDGET.maxInputPerPayment,
      validAfter: 0n,
      validUntil: 99999999999n,
      subsidyMode: 0,
      canonicalConfigBytes: Buffer.alloc(32),
      configProjection: v4PolicyConfig,
      observedStatus: 'ACTIVE',
      observedBlockHash: Buffer.from(v4Receipt.blockHash.slice(2), 'hex'),
    });
    await insertPolicyMerchants(client, {
      policyId: v4PolicyId,
      merchants: [
        {
          merchantId: Buffer.from(v4MerchantId.slice(2), 'hex'),
          recipient: Buffer.from(v4Fixture.merchantAccount.address.slice(2), 'hex'),
          invoiceSigner: Buffer.from(v4Fixture.merchantAccount.address.slice(2), 'hex'),
          category: 0,
        },
      ],
    });
  });

  // Owner deposit: real mRWA (the v4 route's input token) via the real deposit() path.
  const v4MintHash = await v4Fixture.ownerWalletClient.writeContract({
    address: v4Fixture.rwaAddress,
    abi: v4Fixture.erc20Abi,
    functionName: 'mint',
    args: [v4Fixture.ownerAccount.address, V4_DEPOSIT_AMOUNT_ATOMIC],
    chain: null,
    account: v4Fixture.ownerAccount,
  } as never);
  await v4Fixture.publicClient.waitForTransactionReceipt({ hash: v4MintHash });
  const v4ApproveHash = await v4Fixture.ownerWalletClient.writeContract({
    address: v4Fixture.rwaAddress,
    abi: v4Fixture.erc20Abi,
    functionName: 'approve',
    args: [v4Fixture.vaultAddress, V4_DEPOSIT_AMOUNT_ATOMIC],
    chain: null,
    account: v4Fixture.ownerAccount,
  } as never);
  await v4Fixture.publicClient.waitForTransactionReceipt({ hash: v4ApproveHash });
  const v4DepositHash = await v4Fixture.ownerWalletClient.writeContract({
    address: v4Fixture.vaultAddress,
    abi: v4Fixture.vaultAbi,
    functionName: 'deposit',
    args: [v4Fixture.rwaAddress, V4_DEPOSIT_AMOUNT_ATOMIC],
    chain: null,
    account: v4Fixture.ownerAccount,
  } as never);
  await v4Fixture.publicClient.waitForTransactionReceipt({ hash: v4DepositHash });

  // ---- B4: the real Aqua/SwapVM route's own policy, on its own fresh vault -------------------
  const aquaPolicyConfig = {
    agent: aquaFixture.agentAccount.address,
    inputToken: aquaFixture.aqInputAddress,
    settlementToken: aquaFixture.aqOutputAddress,
    adapter: aquaFixture.aquaAdapterAddress,
    routeId: aquaFixture.aquaRouteId,
    totalOutputBudget: AQUA_DEMO_BUDGET.totalOutputBudget.toString(10),
    epochOutputBudget: AQUA_DEMO_BUDGET.epochOutputBudget.toString(10),
    automaticOutputCap: AQUA_DEMO_BUDGET.automaticOutputCap.toString(10),
    escalationOutputCap: AQUA_DEMO_BUDGET.escalationOutputCap.toString(10),
    totalInputBudget: AQUA_DEMO_BUDGET.totalInputBudget.toString(10),
    maxInputPerPayment: AQUA_DEMO_BUDGET.maxInputPerPayment.toString(10),
    validAfter: '0',
    validUntil: '99999999999',
    allowedCategoryBitmap: '1',
    subsidyMode: 'NONE' as const,
  };
  const aquaPrepared = prepareCreatePolicy(
    {
      chainId: String(CHAIN_ID),
      ownerAddress: aquaFixture.ownerAccount.address,
      vaultAddress: aquaFixture.vaultAddress,
    },
    // biome-ignore lint/suspicious/noExplicitAny: fixture shape matches PolicyConfig exactly
    aquaPolicyConfig as any,
    [
      {
        merchantId: aquaMerchantId,
        recipient: aquaFixture.merchantAccount.address,
        invoiceSigner: aquaFixture.merchantAccount.address,
        category: '0',
      },
    ] as never,
  );
  const aquaCreatePolicyHash = await aquaFixture.ownerWalletClient.sendTransaction({
    to: aquaPrepared.transaction.to as `0x${string}`,
    data: aquaPrepared.transaction.data as `0x${string}`,
    value: 0n,
    chain: null,
    account: aquaFixture.ownerAccount,
  });
  const aquaReceipt = await aquaFixture.publicClient.waitForTransactionReceipt({
    hash: aquaCreatePolicyHash,
  });
  let aquaOnchainPolicyId: `0x${string}` | null = null;
  for (const log of aquaReceipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: aquaFixture.vaultAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'PolicyCreated') {
        aquaOnchainPolicyId = (decoded.args as { policyId: `0x${string}` }).policyId;
      }
    } catch {
      // not this event
    }
  }
  if (!aquaOnchainPolicyId)
    throw new Error('demo-setup: Aqua PolicyCreated event not found in receipt logs');

  const aquaPolicyId = randomUUID();
  await withTransaction(pool, async (client) => {
    await recordObservedPolicy(client, {
      id: aquaPolicyId,
      vaultId: aquaVaultId,
      onchainPolicyId: Buffer.from((aquaOnchainPolicyId as `0x${string}`).slice(2), 'hex'),
      agent: Buffer.from(aquaPolicyConfig.agent.slice(2), 'hex'),
      inputToken: Buffer.from(aquaPolicyConfig.inputToken.slice(2), 'hex'),
      settlementToken: Buffer.from(aquaPolicyConfig.settlementToken.slice(2), 'hex'),
      adapter: Buffer.from(aquaPolicyConfig.adapter.slice(2), 'hex'),
      routeId: Buffer.from(aquaPolicyConfig.routeId.slice(2), 'hex'),
      totalOutputBudget: AQUA_DEMO_BUDGET.totalOutputBudget,
      epochOutputBudget: AQUA_DEMO_BUDGET.epochOutputBudget,
      automaticOutputCap: AQUA_DEMO_BUDGET.automaticOutputCap,
      escalationOutputCap: AQUA_DEMO_BUDGET.escalationOutputCap,
      totalInputBudget: AQUA_DEMO_BUDGET.totalInputBudget,
      maxInputPerPayment: AQUA_DEMO_BUDGET.maxInputPerPayment,
      validAfter: 0n,
      validUntil: 99999999999n,
      subsidyMode: 0,
      canonicalConfigBytes: Buffer.alloc(32),
      configProjection: aquaPolicyConfig,
      observedStatus: 'ACTIVE',
      observedBlockHash: Buffer.from(aquaReceipt.blockHash.slice(2), 'hex'),
    });
    await insertPolicyMerchants(client, {
      policyId: aquaPolicyId,
      merchants: [
        {
          merchantId: Buffer.from(aquaMerchantId.slice(2), 'hex'),
          recipient: Buffer.from(aquaFixture.merchantAccount.address.slice(2), 'hex'),
          invoiceSigner: Buffer.from(aquaFixture.merchantAccount.address.slice(2), 'hex'),
          category: 0,
        },
      ],
    });
  });

  // Owner deposit: real aqInput (the Aqua route's input token) via the real deposit() path.
  const aquaMintHash = await aquaFixture.ownerWalletClient.writeContract({
    address: aquaFixture.aqInputAddress,
    abi: aquaFixture.erc20Abi,
    functionName: 'mint',
    args: [aquaFixture.ownerAccount.address, AQUA_DEPOSIT_AMOUNT_ATOMIC],
    chain: null,
    account: aquaFixture.ownerAccount,
  } as never);
  await aquaFixture.publicClient.waitForTransactionReceipt({ hash: aquaMintHash });
  const aquaApproveHash = await aquaFixture.ownerWalletClient.writeContract({
    address: aquaFixture.aqInputAddress,
    abi: aquaFixture.erc20Abi,
    functionName: 'approve',
    args: [aquaFixture.vaultAddress, AQUA_DEPOSIT_AMOUNT_ATOMIC],
    chain: null,
    account: aquaFixture.ownerAccount,
  } as never);
  await aquaFixture.publicClient.waitForTransactionReceipt({ hash: aquaApproveHash });
  const aquaDepositHash = await aquaFixture.ownerWalletClient.writeContract({
    address: aquaFixture.vaultAddress,
    abi: aquaFixture.vaultAbi,
    functionName: 'deposit',
    args: [aquaFixture.aqInputAddress, AQUA_DEPOSIT_AMOUNT_ATOMIC],
    chain: null,
    account: aquaFixture.ownerAccount,
  } as never);
  await aquaFixture.publicClient.waitForTransactionReceipt({ hash: aquaDepositHash });

  return {
    deploymentId,
    vaultId,
    policyId,
    vaultAddress: fixture.vaultAddress,
    agentAddress: fixture.agentAccount.address,
    merchantAddress: fixture.merchantAccount.address,
    unauthorizedMerchantAddress: fixture.relayerAccount.address,
    v4: {
      vaultId: v4VaultId,
      policyId: v4PolicyId,
      vaultAddress: v4Fixture.vaultAddress,
      adapterAddress: v4Fixture.v4AdapterAddress,
      poolManagerAddress: v4Fixture.poolManagerAddress,
      routeId: v4Fixture.v4RouteId,
    },
    aqua: {
      vaultId: aquaVaultId,
      policyId: aquaPolicyId,
      vaultAddress: aquaFixture.vaultAddress,
      adapterAddress: aquaFixture.aquaAdapterAddress,
      aquaAddress: aquaFixture.aquaAddress,
      routerAddress: aquaFixture.routerAddress,
      routeId: aquaFixture.aquaRouteId,
      strategyHash: aquaFixture.strategyHash,
    },
  };
}

export function printDemoEnvBlock(deploymentId: string, provisioned: ProvisionedDemoDeployment) {
  console.log('');
  console.log('Set these on the API/worker processes (never a committed file):');
  console.log('');
  console.log(`  PAYGUARD_DEPLOYMENT_ID=${deploymentId}`);
  console.log(`  CHAIN_ID=${CHAIN_ID}`);
  console.log(`  RPC_URL=${RPC_URL}`);
  console.log('  PAYGUARD_DEMO_ENABLED=true');
  console.log(
    '  # Well-known local Anvil dev keys -- never the owner key, never a real credential:',
  );
  console.log(
    '  DEMO_AGENT_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  );
  console.log(
    '  DEMO_MERCHANT_PRIVATE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  );
  console.log(
    '  DEMO_UNAUTHORIZED_MERCHANT_PRIVATE_KEY=<relayer key -- see packages/test-utils/src/vaultFixture.ts RELAYER_PRIVATE_KEY>',
  );
  console.log('');
  console.log(`  vaultId (DB):                ${provisioned.vaultId}`);
  console.log(`  demo profileId (policy id):  ${provisioned.policyId}`);
  console.log(`  vaultAddress:                ${provisioned.vaultAddress}`);
  console.log(`  agentAddress:                ${provisioned.agentAddress}`);
  console.log(`  merchantAddress:             ${provisioned.merchantAddress}`);
  console.log(`  unauthorizedMerchantAddress: ${provisioned.unauthorizedMerchantAddress}`);
  console.log('');
  console.log('  B3 real Uniswap v4 fixed-pool route (a second selectable demo profile):');
  console.log(`    v4 vaultId (DB):       ${provisioned.v4.vaultId}`);
  console.log(`    v4 demo profileId:     ${provisioned.v4.policyId}`);
  console.log(`    v4 vaultAddress:       ${provisioned.v4.vaultAddress}`);
  console.log(`    v4 adapterAddress:     ${provisioned.v4.adapterAddress}`);
  console.log(`    v4 poolManagerAddress: ${provisioned.v4.poolManagerAddress}`);
  console.log(`    v4 routeId:            ${provisioned.v4.routeId}`);
  console.log('');
  console.log(
    '  B4 real 1inch Aqua/SwapVM maker-liquidation route (a third selectable demo profile):',
  );
  console.log(`    aqua vaultId (DB):    ${provisioned.aqua.vaultId}`);
  console.log(`    aqua demo profileId:  ${provisioned.aqua.policyId}`);
  console.log(`    aqua vaultAddress:    ${provisioned.aqua.vaultAddress}`);
  console.log(`    aqua adapterAddress:  ${provisioned.aqua.adapterAddress}`);
  console.log(`    aquaAddress:          ${provisioned.aqua.aquaAddress}`);
  console.log(`    routerAddress:        ${provisioned.aqua.routerAddress}`);
  console.log(`    aqua routeId:         ${provisioned.aqua.routeId}`);
  console.log(`    strategyHash:         ${provisioned.aqua.strategyHash}`);
}

async function main() {
  const instanceLabel = process.env.PAYGUARD_DEMO_INSTANCE_LABEL ?? 'payguard-local-demo';
  const pool = createPool({ connectionString: DATABASE_URL });
  try {
    const existing = await pool.query('SELECT id FROM deployments WHERE instance_label = $1', [
      instanceLabel,
    ]);
    if (existing.rows[0]) {
      const deploymentId = existing.rows[0].id as string;
      const vaults = await getVaultsByDeployment(pool, deploymentId);
      if (vaults.length === 0) {
        throw new Error(
          `demo-setup: deployment '${instanceLabel}' (${deploymentId}) exists with no vault -- inconsistent state, needs manual review`,
        );
      }
      const publicClient = createPublicClient({
        chain: {
          id: CHAIN_ID,
          name: 'payguard-local-anvil',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: [RPC_URL] } },
        },
        transport: http(RPC_URL),
      });
      console.log(
        `Reusing existing demo deployment '${instanceLabel}' (${deploymentId}) -- no reseed, no redeploy.`,
      );
      for (const vault of vaults) {
        const vaultAddress = `0x${vault.address.toString('hex')}` as `0x${string}`;
        const code = await publicClient.getCode({ address: vaultAddress });
        if (!code) {
          throw new Error(
            `demo-setup: existing deployment '${instanceLabel}' has a vault at ${vaultAddress}, but RPC_URL=${RPC_URL} has no code there (Anvil state was reset without a matching 'demo-reset'). Run demo-reset.ts to provision a fresh deployment.`,
          );
        }
        const policies = await getPoliciesByVault(pool, vault.id);
        console.log(`  vaultId (DB):    ${vault.id}`);
        console.log(`  vaultAddress:    ${vaultAddress}`);
        if (policies[0]) console.log(`  demo profileId:  ${policies[0].id}`);
        console.log('');
      }
      console.log(
        'Point the API/worker at PAYGUARD_DEPLOYMENT_ID=' +
          deploymentId +
          ' with PAYGUARD_DEMO_ENABLED=true and the same well-known demo agent/merchant keys as before.',
      );
      return;
    }

    console.log(`No demo deployment '${instanceLabel}' found -- provisioning fresh.`);
    const provisioned = await provisionFreshDemoDeployment(pool, instanceLabel);
    console.log(
      `Provisioned demo deployment '${instanceLabel}' (${provisioned.deploymentId}), policy ${provisioned.policyId}.`,
    );
    printDemoEnvBlock(provisioned.deploymentId, provisioned);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
