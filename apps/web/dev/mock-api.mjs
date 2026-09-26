/**
 * DEV-ONLY stand-in for the PayGuard API, for working on layout without PostgreSQL, Anvil and the
 * worker. It keeps fake state in memory and accepts any signature.
 *
 *   NEVER use this for a demo, a recording or a test of payment behaviour.
 *   It proves nothing about PayGuard. The app itself has no mock mode and no fallback to this.
 *
 * Run: `pnpm --filter @payguard/web mock-api`, then `pnpm --filter @payguard/web dev`.
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { encodeFunctionData, erc20Abi, hashTypedData, keccak256 } from 'viem';

const PORT = Number.parseInt(process.env.MOCK_API_PORT ?? '3000', 10);
const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const AGENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const MERCHANT = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const ZERO32 = `0x${'0'.repeat(64)}`;
const hex = (byte, length) => `0x${byte.repeat(length)}`;

const T = {
  usdcD: hex('a1', 20), usdc: hex('a2', 20), rwa: hex('a3', 20), aqin: hex('a4', 20), aqout: hex('a5', 20),
};
const config = {
  deploymentId: '5f0c2c1e-8a44-4b57-9c2e-1d1f6f0a7b11', environment: 'LOCAL_DEMO', chainId: '31337',
  schemaVersion: '1', abiSchemaVersion: '1',
  tokens: [
    { address: T.usdcD, symbol: 'mUSDC', decimals: 6, isMock: true },
    { address: T.usdc, symbol: 'mUSDC', decimals: 6, isMock: true },
    { address: T.rwa, symbol: 'mRWA', decimals: 18, isMock: true },
    { address: T.aqin, symbol: 'AQIN', decimals: 18, isMock: true },
    { address: T.aqout, symbol: 'AQOUT', decimals: 18, isMock: true },
  ],
  routes: [
    { routeId: ZERO32, adapter: hex('00', 20), kind: 'DIRECT', inputToken: T.usdcD, outputToken: T.usdcD, subsidyModes: ['NONE'] },
    { routeId: hex('b4', 32), adapter: hex('c4', 20), kind: 'UNISWAP_V4', inputToken: T.rwa, outputToken: T.usdc, subsidyModes: ['NONE'] },
    { routeId: hex('b5', 32), adapter: hex('c5', 20), kind: 'AQUA', inputToken: T.aqin, outputToken: T.aqout, subsidyModes: ['NONE'] },
  ],
  confidencePolicy: { mode: 'LOCAL_DEMO', confirmationDepth: null },
};

function makeProfile(index, route, scale, balances) {
  const unit = 10n ** BigInt(scale);
  const vaultId = randomUUID();
  const policyId = randomUUID();
  return {
    vault: { vaultId, ownerAddress: OWNER, address: hex(`d${index}`, 20), deploymentId: config.deploymentId, chainId: '31337', paused: false, balances },
    policy: {
      policyId, onchainPolicyId: hex(`e${index}`, 32), vaultId,
      config: {
        agent: AGENT, inputToken: route.inputToken, settlementToken: route.outputToken, adapter: route.adapter, routeId: route.routeId,
        totalOutputBudget: String(300n * unit), epochOutputBudget: String(300n * unit), automaticOutputCap: String(100n * unit),
        escalationOutputCap: String(200n * unit), totalInputBudget: String(1000n * 10n ** 18n), maxInputPerPayment: String(500n * 10n ** 18n),
        validAfter: '0', validUntil: String(Math.floor(Date.now() / 1000) + 30 * 86400), allowedCategoryBitmap: '1', subsidyMode: 'NONE',
      },
      merchants: [{ merchantId: hex(`f${index}`, 32), recipient: MERCHANT, invoiceSigner: MERCHANT, category: '0' }],
      outputSpent: 0n, inputSpent: 0n, scale,
    },
  };
}
const profiles = [
  makeProfile(1, config.routes[0], 6, [{ token: T.usdcD, symbol: 'mUSDC', amountAtomic: '500000000' }]),
  makeProfile(2, config.routes[1], 6, [{ token: T.rwa, symbol: 'mRWA', amountAtomic: '1200000000000000000' }, { token: T.usdc, symbol: 'mUSDC', amountAtomic: '40000000' }]),
  makeProfile(3, config.routes[2], 18, [{ token: T.aqin, symbol: 'AQIN', amountAtomic: '5000000000000000000' }]),
];

const scenarios = [
  { scenarioId: 'compute', label: 'Demo Compute', description: 'A small, ordinary invoice safely inside the automatic cap. Expected outcome: ALLOW, real settlement.', amount: 5n, div: 10n },
  { scenarioId: 'hotel', label: 'Demo Hotel', description: 'An invoice above the automatic cap but within the escalation cap. Expected outcome: ESCALATE, paused pending a real owner approval.', amount: 180n, div: 1n },
  { scenarioId: 'over_budget', label: 'Over Hard Budget', description: "An invoice exceeding the policy's total output budget. Expected outcome: real BLOCK from the vault's own evaluation.", amount: 500n, div: 1n },
  { scenarioId: 'unauthorized_merchant', label: 'Unauthorized Merchant', description: 'An invoice signed by an identity this vault never registered. Expected outcome: INVALID_SIGNATURE, no payment is ever created.', amount: 5n, div: 10n },
  { scenarioId: 'duplicate', label: 'Duplicate Attempt', description: "Reuses a settled payment's invoice. Expected outcome: the same obligation, not a second payment.", amount: 0n, div: 1n, requiresSourcePayment: true },
];

const payments = new Map();
const runs = new Map();
let block = 120;

function progress(payment) {
  if (!payment.queuedAt) return;
  const age = Date.now() - payment.queuedAt;
  const profile = profiles.find((p) => p.vault.vaultId === payment.vaultId);
  if (age > 1500 && payment.executionStatus === 'QUEUED') {
    payment.executionStatus = 'SUBMITTED';
    payment.transaction = { hash: keccak256(`0x${Buffer.from(payment.paymentId).toString('hex')}`), replacementOf: null };
  }
  if (age > 4000 && payment.executionStatus === 'SUBMITTED') payment.executionStatus = 'INCLUDED';
  if (age > 6000 && payment.executionStatus === 'INCLUDED') {
    payment.executionStatus = 'SUCCEEDED';
    payment.confidence = 'LOCAL_DEMO';
    payment.reconciliation = 'MATCHED';
    const out = BigInt(payment.invoice.outputAmountAtomic);
    const direct = profile.policy.config.routeId === ZERO32;
    const input = direct ? out : (out * 10n ** 18n) / (233n * 10n ** BigInt(profile.policy.scale));
    payment.settlement = { actualInputAtomic: String(input), outputDeliveredAtomic: String(out), subsidyAmountAtomic: '0' };
    payment.observedAt = { blockNumber: String(++block), blockHash: hex('9a', 32), canonical: true, observedAt: new Date().toISOString() };
    profile.policy.outputSpent += out;
    profile.policy.inputSpent += input;
  }
}

function send(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(status < 400 ? { data, requestId: randomUUID() } : { error: { ...data, requestId: randomUUID() } }));
}
const fail = (response, status, code, message) => send(response, status, { code, message, retryable: false });

function prepared(to, data) {
  return { chainId: '31337', from: OWNER, to, data, value: '0', calldataHash: keccak256(data), abiSchemaVersion: '1' };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://mock');
  const route = `${request.method} ${url.pathname}`;
  let body = {};
  if (request.method !== 'GET') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  }
  const authed = (request.headers.cookie ?? '').includes('payguard_session=mock');
  const open = ['GET /health/ready', 'GET /v1/config', 'POST /v1/auth/challenges', 'POST /v1/auth/verify'];
  if (!open.includes(route) && !authed) return fail(response, 401, 'INVALID_SESSION', 'authentication required');
  for (const payment of payments.values()) progress(payment);
  let match;

  if (route === 'GET /health/ready') return send(response, 200, { status: 'READY', readyForPaymentExecution: true, checks: ['database', 'deployment', 'chain', 'worker', 'relayerBalance', 'vaultCode'].map((name) => ({ name, ok: true, detail: 'mock' })) });
  if (route === 'GET /v1/config') return send(response, 200, config);
  if (route === 'POST /v1/auth/challenges') {
    return send(response, 201, { challengeId: randomUUID(), message: `localhost:5173 wants you to sign in with your Ethereum account:\n${body.address}\n\nSign in to PayGuard (MOCK API).`, expiresAt: new Date(Date.now() + 3e5).toISOString() });
  }
  if (route === 'POST /v1/auth/verify') {
    response.setHeader('set-cookie', 'payguard_session=mock; Path=/; HttpOnly; SameSite=Strict');
    return send(response, 201, { walletAddress: OWNER, sessionExpiresAt: new Date(Date.now() + 36e5).toISOString(), csrfToken: 'mock-csrf' });
  }
  if (route === 'GET /v1/auth/session') return send(response, 200, { walletAddress: OWNER, sessionKind: 'BROWSER', sessionExpiresAt: new Date(Date.now() + 36e5).toISOString(), csrfToken: 'mock-csrf' });
  if (route === 'POST /v1/auth/logout') {
    response.setHeader('set-cookie', 'payguard_session=; Path=/; Max-Age=0');
    return send(response, 200, { revoked: true });
  }
  if (route === 'GET /v1/vaults') return send(response, 200, { items: profiles.map(({ vault }) => ({ vaultId: vault.vaultId, ownerAddress: OWNER, address: vault.address, deploymentId: vault.deploymentId, chainId: '31337' })), nextCursor: null });
  if ((match = /^GET \/v1\/vaults\/([^/]+)$/.exec(route))) {
    const profile = profiles.find((p) => p.vault.vaultId === match[1]);
    if (!profile) return fail(response, 404, 'RESOURCE_NOT_FOUND', 'vault not found');
    const { paused, ...vault } = profile.vault;
    return send(response, 200, { ...vault, executionPaused: paused, activePolicies: [{ policyResourceId: profile.policy.policyId, onchainPolicyId: profile.policy.onchainPolicyId, agent: AGENT }], observation: { blockNumber: String(block), blockHash: hex('9b', 32), canonical: true, observedAt: new Date().toISOString() } });
  }
  if ((match = /^POST \/v1\/vaults\/([^/]+)\/transactions$/.exec(route))) {
    const profile = profiles.find((p) => p.vault.vaultId === match[1]);
    const approve = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [profile.vault.address, BigInt(body.amountAtomic ?? '0')] });
    return send(response, 201, { operationId: randomUUID(), transactions: [prepared(body.token ?? profile.vault.address, approve)], review: { steps: [], multiStep: false } });
  }
  if ((match = /^GET \/v1\/policies\/([^/]+)$/.exec(route))) {
    const profile = profiles.find((p) => p.policy.policyId === match[1]);
    if (!profile) return fail(response, 404, 'RESOURCE_NOT_FOUND', 'policy not found');
    const { policy } = profile;
    return send(response, 200, { policyId: policy.policyId, onchainPolicyId: policy.onchainPolicyId, vault: profile.vault.address, config: policy.config, merchants: policy.merchants, status: 'ACTIVE', counters: { outputSpent: String(policy.outputSpent), epochOutputSpent: String(policy.outputSpent), inputSpent: String(policy.inputSpent) }, observation: { blockNumber: String(block), blockHash: hex('9b', 32), canonical: true, observedAt: new Date().toISOString() } });
  }
  if (route === 'POST /v1/policy-drafts') {
    const c = body.config;
    if (BigInt(c.automaticOutputCap) > BigInt(c.escalationOutputCap)) {
      return send(response, 422, { code: 'POLICY_VALIDATION_FAILED', message: 'policy draft is not valid', retryable: false, details: { problems: ['automaticOutputCap must be <= escalationOutputCap'] } });
    }
    return send(response, 201, { draftId: randomUUID(), draftVersion: '1', review: body, chainAuthorityCreated: false });
  }
  if (/^POST \/v1\/(policy-drafts|policies)\/[^/]+\/(transaction|revocation-transaction)$/.test(route)) {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [OWNER, 0n] });
    return send(response, 201, { transaction: prepared(profiles[0].vault.address, data), review: {} });
  }
  if (route === 'POST /v1/chain-observations') return send(response, 202, { operationId: randomUUID(), resourceType: 'observation', resourceId: randomUUID(), status: 'QUEUED' });

  if (route === 'GET /v1/payments') {
    const status = url.searchParams.get('status');
    const items = [...payments.values()].filter((p) => !status || p.executionStatus === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => ({ paymentId: p.paymentId, vaultId: p.vaultId, executionStatus: p.executionStatus, createdAt: p.createdAt }));
    return send(response, 200, { items, nextCursor: null });
  }
  if ((match = /^GET \/v1\/payments\/([^/]+)$/.exec(route))) {
    const payment = payments.get(match[1]);
    if (!payment) return fail(response, 404, 'RESOURCE_NOT_FOUND', 'payment not found');
    const { queuedAt, createdAt, ...view } = payment;
    return send(response, 200, view);
  }
  if ((match = /^GET \/v1\/payments\/([^/]+)\/timeline$/.exec(route))) {
    const payment = payments.get(match[1]);
    const items = [{ eventId: randomUUID(), type: payment?.policyDecision === 'BLOCK' ? 'PAYMENT_REJECTED' : 'PAYMENT_SUBMISSION_REQUESTED', createdAt: payment?.createdAt, body: null }];
    if (payment?.executionStatus === 'SUCCEEDED') items.push({ eventId: randomUUID(), type: 'PAYMENT_SUCCEEDED', createdAt: new Date().toISOString(), body: null });
    return send(response, 200, { items, nextCursor: null });
  }
  if ((match = /^GET \/v1\/transactions\/([^/]+)$/.exec(route))) return send(response, 200, { hash: match[1], from: hex('77', 20), nonce: '14', state: 'SUCCEEDED', replacementOf: null, canonicalReceiptIdentity: null, confidence: 'LOCAL_DEMO' });

  if ((match = /^GET \/v1\/payment-intents\/([^/]+)\/approval-typed-data$/.exec(route))) {
    const payment = [...payments.values()].find((p) => p.intentId === match[1]);
    const profile = profiles.find((p) => p.vault.vaultId === payment.vaultId);
    const typedData = {
      domain: { name: 'PayGuard', version: '1', chainId: 31337, verifyingContract: profile.vault.address },
      types: { ExceptionApproval: [{ name: 'intentHash', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'validUntil', type: 'uint48' }] },
      primaryType: 'ExceptionApproval',
      message: { intentHash: hex('ab', 32), nonce: BigInt(hex('ab', 32)).toString(10), validUntil: profile.policy.config.validUntil },
    };
    const computedDigest = hashTypedData({ ...typedData, message: { ...typedData.message, nonce: BigInt(typedData.message.nonce), validUntil: Number(typedData.message.validUntil) } });
    return send(response, 200, { typedData, expectedSigner: OWNER, computedDigest, nonceUsedOrCancelled: false, review: { merchant: MERCHANT, outputToken: payment.invoice.outputToken, exactOutputAtomic: payment.invoice.outputAmountAtomic, inputToken: payment.authorized.inputToken, maxInputAtomic: payment.authorized.maxInputAtomic, routeId: payment.authorized.routeId, override: 'AUTOMATIC_OUTPUT_CAP_ONLY', validUntil: typedData.message.validUntil } });
  }
  if (/^POST \/v1\/payment-intents\/[^/]+\/approvals$/.test(route)) return send(response, 201, { approvalId: randomUUID(), status: 'SIGNED' });
  if ((match = /^POST \/v1\/payment-intents\/([^/]+)\/submit$/.exec(route))) {
    const payment = [...payments.values()].find((p) => p.intentId === match[1]);
    payment.executionStatus = 'QUEUED';
    payment.queuedAt = Date.now();
    return send(response, 202, { operationId: randomUUID(), resourceType: 'payment_intent', resourceId: match[1], status: 'QUEUED', paymentId: payment.paymentId, intentId: match[1] });
  }

  if (route === 'GET /v1/demo/scenarios') {
    return send(response, 200, {
      scenarios: scenarios.map((s) => ({ scenarioId: s.scenarioId, label: s.label, description: s.description, permittedProfileIds: profiles.map((p) => p.policy.policyId), invoiceAmountAtomic: String((s.amount * 10n ** 6n) / s.div), requiresSourcePayment: !!s.requiresSourcePayment })),
      profiles: profiles.map((p) => ({ profileId: p.policy.policyId, label: 'mock', vaultId: p.vault.vaultId, policyResourceId: p.policy.policyId, routeKind: 'MOCK', outputToken: p.policy.config.settlementToken, available: true })),
    });
  }
  if (route === 'POST /v1/demo/runs') {
    const profile = profiles.find((p) => p.policy.policyId === body.profileId);
    const scenario = scenarios.find((s) => s.scenarioId === body.scenarioId);
    const runId = randomUUID();
    const base = { runId, deploymentId: config.deploymentId, profileId: body.profileId, scenarioId: body.scenarioId };
    if (scenario.scenarioId === 'unauthorized_merchant') {
      runs.set(runId, { ...base, stage: 'invoice', orchestrationStatus: 'REJECTED_INVALID_SIGNATURE', errorCode: 'INVALID_SIGNATURE', paymentId: null, intentId: null, operationId: null });
    } else if (scenario.scenarioId === 'duplicate') {
      runs.set(runId, { ...base, stage: 'submit', orchestrationStatus: 'DUPLICATE_NOT_PAID_TWICE', errorCode: 'INVOICE_ALREADY_PAID', paymentId: body.sourcePaymentId, intentId: randomUUID(), operationId: null });
    } else {
      const unit = 10n ** BigInt(profile.policy.scale);
      const out = (scenario.amount * unit) / scenario.div;
      const cfg = profile.policy.config;
      const decision = out + profile.policy.outputSpent > BigInt(cfg.totalOutputBudget) ? 'BLOCK' : out > BigInt(cfg.automaticOutputCap) ? 'ESCALATE' : 'ALLOW';
      const paymentId = randomUUID();
      const intentId = randomUUID();
      payments.set(paymentId, {
        paymentId, vaultId: profile.vault.vaultId, intentId, deploymentId: config.deploymentId, chainId: '31337', createdAt: new Date().toISOString(),
        invoice: { invoiceId: keccak256(`0x${Buffer.from(paymentId).toString('hex')}`), recipient: MERCHANT, outputToken: cfg.settlementToken, outputAmountAtomic: String(out) },
        authorized: { inputToken: cfg.inputToken, maxInputAtomic: cfg.routeId === ZERO32 ? String(out) : String((out * 10n ** 18n) / (200n * unit)), routeId: cfg.routeId },
        policyDecision: decision, executionStatus: decision === 'ALLOW' ? 'QUEUED' : decision === 'ESCALATE' ? 'AWAITING_APPROVAL' : 'DRAFT',
        confidence: 'UNOBSERVED', reconciliation: 'NOT_CHECKED', reasonCode: decision === 'ALLOW' ? 'OK' : decision === 'ESCALATE' ? 'APPROVAL_REQUIRED' : 'TOTAL_OUTPUT_BUDGET',
        settlement: null, transaction: null, observedAt: null, queuedAt: decision === 'ALLOW' ? Date.now() : null,
      });
      runs.set(runId, { ...base, stage: decision === 'ALLOW' ? 'submit' : 'intent', orchestrationStatus: decision === 'ALLOW' ? 'QUEUED' : decision === 'ESCALATE' ? 'AWAITING_APPROVAL' : 'BLOCKED', errorCode: decision === 'BLOCK' ? 'TOTAL_OUTPUT_BUDGET' : null, paymentId, intentId, operationId: decision === 'ALLOW' ? randomUUID() : null });
    }
    return send(response, 201, runs.get(runId));
  }
  if ((match = /^GET \/v1\/demo\/runs\/([^/]+)$/.exec(route))) {
    const run = runs.get(match[1]);
    if (!run) return fail(response, 404, 'RESOURCE_NOT_FOUND', 'demo run not found');
    const payment = run.paymentId ? payments.get(run.paymentId) : null;
    return send(response, 200, { ...run, livePaymentStatus: payment ? { executionStatus: payment.executionStatus, reconciliation: payment.reconciliation, policyDecision: payment.policyDecision } : null });
  }
  return fail(response, 404, 'RESOURCE_NOT_FOUND', 'no such route');
});

server.listen(PORT, '127.0.0.1', () => console.log(`MOCK PayGuard API (dev layout only) on http://127.0.0.1:${PORT}`));
