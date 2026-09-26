import { describe, expect, it } from 'vitest';
import { invoiceSchema, uintStringSchema } from '../src/schemas.js';
import { FIXTURE_INVOICE } from './fixtures.js';

describe('uintStringSchema: canonical decimal string rules (API_CONTRACT.md common wire rules)', () => {
  it('accepts a plain positive integer string', () => {
    expect(uintStringSchema.safeParse('500000').success).toBe(true);
  });

  it('accepts zero', () => {
    expect(uintStringSchema.safeParse('0').success).toBe(true);
  });

  it('rejects a leading zero', () => {
    expect(uintStringSchema.safeParse('0500000').success).toBe(false);
  });

  it('rejects exponent notation', () => {
    expect(uintStringSchema.safeParse('5e6').success).toBe(false);
  });

  it('rejects a leading sign', () => {
    expect(uintStringSchema.safeParse('+500000').success).toBe(false);
    expect(uintStringSchema.safeParse('-1').success).toBe(false);
  });

  it('rejects a decimal point', () => {
    expect(uintStringSchema.safeParse('1.0').success).toBe(false);
  });

  it('rejects a number type outright (no coercion)', () => {
    // @ts-expect-error deliberately wrong input type
    expect(uintStringSchema.safeParse(500000).success).toBe(false);
  });

  it('rejects a value above 2^256-1', () => {
    const tooBig = '115792089237316195423570985008687907853269984665640564039457584007913129639936';
    expect(uintStringSchema.safeParse(tooBig).success).toBe(false);
  });

  it('accepts exactly 2^256-1', () => {
    const max = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    expect(uintStringSchema.safeParse(max).success).toBe(true);
  });
});

describe('invoiceSchema: strict object rules', () => {
  it('accepts the fixture invoice', () => {
    expect(invoiceSchema.safeParse(FIXTURE_INVOICE).success).toBe(true);
  });

  it('rejects an extra unknown property', () => {
    const withExtra = { ...FIXTURE_INVOICE, unexpectedField: '1' };
    expect(invoiceSchema.safeParse(withExtra).success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const { outputAmount: _omitted, ...withoutAmount } = FIXTURE_INVOICE;
    expect(invoiceSchema.safeParse(withoutAmount).success).toBe(false);
  });

  it('rejects a malformed address', () => {
    const bad = { ...FIXTURE_INVOICE, recipient: '0xnotanaddress' };
    expect(invoiceSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a malformed hash32', () => {
    const bad = { ...FIXTURE_INVOICE, invoiceId: '0x1234' };
    expect(invoiceSchema.safeParse(bad).success).toBe(false);
  });
});
