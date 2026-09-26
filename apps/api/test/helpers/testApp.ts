/**
 * Real end-to-end test harness: a real local Anvil instance with a REAL deployed PayGuardVault +
 * MockERC20 (packages/test-utils/vaultFixture), a real Postgres `payguard_test` database
 * (migrated), and a real Fastify app instance built with a real viem PublicClient pointed at that
 * Anvil instance. Tests exercise the app via `app.inject()` (no real HTTP socket needed, but
 * every DB/chain interaction underneath is real).
 */
import { randomUUID } from 'node:crypto';
import {
  AGENT_PRIVATE_KEY,
  type DeployedVaultFixture,
  deployVaultFixture,
  MERCHANT_PRIVATE_KEY,
  RELAYER_PRIVATE_KEY,
  spawnAnvil,
} from '@payguard/test-utils';
import { createPublicClient, http, keccak256, toHex } from 'viem';
import { type BuiltApp, buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createAppContext } from '../../src/context.js';
import { ensureMigrated, getTestPool, truncateAll, uuid } from './testDb.js';

let nextPort = 8600;

export interface TestHarness {
  built: BuiltApp;
  fixture: DeployedVaultFixture;
  pool: ReturnType<typeof getTestPool>;
  deploymentId: string;
  stopAnvil: () => Promise<void>;
}

export async function createTestHarness(options?: { demoEnabled?: boolean }): Promise<TestHarness> {
  const pool = getTestPool();
  await ensureMigrated(pool);
  await truncateAll(pool);

  const port = nextPort++;
  const anvil = await spawnAnvil({ port, chainId: 31337 });
  const fixture = await deployVaultFixture({ rpcUrl: anvil.rpcUrl, chainId: 31337 });

  const deploymentId = uuid();
  await pool.query(
    `INSERT INTO deployments (id, chain_id, instance_label, environment, start_block, genesis_or_anchor_hash, configuration)
     VALUES ($1, 31337, $2, 'LOCAL_DEMO', 0, $3, $4)`,
    [
      deploymentId,
      `test-${randomUUID()}`,
      Buffer.alloc(32, 1),
      JSON.stringify({
        tokens: [
          {
            address: fixture.tokenAddress,
            symbol: 'mUSDC',
            decimals: 6,
            isMock: true,
          },
        ],
        routes: [
          {
            routeId: `0x${'0'.repeat(64)}`,
            adapter: '0x0000000000000000000000000000000000000000',
            kind: 'DIRECT',
            inputToken: fixture.tokenAddress,
            outputToken: fixture.tokenAddress,
            subsidyModes: ['NONE'],
            enabled: true,
          },
        ],
        confidencePolicy: { mode: 'LOCAL_DEMO', confirmationDepth: null },
      }),
    ],
  );

  const config = loadConfig({
    DATABASE_URL: 'unused-direct-pool',
    PAYGUARD_DEPLOYMENT_ID: deploymentId,
    CHAIN_ID: '31337',
    RPC_URL: anvil.rpcUrl,
    API_SIWE_DOMAIN: '127.0.0.1:3999',
    API_SIWE_URI: 'http://127.0.0.1:3999',
    API_ALLOWED_ORIGINS: 'http://127.0.0.1:3999',
    RELAYER_ADDRESS: fixture.ownerAccount.address,
    // B2: the demo bridge's isolated signing identities are the SAME fixture accounts already
    // bound as `agent`/`invoiceSigner` on demo policies seeded via `seedPolicy` -- never the owner
    // key. `unauthorizedMerchant` reuses the relayer's key specifically because it is guaranteed,
    // by this fixture's own design, to never be bound to any policy anywhere.
    ...(options?.demoEnabled
      ? {
          PAYGUARD_DEMO_ENABLED: 'true',
          DEMO_AGENT_PRIVATE_KEY: AGENT_PRIVATE_KEY,
          DEMO_MERCHANT_PRIVATE_KEY: MERCHANT_PRIVATE_KEY,
          DEMO_UNAUTHORIZED_MERCHANT_PRIVATE_KEY: RELAYER_PRIVATE_KEY,
        }
      : {}),
  });

  const publicClient = createPublicClient({
    chain: {
      id: 31337,
      name: 'payguard-local-anvil',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [anvil.rpcUrl] } },
    },
    transport: http(anvil.rpcUrl),
  });

  const context = createAppContext({ config, pool, publicClient, now: () => new Date() });
  const built = buildApp(context);

  return {
    built,
    fixture,
    pool,
    deploymentId,
    stopAnvil: async () => {
      await built.app.close();
      await anvil.stop();
    },
  };
}

/** Registers a wallet + vault owned by the fixture's owner account, seeded directly into SQL. */
export async function seedOwnerVault(
  harness: TestHarness,
): Promise<{ walletId: string; vaultId: string }> {
  const walletId = uuid();
  await harness.pool.query(
    'INSERT INTO wallets (id, address) VALUES ($1, $2) ON CONFLICT (address) DO NOTHING',
    [walletId, Buffer.from(harness.fixture.ownerAccount.address.slice(2), 'hex')],
  );
  const existingWallet = await harness.pool.query('SELECT id FROM wallets WHERE address = $1', [
    Buffer.from(harness.fixture.ownerAccount.address.slice(2), 'hex'),
  ]);
  const resolvedWalletId = existingWallet.rows[0].id as string;

  const vaultId = uuid();
  const vaultAddressBytes = Buffer.from(harness.fixture.vaultAddress.slice(2), 'hex');
  // B1 (INT-006): the vault's real deployed code, not a placeholder hash -- health.ts's `vaultCode`
  // check re-observes live code and compares it against exactly this value.
  const deployedCode = await harness.fixture.publicClient.getCode({
    address: harness.fixture.vaultAddress,
  });
  if (!deployedCode) throw new Error('seedOwnerVault: no code observed at vault address');
  await harness.pool.query(
    `INSERT INTO vaults (id, deployment_id, owner_wallet_id, address, runtime_code_hash, abi_schema_version)
     VALUES ($1,$2,$3,$4,$5,'1')
     ON CONFLICT (deployment_id, address) DO NOTHING`,
    [
      vaultId,
      harness.deploymentId,
      resolvedWalletId,
      vaultAddressBytes,
      Buffer.from(keccak256(deployedCode).slice(2), 'hex'),
    ],
  );
  const existingVault = await harness.pool.query(
    'SELECT id FROM vaults WHERE deployment_id = $1 AND address = $2',
    [harness.deploymentId, vaultAddressBytes],
  );
  const resolvedVaultId = existingVault.rows[0].id as string;
  return { walletId: resolvedWalletId, vaultId: resolvedVaultId };
}

/**
 * Creates an authenticated session directly in SQL (skips the SIWE round trip for tests that
 * aren't exercising auth itself). `tokenHash` mirrors exactly what `auth.ts`'s real login flow
 * stores, so `resolveSession` finds it the same way a real session would be found.
 */
export async function seedSession(
  harness: Pick<TestHarness, 'pool'>,
  params: { walletId: string; sessionKind: 'BROWSER' | 'AGENT'; chainId?: bigint },
): Promise<{ token: string; csrfToken: string | null }> {
  const { createHash, randomBytes } = await import('node:crypto');
  const token = randomBytes(32).toString('base64url');
  const csrfToken = params.sessionKind === 'BROWSER' ? randomBytes(32).toString('base64url') : null;
  const sha256 = (input: string) => createHash('sha256').update(input).digest();

  await harness.pool.query(
    `INSERT INTO sessions (id, wallet_id, token_hash, csrf_token_hash, session_kind, chain_id, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6, now() + interval '1 hour')`,
    [
      uuid(),
      params.walletId,
      sha256(token),
      csrfToken ? sha256(csrfToken) : null,
      params.sessionKind,
      (params.chainId ?? 31337n).toString(10),
    ],
  );
  return { token, csrfToken };
}

/** Seeds a wallet + vault at an arbitrary address, for a chosen owner wallet id. */
export async function seedVaultForWallet(
  harness: TestHarness,
  params: { ownerWalletId: string; address: `0x${string}` },
): Promise<{ vaultId: string }> {
  const vaultId = uuid();
  await harness.pool.query(
    `INSERT INTO vaults (id, deployment_id, owner_wallet_id, address, runtime_code_hash, abi_schema_version)
     VALUES ($1,$2,$3,$4,$5,'1')`,
    [
      vaultId,
      harness.deploymentId,
      params.ownerWalletId,
      Buffer.from(params.address.slice(2), 'hex'),
      Buffer.from(keccak256(toHex('runtime')).slice(2), 'hex'),
    ],
  );
  return { vaultId };
}

/** Seeds a bare wallet row (no vault) for an arbitrary address, returning its resource id. */
export async function seedWallet(harness: TestHarness, address: `0x${string}`): Promise<string> {
  const walletId = uuid();
  await harness.pool.query(
    'INSERT INTO wallets (id, address) VALUES ($1, $2) ON CONFLICT (address) DO NOTHING',
    [walletId, Buffer.from(address.slice(2), 'hex')],
  );
  const existing = await harness.pool.query('SELECT id FROM wallets WHERE address = $1', [
    Buffer.from(address.slice(2), 'hex'),
  ]);
  return existing.rows[0].id as string;
}

/**
 * Directly seeds a `policies` row (+ optional merchant snapshots), bypassing the not-yet-built
 * Stage 5 worker that would normally create one from a verified createPolicy receipt. Stage 4's
 * GET /v1/policies/{id} and revocation-transaction routes are tested against this seeded state.
 */
export async function seedPolicy(
  harness: TestHarness,
  params: {
    vaultId: string;
    onchainPolicyId: `0x${string}`;
    config: {
      agent: `0x${string}`;
      inputToken: `0x${string}`;
      settlementToken: `0x${string}`;
      adapter: `0x${string}`;
      routeId: `0x${string}`;
      totalOutputBudget: string;
      epochOutputBudget: string;
      automaticOutputCap: string;
      escalationOutputCap: string;
      totalInputBudget: string;
      maxInputPerPayment: string;
      validAfter: string;
      validUntil: string;
      allowedCategoryBitmap: string;
      subsidyMode: 'NONE' | 'REQUIRED' | 'BEST_EFFORT';
    };
    merchants?: Array<{
      merchantId: `0x${string}`;
      recipient: `0x${string}`;
      invoiceSigner: `0x${string}`;
      category: number;
    }>;
  },
): Promise<{ policyId: string }> {
  const subsidyOnchain = { NONE: 0, REQUIRED: 1, BEST_EFFORT: 2 }[params.config.subsidyMode];
  const policyId = uuid();
  const addr = (a: string) => Buffer.from(a.slice(2), 'hex');
  await harness.pool.query(
    `INSERT INTO policies (
       id, vault_id, onchain_policy_id, agent, input_token, settlement_token, adapter, route_id,
       total_output_budget, epoch_output_budget, automatic_output_cap, escalation_output_cap,
       total_input_budget, max_input_per_payment, valid_after, valid_until, subsidy_mode,
       canonical_config_bytes, config_projection, observed_status, observed_block_hash
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'ACTIVE',$20)`,
    [
      policyId,
      params.vaultId,
      Buffer.from(params.onchainPolicyId.slice(2), 'hex'),
      addr(params.config.agent),
      addr(params.config.inputToken),
      addr(params.config.settlementToken),
      addr(params.config.adapter),
      Buffer.from(params.config.routeId.slice(2), 'hex'),
      params.config.totalOutputBudget,
      params.config.epochOutputBudget,
      params.config.automaticOutputCap,
      params.config.escalationOutputCap,
      params.config.totalInputBudget,
      params.config.maxInputPerPayment,
      params.config.validAfter,
      params.config.validUntil,
      subsidyOnchain,
      Buffer.alloc(32),
      JSON.stringify(params.config),
      Buffer.alloc(32),
    ],
  );
  for (const merchant of params.merchants ?? []) {
    await harness.pool.query(
      `INSERT INTO policy_merchants (policy_id, merchant_id, recipient, invoice_signer, category)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        policyId,
        Buffer.from(merchant.merchantId.slice(2), 'hex'),
        addr(merchant.recipient),
        addr(merchant.invoiceSigner),
        merchant.category,
      ],
    );
  }
  return { policyId };
}

export function authHeaders(session: { token: string; csrfToken: string | null }, origin?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${session.token}` };
  return headers;
}

export function browserHeaders(
  session: { token: string; csrfToken: string | null },
  origin: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    cookie: `payguard_session=${session.token}`,
    origin,
  };
  if (session.csrfToken) headers['x-csrf-token'] = session.csrfToken;
  return headers;
}
