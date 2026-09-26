/**
 * Fastify application factory.
 *
 * AJV is configured strictly (`coerceTypes:false`, `useDefaults:false`, `removeAdditional:false`)
 * because these settings are a signature-integrity requirement for signed business objects: any of
 * them left permissive would let the validator mutate a payload before it is hashed, so the digest
 * the API computes would differ from the one the wallet signed.
 *
 * Every registered route is captured via the `onRoute` hook into a single registry, which is what
 * the OpenAPI artifact is generated from. Handlers and the published contract therefore cannot
 * drift: there is one source, not a hand-maintained parallel document.
 */

import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { enforceBrowserMutationGuards, resolveSession } from './auth.js';
import type { AppContext } from './context.js';
import { ApiError, failureEnvelope } from './errors.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerDemoRoutes } from './routes/demo.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerInvoiceRoutes } from './routes/invoices.js';
import { registerObservationRoutes } from './routes/observations.js';
import { registerPaymentIntentRoutes } from './routes/paymentIntents.js';
import { registerPaymentReadRoutes } from './routes/payments.js';
import { registerPolicyRoutes } from './routes/policies.js';
import { registerVaultRoutes } from './routes/vaults.js';

export interface RegisteredRoute {
  method: string;
  url: string;
  schema: Record<string, unknown> | undefined;
}

export interface BuiltApp {
  app: FastifyInstance;
  routes: RegisteredRoute[];
}

/** Endpoints that establish a session and therefore must NOT require a pre-existing one. */
const SESSION_ESTABLISHING = new Set(['POST:/v1/auth/challenges', 'POST:/v1/auth/verify']);

/** Endpoints intentionally public. */
const PUBLIC_ROUTES = new Set(['GET:/v1/config', 'GET:/health/live', 'GET:/health/ready']);

function routeKey(request: FastifyRequest): string {
  return `${request.method}:${request.routeOptions?.url ?? request.url}`;
}

export function buildApp(context: AppContext): BuiltApp {
  const routes: RegisteredRoute[] = [];

  const app = Fastify({
    ajv: {
      customOptions: {
        coerceTypes: false,
        useDefaults: false,
        removeAdditional: false,
        allErrors: false,
      },
    },
    genReqId: () => randomUUID(),
  });

  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD') continue;
      routes.push({
        method,
        url: route.url,
        schema: route.schema as Record<string, unknown> | undefined,
      });
    }
  });

  app.addHook('onRequest', async (request) => {
    request.requestId = String(request.id);
  });

  // Session resolution runs for every request; authorization is decided per route afterwards.
  app.addHook('preHandler', async (request) => {
    const key = routeKey(request);
    const session = await resolveSession(context, request);
    if (session) request.auth = session;

    if (PUBLIC_ROUTES.has(key) || SESSION_ESTABLISHING.has(key)) return;
    if (!session) {
      throw new ApiError('INVALID_SESSION', 'authentication required');
    }
    enforceBrowserMutationGuards(context, request, session);
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = String(request.id);

    if (error instanceof ApiError) {
      reply.status(error.status).send(failureEnvelope(error, requestId));
      return;
    }
    // Fastify/AJV validation failures become INVALID_SCHEMA, never a 500.
    const maybeValidationError = error as { validation?: unknown; message?: unknown };
    if (maybeValidationError.validation) {
      const message =
        typeof maybeValidationError.message === 'string'
          ? maybeValidationError.message
          : 'request failed schema validation';
      const apiError = new ApiError('INVALID_SCHEMA', message);
      reply.status(apiError.status).send(failureEnvelope(apiError, requestId));
      return;
    }
    request.log.error({ err: error }, 'unhandled error');
    // Deliberately generic: never leak a stack trace, internal path or DB detail to a client.
    const internal = new ApiError('INTERNAL', 'internal error');
    reply.status(internal.status).send(failureEnvelope(internal, requestId));
  });

  app.setNotFoundHandler((request, reply) => {
    const apiError = new ApiError('RESOURCE_NOT_FOUND', 'no such route');
    reply.status(apiError.status).send(failureEnvelope(apiError, String(request.id)));
  });

  registerHealthRoutes(app, context);
  registerConfigRoutes(app, context);
  registerAuthRoutes(app, context);
  registerVaultRoutes(app, context);
  registerPolicyRoutes(app, context);
  registerObservationRoutes(app, context);
  registerInvoiceRoutes(app, context);
  registerPaymentIntentRoutes(app, context);
  registerPaymentReadRoutes(app, context);
  registerDemoRoutes(app, context);

  return { app, routes };
}
