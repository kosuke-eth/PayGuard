/**
 * Deploys a REAL PayGuardVault and a real MockERC20 to a real local Anvil instance, from the
 * ACTUAL compiled Foundry artifacts (never a hand-encoded mirror). Used by Stage 4's API tests,
 * which need a deployed vault to prepare/decode/validate real transactions against -- not a
 * mocked chain client.
 *
 * Anvil's well-known dev key #0 (also used by contracts/core-v4/script/DeployFixture.s.sol and
 * packages/chain/test/v4-anvil-fixture.test.ts) is reused here for consistency; it is a disposable
 * local-only key, never a real credential.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

export const OWNER_PRIVATE_KEY: Hex =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
/** Anvil dev key #1 -- used as a bound agent identity in tests. */
export const AGENT_PRIVATE_KEY: Hex =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
/** Anvil dev key #2 -- used as a merchant/invoice-signer identity in tests. */
export const MERCHANT_PRIVATE_KEY: Hex =
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
/**
 * Anvil dev key #9, matching `.env.example`'s RELAYER_PRIVATE_KEY. A dedicated relayer identity,
 * distinct from owner/agent/merchant -- never granted vault ownership, never bound as an `agent`
 * on any policy. Pre-funded with ETH by Anvil like every other dev account (gas only; it never
 * holds or moves ERC20 value itself).
 */
export const RELAYER_PRIVATE_KEY: Hex =
  '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6';

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

export interface DeployedVaultFixture {
  publicClient: PublicClient;
  ownerWalletClient: WalletClient;
  ownerAccount: PrivateKeyAccount;
  agentAccount: PrivateKeyAccount;
  merchantAccount: PrivateKeyAccount;
  relayerAccount: PrivateKeyAccount;
  vaultAddress: Address;
  tokenAddress: Address;
  vaultAbi: readonly unknown[];
  erc20Abi: readonly unknown[];
  chainId: number;
  rpcUrl: string;
}

export async function deployVaultFixture(params: {
  rpcUrl: string;
  chainId: number;
}): Promise<DeployedVaultFixture> {
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

  const tokenArtifact = loadArtifact('contracts/core-v4/out/MockERC20.sol/MockERC20.json');
  const tokenDeployHash = await ownerWalletClient.deployContract({
    abi: tokenArtifact.abi,
    bytecode: tokenArtifact.bytecode.object,
    args: ['Mock USDC', 'mUSDC', 6],
    chain,
    account: ownerAccount,
  });
  const tokenReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenDeployHash });
  const tokenAddress = tokenReceipt.contractAddress;
  if (!tokenAddress) throw new Error('MockERC20 deployment produced no contractAddress');

  const vaultArtifact = loadArtifact('contracts/core-v4/out/PayGuardVault.sol/PayGuardVault.json');
  const vaultDeployHash = await ownerWalletClient.deployContract({
    abi: vaultArtifact.abi,
    bytecode: vaultArtifact.bytecode.object,
    args: [ownerAccount.address, [tokenAddress]],
    chain,
    account: ownerAccount,
  });
  const vaultReceipt = await publicClient.waitForTransactionReceipt({ hash: vaultDeployHash });
  const vaultAddress = vaultReceipt.contractAddress;
  if (!vaultAddress) throw new Error('PayGuardVault deployment produced no contractAddress');

  return {
    publicClient,
    ownerWalletClient,
    ownerAccount,
    agentAccount,
    merchantAccount,
    relayerAccount,
    vaultAddress,
    tokenAddress,
    vaultAbi: vaultArtifact.abi,
    erc20Abi: tokenArtifact.abi,
    chainId: params.chainId,
    rpcUrl: params.rpcUrl,
  };
}

/** Mints tokens to a holder and returns the tx hash, using the vault owner as minter. */
export async function mintTokens(
  fixture: DeployedVaultFixture,
  to: Address,
  amount: bigint,
): Promise<Hex> {
  const hash = await fixture.ownerWalletClient.writeContract({
    address: fixture.tokenAddress,
    abi: fixture.erc20Abi,
    functionName: 'mint',
    args: [to, amount],
    chain: localAnvilChain(fixture.chainId, fixture.rpcUrl),
    account: fixture.ownerAccount,
  } as never);
  await fixture.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
