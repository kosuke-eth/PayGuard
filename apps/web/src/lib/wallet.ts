/**
 * Browser wallet boundary (EIP-1193). This wallet is the HUMAN OWNER only: SIWE sign-in, owner
 * transactions and exact exception approvals. It never holds the agent, merchant or relayer key.
 *
 * Prepared transaction bytes from the API are authoritative. Before anything reaches the wallet
 * we check chain / from / calldata hash against the connected account, and the calldata is decoded
 * independently (see `decodePrepared`) so the owner reviews what will actually be signed.
 */
import { PAYGUARD_VAULT_ABI, type UnsignedTransaction } from '@payguard/integration';
import { decodeFunctionData, erc20Abi, getAddress, keccak256, toHex } from 'viem';
import { WalletError } from './errors';

interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function getProvider(): Eip1193Provider | null {
  return typeof window !== 'undefined' && window.ethereum ? window.ethereum : null;
}

function requireProvider(): Eip1193Provider {
  const provider = getProvider();
  if (!provider) {
    throw new WalletError('No browser wallet found. Install MetaMask or another EIP-1193 wallet.');
  }
  return provider;
}

function wrap(error: unknown): WalletError {
  const candidate = error as { code?: number; message?: string };
  if (candidate?.code === 4001) {
    return new WalletError('You declined the request in your wallet. Nothing was signed.', true);
  }
  return new WalletError(candidate?.message ?? 'The wallet returned an error.');
}

export async function readAccounts(): Promise<string[]> {
  const provider = getProvider();
  if (!provider) return [];
  try {
    const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
    return accounts.map((a) => getAddress(a));
  } catch {
    return [];
  }
}

export async function requestAccounts(): Promise<string[]> {
  try {
    const accounts = (await requireProvider().request({
      method: 'eth_requestAccounts',
    })) as string[];
    return accounts.map((a) => getAddress(a));
  } catch (error) {
    throw wrap(error);
  }
}

/** Decimal-string chain id, the same representation the API uses. */
export async function readChainId(): Promise<string | null> {
  const provider = getProvider();
  if (!provider) return null;
  try {
    const hex = (await provider.request({ method: 'eth_chainId' })) as string;
    return BigInt(hex).toString(10);
  } catch {
    return null;
  }
}

export async function switchChain(chainId: string): Promise<void> {
  const provider = requireProvider();
  const hexId = toHex(BigInt(chainId));
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
  } catch (error) {
    const code = (error as { code?: number })?.code;
    // 4902: the wallet does not know this chain. Only the local demo chain is safe to add blind.
    if (code === 4902 && chainId === '31337') {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: hexId,
              chainName: 'Anvil (local)',
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['http://127.0.0.1:8545'],
            },
          ],
        });
        return;
      } catch (addError) {
        throw wrap(addError);
      }
    }
    throw wrap(error);
  }
}

export async function signMessage(account: string, message: string): Promise<string> {
  try {
    return (await requireProvider().request({
      method: 'personal_sign',
      params: [toHex(message), account],
    })) as string;
  } catch (error) {
    throw wrap(error);
  }
}

/**
 * Signs the API's typed data byte-for-byte. Only `EIP712Domain` is added, which
 * eth_signTypedData_v4 requires and which is fully determined by the domain object itself.
 */
export async function signTypedData(
  account: string,
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
    primaryType: string;
    message: unknown;
  },
): Promise<string> {
  const payload = {
    ...typedData,
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      ...typedData.types,
    },
  };
  try {
    return (await requireProvider().request({
      method: 'eth_signTypedData_v4',
      params: [account, JSON.stringify(payload)],
    })) as string;
  } catch (error) {
    throw wrap(error);
  }
}

export interface DecodedCall {
  target: 'vault' | 'token';
  functionName: string;
  args: Array<{ name: string; value: string }>;
}

function stringify(value: unknown): string {
  if (typeof value === 'bigint') return value.toString(10);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value, (_key, inner) =>
    typeof inner === 'bigint' ? inner.toString(10) : inner,
  );
}

/** Independent decode of prepared calldata, using the published vault ABI (or ERC-20 approve). */
export function decodePrepared(tx: UnsignedTransaction, vaultAddress: string): DecodedCall | null {
  const isVault = tx.to.toLowerCase() === vaultAddress.toLowerCase();
  const abi = isVault ? PAYGUARD_VAULT_ABI : erc20Abi;
  try {
    const decoded = decodeFunctionData({ abi, data: tx.data as `0x${string}` });
    const item = (
      abi as ReadonlyArray<{ type: string; name?: string; inputs?: readonly { name?: string }[] }>
    ).find((entry) => entry.type === 'function' && entry.name === decoded.functionName);
    const args = (decoded.args ?? []).map((value: unknown, index: number) => ({
      name: item?.inputs?.[index]?.name || `arg${index}`,
      value: stringify(value),
    }));
    return { target: isVault ? 'vault' : 'token', functionName: decoded.functionName, args };
  } catch {
    return null;
  }
}

/**
 * Sends one prepared owner transaction. Refuses if the wallet's account or chain no longer match
 * what the API prepared, or if the bytes do not hash to the advertised calldataHash.
 */
export async function sendPrepared(tx: UnsignedTransaction): Promise<string> {
  const [account] = await readAccounts();
  const chainId = await readChainId();
  if (!account || account.toLowerCase() !== tx.from.toLowerCase()) {
    throw new WalletError('Your wallet changed accounts. Review the action again before signing.');
  }
  if (chainId !== tx.chainId) {
    throw new WalletError('Your wallet is on a different network than this transaction.');
  }
  if (keccak256(tx.data as `0x${string}`) !== tx.calldataHash.toLowerCase()) {
    throw new WalletError('Prepared transaction bytes do not match their hash. Not sending.');
  }
  try {
    return (await requireProvider().request({
      method: 'eth_sendTransaction',
      params: [{ from: tx.from, to: tx.to, data: tx.data, value: toHex(BigInt(tx.value)) }],
    })) as string;
  } catch (error) {
    throw wrap(error);
  }
}

export type ReceiptResult =
  | { state: 'success' | 'reverted'; blockNumber: string }
  | { state: 'unknown' };

/** Polls for a receipt. Running out of attempts is reported as UNKNOWN, never as failure. */
export async function waitForReceipt(hash: string, attempts = 60): Promise<ReceiptResult> {
  const provider = requireProvider();
  for (let i = 0; i < attempts; i += 1) {
    try {
      const receipt = (await provider.request({
        method: 'eth_getTransactionReceipt',
        params: [hash],
      })) as { status?: string; blockNumber?: string } | null;
      if (receipt?.blockNumber) {
        return {
          state: receipt.status === '0x1' ? 'success' : 'reverted',
          blockNumber: BigInt(receipt.blockNumber).toString(10),
        };
      }
    } catch {
      // transient provider error: keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { state: 'unknown' };
}

export function onWalletChange(listener: () => void): () => void {
  const provider = getProvider();
  if (!provider?.on) return () => {};
  provider.on('accountsChanged', listener);
  provider.on('chainChanged', listener);
  return () => {
    provider.removeListener?.('accountsChanged', listener);
    provider.removeListener?.('chainChanged', listener);
  };
}
