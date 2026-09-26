/**
 * Public frontend-integration surface. This file (and everything it re-exports) is the complete
 * dependency contract an external client — CLI, browser, or otherwise — needs to construct and
 * sign PayGuard business objects, validate wire responses, and call the API. It never imports
 * @payguard/db or @payguard/chain (enforced by `test/boundary.test.ts`'s package.json check).
 *
 * Stage 4 additions: the generated vault ABI (own independent copy, `generated/abi.ts`), the
 * published HTTP wire schemas (`schemas.ts`) and public-config schema (`config.ts`) — both
 * drift-tested against `apps/api`'s implementation — and a small documented client boundary
 * (`client.ts`). `test/external-consumer.test.ts` exercises this package exactly as an external
 * CLI consumer would.
 */

export type {
  Address,
  Evaluation,
  ExceptionApproval,
  Hash32,
  HexBytes,
  Invoice,
  ISODate,
  MerchantPermission,
  Observation,
  Operation,
  PayGuardDomain,
  PaymentIntent,
  PaymentView,
  PolicyConfig,
  SubsidyModeWire,
  UIntString,
  UnsignedTransaction,
} from '@payguard/domain';
export {
  addressSchema,
  approvalNonceFromIntentHash,
  CONFIDENCE_WIRE,
  // EIP-712
  domainFor,
  EIP712_TYPES,
  EXECUTION_STATUS_WIRE,
  exceptionApprovalSchema,
  hash32Schema,
  hashApproval,
  hashIntent,
  hashInvoice,
  hexBytesSchema,
  invoiceSchema,
  // primitives
  isAddress,
  isHash32,
  isHexBytes,
  isUIntString,
  merchantPermissionSchema,
  ONCHAIN_DECISION_WIRE,
  OPERATION_STATUS_WIRE,
  parseUIntOfWidth,
  parseUIntString,
  paymentIntentSchema,
  // wire schemas
  policyConfigSchema,
  REASON_WIRE,
  RECONCILIATION_WIRE,
  // enums
  SUBSIDY_MODE_WIRE,
  subsidyModeFromOnChain,
  subsidyModeToOnChain,
  toUIntString,
  UINT256_MAX,
  uintStringSchema,
  ZERO_APPROVAL,
  ZERO_APPROVAL_SIGNATURE,
} from '@payguard/domain';
export * from './client.js';
export * from './config.js';
export { PAYGUARD_VAULT_ABI } from './generated/abi.js';
export * from './schemas.js';
