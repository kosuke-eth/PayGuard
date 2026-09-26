/** bytea (Buffer) <-> 0x-hex string conversions for evm_address/hash32 columns. */

export function hexToBytes(hex: string): Buffer {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Buffer.from(clean, 'hex');
}

export function bytesToHex(bytes: Buffer): string {
  return `0x${bytes.toString('hex')}`;
}
