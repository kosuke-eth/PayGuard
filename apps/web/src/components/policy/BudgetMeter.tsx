import { percentOf, subtractFloorZero } from '../../lib/amounts';
import type { PolicyView } from '../../lib/types';
import { Amount } from '../ui/Amount';

/**
 * One bar, scaled to the policy's total budget. The hatched part is what the vault reports as
 * already spent; the two marks show how large a SINGLE payment may be before it needs the owner
 * (automatic limit) and before it is refused outright (approval ceiling).
 */
export function BudgetMeter({
  policy,
  heading = true,
}: {
  policy: PolicyView;
  /** Hide the remaining-budget line when a parent already shows that figure. */
  heading?: boolean;
}) {
  const { config, counters } = policy;
  const token = config.settlementToken;
  const total = config.totalOutputBudget;
  const spent = counters?.outputSpent ?? null;
  return (
    <div>
      {heading && (
        <div className="spread" style={{ marginBottom: 8 }}>
          <span className="muted">Remaining budget</span>
          <strong className="meter-remaining">
            {spent === null ? (
              <span className="muted">unknown — chain not readable</span>
            ) : (
              <Amount atomic={subtractFloorZero(total, String(spent))} token={token} />
            )}
          </strong>
        </div>
      )}
      <div className="meter" aria-hidden="true">
        {spent !== null && (
          <div className="meter-spent" style={{ width: `${percentOf(String(spent), total)}%` }} />
        )}
        <div
          className="meter-mark"
          style={{
            left: `${percentOf(config.automaticOutputCap, total)}%`,
            background: 'var(--allow)',
          }}
        />
        <div
          className="meter-mark"
          style={{
            left: `${percentOf(config.escalationOutputCap, total)}%`,
            background: 'var(--escalate)',
          }}
        />
      </div>
      <div className="meter-legend">
        <span>
          <i style={{ background: '#c4cbe0' }} />
          Spent {spent !== null && <Amount atomic={String(spent)} token={token} />}
        </span>
        <span>
          <i style={{ background: 'var(--allow)' }} />
          One payment passes alone up to <Amount atomic={config.automaticOutputCap} token={token} />
        </span>
        <span>
          <i style={{ background: 'var(--escalate)' }} />
          With your approval up to <Amount atomic={config.escalationOutputCap} token={token} />
        </span>
      </div>
    </div>
  );
}
