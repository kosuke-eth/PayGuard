/**
 * SIWE session establishment.
 *
 * Login endpoints deliberately do NOT require a pre-existing session (API_CONTRACT.md: "Login
 * challenge creation and signature verification are session-establishment endpoints, so neither
 * requires a pre-existing session"); `app.ts` exempts them explicitly rather than by accident.
 *
 * Logout revokes the API session ONLY. It is not, and must never be reported as, revocation of an
 * agent's on-chain authority -- that requires a separate owner transaction.
 */
import { randomUUID } from 'node:crypto';
import {
  consumeAuthChallenge,
  createAuthChallenge,
  createSession,
  findOrCreateWallet,
  revokeSession,
  rotateSessionCsrfToken,
  withTransaction,
} from '@payguard/db';
import type { Address, Hash32 } from '@payguard/domain';
import type { FastifyInstance } from 'fastify';
import { keccak256, toHex } from 'viem';
import {
  addressToBuffer,
  buildClearedSessionCookie,
  buildSessionCookie,
  generateToken,
  requireSession,
  sha256,
} from '../auth.js';
import type { AppContext } from '../context.js';
import { ApiError, successEnvelope } from '../errors.js';
import { AUTH_CHALLENGE_BODY, AUTH_VERIFY_BODY, EMPTY_BODY } from '../schemas.js';
import { assertChallengeFields, buildChallenge, verifySiweSignature } from '../siwe.js';

interface ChallengeBody {
  address: Address;
  chainId: string;
  sessionKind: 'BROWSER' | 'AGENT';
}

interface VerifyBody {
  challengeId: string;
  signature: `0x${string}`;
}

export function registerAuthRoutes(app: FastifyInstance, context: AppContext): void {
  app.post<{ Body: ChallengeBody }>(
    '/v1/auth/challenges',
    { schema: { body: AUTH_CHALLENGE_BODY } },
    async (request, reply) => {
      const { address, chainId, sessionKind } = request.body;
      const requestedChainId = BigInt(chainId);

      // A challenge for a chain this deployment does not serve can never become a usable session,
      // so it is refused at creation rather than after a pointless signature round trip.
      if (requestedChainId !== context.config.chainId) {
        throw new ApiError(
          'DEPLOYMENT_MISMATCH',
          'requested chainId is not served by this deployment',
          { expected: context.config.chainId.toString(10) },
        );
      }

      const issuedAt = context.now();
      const expiresAt = new Date(issuedAt.getTime() + context.config.challengeTtlSeconds * 1000);
      const { message, nonce } = buildChallenge({
        address,
        chainId: requestedChainId,
        domain: context.config.siweDomain,
        uri: context.config.siweUri,
        sessionKind,
        issuedAt,
        expiresAt,
      });

      const challengeId = randomUUID();
      await withTransaction(context.pool, async (client) => {
        const wallet = await findOrCreateWallet(client, {
          id: randomUUID(),
          address: addressToBuffer(address),
        });
        await createAuthChallenge(client, {
          id: challengeId,
          walletId: wallet.id,
          chainId: requestedChainId,
          // The nonce is stored hashed; the plaintext lives only inside the message itself.
          nonceHash: Buffer.from(keccak256(toHex(nonce)).slice(2), 'hex'),
          expectedMessage: message,
          // SPEC-004: captured HERE so verification cannot swap credential-delivery mode.
          sessionKind,
          expiresAt,
        });
      });

      return reply
        .status(201)
        .send(
          successEnvelope(
            { challengeId, message, expiresAt: expiresAt.toISOString() },
            String(request.id),
          ),
        );
    },
  );

  app.post<{ Body: VerifyBody }>(
    '/v1/auth/verify',
    { schema: { body: AUTH_VERIFY_BODY } },
    async (request, reply) => {
      const { challengeId, signature } = request.body;
      const now = context.now();

      // Read the challenge OUTSIDE the write transaction: signature verification may require an
      // RPC round trip (ERC-1271), and CLAUDE.md forbids holding a SQL transaction across an RPC.
      const existing = await context.pool.query(
        `SELECT c.*, w.address AS wallet_address
         FROM auth_challenges c JOIN wallets w ON w.id = c.wallet_id
         WHERE c.id = $1`,
        [challengeId],
      );
      const row = existing.rows[0];
      if (!row) {
        throw new ApiError('INVALID_SESSION', 'challenge not found');
      }
      if (row.consumed_at !== null) {
        // Replay of an already-used challenge.
        throw new ApiError('INVALID_SESSION', 'challenge has already been used');
      }

      const walletAddress = `0x${(row.wallet_address as Buffer).toString('hex')}` as Address;
      const storedMessage = row.expected_message as string;
      const storedChainId = BigInt(row.chain_id as string);
      const storedSessionKind = row.session_kind as 'BROWSER' | 'AGENT';

      // Validate the STORED message's own fields. A caller never supplies the message.
      assertChallengeFields(storedMessage, {
        address: walletAddress,
        chainId: storedChainId,
        domain: context.config.siweDomain,
        uri: context.config.siweUri,
        now,
      });

      const verdict = await verifySiweSignature({
        message: storedMessage,
        signature,
        address: walletAddress,
        publicClient: context.publicClient,
      });
      if (verdict.kind === 'UNKNOWN') {
        // Infrastructure could not answer. This is NOT "your signature is invalid".
        throw new ApiError(
          'CHAIN_STATE_UNKNOWN',
          'could not complete a contract-account signature check; retry',
          { detail: verdict.detail },
        );
      }
      if (verdict.kind === 'INVALID') {
        throw new ApiError('INVALID_SESSION', 'signature does not match the challenge');
      }

      const token = generateToken();
      const csrfToken = storedSessionKind === 'BROWSER' ? generateToken() : null;
      const expiresAt = new Date(now.getTime() + context.config.sessionTtlSeconds * 1000);

      // Consume + create atomically. If a concurrent request already consumed this challenge, the
      // CAS returns no row and this request fails -- one challenge yields exactly one session.
      const created = await withTransaction(context.pool, async (client) => {
        const consumed = await consumeAuthChallenge(client, { id: challengeId, now });
        if (!consumed) return null;
        return createSession(client, {
          id: randomUUID(),
          walletId: consumed.walletId,
          // token_hash is NOT NULL for both kinds: the browser cookie value is hashed here too.
          tokenHash: sha256(token),
          csrfTokenHash: csrfToken ? sha256(csrfToken) : null,
          sessionKind: consumed.sessionKind,
          chainId: consumed.chainId,
          expiresAt,
        });
      });

      if (!created) {
        throw new ApiError('INVALID_SESSION', 'challenge has already been used');
      }

      if (storedSessionKind === 'BROWSER') {
        reply.header('set-cookie', buildSessionCookie(token, context.config.cookie));
        return reply.status(201).send(
          successEnvelope(
            {
              walletAddress,
              sessionExpiresAt: expiresAt.toISOString(),
              csrfToken,
            },
            String(request.id),
          ),
        );
      }

      return reply.status(201).send(
        successEnvelope(
          {
            walletAddress,
            sessionExpiresAt: expiresAt.toISOString(),
            // The bearer token authorizes the API session only; it is not spending authority.
            accessToken: token,
          },
          String(request.id),
        ),
      );
    },
  );

  // B1 (item 6): the ONLY recovery a browser client has after a reload. The httpOnly session
  // cookie survives a reload; the in-memory CSRF token and walletAddress the frontend was holding
  // do not. Since `csrf_token_hash` is stored one-way, the original token can never be handed
  // back -- the honest recovery is to mint and store a NEW one (never to weaken/skip the CSRF
  // check to work around its absence). A GET is not itself subject to `enforceBrowserMutationGuards`
  // (that guard only applies to mutating methods), so this read is safe to call with only the
  // cookie present; every subsequent MUTATING request still needs the freshly-rotated token.
  app.get('/v1/auth/session', async (request, reply) => {
    const auth = requireSession(request);
    let csrfToken: string | null = null;
    if (auth.kind === 'BROWSER') {
      csrfToken = generateToken();
      const rotated = await rotateSessionCsrfToken(context.pool, {
        sessionId: auth.session.id,
        csrfTokenHash: sha256(csrfToken),
        now: context.now(),
      });
      if (!rotated) {
        // The session was revoked/expired in the instant between resolveSession's read and this
        // write -- refuse rather than hand back a token bound to a session that is no longer live.
        throw new ApiError('INVALID_SESSION', 'session is no longer valid');
      }
    }
    return reply.status(200).send(
      successEnvelope(
        {
          walletAddress: auth.walletAddress,
          sessionKind: auth.kind,
          sessionExpiresAt: auth.session.expiresAt.toISOString(),
          ...(auth.kind === 'BROWSER' ? { csrfToken } : {}),
        },
        String(request.id),
      ),
    );
  });

  app.post('/v1/auth/logout', { schema: { body: EMPTY_BODY } }, async (request, reply) => {
    const auth = requireSession(request);
    await withTransaction(context.pool, async (client) => {
      await revokeSession(client, { id: auth.session.id, now: context.now() });
    });
    if (auth.kind === 'BROWSER') {
      reply.header('set-cookie', buildClearedSessionCookie(context.config.cookie));
    }
    // `revoked` refers to the API session ONLY -- no on-chain agent authority changed.
    return reply.status(200).send(
      successEnvelope(
        {
          revoked: true,
          onChainAgentAuthorityUnchanged: true,
        },
        String(request.id),
      ),
    );
  });
}

export type { Hash32 };
