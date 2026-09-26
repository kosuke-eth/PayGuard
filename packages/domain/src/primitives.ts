/**
 * Canonical wire primitives per API_CONTRACT.md "Common wire rules".
 * uint256 fields are decimal strings, no exponent/sign/decimal point, bound to 2^256-1.
 * Addresses are 0x + 20 bytes hex; hashes are 0x + 32 bytes hex; HexBytes is even-length 0x hex.
 */

export const UINT256_MAX =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;

const UINT_DECIMAL_RE = /^(0|[1-9][0-9]*)$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH32_RE = /^0x[0-9a-fA-F]{64}$/;
const HEX_BYTES_RE = /^0x([0-9a-fA-F]{2})*$/;

export type UIntString = string;
export type Address = `0x${string}`;
export type Hash32 = `0x${string}`;
export type HexBytes = `0x${string}`;
export type ISODate = string;

export function isUIntString(value: string): value is UIntString {
  if (!UINT_DECIMAL_RE.test(value)) return false;
  return BigInt(value) <= UINT256_MAX;
}

export function parseUIntString(value: string): bigint {
  if (!isUIntString(value)) {
    throw new TypeError(`invalid canonical uint256 decimal string: ${JSON.stringify(value)}`);
  }
  return BigInt(value);
}

export function toUIntString(value: bigint): UIntString {
  if (value < 0n || value > UINT256_MAX) {
    throw new RangeError(`value out of uint256 range: ${value}`);
  }
  return value.toString(10);
}

export function isAddress(value: string): value is Address {
  return ADDRESS_RE.test(value);
}

export function isHash32(value: string): value is Hash32 {
  return HASH32_RE.test(value);
}

export function isHexBytes(value: string): value is HexBytes {
  return HEX_BYTES_RE.test(value);
}

/**
 * Strict decimal-string parse bounded to a specific Solidity integer width (Stage 4).
 *
 * The ABI structs are not uniformly uint256: `validAfter`/`validUntil` are uint48 and `category`
 * is uint32 (reference/CONTRACT_INTERFACE.sol). A value that parses as a valid uint256 decimal
 * string can still be unencodable at its real width, so the width check has to happen explicitly
 * after parsing -- and it is done in bigint, never by round-tripping through JavaScript Number
 * (which silently loses precision above 2^53-1).
 */
export function parseUIntOfWidth(value: string, bits: number): bigint {
  if (!Number.isInteger(bits) || bits <= 0 || bits > 256) {
    throw new RangeError(`unsupported integer width: ${bits}`);
  }
  const parsed = parseUIntString(value);
  const max = (1n << BigInt(bits)) - 1n;
  if (parsed > max) {
    throw new RangeError(`value ${value} exceeds uint${bits} maximum ${max}`);
  }
  return parsed;
}

/** v4 route amounts (ARCH 3.1 "Request validation"): must additionally fit the signed-delta range. */
export const V4_MAX_ROUTE_AMOUNT = (1n << 127n) - 1n;

export function isV4RouteAmount(value: bigint): boolean {
  return value >= 0n && value <= V4_MAX_ROUTE_AMOUNT;
}
