/**
 * B4: deploys a REAL local 1inch Aqua + SwapVM (AquaSwapVMRouter) instance + a real maker
 * shipping a real, bounded XYCSwap liquidity position (via the pinned project's own
 * `AquaMakerFixture` contract, reused rather than reimplemented -- see
 * `contracts/aqua/test/fixtures/AquaMakerFixture.sol`) + a FRESH `PayGuardVault` supporting the
 * Aqua route's token pair + the real `PayGuardAquaAdapter`, to a real local Anvil instance from
 * the ACTUAL compiled Foundry artifacts of BOTH `contracts/core-v4` (solc 0.8.26) and
 * `contracts/aqua` (solc 0.8.30) -- two separately compiled projects, deployed side by side on
 * the same chain, exactly proving the cross-pragma ABI boundary works at the EVM level (see
 * `contracts/aqua/src/interfaces/IPayGuardSettlementAdapterShim.sol`'s own doc comment). Used by
 * API/worker end-to-end tests that need a genuine Aqua-route policy to pay through, not a mocked
 * adapter.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
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

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
/** Anvil dev key #3 -- a dedicated Aqua maker identity, distinct from owner/agent/merchant/relayer. */
const MAKER_PRIVATE_KEY: Hex = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
const MAKER_BALANCE_IN = 1_000_000_000000000000000000n; // 1e24, matches PayGuardAquaAdapter.t.sol
const MAKER_BALANCE_OUT = 1_000_000_000000000000000000n;

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

const ORDER_ABI_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'maker', type: 'address' },
    { name: 'traits', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
} as const;

export interface DeployedAquaVaultFixture {
  publicClient: PublicClient;
  ownerWalletClient: WalletClient;
  ownerAccount: PrivateKeyAccount;
  agentAccount: PrivateKeyAccount;
  merchantAccount: PrivateKeyAccount;
  relayerAccount: PrivateKeyAccount;
  makerAccount: PrivateKeyAccount;
  vaultAddress: Address;
  /** Settlement/output token, minted to the maker's shipped inventory. */
  aqOutputAddress: Address;
  /** Input token, the asset an Aqua-route agent actually pays with. */
  aqInputAddress: Address;
  aquaAddress: Address;
  routerAddress: Address;
  aquaAdapterAddress: Address;
  aquaRouteId: `0x${string}`;
  strategyHash: `0x${string}`;
  vaultAbi: readonly unknown[];
  erc20Abi: readonly unknown[];
  aquaAdapterAbi: readonly unknown[];
  chainId: number;
  rpcUrl: string;
}

export async function deployAquaVaultFixture(params: {
  rpcUrl: string;
  chainId: number;
}): Promise<DeployedAquaVaultFixture> {
  const chain = localAnvilChain(params.chainId, params.rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(params.rpcUrl) });

  const ownerAccount = privateKeyToAccount(OWNER_PRIVATE_KEY);
  const agentAccount = privateKeyToAccount(AGENT_PRIVATE_KEY);
  const merchantAccount = privateKeyToAccount(MERCHANT_PRIVATE_KEY);
  const relayerAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY);
  const makerAccount = privateKeyToAccount(MAKER_PRIVATE_KEY);
  const ownerWalletClient = createWalletClient({
    account: ownerAccount,
    chain,
    transport: http(params.rpcUrl),
  });
  const makerWalletClient = createWalletClient({
    account: makerAccount,
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

  async function writeAsOwner(
    address: Address,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[],
  ) {
    const hash = await ownerWalletClient.writeContract({
      address,
      abi,
      functionName,
      args,
      chain,
      account: ownerAccount,
    } as never);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function writeAsMaker(
    address: Address,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[],
  ) {
    const hash = await makerWalletClient.writeContract({
      address,
      abi,
      functionName,
      args,
      chain,
      account: makerAccount,
    } as never);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  const aqua = await deploy('contracts/aqua/out/Aqua.sol/Aqua.json', []);
  const aqInput = await deploy('contracts/aqua/out/TokenMock.sol/TokenMock.json', [
    'Aqua Input',
    'AQIN',
  ]);
  const aqOutput = await deploy('contracts/aqua/out/TokenMock.sol/TokenMock.json', [
    'Aqua Output',
    'AQOUT',
  ]);

  // Reuses the pinned project's OWN AquaMakerFixture contract (which itself deploys a real
  // AquaSwapVMRouter internally) rather than re-deriving MakerTraits/program bytecode in
  // TypeScript -- the exact same principle as reusing V4SwapHarness (B3).
  const makerFixture = await deploy(
    'contracts/aqua/out/AquaMakerFixture.sol/AquaMakerFixture.json',
    [aqua.address, ZERO_ADDRESS, ownerAccount.address],
  );
  const routerAddress = (await publicClient.readContract({
    address: makerFixture.address,
    abi: makerFixture.abi,
    functionName: 'router',
  })) as Address;
  const routerAbi = loadArtifact(
    'contracts/aqua/out/AquaSwapVMRouter.sol/AquaSwapVMRouter.json',
  ).abi;

  const salt = BigInt(Date.now());
  const order = (await publicClient.readContract({
    address: makerFixture.address,
    abi: makerFixture.abi,
    functionName: 'buildOrder',
    args: [makerAccount.address, salt],
  })) as { maker: Address; traits: bigint; data: Hex };

  // Real bounded position: the maker actually holds and approves BOTH tokens before shipping --
  // Aqua never custodies tokens itself (confirmed directly from its own source, SOURCES.md S07).
  await writeAsOwner(aqInput.address, aqInput.abi, 'mint', [
    makerAccount.address,
    MAKER_BALANCE_IN,
  ]);
  await writeAsOwner(aqOutput.address, aqOutput.abi, 'mint', [
    makerAccount.address,
    MAKER_BALANCE_OUT,
  ]);
  await writeAsMaker(aqInput.address, aqInput.abi, 'approve', [aqua.address, 2n ** 256n - 1n]);
  await writeAsMaker(aqOutput.address, aqOutput.abi, 'approve', [aqua.address, 2n ** 256n - 1n]);

  const strategyBytes = encodeAbiParameters([ORDER_ABI_TUPLE], [order]);
  await writeAsMaker(aqua.address, aqua.abi, 'ship', [
    routerAddress,
    strategyBytes,
    [aqInput.address, aqOutput.address],
    [MAKER_BALANCE_IN, MAKER_BALANCE_OUT],
  ]);

  const strategyHash = (await publicClient.readContract({
    address: routerAddress,
    abi: routerAbi,
    functionName: 'hash',
    args: [order],
  })) as `0x${string}`;

  const vault = await deploy('contracts/core-v4/out/PayGuardVault.sol/PayGuardVault.json', [
    ownerAccount.address,
    [aqInput.address, aqOutput.address],
  ]);

  const aquaAdapter = await deploy(
    'contracts/aqua/out/PayGuardAquaAdapter.sol/PayGuardAquaAdapter.json',
    [
      aqua.address,
      routerAddress,
      vault.address,
      makerAccount.address,
      order.traits,
      order.data,
      aqInput.address,
      aqOutput.address,
    ],
  );
  const aquaRouteId = (await publicClient.readContract({
    address: aquaAdapter.address,
    abi: aquaAdapter.abi,
    functionName: 'ROUTE_ID',
  })) as `0x${string}`;

  return {
    publicClient,
    ownerWalletClient,
    ownerAccount,
    agentAccount,
    merchantAccount,
    relayerAccount,
    makerAccount,
    vaultAddress: vault.address,
    aqOutputAddress: aqOutput.address,
    aqInputAddress: aqInput.address,
    aquaAddress: aqua.address,
    routerAddress,
    aquaAdapterAddress: aquaAdapter.address,
    aquaRouteId,
    strategyHash,
    vaultAbi: vault.abi,
    erc20Abi: aqInput.abi,
    aquaAdapterAbi: aquaAdapter.abi,
    chainId: params.chainId,
    rpcUrl: params.rpcUrl,
  };
}
