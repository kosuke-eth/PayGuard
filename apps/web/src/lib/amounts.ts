/**
 * Exact amount handling. Atomic amounts stay decimal strings / bigint end to end; `Number` is
 * never used for token amounts. Formatting happens only at the display boundary.
 */
import { parseUIntString, toUIntString, UINT256_MAX } from '@payguard/integration';

export function formatAtomic(
  atomic: string | null | undefined,
  decimals: number,
  options: { minFraction?: number; maxFraction?: number } = {},
): string {
  if (atomic === null || atomic === undefined) return '—';
  let value: bigint;
  try {
    value = parseUIntString(atomic);
  } catch {
    return '—';
  }
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  let fraction = (value % base).toString(10).padStart(decimals, '0');
  const max = Math.min(options.maxFraction ?? Math.min(decimals, 6), decimals);
  const min = Math.min(options.minFraction ?? 2, max);
  // Truncate, never round up: a displayed amount must not exceed the real one.
  fraction = fraction.slice(0, max);
  while (fraction.length > min && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  const wholeText = whole.toString(10).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction.length > 0 ? `${wholeText}.${fraction}` : wholeText;
}

/** Full-precision plain decimal, for prefilling inputs. */
export function atomicToDecimalInput(atomic: string, decimals: number): string {
  const value = parseUIntString(atomic);
  const base = 10n ** BigInt(decimals);
  const fraction = (value % base).toString(10).padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${value / base}.${fraction}` : `${value / base}`;
}

export type ParsedAmount = { ok: true; atomic: string } | { ok: false; problem: string };

/** Friendly decimal text -> exact atomic UIntString. Rejects excess precision, never rounds. */
export function parseDecimalToAtomic(text: string, decimals: number): ParsedAmount {
  const trimmed = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d*)?$/.test(trimmed)) {
    return { ok: false, problem: 'Enter a plain positive number, for example 100 or 0.5.' };
  }
  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) {
    return { ok: false, problem: `This token has at most ${decimals} decimal places.` };
  }
  const value =
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (value > UINT256_MAX) return { ok: false, problem: 'Amount is too large.' };
  return { ok: true, atomic: toUIntString(value) };
}

export function subtractFloorZero(a: string, b: string): string {
  const left = parseUIntString(a);
  const right = parseUIntString(b);
  return toUIntString(left > right ? left - right : 0n);
}

/** Share of `part` in `whole` as 0..100, computed in bigint basis points. Display only. */
export function percentOf(part: string, whole: string): number {
  const w = parseUIntString(whole);
  if (w === 0n) return 0;
  const bps = (parseUIntString(part) * 10000n) / w;
  return Math.min(100, Number(bps) / 100);
}
