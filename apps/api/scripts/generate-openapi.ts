#!/usr/bin/env tsx
/**
 * Generates an OpenAPI 3.0 document FROM the actually-registered Fastify routes (via `app.ts`'s
 * `onRoute` capture), not from a hand-maintained parallel description. A route added, removed, or
 * given a different schema shows up here automatically on regeneration; `test/openapi-drift.test.ts`
 * fails if the committed artifact is stale.
 *
 * Building the app only to enumerate its route table needs no live database or chain connection --
 * registration never executes a handler -- so this runs with an inert pool/client.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { buildApp, type RegisteredRoute } from '../src/app.js';
import type { AppContext } from '../src/context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
export const OPENAPI_PATH = path.join(REPO_ROOT, 'docs/implementation/evidence/openapi.json');

function inertContext(): AppContext {
  return {
    config: {
      port: 3000,
      host: '127.0.0.1',
      databaseUrl: 'postgresql://unused/unused',
      rpcUrl: 'http://unused',
      chainId: 31337n,
      environment: 'LOCAL_DEMO',
      deploymentId: '00000000-0000-0000-0000-000000000000',
      siweDomain: 'localhost:3000',
      siweUri: 'http://localhost:3000',
      allowedOrigins: ['http://localhost:3000'],
      cookie: {
        name: 'payguard_session',
        secure: true,
        sameSite: 'Strict',
        path: '/',
        maxAgeSeconds: 3600,
      },
      sessionTtlSeconds: 3600,
      challengeTtlSeconds: 300,
      relayerAddress: null,
      tlsEnabled: false,
    },
    // Route REGISTRATION never queries the pool or chain client -- only handler execution does.
    pool: {} as pg.Pool,
    publicClient: null,
    vaultReaderFor: () => null,
    now: () => new Date(),
  };
}

function schemaToParameters(
  schema: Record<string, unknown> | undefined,
  location: 'path' | 'query',
): Array<Record<string, unknown>> {
  if (!schema || typeof schema !== 'object') return [];
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, propSchema]) => ({
    name,
    in: location,
    required: location === 'path' || required.has(name),
    schema: propSchema,
  }));
}

function routeToOperation(route: RegisteredRoute): Record<string, unknown> {
  const schema = route.schema ?? {};
  const parameters = [
    ...schemaToParameters(schema.params as Record<string, unknown> | undefined, 'path'),
    ...schemaToParameters(schema.querystring as Record<string, unknown> | undefined, 'query'),
  ];
  const operation: Record<string, unknown> = {
    operationId: `${route.method.toLowerCase()}_${route.url.replace(/[/:{}]/g, '_')}`,
    responses: {
      '200': { description: 'Success<T> envelope' },
      default: { description: 'Failure envelope' },
    },
  };
  if (parameters.length > 0) operation.parameters = parameters;
  if (schema.body) {
    operation.requestBody = {
      required: true,
      content: { 'application/json': { schema: schema.body } },
    };
  }
  return operation;
}

/** Converts Fastify's `:param` path syntax to OpenAPI's `{param}`. */
function toOpenApiPath(url: string): string {
  return url.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

export function generateOpenApiDocument(routes: RegisteredRoute[]): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const sorted = [...routes].sort(
    (a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method),
  );
  for (const route of sorted) {
    const openApiPath = toOpenApiPath(route.url);
    paths[openApiPath] ??= {};
    paths[openApiPath][route.method.toLowerCase()] = routeToOperation(route);
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'PayGuard API',
      version: '1',
      description:
        'Generated from the implemented Fastify route table (apps/api/src/app.ts onRoute capture), not hand-maintained. See API_CONTRACT.md for the full prose contract.',
    },
    paths,
  };
}

function main(): void {
  const context = inertContext();
  const { routes } = buildApp(context);
  const document = generateOpenApiDocument(routes);
  mkdirSync(path.dirname(OPENAPI_PATH), { recursive: true });
  writeFileSync(OPENAPI_PATH, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`wrote ${path.relative(REPO_ROOT, OPENAPI_PATH)} (${routes.length} routes)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
