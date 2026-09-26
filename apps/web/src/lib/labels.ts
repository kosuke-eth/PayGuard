/** Display vocabulary. One name per thing, used everywhere. */
import type { PublicConfig, PublicTokenConfig } from '@payguard/integration';
import type { ExecutionStatus, PolicyDecision } from './types';

const ROUTE_LABELS: Record<string, string> = {
  DIRECT: 'Direct transfer',
  UNISWAP_V4: 'Uniswap v4',
  AQUA: 'Aqua / SwapVM',
};

export function isKnownRouteKind(kind: string): boolean {
  return kind in ROUTE_LABELS;
}

/** An unrecognised kind is shown verbatim; it is never silently aliased to a known route. */
export function routeLabel(kind: string | undefined): string {
  if (!kind) return 'Unknown route';
  return ROUTE_LABELS[kind] ?? `Unrecognised route (${kind})`;
}

export function findRoute(config: PublicConfig, routeId: string | null | undefined) {
  if (!routeId) return undefined;
  return config.routes.find((route) => route.routeId.toLowerCase() === routeId.toLowerCase());
}

/** Tokens are resolved by ADDRESS. Two demo tokens share the symbol mUSDC. */
export function findToken(
  config: PublicConfig,
  address: string | null | undefined,
): PublicTokenConfig | undefined {
  if (!address) return undefined;
  return config.tokens.find((token) => token.address.toLowerCase() === address.toLowerCase());
}

export function shortHex(value: string | null | undefined, lead = 6, tail = 4): string {
  if (!value) return '—';
  if (value.length <= lead + tail + 2) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export const DECISION_LABEL: Record<PolicyDecision, string> = {
  ALLOW: 'Allow',
  ESCALATE: 'Escalate',
  BLOCK: 'Block',
  UNKNOWN: 'Unknown',
};

export const EXECUTION_TEXT: Record<ExecutionStatus, string> = {
  DRAFT: 'Draft',
  AWAITING_APPROVAL: 'Awaiting owner approval',
  READY: 'Ready to submit',
  QUEUED: 'Queued for the relayer',
  SIGNED: 'Signed by the relayer',
  SUBMITTED: 'Submitted to the chain',
  UNKNOWN: 'Unknown — not yet confirmed',
  INCLUDED: 'Included in a block',
  SUCCEEDED: 'Succeeded',
  REVERTED: 'Reverted',
  CANCELLED: 'Cancelled',
  REORGED: 'Reorged out',
};

/** States after which a payment will not change without a new action. */
export const SETTLED_STATES: ReadonlySet<ExecutionStatus> = new Set([
  'SUCCEEDED',
  'REVERTED',
  'CANCELLED',
]);

export function isInFlight(status: ExecutionStatus, decision: PolicyDecision): boolean {
  if (decision === 'BLOCK') return false;
  return ['QUEUED', 'SIGNED', 'SUBMITTED', 'UNKNOWN', 'INCLUDED', 'REORGED'].includes(status);
}

export function categoriesFromBitmap(bitmap: string): number[] {
  let value = BigInt(bitmap);
  const result: number[] = [];
  for (let bit = 0; bit < 256 && value > 0n; bit += 1) {
    if ((value & 1n) === 1n) result.push(bit);
    value >>= 1n;
  }
  return result;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatUnixSeconds(seconds: string): string {
  const value = Number.parseInt(seconds, 10); // uint48 seconds fit a double exactly
  if (!Number.isFinite(value) || value === 0) return '—';
  return new Date(value * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
