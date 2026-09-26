/**
 * API process configuration.
 *
 * Two rules this file exists to enforce:
 *
 * 1. **No owner private key, ever.** CLAUDE.md: "Owner keys stay outside API/worker processes" and
 *    "No API or worker configuration may require an owner private key." There is deliberately no
 *    field here that could hold one, and `assertNoOwnerKeyConfigured` fails startup if the
 *    environment looks like someone tried.
 *
 * 2. **SPEC-018: exactly one active deployment.** `GET /v1/config` takes no parameters, so the
 *    process resolves a single active deployment. A request-supplied `deploymentId` is validated
 *    as EQUAL to it, never used to select one -- otherwise a caller could reach another
 *    deployment's projections by naming it.
 */

export type Environment = 'LOCAL_DEMO' | 'TESTNET';

export interface CookieConfig {
  name: string;
  /**
   * SPEC-014: `Secure` stays ON for local development. `http://localhost` and `http://127.0.0.1`
   * are "potentially trustworthy origins" per W3C secure-contexts, so real browsers DO honour
   * Secure cookies there -- the local arrangement does not require weakening the cookie, and
   * CSRF/Origin checks are never globally disabled. Set `API_TLS_ENABLED` for real HTTPS.
   */
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
  path: string;
  maxAgeSeconds: number;
}

export interface ApiConfig {
  port: number;
  host: string;
  databaseUrl: string;
  rpcUrl: string;
  chainId: bigint;
  environment: Environment;
  /** SPEC-018: the single active deployment this process serves. */
  deploymentId: string;
  /** SIWE domain/URI the server puts into every challenge and re-checks at verification. */
  siweDomain: string;
  siweUri: string;
  /** Explicit allowlist. An unlisted Origin is rejected on browser mutations. */
  allowedOrigins: string[];
  cookie: CookieConfig;
  sessionTtlSeconds: number;
  challengeTtlSeconds: number;
  /** The account the worker will relay from; used ONLY as the `from` of eth_call simulations. */
  relayerAddress: string | null;
  tlsEnabled: boolean;
  /** GET /health/ready: a worker_heartbeat row older than this fails the `worker` check. */
  workerHeartbeatStalenessSeconds: number;
  /**
   * B2: the demo bridge (`/v1/demo/*`). `undefined` when demo mode is off -- the routes gate on
   * this being present, never on `environment === 'LOCAL_DEMO'` alone (an operator could point a
   * LOCAL_DEMO-labeled deployment at real value; the label is not authorization). These are
   * ISOLATED demo merchant/agent signing keys, never the owner key -- `assertNoOwnerKeyConfigured`
   * above still applies unconditionally and independently of this flag.
   */
  demo: DemoConfig | null;
}

export interface DemoConfig {
  /** Merchant identity the bridge signs demo invoices with, for pre-enrolled demo profiles only. */
  merchantPrivateKey: `0x${string}`;
  /** Agent identity the bridge signs demo intents with and logs in as via real SIWE, per run. */
  agentPrivateKey: `0x${string}`;
  /**
   * A THIRD identity, deliberately never registered as an `invoiceSigner` on any demo policy --
   * used only by the "unauthorized merchant" scenario to produce a REAL `INVALID_SIGNATURE`
   * rejection from `/v1/invoices`, never a fabricated one.
   */
  unauthorizedMerchantPrivateKey: `0x${string}`;
}

/** Environment variable names that would imply an owner signing key lives in this process. */
const FORBIDDEN_KEY_VARS = [
  'OWNER_PRIVATE_KEY',
  'VAULT_OWNER_PRIVATE_KEY',
  'OWNER_KEY',
  'OWNER_MNEMONIC',
];

/**
 * Hard startup check. The API prepares transactions for an owner to sign in their own wallet; it
 * must never be able to sign for them. If an operator wires an owner key into this process, that
 * is a deployment mistake worth refusing to boot over, not a warning to log.
 */
export function assertNoOwnerKeyConfigured(env: NodeJS.ProcessEnv = process.env): void {
  const present = FORBIDDEN_KEY_VARS.filter((name) => {
    const value = env[name];
    return typeof value === 'string' && value.length > 0;
  });
  if (present.length > 0) {
    throw new Error(
      `refusing to start: owner signing material must never be configured in the API process (found: ${present.join(', ')})`,
    );
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing required environment variable ${name}`);
  }
  return value;
}

/** Strict positive-integer parse (port/TTL/staleness vars) -- never silently coerces to NaN/0. */
function optionalInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^[0-9]+$/.test(raw) || Number.parseInt(raw, 10) <= 0) {
    throw new Error(`invalid environment variable ${name}: expected a positive integer, got "${raw}"`);
  }
  return Number.parseInt(raw, 10);
}

/** Strict BigInt parse (CHAIN_ID) -- BigInt() on garbage input throws an unlabeled SyntaxError. */
function optionalBigInt(env: NodeJS.ProcessEnv, name: string, fallback: string): bigint {
  const raw = env[name] ?? fallback;
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`invalid environment variable ${name}: expected a non-negative integer, got "${raw}"`);
  }
  return BigInt(raw);
}

function optionalEnum<T extends string>(
  env: NodeJS.ProcessEnv,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new Error(
      `invalid environment variable ${name}: expected one of [${allowed.join(', ')}], got "${raw}"`,
    );
  }
  return raw as T;
}

/** Loose hex-private-key shape check -- not a cryptographic validation, just "looks like a key". */
function isHexPrivateKey(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function loadDemoConfig(env: NodeJS.ProcessEnv): DemoConfig | null {
  if (env.PAYGUARD_DEMO_ENABLED !== 'true') return null;
  const merchant = required(env, 'DEMO_MERCHANT_PRIVATE_KEY');
  const agent = required(env, 'DEMO_AGENT_PRIVATE_KEY');
  const unauthorizedMerchant = required(env, 'DEMO_UNAUTHORIZED_MERCHANT_PRIVATE_KEY');
  for (const [name, value] of [
    ['DEMO_MERCHANT_PRIVATE_KEY', merchant],
    ['DEMO_AGENT_PRIVATE_KEY', agent],
    ['DEMO_UNAUTHORIZED_MERCHANT_PRIVATE_KEY', unauthorizedMerchant],
  ] as const) {
    if (!isHexPrivateKey(value)) {
      throw new Error(`${name} must be a 0x-prefixed 32-byte hex private key`);
    }
  }
  return {
    merchantPrivateKey: merchant as `0x${string}`,
    agentPrivateKey: agent as `0x${string}`,
    unauthorizedMerchantPrivateKey: unauthorizedMerchant as `0x${string}`,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  assertNoOwnerKeyConfigured(env);

  const tlsEnabled = env.API_TLS_ENABLED === 'true';
  const host = env.API_HOST ?? '127.0.0.1';
  const port = optionalInt(env, 'API_PORT', 3000);
  const scheme = tlsEnabled ? 'https' : 'http';
  const siweDomain = env.API_SIWE_DOMAIN ?? `${host}:${port}`;
  const sessionTtlSeconds = optionalInt(env, 'API_SESSION_TTL_SECONDS', 3600);

  return {
    port,
    host,
    databaseUrl: required(env, 'DATABASE_URL'),
    rpcUrl: env.RPC_URL ?? 'http://127.0.0.1:8545',
    chainId: optionalBigInt(env, 'CHAIN_ID', '31337'),
    environment: optionalEnum(env, 'PAYGUARD_ENVIRONMENT', ['LOCAL_DEMO', 'TESTNET'], 'LOCAL_DEMO'),
    deploymentId: required(env, 'PAYGUARD_DEPLOYMENT_ID'),
    siweDomain,
    siweUri: env.API_SIWE_URI ?? `${scheme}://${siweDomain}`,
    allowedOrigins: (env.API_ALLOWED_ORIGINS ?? `${scheme}://${siweDomain}`)
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    cookie: {
      name: env.API_COOKIE_NAME ?? 'payguard_session',
      secure: env.API_COOKIE_SECURE !== 'false',
      sameSite: optionalEnum(env, 'API_COOKIE_SAMESITE', ['Strict', 'Lax', 'None'], 'Strict'),
      path: '/',
      maxAgeSeconds: sessionTtlSeconds,
    },
    sessionTtlSeconds,
    challengeTtlSeconds: optionalInt(env, 'API_CHALLENGE_TTL_SECONDS', 300),
    relayerAddress: env.RELAYER_ADDRESS ?? null,
    tlsEnabled,
    workerHeartbeatStalenessSeconds: optionalInt(env, 'API_WORKER_HEARTBEAT_STALENESS_SECONDS', 30),
    demo: loadDemoConfig(env),
  };
}
