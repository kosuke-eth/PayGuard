/**
 * B2 demo bridge (`docs/PAYGUARD_INTEGRATION_BOUNDARY.md` section 5).
 *
 * This bridge is a CALLER of the real public API, not a shortcut around it. Every step below goes
 * through the SAME `app.inject()` request path a real HTTP client would use -- real SIWE login,
 * real schema validation, real signature verification, real on-chain `evaluate()` -- so a rejection
 * recorded here is a REAL rejection, never a fabricated one. It never signs an owner approval, never
 * writes payment state directly, and never holds the owner's private key: only two isolated demo
 * signing identities (merchant, agent) plus a third deliberately-unregistered one for the
 * "unauthorized merchant" scenario, all loaded from `context.config.demo` -- present only when
 * `PAYGUARD_DEMO_ENABLED=true` was explicitly set.
 *
 * Gate (all three required, not just one): (1) `context.config.demo` is configured, (2)
 * `context.config.environment === 'LOCAL_DEMO'`, (3) `context.config.chainId` is the well-known
 * local Anvil chain id (31337) -- an environment LABEL alone is never trusted (a real deployment
 * could mislabel itself), and neither is the flag alone (an operator could set it on the wrong
 * deployment by mistake); all three must agree.
 */
import { randomUUID } from 'node:crypto';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  getIdempotencyKeyById,
  getPolicyMerchants,
  withTransaction,
} from '@payguard/db';
import { hashIntent, hashInvoice, type Invoice, type PaymentIntent } from '@payguard/domain';
import type { FastifyInstance } from 'fastify';
import { keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { requireIdempotencyKey, requireSession } from '../auth.js';
import { requireVaultOwner } from '../authz.js';
import type { AppContext } from '../context.js';
import {
  DEMO_SCENARIOS,
  type DemoProfile,
  findScenario,
  getDemoProfileById,
  getDemoProfilesForOwner,
} from '../demo/catalog.js';
import { ApiError, successEnvelope } from '../errors.js';
import { DEMO_RUN_START_BODY } from '../schemas.js';

interface DemoRunStartBody {
  profileId: string;
  scenarioId: string;
  sourcePaymentId?: string;
}

function assertDemoEnabled(context: AppContext): asserts context is AppContext & {
  config: AppContext['config'] & { demo: NonNullable<AppContext['config']['demo']> };
} {
  if (
    !context.config.demo ||
    context.config.environment !== 'LOCAL_DEMO' ||
    context.config.chainId !== 31337n
  ) {
    // Deliberately RESOURCE_NOT_FOUND, not a more informative "demo disabled" code -- outside the
    // controlled demo configuration, this surface does not exist at all, same posture as a route
    // that was never registered.
    throw new ApiError('RESOURCE_NOT_FOUND', 'no such route');
  }
}

async function injectJson(
  app: FastifyInstance,
  params: {
    method: 'POST' | 'GET';
    url: string;
    headers?: Record<string, string>;
    payload?: Record<string, unknown>;
  },
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = await app.inject({
    method: params.method,
    url: params.url,
    ...(params.headers ? { headers: params.headers } : {}),
    ...(params.payload !== undefined ? { payload: params.payload } : {}),
  });
  return { statusCode: response.statusCode, body: response.json() };
}

/** Real SIWE login (challenge + verify), exactly the flow a real agent client performs. */
async function loginAsDemoAgent(
  app: FastifyInstance,
  privateKey: `0x${string}`,
  chainId: bigint,
): Promise<string> {
  const account = privateKeyToAccount(privateKey);
  const challenge = await injectJson(app, {
    method: 'POST',
    url: '/v1/auth/challenges',
    payload: { address: account.address, chainId: chainId.toString(10), sessionKind: 'AGENT' },
  });
  if (challenge.statusCode !== 201) {
    throw new Error(`demo agent login: challenge failed (${challenge.statusCode})`);
  }
  const { challengeId, message } = challenge.body.data as { challengeId: string; message: string };
  const signature = await account.signMessage({ message });
  const verify = await injectJson(app, {
    method: 'POST',
    url: '/v1/auth/verify',
    payload: { challengeId, signature },
  });
  if (verify.statusCode !== 201) {
    throw new Error(`demo agent login: verify failed (${verify.statusCode})`);
  }
  return (verify.body.data as { accessToken: string }).accessToken;
}

interface OrchestrationOutcome {
  stage: 'invoice' | 'intent' | 'submit' | 'settled';
  orchestrationStatus:
    | 'REJECTED_INVALID_SIGNATURE'
    | 'BLOCKED'
    | 'AWAITING_APPROVAL'
    | 'QUEUED'
    | 'DUPLICATE_NOT_PAID_TWICE';
  errorCode: string | null;
  paymentId: string | null;
  intentId: string | null;
  operationId: string | null;
}

async function orchestrate(
  app: FastifyInstance,
  context: AppContext & { config: { demo: NonNullable<AppContext['config']['demo']> } },
  params: {
    profile: DemoProfile;
    scenario: (typeof DEMO_SCENARIOS)[number];
    sourcePaymentId?: string;
  },
): Promise<OrchestrationOutcome> {
  const { profile, scenario } = params;
  const chainId = context.config.chainId;
  // The EIP-712 domain needs the vault's real ADDRESS, not its DB resource id.
  const vaultAddressResult = await context.pool.query('SELECT address FROM vaults WHERE id = $1', [
    profile.vaultId,
  ]);
  const vaultAddress =
    `0x${(vaultAddressResult.rows[0].address as Buffer).toString('hex')}` as `0x${string}`;
  const domain = { chainId: Number(chainId), verifyingContract: vaultAddress };

  const agentAccessToken = await loginAsDemoAgent(
    app,
    context.config.demo.agentPrivateKey,
    chainId,
  );
  const agentHeaders = { authorization: `Bearer ${agentAccessToken}` };

  let invoiceResourceId: string;
  let invoiceHash: `0x${string}`;

  if (scenario.requiresSourcePayment) {
    // "Duplicate" scenario: reuse the EXISTING invoice identity from a prior settled run, never a
    // fresh invoice. This is what makes the coming intent/submit attempt a genuine test of "does
    // not pay the same obligation twice", not a comparison against an unrelated invoice.
    if (!params.sourcePaymentId) {
      throw new ApiError('INVALID_SCHEMA', 'duplicate scenario requires sourcePaymentId');
    }
    const source = await context.pool.query(
      `SELECT inv.id AS invoice_resource_id, inv.invoice_digest, p.vault_id
       FROM payments p JOIN invoices inv ON inv.id = p.invoice_id
       WHERE p.id = $1`,
      [params.sourcePaymentId],
    );
    const sourceRow = source.rows[0];
    if (!sourceRow || sourceRow.vault_id !== profile.vaultId) {
      throw new ApiError('RESOURCE_NOT_FOUND', 'sourcePaymentId not found for this profile');
    }
    invoiceResourceId = sourceRow.invoice_resource_id as string;
    invoiceHash = `0x${(sourceRow.invoice_digest as Buffer).toString('hex')}` as `0x${string}`;
  } else {
    const merchants = await getPolicyMerchants(context.pool, profile.policyResourceId);
    const merchant = merchants[0];
    if (!merchant) {
      throw new ApiError('RESOURCE_NOT_FOUND', 'this profile has no configured demo merchant');
    }
    const invoice: Invoice = {
      invoiceId: `0x${randomUUID().replace(/-/g, '').padEnd(64, '0')}` as `0x${string}`,
      merchantId: `0x${merchant.merchantId.toString('hex')}` as `0x${string}`,
      recipient: `0x${merchant.recipient.toString('hex')}` as `0x${string}`,
      settlementToken: profile.outputToken,
      outputAmount: scenario.invoiceAmountAtomic,
      category: merchant.category.toString(10),
      validUntil: '99999999999',
    };
    invoiceHash = hashInvoice(domain, invoice);
    const signingKey =
      scenario.invoiceSigner === 'unauthorizedMerchant'
        ? context.config.demo.unauthorizedMerchantPrivateKey
        : context.config.demo.merchantPrivateKey;
    const merchantSignature = await privateKeyToAccount(signingKey).sign({ hash: invoiceHash });

    const invoiceResult = await injectJson(app, {
      method: 'POST',
      url: '/v1/invoices',
      headers: agentHeaders,
      payload: { vaultId: profile.vaultId, invoice, merchantSignature },
    });
    if (invoiceResult.statusCode >= 400) {
      const error = invoiceResult.body.error as { code: string } | undefined;
      return {
        stage: 'invoice',
        orchestrationStatus: 'REJECTED_INVALID_SIGNATURE',
        errorCode: error?.code ?? 'UNKNOWN',
        paymentId: null,
        intentId: null,
        operationId: null,
      };
    }
    invoiceResourceId = (invoiceResult.body.data as { invoiceResourceId: string })
      .invoiceResourceId;
  }

  const intent: PaymentIntent = {
    policyId: profile.onchainPolicyId,
    invoiceHash,
    routeId: profile.routeId,
    maxInputAmount: scenario.requiresSourcePayment
      ? '1' // irrelevant for a duplicate attempt against an already-consumed invoice
      : scenario.invoiceAmountAtomic,
    nonce: Math.floor(Math.random() * 1_000_000_000).toString(10),
    validUntil: '99999999999',
    subsidyMode: 'NONE',
    maxSubsidyAmount: '0',
  };
  const intentDigest = hashIntent(domain, intent);
  const agentSignature = await privateKeyToAccount(context.config.demo.agentPrivateKey).sign({
    hash: intentDigest,
  });

  const intentResult = await injectJson(app, {
    method: 'POST',
    url: '/v1/payment-intents',
    headers: { ...agentHeaders, 'idempotency-key': randomUUID() },
    payload: {
      invoiceResourceId,
      policyResourceId: profile.policyResourceId,
      intent,
      agentSignature,
    },
  });
  if (intentResult.statusCode >= 400) {
    const error = intentResult.body.error as { code: string } | undefined;
    return {
      stage: 'intent',
      orchestrationStatus: 'REJECTED_INVALID_SIGNATURE',
      errorCode: error?.code ?? 'UNKNOWN',
      paymentId: null,
      intentId: null,
      operationId: null,
    };
  }
  const { paymentId, intentId, evaluation } = intentResult.body.data as {
    paymentId: string;
    intentId: string;
    evaluation: { decision: 'ALLOW' | 'ESCALATE' | 'BLOCK' | 'UNKNOWN'; reasonCode?: string };
  };

  if (evaluation.decision === 'BLOCK') {
    // The REAL rejection point, recorded honestly -- never bypassed to force a more theatrical
    // later BLOCK, and never submitted (submit would only queue toward the same real BLOCK the
    // worker re-checks; recording the earlier, real one is more accurate, not less).
    return {
      stage: 'intent',
      orchestrationStatus: 'BLOCKED',
      errorCode: evaluation.reasonCode ?? 'BLOCK',
      paymentId,
      intentId,
      operationId: null,
    };
  }

  const submitResult = await injectJson(app, {
    method: 'POST',
    url: `/v1/payment-intents/${intentId}/submit`,
    headers: { ...agentHeaders, 'idempotency-key': randomUUID() },
    payload: {},
  });
  if (submitResult.statusCode >= 400) {
    const error = submitResult.body.error as { code: string } | undefined;
    return {
      stage: 'submit',
      orchestrationStatus: 'REJECTED_INVALID_SIGNATURE',
      errorCode: error?.code ?? 'UNKNOWN',
      paymentId,
      intentId,
      operationId: null,
    };
  }
  const { operationId, deduplicated } = submitResult.body.data as {
    operationId: string;
    deduplicated?: boolean;
  };

  return {
    stage: 'submit',
    orchestrationStatus:
      scenario.requiresSourcePayment && deduplicated
        ? 'DUPLICATE_NOT_PAID_TWICE'
        : evaluation.decision === 'ESCALATE'
          ? 'AWAITING_APPROVAL'
          : 'QUEUED',
    errorCode: null,
    paymentId,
    intentId,
    operationId,
  };
}

export function registerDemoRoutes(app: FastifyInstance, context: AppContext): void {
  // --- GET /v1/demo/scenarios --------------------------------------------------------------------
  app.get('/v1/demo/scenarios', async (request, reply) => {
    assertDemoEnabled(context);
    const auth = requireSession(request);
    const profiles = await getDemoProfilesForOwner(context, auth.walletId);
    const scenarios = DEMO_SCENARIOS.map((s) => ({
      scenarioId: s.scenarioId,
      label: s.label,
      description: s.description,
      permittedProfileIds: profiles.filter((p) => p.available).map((p) => p.profileId),
      invoiceAmountAtomic: s.invoiceAmountAtomic,
      requiresSourcePayment: s.requiresSourcePayment,
    }));
    return reply.status(200).send(successEnvelope({ scenarios, profiles }, String(request.id)));
  });

  // --- POST /v1/demo/runs ------------------------------------------------------------------------
  app.post<{ Body: DemoRunStartBody }>(
    '/v1/demo/runs',
    { schema: { body: DEMO_RUN_START_BODY } },
    async (request, reply) => {
      assertDemoEnabled(context);
      const auth = requireSession(request);
      const idempotencyKey = requireIdempotencyKey(request);
      const { profileId, scenarioId, sourcePaymentId } = request.body;

      const scenario = findScenario(scenarioId);
      if (!scenario) throw new ApiError('RESOURCE_NOT_FOUND', 'unknown scenarioId');

      const profile = await getDemoProfileById(context, profileId);
      if (!profile) throw new ApiError('RESOURCE_NOT_FOUND', 'unknown profileId');
      // Ownership: the caller must own the vault this profile belongs to -- selecting a profile
      // never grants access to someone else's vault, it only picks among the caller's own.
      await requireVaultOwner(context, auth, profile.vaultId);
      if (!profile.available) {
        throw new ApiError('RESOURCE_FORBIDDEN', "this profile's route is not enabled/available");
      }

      const immutableRequest = Buffer.from(
        JSON.stringify({ profileId, scenarioId, sourcePaymentId: sourcePaymentId ?? null }),
        'utf8',
      );
      const requestDigest = Buffer.from(
        keccak256(`0x${immutableRequest.toString('hex')}`).slice(2),
        'hex',
      );

      const runId = await withTransaction(context.pool, async (client) => {
        const idempotent = await beginIdempotentRequest(client, {
          id: randomUUID(),
          principalWalletId: auth.walletId,
          operation: `demo_run:${profile.vaultId}`,
          clientKey: idempotencyKey,
          requestDigest,
        });
        if (idempotent.kind === 'conflict') {
          throw new ApiError(
            'IDEMPOTENCY_KEY_REUSED',
            'this Idempotency-Key was already used for a different demo run request',
          );
        }
        return idempotent.row.id;
      });

      // Orchestration happens OUTSIDE the idempotency-begin transaction (it makes real HTTP/RPC
      // calls internally); `completeIdempotentRequest` below is the durable record of the outcome,
      // scoped by `runId` so a lost response recovers the SAME run rather than re-orchestrating.
      const alreadyCompleted = await context.pool.query(
        "SELECT response_body FROM idempotency_keys WHERE id = $1 AND status = 'COMPLETED'",
        [runId],
      );
      let outcome: OrchestrationOutcome;
      if (alreadyCompleted.rows[0]) {
        outcome = alreadyCompleted.rows[0].response_body as OrchestrationOutcome;
      } else {
        outcome = await orchestrate(app, context, {
          profile,
          scenario,
          ...(sourcePaymentId !== undefined ? { sourcePaymentId } : {}),
        });
        await withTransaction(context.pool, (client) =>
          completeIdempotentRequest(client, {
            id: runId,
            status: 'COMPLETED',
            resourceKind: 'demo_run',
            resourceId: runId,
            responseStatus: 201,
            responseBody: outcome,
          }),
        );
      }

      const body = {
        runId,
        deploymentId: context.config.deploymentId,
        profileId: profile.profileId,
        scenarioId: scenario.scenarioId,
        ...outcome,
      };
      return reply.status(201).send(successEnvelope(body, String(request.id)));
    },
  );

  // --- GET /v1/demo/runs/{id} ---------------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/v1/demo/runs/:id', async (request, reply) => {
    assertDemoEnabled(context);
    const auth = requireSession(request);
    const run = await getIdempotencyKeyById(context.pool, request.params.id);
    if (
      !run ||
      run.principalWalletId !== auth.walletId ||
      run.operation.split(':')[0] !== 'demo_run'
    ) {
      throw new ApiError('RESOURCE_NOT_FOUND', 'demo run not found');
    }
    const outcome = (run.responseBody ?? null) as OrchestrationOutcome | null;

    // Live status, not a frozen snapshot -- a caller polling this must see real current progress
    // (a QUEUED run that has since settled, or an AWAITING_APPROVAL run once the owner approves).
    let livePaymentStatus: Record<string, unknown> | null = null;
    if (outcome?.paymentId) {
      const paymentResult = await context.pool.query(
        'SELECT execution_status, reconciliation, policy_decision FROM payments WHERE id = $1',
        [outcome.paymentId],
      );
      const paymentRow = paymentResult.rows[0];
      if (paymentRow) {
        livePaymentStatus = {
          executionStatus: paymentRow.execution_status,
          reconciliation: paymentRow.reconciliation,
          policyDecision: paymentRow.policy_decision,
        };
      }
    }

    const body = {
      runId: run.id,
      ...outcome,
      livePaymentStatus,
    };
    return reply.status(200).send(successEnvelope(body, String(request.id)));
  });
}
