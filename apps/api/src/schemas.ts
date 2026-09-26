/**
 * Strict JSON schemas for the wire contract.
 *
 * Every object sets `additionalProperties: false`, and the app configures AJV with
 * `coerceTypes:false`, `useDefaults:false`, `removeAdditional:false`. For signed business objects
 * this is a signature-integrity requirement, not a style preference: coercing `"5"` to `5`,
 * inserting a default, or silently dropping an unknown field would change the bytes that get
 * hashed, so the digest the API computes would no longer be the digest the wallet signed.
 *
 * Integers are matched as canonical decimal STRINGS by pattern (no exponent, no sign, no leading
 * zeros). The pattern rejects the obvious garbage; exact width bounds (uint256/uint48/uint32) are
 * enforced afterwards in bigint by `parseUIntOfWidth`, because JSON Schema cannot express 2^256-1.
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

// --- canonical business models (signed objects: field sets are exact) -------------------------

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

// --- request bodies ---------------------------------------------------------------------------

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

/**
 * The owner-action discriminated union. `oneOf` with `additionalProperties:false` on each branch is
 * what makes "all other fields rejected" true: a DEPOSIT body carrying an extra `recipient`
 * matches no branch and is refused, so a caller cannot smuggle a field into a different action.
 */
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

/** MEDIUM-3: the compile route requires expectedVersion too, so a compile cannot race an edit. */
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

// --- params / querystrings ---------------------------------------------------------------------

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
