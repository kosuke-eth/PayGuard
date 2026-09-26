import { formatAtomic } from '../../lib/amounts';
import { findToken, shortHex } from '../../lib/labels';
import { useConfig } from '../../state/app';

/**
 * An atomic amount rendered with its token's real decimals, resolved by token ADDRESS from
 * /v1/config. An unconfigured token shows raw atomic units instead of a guessed scale.
 */
export function Amount({
  atomic,
  token,
  precise = false,
}: {
  atomic: string | null | undefined;
  token: string | null | undefined;
  precise?: boolean;
}) {
  const config = useConfig();
  const info = findToken(config, token);
  if (atomic === null || atomic === undefined) return <span className="muted">—</span>;
  if (!info) {
    return (
      <span className="num">
        {atomic} <span className="muted small">atomic units of {shortHex(token)}</span>
      </span>
    );
  }
  return (
    <span className="num">
      {formatAtomic(
        atomic,
        info.decimals,
        precise ? { maxFraction: info.decimals, minFraction: Math.min(6, info.decimals) } : {},
      )}{' '}
      {info.symbol}
    </span>
  );
}

export function Hex({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="muted">—</span>;
  return (
    <button
      type="button"
      className="btn-quiet btn mono"
      style={{ padding: 0, fontWeight: 400, color: 'inherit' }}
      title={`${value} — click to copy`}
      onClick={() => void navigator.clipboard?.writeText(value)}
    >
      {shortHex(value, 10, 8)}
    </button>
  );
}

export function TokenName({ address }: { address: string | null | undefined }) {
  const config = useConfig();
  const info = findToken(config, address);
  return (
    <span>
      {info ? info.symbol : 'Unconfigured token'}{' '}
      <span className="small mono muted">{shortHex(address, 6, 4)}</span>
    </span>
  );
}
