/**
 * B3: deploys a REAL local Uniswap v4 PoolManager + seeded liquidity position (mirroring
 * `contracts/core-v4/test/V4SwapFixture.t.sol`'s own setup, not reinvented) + a FRESH
 * `PayGuardVault` supporting both `mUSDC`/`mRWA` (the existing single-token vault fixture's
 * `supportedTokenMap` is immutable, so a v4 policy needs its own vault) + the real
 * `PayGuardV4Adapter`, to a real local Anvil instance from the ACTUAL compiled Foundry
 * artifacts. Used by API/worker end-to-end tests that need a genuine v4-route policy to pay
 * through, not a mocked adapter.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts';
import {
  AGENT_PRIVATE_KEY,
  MERCHANT_PRIVATE_KEY,
  OWNER_PRIVATE_KEY,
  RELAYER_PRIVATE_KEY,
} from './vaultFixture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const SQRT_PRICE_1_1 = 79228162514264337593543950336n;
const TICK_LOWER = -60000;
const TICK_UPPER = 60000;
const LIQUIDITY_DELTA = 1_000000000000000000000000n; // 1e24, matches V4SwapFixture.t.sol
const LP_MINT_AMOUNT = 1_000_000_000_000_000000000000000000n; // 1e12 * 1e18
const V4_FEE = 3000;
const V4_TICK_SPACING = 60;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

function loadArtifact(relativePath: string): { abi: unknown[]; bytecode: { object: Hex } } {
  const fullPath = path.join(REPO_ROOT, relativePath);
  return JSON.parse(readFileSync(fullPath, 'utf8'));
}

function localAnvilChain(chainId: number, rpcUrl: string): Chain {
  return {
    id: chainId,
    name: 'payguard-local-anvil',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

export interface DeployedV4VaultFixture {
  publicClient: PublicClient;
  ownerWalletClient: WalletClient;
  ownerAccount: PrivateKeyAccount;
  agentAccount: PrivateKeyAccount;
  merchantAccount: PrivateKeyAccount;
  relayerAccount: PrivateKeyAccount;
  vaultAddress: Address;
  /** Settlement/output token, 6 decimals -- same symbol as the DIRECT-route fixture's token. */
  usdcAddress: Address;
  /** Input token, 18 decimals -- the asset a v4-route agent actually pays with. */
  rwaAddress: Address;
  poolManagerAddress: Address;
  v4AdapterAddress: Address;
  v4RouteId: `0x${string}`;
  vaultAbi: readonly unknown[];
  erc20Abi: readonly unknown[];
  v4AdapterAbi: readonly unknown[];
  chainId: number;
  rpcUrl: string;
}

export async function deployV4VaultFixture(params: {
  rpcUrl: string;
  chainId: number;
}): Promise<DeployedV4VaultFixture> {
  const chain = localAnvilChain(params.chainId, params.rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(params.rpcUrl) });

  const ownerAccount = privateKeyToAccount(OWNER_PRIVATE_KEY);
  const agentAccount = privateKeyToAccount(AGENT_PRIVATE_KEY);
  const merchantAccount = privateKeyToAccount(MERCHANT_PRIVATE_KEY);
  const relayerAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY);
  const ownerWalletClient = createWalletClient({
    account: ownerAccount,
    chain,
    transport: http(params.rpcUrl),
  });

  async function deploy(
    artifactPath: string,
    args: readonly unknown[],
  ): Promise<{ address: Address; abi: readonly unknown[] }> {
    const artifact = loadArtifact(artifactPath);
    const hash = await ownerWalletClient.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args,
      chain,
      account: ownerAccount,
    } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress)
      throw new Error(`${artifactPath} deployment produced no contractAddress`);
    return { address: receipt.contractAddress, abi: artifact.abi };
  }

  const poolManager = await deploy('contracts/core-v4/out/PoolManager.sol/PoolManager.json', [
    ownerAccount.address,
  ]);
  const mUSDC = await deploy('contracts/core-v4/out/MockERC20.sol/MockERC20.json', [
    'Mock USDC',
    'mUSDC',
    6,
  ]);
  const mRWA = await deploy('contracts/core-v4/out/MockERC20.sol/MockERC20.json', [
    'Mock RWA',
    'mRWA',
    18,
  ]);

  const usdcIsCurrency0 = mUSDC.address.toLowerCase() < mRWA.address.toLowerCase();
  const currency0 = usdcIsCurrency0 ? mUSDC.address : mRWA.address;
  const currency1 = usdcIsCurrency0 ? mRWA.address : mUSDC.address;
  const poolKey = {
    currency0,
    currency1,
    fee: V4_FEE,
    tickSpacing: V4_TICK_SPACING,
    hooks: ZERO_ADDRESS,
  };

  const initHash = await ownerWalletClient.writeContract({
    address: poolManager.address,
    abi: poolManager.abi,
    functionName: 'initialize',
    args: [poolKey, SQRT_PRICE_1_1],
    chain,
    account: ownerAccount,
  } as never);
  await publicClient.waitForTransactionReceipt({ hash: initHash });

  const liquidityRouter = await deploy(
    'contracts/core-v4/out/PoolModifyLiquidityTest.sol/PoolModifyLiquidityTest.json',
    [poolManager.address],
  );

  async function mint(token: Address, to: Address, amount: bigint) {
    const hash = await ownerWalletClient.writeContract({
      address: token,
      abi: mUSDC.abi,
      functionName: 'mint',
      args: [to, amount],
      chain,
      account: ownerAccount,
    } as never);
    await publicClient.waitForTransactionReceipt({ hash });
  }
  async function approve(token: Address, spender: Address, amount: bigint) {
    const hash = await ownerWalletClient.writeContract({
      address: token,
      abi: mUSDC.abi,
      functionName: 'approve',
      args: [spender, amount],
      chain,
      account: ownerAccount,
    } as never);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  // The owner account doubles as the LP for this local fixture (mirrors DeployFixture.s.sol).
  await mint(mUSDC.address, ownerAccount.address, LP_MINT_AMOUNT);
  await mint(mRWA.address, ownerAccount.address, LP_MINT_AMOUNT);
  await approve(mUSDC.address, liquidityRouter.address, 2n ** 256n - 1n);
  await approve(mRWA.address, liquidityRouter.address, 2n ** 256n - 1n);
  const liquidityHash = await ownerWalletClient.writeContract({
    address: liquidityRouter.address,
    abi: liquidityRouter.abi,
    functionName: 'modifyLiquidity',
    args: [
      poolKey,
      {
        tickLower: TICK_LOWER,
        tickUpper: TICK_UPPER,
        liquidityDelta: LIQUIDITY_DELTA,
        salt: `0x${'0'.repeat(64)}`,
      },
      '0x',
    ],
    chain,
    account: ownerAccount,
  } as never);
  await publicClient.waitForTransactionReceipt({ hash: liquidityHash });

  const vault = await deploy('contracts/core-v4/out/PayGuardVault.sol/PayGuardVault.json', [
    ownerAccount.address,
    [mUSDC.address, mRWA.address],
  ]);

  const v4Adapter = await deploy(
    'contracts/core-v4/out/PayGuardV4Adapter.sol/PayGuardV4Adapter.json',
    [
      poolManager.address,
      vault.address,
      currency0,
      currency1,
      V4_FEE,
      V4_TICK_SPACING,
      ZERO_ADDRESS,
    ],
  );
  const v4RouteId = (await publicClient.readContract({
    address: v4Adapter.address,
    abi: v4Adapter.abi,
    functionName: 'ROUTE_ID',
  })) as `0x${string}`;

  return {
    publicClient,
    ownerWalletClient,
    ownerAccount,
    agentAccount,
    merchantAccount,
    relayerAccount,
    vaultAddress: vault.address,
    usdcAddress: mUSDC.address,
    rwaAddress: mRWA.address,
    poolManagerAddress: poolManager.address,
    v4AdapterAddress: v4Adapter.address,
    v4RouteId,
    vaultAbi: vault.abi,
    erc20Abi: mUSDC.abi,
    v4AdapterAbi: v4Adapter.abi,
    chainId: params.chainId,
    rpcUrl: params.rpcUrl,
  };
}
