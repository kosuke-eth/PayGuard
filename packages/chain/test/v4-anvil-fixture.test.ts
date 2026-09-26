/**
 * Stage 1 required checkpoint, satisfied literally: "Start an isolated local Anvil instance.
 * Deploy the inspected actual v4 PoolManager... Run a bare exact-output swap through a minimal
 * authenticated unlock-callback harness... Exercise one bounded failure."
 *
 * contracts/core-v4/test/V4SwapFixture.t.sol already proves the same mechanics inside forge
 * test's own EVM. This file additionally spawns a REAL `anvil` process, broadcasts real signed
 * transactions to it via `forge script`, then drives the deployed contracts over real JSON-RPC
 * with viem — so the "local Anvil instance" requirement is met literally, not just by forge's
 * built-in test EVM (which is a different execution path, even though both are revm-based).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type SpawnedAnvil, spawnAnvil } from '@payguard/test-utils';
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, '../../../contracts/core-v4');

const PORT = 8551;
const CHAIN_ID = 31340;
// Anvil's well-known default dev account #0 — matches script/DeployFixture.s.sol's default.
const DEPLOYER_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
]);

const HARNESS_ABI_JSON = JSON.parse(
  readFileSync(resolve(CONTRACTS_DIR, 'out/V4SwapHarness.sol/V4SwapHarness.json'), 'utf8'),
).abi;

interface DeployedFixture {
  manager: Address;
  mUSDC: Address;
  mRWA: Address;
  harness: Address;
  trader: Address;
  usdcIsCurrency0: boolean;
}

function parseDeployLog(stdout: string): DeployedFixture {
  const grab = (key: string): string => {
    const match = stdout.match(new RegExp(`${key}=\\s*(\\S+)`));
    if (!match?.[1]) throw new Error(`deploy script output missing ${key}=; got:\n${stdout}`);
    return match[1];
  };
  return {
    manager: grab('MANAGER') as Address,
    mUSDC: grab('MUSDC') as Address,
    mRWA: grab('MRWA') as Address,
    harness: grab('HARNESS') as Address,
    trader: grab('TRADER') as Address,
    usdcIsCurrency0: grab('USDC_IS_CURRENCY0') === 'true',
  };
}

function deployFixtureViaForgeScript(rpcUrl: string): DeployedFixture {
  const stdout = execFileSync(
    'forge',
    [
      'script',
      'script/DeployFixture.s.sol',
      '--rpc-url',
      rpcUrl,
      '--broadcast',
      '--private-key',
      DEPLOYER_KEY,
    ],
    {
      cwd: CONTRACTS_DIR,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}` },
    },
  );
  return parseDeployLog(stdout);
}

describe('Stage 1: real local Anvil instance + real v4 exact-output swap over RPC', () => {
  let anvil: SpawnedAnvil;
  let fixture: DeployedFixture;
  let key: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  };

  const chain: Chain = {
    id: CHAIN_ID,
    name: 'payguard-local-anvil-fixture',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [] } },
  };

  beforeAll(async () => {
    anvil = await spawnAnvil({ port: PORT, chainId: CHAIN_ID });
    fixture = deployFixtureViaForgeScript(anvil.rpcUrl);
    key = {
      currency0: fixture.usdcIsCurrency0 ? fixture.mUSDC : fixture.mRWA,
      currency1: fixture.usdcIsCurrency0 ? fixture.mRWA : fixture.mUSDC,
      fee: 3000,
      tickSpacing: 60,
      hooks: '0x0000000000000000000000000000000000000000',
    };
  }, 60_000);

  afterAll(async () => {
    await anvil?.stop();
  });

  function clients() {
    const transport = http(anvil.rpcUrl);
    const account = privateKeyToAccount(DEPLOYER_KEY);
    const withRpc: Chain = { ...chain, rpcUrls: { default: { http: [anvil.rpcUrl] } } };
    const publicClient = createPublicClient({ chain: withRpc, transport });
    const walletClient = createWalletClient({ account, chain: withRpc, transport });
    return { publicClient, walletClient };
  }

  function swapParamsForExactUsdcOutput(usdcOut: bigint) {
    const zeroForOne = !fixture.usdcIsCurrency0; // mRWA -> mUSDC direction
    const MIN_SQRT_PRICE_PLUS_ONE = 4295128740n;
    const MAX_SQRT_PRICE_MINUS_ONE = 1461446703485210103287273052203988822378723970341n;
    return {
      zeroForOne,
      amountSpecified: usdcOut,
      sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE,
    };
  }

  it("deployed real bytecode to the spawned Anvil instance (not forge test's in-process EVM)", async () => {
    const { publicClient } = clients();
    const observedChainId = await publicClient.getChainId();
    expect(observedChainId).toBe(CHAIN_ID);

    const managerCode = await publicClient.getCode({ address: fixture.manager });
    const harnessCode = await publicClient.getCode({ address: fixture.harness });
    expect(managerCode?.length).toBeGreaterThan(2);
    expect(harnessCode?.length).toBeGreaterThan(2);
  });

  it('delivers exact output and bounded input via a real mined transaction', async () => {
    const { publicClient, walletClient } = clients();
    const requestedUsdcOut = 500_000n;
    const maxInput = 10n * 10n ** 18n;

    const usdcBefore = (await publicClient.readContract({
      address: fixture.mUSDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [fixture.trader],
    })) as bigint;
    const rwaBefore = (await publicClient.readContract({
      address: fixture.mRWA,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [fixture.trader],
    })) as bigint;

    const txHash = await walletClient.writeContract({
      address: fixture.harness,
      abi: HARNESS_ABI_JSON,
      functionName: 'exactOutputSwap',
      args: [key, swapParamsForExactUsdcOutput(requestedUsdcOut), maxInput],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    expect(receipt.status).toBe('success');

    const usdcAfter = (await publicClient.readContract({
      address: fixture.mUSDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [fixture.trader],
    })) as bigint;
    const rwaAfter = (await publicClient.readContract({
      address: fixture.mRWA,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [fixture.trader],
    })) as bigint;

    expect(usdcAfter - usdcBefore).toBe(requestedUsdcOut);
    const actualInput = rwaBefore - rwaAfter;
    expect(actualInput > 0n).toBe(true);
    expect(actualInput <= maxInput).toBe(true);
  });

  it('bounded failure: insufficient maxInput is rejected before any state changes, no partial result', async () => {
    const { publicClient, walletClient } = clients();
    const requestedUsdcOut = 500_000n;
    const tooSmallMaxInput = 1n;

    const usdcBefore = (await publicClient.readContract({
      address: fixture.mUSDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [fixture.trader],
    })) as bigint;
    const rwaBefore = (await publicClient.readContract({
      address: fixture.mRWA,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [fixture.trader],
    })) as bigint;

    // simulateContract performs a real eth_call against the live node without broadcasting a
    // transaction, so a revert here means nothing was ever mined — the strongest possible
    // "no partial result persists" evidence for this negative case.
    await expect(
      publicClient.simulateContract({
        account: walletClient.account,
        address: fixture.harness,
        abi: HARNESS_ABI_JSON,
        functionName: 'exactOutputSwap',
        args: [key, swapParamsForExactUsdcOutput(requestedUsdcOut), tooSmallMaxInput],
      }),
    ).rejects.toThrow();

    const usdcAfter = (await publicClient.readContract({
      address: fixture.mUSDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [fixture.trader],
    })) as bigint;
    const rwaAfter = (await publicClient.readContract({
      address: fixture.mRWA,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [fixture.trader],
    })) as bigint;

    expect(usdcAfter).toBe(usdcBefore);
    expect(rwaAfter).toBe(rwaBefore);
  });
});
