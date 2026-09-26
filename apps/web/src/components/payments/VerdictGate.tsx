import type { ExecutionStatus, PolicyDecision } from '../../lib/types';

/**
 * The PayGuard gate: one proposal enters, and it leaves by exactly one of three lanes.
 *   ALLOW     straight through to the merchant
 *   ESCALATE  up through the owner's exact approval, then to the merchant
 *   BLOCK     into the wall; nothing is settled
 * It only draws what the backend reported. With no decision every lane stays dashed; the
 * travelling marker sits where the payment's real execution status puts it.
 */
type Where = 'gate' | 'owner' | 'road' | 'merchant' | 'wall';

function locate(decision: PolicyDecision | null, status: ExecutionStatus | null): Where {
  if (!decision || decision === 'UNKNOWN') return 'gate';
  if (decision === 'BLOCK') return 'wall';
  if (status === 'SUCCEEDED') return 'merchant';
  if (status === 'AWAITING_APPROVAL') return 'owner';
  if (status && ['QUEUED', 'SIGNED', 'SUBMITTED', 'INCLUDED', 'UNKNOWN'].includes(status)) {
    return 'road';
  }
  return decision === 'ESCALATE' ? 'owner' : 'gate';
}

const COLOR: Record<string, string> = {
  ALLOW: 'var(--allow)',
  ESCALATE: 'var(--escalate)',
  BLOCK: 'var(--block)',
};

export function VerdictGate({
  decision,
  status,
  compact = false,
}: {
  decision: PolicyDecision | null;
  status: ExecutionStatus | null;
  compact?: boolean;
}) {
  const where = locate(decision, status);
  const active = decision && decision !== 'UNKNOWN' ? decision : null;
  const color = active ? COLOR[active] : 'var(--ink-3)';
  const moving = where === 'road';
  const approvedEscalation = active === 'ESCALATE' && (where === 'road' || where === 'merchant');

  const lane = (name: 'ALLOW' | 'ESCALATE' | 'BLOCK') =>
    `lane${active === name ? ' on' : ''}${active === name && moving ? ' flow' : ''}`;

  const marker: Record<Where, [number, number]> = {
    gate: [212, 80],
    owner: [392, 26],
    road: active === 'ESCALATE' ? [500, 50] : [400, 80],
    merchant: [592, 80],
    wall: [404, 134],
  };
  const [mx, my] = marker[where];

  const summary = !active
    ? 'No decision yet.'
    : active === 'BLOCK'
      ? 'Blocked. No settlement was submitted.'
      : where === 'merchant'
        ? `${active}: the merchant was paid.`
        : where === 'owner'
          ? 'Escalated: waiting for the owner to approve this exact payment.'
          : `${active}: settlement is in progress.`;

  return (
    <svg
      className="gate"
      viewBox="0 0 640 160"
      style={{ aspectRatio: '640 / 160', minHeight: 0 }}
      role="img"
      aria-label={`PayGuard gate. ${summary}`}
    >
      {/* approach */}
      <path d="M48 80H196" className="lane on" style={{ stroke: 'var(--ink-3)' }} />
      {/* lanes */}
      <path
        d="M228 72C280 72 300 26 360 26H424C484 26 500 80 560 80"
        className={lane('ESCALATE')}
        style={active === 'ESCALATE' ? { stroke: color } : undefined}
      />
      <path
        d="M228 80H560"
        className={lane('ALLOW')}
        style={active === 'ALLOW' ? { stroke: color } : undefined}
      />
      <path
        d="M228 88C280 88 300 134 360 134H398"
        className={lane('BLOCK')}
        style={active === 'BLOCK' ? { stroke: color } : undefined}
      />
      {/* the wall */}
      <rect
        x="400"
        y="116"
        width="8"
        height="36"
        rx="2"
        fill={active === 'BLOCK' ? 'var(--block)' : 'var(--line)'}
      />
      {/* agent */}
      <circle cx="34" cy="80" r="14" fill="var(--surface)" stroke="var(--ink-3)" strokeWidth="2" />
      <text x="34" y="84.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--ink-2)">
        AI
      </text>
      {/* gate */}
      <rect
        x="196"
        y="56"
        width="32"
        height="48"
        rx="6"
        fill="var(--chrome)"
        stroke={active ? color : 'var(--chrome)'}
        strokeWidth="3"
      />
      <path d="M205 70h8a6 6 0 0 1 0 12h-4v8h-4z" fill="#fff" />
      {/* owner */}
      <circle
        cx="392"
        cy="26"
        r="12"
        fill={approvedEscalation ? 'var(--escalate)' : 'var(--surface)'}
        stroke={active === 'ESCALATE' ? 'var(--escalate)' : 'var(--line)'}
        strokeWidth="2"
      />
      {approvedEscalation && (
        <path d="M386 26l4 4 8-9" fill="none" stroke="#fff" strokeWidth="2.2" />
      )}
      {/* merchant */}
      <rect
        x="560"
        y="62"
        width="64"
        height="36"
        rx="6"
        fill={where === 'merchant' ? color : 'var(--surface)'}
        stroke={active && active !== 'BLOCK' ? color : 'var(--line)'}
        strokeWidth="2"
      />
      <text
        x="592"
        y="84.5"
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        fill={where === 'merchant' ? '#fff' : 'var(--ink-2)'}
      >
        Merchant
      </text>
      {/* labels */}
      {!compact && (
        <g fontSize="11" fill="var(--ink-2)">
          <text x="34" y="112" textAnchor="middle">
            Agent
          </text>
          <text x="212" y="122" textAnchor="middle">
            PayGuard
          </text>
        </g>
      )}
      <g fontSize="11" fontWeight="700" letterSpacing="0.06em">
        <text x="300" y="38" fill={active === 'ESCALATE' ? color : 'var(--ink-3)'}>
          ESCALATE
        </text>
        <text x="300" y="74" fill={active === 'ALLOW' ? color : 'var(--ink-3)'}>
          ALLOW
        </text>
        <text x="300" y="152" fill={active === 'BLOCK' ? color : 'var(--ink-3)'}>
          BLOCK
        </text>
      </g>
      <text x="410" y="12" fontSize="11" fill="var(--ink-2)">
        Owner signs this exact payment
      </text>
      <text x="416" y="139" fontSize="11" fill="var(--ink-2)">
        No settlement. Funds moved: 0
      </text>
      {/* marker */}
      {active && where !== 'merchant' && where !== 'wall' && (
        <circle cx={mx} cy={my} r="6" fill={color} stroke="#fff" strokeWidth="2">
          {moving && (
            <animate attributeName="r" values="5;8;5" dur="1.2s" repeatCount="indefinite" />
          )}
        </circle>
      )}
    </svg>
  );
}
