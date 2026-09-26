/**
 * The published HTTP wire schemas -- the canonical copy. `apps/api`'s own request schemas
 * (`apps/api/src/schemas.ts`) are drift-tested against these (`apps/api/test/contract-drift.test.ts`)
 * so the implemented handlers and this published contract cannot silently diverge.
 *
 * As in the API's own copy, every object is `additionalProperties: false` and integers are
 * matched as canonical decimal STRINGS by pattern -- exact width bounds are enforced afterwards in
 * bigint by `parseUIntOfWidth`/`parseUIntString`, re-exported from this package.
 */

export const UINT_STRING = { type: 'string', pattern: '^(0|[1-9][0-9]*)$' } as const;
export const ADDRESS = { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' } as const;
export const HASH32 = { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$' } as const;
export const HEX_BYTES = { type: 'string', pattern: '^0x([0-9a-fA-F]{2})*$' } as const;
export const UUID = {
  type: 'string',
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
} as const;
export const SUBSIDY_MODE = { type: 'string', enum: ['NONE', 'REQUIRED', 'BEST_EFFORT'] } as const;

function strictObject<T extends Record<string, unknown>>(
  properties: T,
  required: Array<keyof T & string>,
) {
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  } as const;
}

export const INVOICE_SCHEMA = strictObject(
  {
    invoiceId: HASH32,
    merchantId: HASH32,
    recipient: ADDRESS,
    settlementToken: ADDRESS,
    outputAmount: UINT_STRING,
    category: UINT_STRING,
    validUntil: UINT_STRING,
  },
  [
    'invoiceId',
    'merchantId',
    'recipient',
    'settlementToken',
    'outputAmount',
    'category',
    'validUntil',
  ],
);

export const PAYMENT_INTENT_SCHEMA = strictObject(
  {
    policyId: HASH32,
    invoiceHash: HASH32,
    routeId: HASH32,
    maxInputAmount: UINT_STRING,
    nonce: UINT_STRING,
    validUntil: UINT_STRING,
    subsidyMode: SUBSIDY_MODE,
    maxSubsidyAmount: UINT_STRING,
  },
  [
    'policyId',
    'invoiceHash',
    'routeId',
    'maxInputAmount',
    'nonce',
    'validUntil',
    'subsidyMode',
    'maxSubsidyAmount',
  ],
);

export const EXCEPTION_APPROVAL_SCHEMA = strictObject(
  { intentHash: HASH32, nonce: UINT_STRING, validUntil: UINT_STRING },
  ['intentHash', 'nonce', 'validUntil'],
);

export const POLICY_CONFIG_SCHEMA = strictObject(
  {
    agent: ADDRESS,
    inputToken: ADDRESS,
    settlementToken: ADDRESS,
    adapter: ADDRESS,
    routeId: HASH32,
    totalOutputBudget: UINT_STRING,
    epochOutputBudget: UINT_STRING,
    automaticOutputCap: UINT_STRING,
    escalationOutputCap: UINT_STRING,
    totalInputBudget: UINT_STRING,
    maxInputPerPayment: UINT_STRING,
    validAfter: UINT_STRING,
    validUntil: UINT_STRING,
    allowedCategoryBitmap: UINT_STRING,
    subsidyMode: SUBSIDY_MODE,
  },
  [
    'agent',
    'inputToken',
    'settlementToken',
    'adapter',
    'routeId',
    'totalOutputBudget',
    'epochOutputBudget',
    'automaticOutputCap',
    'escalationOutputCap',
    'totalInputBudget',
    'maxInputPerPayment',
    'validAfter',
    'validUntil',
    'allowedCategoryBitmap',
    'subsidyMode',
  ],
);

export const MERCHANT_PERMISSION_SCHEMA = strictObject(
  { merchantId: HASH32, recipient: ADDRESS, invoiceSigner: ADDRESS, category: UINT_STRING },
  ['merchantId', 'recipient', 'invoiceSigner', 'category'],
);

export const AUTH_CHALLENGE_BODY = strictObject(
  {
    address: ADDRESS,
    chainId: UINT_STRING,
    sessionKind: { type: 'string', enum: ['BROWSER', 'AGENT'] },
  },
  ['address', 'chainId', 'sessionKind'],
);

export const AUTH_VERIFY_BODY = strictObject({ challengeId: UUID, signature: HEX_BYTES }, [
  'challengeId',
  'signature',
]);

export const EMPTY_BODY = strictObject({}, []);

export const VAULT_TRANSACTION_BODY = {
  oneOf: [
    strictObject(
      { action: { type: 'string', const: 'DEPOSIT' }, token: ADDRESS, amountAtomic: UINT_STRING },
      ['action', 'token', 'amountAtomic'],
    ),
    strictObject(
      {
        action: { type: 'string', const: 'WITHDRAW' },
        token: ADDRESS,
        amountAtomic: UINT_STRING,
        recipient: ADDRESS,
      },
      ['action', 'token', 'amountAtomic', 'recipient'],
    ),
    strictObject({ action: { type: 'string', const: 'REVOKE_AGENT' }, agent: ADDRESS }, [
      'action',
      'agent',
    ]),
    strictObject(
      { action: { type: 'string', const: 'SET_EXECUTION_PAUSED' }, paused: { type: 'boolean' } },
      ['action', 'paused'],
    ),
    strictObject(
      { action: { type: 'string', const: 'CANCEL_APPROVAL_NONCE' }, nonce: UINT_STRING },
      ['action', 'nonce'],
    ),
  ],
} as const;

export const POLICY_DRAFT_BODY = strictObject(
  {
    vaultId: UUID,
    config: POLICY_CONFIG_SCHEMA,
    merchants: { type: 'array', maxItems: 32, items: MERCHANT_PERMISSION_SCHEMA },
  },
  ['vaultId', 'config', 'merchants'],
);

export const POLICY_DRAFT_UPDATE_BODY = strictObject(
  {
    expectedVersion: UINT_STRING,
    config: POLICY_CONFIG_SCHEMA,
    merchants: { type: 'array', maxItems: 32, items: MERCHANT_PERMISSION_SCHEMA },
  },
  ['expectedVersion', 'config', 'merchants'],
);

export const POLICY_DRAFT_TRANSACTION_BODY = strictObject({ expectedVersion: UINT_STRING }, [
  'expectedVersion',
]);

export const CHAIN_OBSERVATION_BODY = strictObject(
  { deploymentId: UUID, txHash: HASH32, relatedResourceId: UUID },
  ['deploymentId', 'txHash', 'relatedResourceId'],
);

export const INVOICE_BODY = strictObject(
  { vaultId: UUID, invoice: INVOICE_SCHEMA, merchantSignature: HEX_BYTES },
  ['vaultId', 'invoice', 'merchantSignature'],
);

export const PAYMENT_INTENT_BODY = strictObject(
  {
    invoiceResourceId: UUID,
    policyResourceId: UUID,
    intent: PAYMENT_INTENT_SCHEMA,
    agentSignature: HEX_BYTES,
  },
  ['invoiceResourceId', 'policyResourceId', 'intent', 'agentSignature'],
);

export const APPROVAL_BODY = strictObject(
  { approval: EXCEPTION_APPROVAL_SCHEMA, ownerSignature: HEX_BYTES },
  ['approval', 'ownerSignature'],
);

export const ID_PARAM = strictObject({ id: UUID }, ['id']);
export const HASH_PARAM = strictObject({ hash: HASH32 }, ['hash']);

export const KEYSET_QUERY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string', maxLength: 512 },
    limit: { type: 'string', pattern: '^([1-9]|[1-9][0-9]|100)$' },
    status: { type: 'string', maxLength: 32 },
  },
} as const;

export const TRANSACTION_QUERY = strictObject({ deploymentId: UUID }, ['deploymentId']);
