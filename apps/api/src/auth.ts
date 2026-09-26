/**
 * Session resolution, browser CSRF/Origin enforcement, and credential issuance.
 *
 * A session proves WHO is calling. It never proves WHAT they may spend -- CLAUDE.md: "A login
 * session is not spending authority." Authorization for a specific resource is derived separately
 * in `authz.ts` from ownership and on-chain policy bindings, never from anything in the request.
 *
 * Cookies are built by hand rather than via a plugin so the exact attributes are visible and
 * testable. `Secure` is never conditionally dropped to make local development work (SPEC-014):
 * `http://localhost` is a W3C potentially-trustworthy origin, so browsers honour Secure there.
 */
import { createHash, randomBytes } from 'node:crypto';
import { resolveSessionByTokenHash, type SessionKind, type SessionRow } from '@payguard/db';
import type { Address } from '@payguard/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CookieConfig } from './config.js';
import type { AppContext } from './context.js';
import { ApiError } from './errors.js';

export interface AuthenticatedSession {
  session: SessionRow;
  walletAddress: Address;
  walletId: string;
  kind: SessionKind;
  /** The chain from the VERIFIED SIWE message; checked against every accessed deployment. */
  chainId: bigint;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthenticatedSession;
    requestId: string;
  }
}

export function sha256(input: string | Buffer): Buffer {
  return createHash('sha256').update(input).digest();
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function bufferToAddress(buffer: Buffer): Address {
  return `0x${buffer.toString('hex')}` as Address;
}

export function addressToBuffer(address: string): Buffer {
  return Buffer.from(address.slice(2), 'hex');
}

/** Minimal, explicit cookie parsing -- only the one cookie this API issues is of interest. */
export function readCookie(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

export function buildSessionCookie(value: string, cookie: CookieConfig): string {
  const attributes = [
    `${cookie.name}=${encodeURIComponent(value)}`,
    `Path=${cookie.path}`,
    `Max-Age=${cookie.maxAgeSeconds}`,
    'HttpOnly',
    `SameSite=${cookie.sameSite}`,
  ];
  if (cookie.secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function buildClearedSessionCookie(cookie: CookieConfig): string {
  const attributes = [
    `${cookie.name}=`,
    `Path=${cookie.path}`,
    'Max-Age=0',
    'HttpOnly',
    `SameSite=${cookie.sameSite}`,
  ];
  if (cookie.secure) attributes.push('Secure');
  return attributes.join('; ');
}

/**
 * Resolves whichever credential was presented. A bearer token identifies an AGENT session; the
 * cookie identifies a BROWSER session. Presenting a browser cookie as a bearer token (or vice
 * versa) cannot upgrade anything, because the session's kind comes from the stored row -- which
 * was fixed at challenge creation (SPEC-004), not chosen at verification.
 */
export async function resolveSession(
  context: AppContext,
  request: FastifyRequest,
): Promise<AuthenticatedSession | null> {
  const authorization = request.headers.authorization;
  let presented: string | null = null;

  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    presented = authorization.slice('Bearer '.length).trim();
  } else {
    presented = readCookie(request, context.config.cookie.name);
  }
  if (!presented) return null;

  const resolved = await resolveSessionByTokenHash(context.pool, {
    tokenHash: sha256(presented),
    now: context.now(),
  });
  if (!resolved) return null;

  return {
    session: resolved.session,
    walletAddress: bufferToAddress(resolved.walletAddress),
    walletId: resolved.session.walletId,
    kind: resolved.session.sessionKind,
    chainId: resolved.session.chainId,
  };
}

export function requireSession(request: FastifyRequest): AuthenticatedSession {
  if (!request.auth) {
    throw new ApiError('INVALID_SESSION', 'authentication required');
  }
  return request.auth;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Browser mutation guard: an accepted Origin AND a session-bound CSRF token.
 *
 * Applies only to BROWSER sessions, because only they are subject to ambient cookie authority --
 * an agent presenting a bearer token is not vulnerable to cross-site form submission. These checks
 * are never globally disabled to accommodate a local origin; the allowlist is explicit instead.
 */
export function enforceBrowserMutationGuards(
  context: AppContext,
  request: FastifyRequest,
  auth: AuthenticatedSession,
): void {
  if (!MUTATING_METHODS.has(request.method)) return;
  if (auth.kind !== 'BROWSER') return;

  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !context.config.allowedOrigins.includes(origin)) {
    throw new ApiError('ORIGIN_NOT_ALLOWED', 'request Origin is not in the configured allowlist', {
      origin: typeof origin === 'string' ? origin : null,
    });
  }

  const presented = request.headers['x-csrf-token'];
  if (typeof presented !== 'string' || presented.length === 0) {
    throw new ApiError('CSRF_REQUIRED', 'browser mutations require an X-CSRF-Token header');
  }
  const expected = auth.session.csrfTokenHash;
  if (!expected || !sha256(presented).equals(expected)) {
    throw new ApiError('CSRF_REQUIRED', 'X-CSRF-Token does not match this session');
  }
}

/** Commands that create resources or execute work require an idempotency key. */
export function requireIdempotencyKey(request: FastifyRequest): string {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length === 0 || key.length > 200) {
    throw new ApiError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'this command requires a non-empty Idempotency-Key header of at most 200 characters',
    );
  }
  return key;
}

/** Convenience for handlers that must run before any reply body is produced. */
export function setSessionCookie(reply: FastifyReply, value: string, cookie: CookieConfig): void {
  reply.header('set-cookie', buildSessionCookie(value, cookie));
}
