/**
 * GET /v1/config -- the public deployment descriptor.
 *
 * This response is built by an explicit ALLOWLIST projection of the deployment's stored
 * configuration, not by serialising the row. That matters: `deployments.configuration` is JSONB an
 * operator controls, so a spread/passthrough would happily publish an RPC URL with an embedded API
 * key the moment someone added one. Only the fields named below can ever appear, and
 * `assertNoSecrets` re-checks the built object before it is returned.
 */

import { getDeploymentById } from '@payguard/db';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError, successEnvelope } from '../errors.js';

/**
 * The single expected wire/ABI-binding schema version this build understands. Shared with
 * `health.ts`'s readiness check (B1, INT-006) so "the config we advertise" and "the version we
 * actually verify a vault's code was registered against" cannot silently drift from each other.
 */
export const EXPECTED_ABI_SCHEMA_VERSION = '1' as const;

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
  /** Only routes actually configured AND tested are advertised. */
  enabled: boolean;
}

export interface PublicConfig {
  deploymentId: string;
  environment: 'LOCAL_DEMO' | 'TESTNET';
  chainId: string;
  schemaVersion: '1';
  abiSchemaVersion: '1';
  tokens: PublicTokenConfig[];
  routes: Array<Omit<PublicRouteConfig, 'enabled'>>;
  confidencePolicy: {
    mode: 'LOCAL_DEMO' | 'RPC_FINALIZED' | 'DEPTH_CONFIRMED';
    confirmationDepth: string | null;
  };
}

/** Substrings that must never appear in a public configuration response. */
const FORBIDDEN_KEY_FRAGMENTS = [
  'privatekey',
  'secret',
  'password',
  'mnemonic',
  'rpcurl',
  'apikey',
];

/**
 * Defence in depth against a future edit widening the projection. Walks the built object and
 * refuses to serve it if a key looks like credential material.
 */
export function assertNoSecrets(value: unknown, path = '$'): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoSecrets(item, `${path}[${index}]`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    if (FORBIDDEN_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
      throw new Error(
        `public configuration would have exposed a secret-looking key at ${path}.${key}`,
      );
    }
    assertNoSecrets(child, `${path}.${key}`);
  }
}

interface StoredDeploymentConfiguration {
  tokens?: Array<{
    address?: string;
    symbol?: string;
    decimals?: number;
    isMock?: boolean;
  }>;
  routes?: Array<{
    routeId?: string;
    adapter?: string;
    kind?: string;
    inputToken?: string;
    outputToken?: string;
    subsidyModes?: string[];
    enabled?: boolean;
  }>;
  confidencePolicy?: { mode?: string; confirmationDepth?: string | null };
}

export function projectPublicConfig(params: {
  deploymentId: string;
  environment: 'LOCAL_DEMO' | 'TESTNET';
  chainId: bigint;
  configuration: unknown;
}): PublicConfig {
  const stored = (params.configuration ?? {}) as StoredDeploymentConfiguration;

  const tokens: PublicTokenConfig[] = (stored.tokens ?? []).map((token) => ({
    address: String(token.address ?? ''),
    symbol: String(token.symbol ?? ''),
    decimals: Number(token.decimals ?? 0),
    isMock: Boolean(token.isMock ?? false),
  }));

  // Only enabled (configured AND tested) routes are advertised. An address merely appearing in
  // documentation does not become an enabled route.
  const routes = (stored.routes ?? [])
    .filter((route) => route.enabled === true)
    .map((route) => ({
      routeId: String(route.routeId ?? ''),
      adapter: String(route.adapter ?? ''),
      kind: (route.kind ?? 'DIRECT') as PublicRouteConfig['kind'],
      inputToken: String(route.inputToken ?? ''),
      outputToken: String(route.outputToken ?? ''),
      subsidyModes: route.subsidyModes ?? ['NONE'],
    }));

  const config: PublicConfig = {
    deploymentId: params.deploymentId,
    environment: params.environment,
    chainId: params.chainId.toString(10),
    schemaVersion: '1',
    abiSchemaVersion: EXPECTED_ABI_SCHEMA_VERSION,
    tokens,
    routes,
    confidencePolicy: {
      mode: (stored.confidencePolicy?.mode ??
        'LOCAL_DEMO') as PublicConfig['confidencePolicy']['mode'],
      confirmationDepth: stored.confidencePolicy?.confirmationDepth ?? null,
    },
  };

  assertNoSecrets(config);
  return config;
}

export function registerConfigRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/v1/config', async (request, reply) => {
    const deployment = await getDeploymentById(context.pool, context.config.deploymentId);
    if (!deployment) {
      throw new ApiError('DEPLOYMENT_MISMATCH', 'configured deployment does not exist');
    }
    const body = projectPublicConfig({
      deploymentId: deployment.id,
      environment: deployment.environment,
      chainId: deployment.chainId,
      configuration: deployment.configuration,
    });
    return reply.status(200).send(successEnvelope(body, String(request.id)));
  });
}
