import type { Address, Hash32, HexBytes } from '@payguard/domain';

export function bufferToAddress(buffer: Buffer): Address {
  return `0x${buffer.toString('hex')}` as Address;
}

export function bufferToHash32(buffer: Buffer): Hash32 {
  return `0x${buffer.toString('hex')}` as Hash32;
}

export function addressToBuffer(address: string): Buffer {
  return Buffer.from(address.slice(2), 'hex');
}

export function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex.slice(2), 'hex');
}

export function bufferToHex(buffer: Buffer): HexBytes {
  return `0x${buffer.toString('hex')}` as HexBytes;
}

/**
 * Recursively converts every `bigint` in a value to a string so it survives `JSON.stringify` --
 * viem's raw receipt/transaction/log objects carry real bigints (blockNumber, gasUsed, logIndex,
 * ...) that `JSON.stringify` cannot serialize on its own (`TypeError: Do not know how to
 * serialize a BigInt`).
 */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString(10);
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJsonSafe(v)]),
    );
  }
  return value;
}
