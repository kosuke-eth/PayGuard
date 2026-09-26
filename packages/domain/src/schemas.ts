/**
 * Runtime zod schemas mirroring API_CONTRACT.md wire rules exactly: reject extra properties,
 * numeric coercion, exponent notation, leading signs. No `z.coerce`, no `.passthrough()`.
 */
import { z } from 'zod';
import { SUBSIDY_MODE_WIRE } from './enums.js';
import { isAddress, isHash32, isHexBytes, isUIntString } from './primitives.js';

export const uintStringSchema = z
  .string()
  .refine(isUIntString, { message: 'must be a canonical uint256 decimal string' });

export const addressSchema = z
  .string()
  .refine(isAddress, { message: 'must be a 0x + 20-byte address' });

export const hash32Schema = z.string().refine(isHash32, { message: 'must be a 0x + 32-byte hash' });

export const hexBytesSchema = z
  .string()
  .refine(isHexBytes, { message: 'must be even-length 0x-prefixed bytes' });

export const subsidyModeSchema = z.enum(SUBSIDY_MODE_WIRE);

export const policyConfigSchema = z
  .object({
    agent: addressSchema,
    inputToken: addressSchema,
    settlementToken: addressSchema,
    adapter: addressSchema,
    routeId: hash32Schema,
    totalOutputBudget: uintStringSchema,
    epochOutputBudget: uintStringSchema,
    automaticOutputCap: uintStringSchema,
    escalationOutputCap: uintStringSchema,
    totalInputBudget: uintStringSchema,
    maxInputPerPayment: uintStringSchema,
    validAfter: uintStringSchema,
    validUntil: uintStringSchema,
    allowedCategoryBitmap: uintStringSchema,
    subsidyMode: subsidyModeSchema,
  })
  .strict();

export const merchantPermissionSchema = z
  .object({
    merchantId: hash32Schema,
    recipient: addressSchema,
    invoiceSigner: addressSchema,
    category: uintStringSchema,
  })
  .strict();

export const invoiceSchema = z
  .object({
    invoiceId: hash32Schema,
    merchantId: hash32Schema,
    recipient: addressSchema,
    settlementToken: addressSchema,
    outputAmount: uintStringSchema,
    category: uintStringSchema,
    validUntil: uintStringSchema,
  })
  .strict();

export const paymentIntentSchema = z
  .object({
    policyId: hash32Schema,
    invoiceHash: hash32Schema,
    routeId: hash32Schema,
    maxInputAmount: uintStringSchema,
    nonce: uintStringSchema,
    validUntil: uintStringSchema,
    subsidyMode: subsidyModeSchema,
    maxSubsidyAmount: uintStringSchema,
  })
  .strict();

export const exceptionApprovalSchema = z
  .object({
    intentHash: hash32Schema,
    nonce: uintStringSchema,
    validUntil: uintStringSchema,
  })
  .strict();
