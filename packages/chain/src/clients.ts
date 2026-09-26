/**
 * viem client factories for the local Anvil deployment. Stage 1 scope: prove viem + a real
 * local Anvil instance talk to each other. Vault/adapter ABI bindings are Stage 2+.
 */
import {
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts';

export interface LocalChainConfig {
  rpcUrl: string;
  chainId: number;
}

function localAnvilChain(chainId: number, rpcUrl: string): Chain {
  return {
    id: chainId,
    name: 'payguard-local-anvil',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

export function createLocalPublicClient(config: LocalChainConfig): PublicClient {
  return createPublicClient({
    chain: localAnvilChain(config.chainId, config.rpcUrl),
    transport: http(config.rpcUrl),
  });
}

export function createLocalWalletClient(
  config: LocalChainConfig,
  privateKey: Hex,
): WalletClient<ReturnType<typeof http>, Chain, PrivateKeyAccount> {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: localAnvilChain(config.chainId, config.rpcUrl),
    transport: http(config.rpcUrl),
  });
}

/** Stage 1 connectivity proof: a real round trip against a real local Anvil instance. */
export async function checkChainConnectivity(config: LocalChainConfig): Promise<{
  ok: true;
  observedChainId: number;
  blockNumber: bigint;
}> {
  const client = createLocalPublicClient(config);
  const observedChainId = await client.getChainId();
  const blockNumber = await client.getBlockNumber();
  return { ok: true, observedChainId, blockNumber };
}
