/**
 * Public `GET /v1/config` response shape and schema. Mirrored from, and drift-tested against,
 * `apps/api/src/routes/config.ts`'s `PublicConfig`/projection so a client-facing type change in
 * the handler cannot silently diverge from what this package publishes.
 */

export interface PublicTokenConfig {
  address: string;
  symbol: string;
  decimals: number;
  isMock: boolean;
}

export interface PublicRouteConfig {
  routeId: string;
  adapter: string;
  kind: 'DIRECT' | 'UNISWAP_V4' | 'AQUA';
  inputToken: string;
  outputToken: string;
  subsidyModes: string[];
}

export interface PublicConfig {
  deploymentId: string;
  environment: 'LOCAL_DEMO' | 'TESTNET';
  chainId: string;
  schemaVersion: '1';
  abiSchemaVersion: '1';
  tokens: PublicTokenConfig[];
  routes: PublicRouteConfig[];
  confidencePolicy: {
    mode: 'LOCAL_DEMO' | 'RPC_FINALIZED' | 'DEPTH_CONFIRMED';
    confirmationDepth: string | null;
  };
}

export const PUBLIC_CONFIG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'deploymentId',
    'environment',
    'chainId',
    'schemaVersion',
    'abiSchemaVersion',
    'tokens',
    'routes',
    'confidencePolicy',
  ],
  properties: {
    deploymentId: { type: 'string' },
    environment: { type: 'string', enum: ['LOCAL_DEMO', 'TESTNET'] },
    chainId: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' },
    schemaVersion: { type: 'string', const: '1' },
    abiSchemaVersion: { type: 'string', const: '1' },
    tokens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['address', 'symbol', 'decimals', 'isMock'],
        properties: {
          address: { type: 'string' },
          symbol: { type: 'string' },
          decimals: { type: 'integer' },
          isMock: { type: 'boolean' },
        },
      },
    },
    routes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['routeId', 'adapter', 'kind', 'inputToken', 'outputToken', 'subsidyModes'],
        properties: {
          routeId: { type: 'string' },
          adapter: { type: 'string' },
          kind: { type: 'string', enum: ['DIRECT', 'UNISWAP_V4', 'AQUA'] },
          inputToken: { type: 'string' },
          outputToken: { type: 'string' },
          subsidyModes: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    confidencePolicy: {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'confirmationDepth'],
      properties: {
        mode: { type: 'string', enum: ['LOCAL_DEMO', 'RPC_FINALIZED', 'DEPTH_CONFIRMED'] },
        confirmationDepth: { type: ['string', 'null'] },
      },
    },
  },
} as const;
