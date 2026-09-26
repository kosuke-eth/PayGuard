import type { PolicyConfig } from '@payguard/integration';
import { useMemo, useState } from 'react';
import { atomicToDecimalInput, parseDecimalToAtomic } from '../../lib/amounts';
import { toUiError, type UiError } from '../../lib/errors';
import { findToken } from '../../lib/labels';
import { api } from '../../lib/payguard-client';
import type { PreparedPolicyTransaction, Profile } from '../../lib/types';
import { useApp, useConfig } from '../../state/app';
import { Drawer } from '../ui/Drawer';
import { ErrorNotice } from '../ui/ErrorNotice';
import { OwnerTxFlow } from '../vault/OwnerTxFlow';

type AmountField =
  | 'totalOutputBudget'
  | 'epochOutputBudget'
  | 'automaticOutputCap'
  | 'escalationOutputCap'
  | 'totalInputBudget'
  | 'maxInputPerPayment';

const OUTPUT_FIELDS: Array<{ key: AmountField; label: string; hint: string }> = [
  {
    key: 'totalOutputBudget',
    label: 'Total budget',
    hint: 'The most this agent can ever pay out under this policy. An approval cannot exceed it.',
  },
  {
    key: 'epochOutputBudget',
    label: 'Budget per period',
    hint: 'Cannot be larger than the total budget.',
  },
  {
    key: 'automaticOutputCap',
    label: 'Automatic payment limit',
    hint: 'A single payment up to this amount settles without you.',
  },
  {
    key: 'escalationOutputCap',
    label: 'Human approval up to',
    hint: 'Above the automatic limit and up to here, you sign the exact payment. Beyond it, payments are blocked.',
  },
];
const INPUT_FIELDS: Array<{ key: AmountField; label: string; hint: string }> = [
  {
    key: 'totalInputBudget',
    label: 'Source asset budget',
    hint: 'Hard cap on how much of the source asset the route may consume in total.',
  },
  {
    key: 'maxInputPerPayment',
    label: 'Maximum source asset per payment',
    hint: 'Cannot be larger than the source asset budget.',
  },
];

function toLocalInput(unixSeconds: string): string {
  const date = new Date(Number.parseInt(unixSeconds, 10) * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * "Replace policy": policies are immutable on-chain snapshots. This form saves an off-chain draft,
 * asks the API to prepare `createPolicy`, and the owner wallet sends it. The new policy supersedes
 * the active one for the same agent and starts with fresh counters; agent, assets, route and
 * merchants are carried over unchanged (a different route is a different profile, not a toggle).
 */
export function ReplacePolicyForm({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const config = useConfig();
  const { canAct, refreshProfiles, handleApiError } = useApp();
  const current = profile.policy.config;
  const outToken = findToken(config, current.settlementToken);
  const inToken = findToken(config, current.inputToken);

  const [values, setValues] = useState<Record<AmountField, string>>(() => {
    const initial = {} as Record<AmountField, string>;
    for (const { key } of OUTPUT_FIELDS)
      initial[key] = atomicToDecimalInput(current[key], outToken?.decimals ?? 0);
    for (const { key } of INPUT_FIELDS)
      initial[key] = atomicToDecimalInput(current[key], inToken?.decimals ?? 0);
    return initial;
  });
  const [validUntil, setValidUntil] = useState(() => toLocalInput(current.validUntil));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [prepared, setPrepared] = useState<{
    draftId: string;
    tx: PreparedPolicyTransaction;
  } | null>(null);

  const parsed = useMemo(() => {
    const result = {} as Record<AmountField, ReturnType<typeof parseDecimalToAtomic>>;
    for (const { key } of OUTPUT_FIELDS)
      result[key] = parseDecimalToAtomic(values[key], outToken?.decimals ?? 0);
    for (const { key } of INPUT_FIELDS)
      result[key] = parseDecimalToAtomic(values[key], inToken?.decimals ?? 0);
    return result;
  }, [values, outToken, inToken]);

  const untilSeconds = Math.floor(new Date(validUntil).getTime() / 1000);
  const untilProblem = !Number.isFinite(untilSeconds)
    ? 'Pick a date and time.'
    : untilSeconds * 1000 <= Date.now()
      ? 'Must be in the future.'
      : null;
  const formValid =
    Object.values(parsed).every((entry) => entry.ok) && !untilProblem && !!outToken && !!inToken;

  async function prepare() {
    if (!formValid) return;
    setBusy(true);
    setError(null);
    const next: PolicyConfig = { ...current, validUntil: String(untilSeconds) };
    for (const key of Object.keys(parsed) as AmountField[]) {
      const entry = parsed[key];
      if (entry.ok) next[key] = entry.atomic;
    }
    try {
      // Cross-field rules (caps vs budgets) are the backend's to enforce; its problems list is shown as-is.
      const draft = await api.createPolicyDraft(
        profile.vault.vaultId,
        next,
        profile.policy.merchants,
      );
      const tx = await api.preparePolicyTransaction(draft.draftId, draft.draftVersion);
      setPrepared({ draftId: draft.draftId, tx });
    } catch (caught) {
      setError(toUiError(caught));
      handleApiError(caught);
    } finally {
      setBusy(false);
    }
  }

  if (prepared) {
    return (
      <Drawer title="Send the new policy" onClose={onClose}>
        <p className="muted">
          The draft is saved, but it is not authority yet. The agent keeps its current policy until
          this transaction executes and PayGuard observes it.
        </p>
        <OwnerTxFlow
          transactions={[prepared.tx.transaction]}
          vaultAddress={profile.vault.address}
          relatedResourceId={prepared.draftId}
          completionNote="Waiting for PayGuard to observe the new policy on-chain. It appears under Policies once it is active; until then the previous policy is still shown."
          onFinished={() => void refreshProfiles()}
        />
      </Drawer>
    );
  }

  const renderField = (
    field: { key: AmountField; label: string; hint: string },
    symbol: string,
  ) => {
    const entry = parsed[field.key];
    return (
      <div className="field" key={field.key}>
        <label htmlFor={`policy-${field.key}`}>{field.label}</label>
        <div className="input-unit">
          <input
            id={`policy-${field.key}`}
            className="input num"
            inputMode="decimal"
            value={values[field.key]}
            onChange={(event) =>
              setValues((previous) => ({ ...previous, [field.key]: event.target.value }))
            }
          />
          <span>{symbol}</span>
        </div>
        {entry.ok ? (
          <span className="hint">{field.hint}</span>
        ) : (
          <span className="problem">{entry.problem}</span>
        )}
      </div>
    );
  };

  return (
    <Drawer title="Replace policy" onClose={onClose}>
      <div className="notice notice-info">
        A policy cannot be edited once it is on-chain. Replacing it creates a new policy for the
        same agent with its own counters starting at zero. Past payments keep pointing at the policy
        they were made under.
      </div>
      {OUTPUT_FIELDS.map((field) => renderField(field, outToken?.symbol ?? 'token'))}
      <details className="tech">
        <summary>Source asset limits</summary>
        <div className="stack">
          {INPUT_FIELDS.map((field) => renderField(field, inToken?.symbol ?? 'token'))}
        </div>
      </details>
      <div className="field">
        <label htmlFor="policy-until">Valid until</label>
        <input
          id="policy-until"
          type="datetime-local"
          className="input"
          value={validUntil}
          onChange={(event) => setValidUntil(event.target.value)}
        />
        {untilProblem && <span className="problem">{untilProblem}</span>}
      </div>
      {error && <ErrorNotice error={error} />}
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!formValid || busy || !canAct}
          onClick={() => void prepare()}
        >
          {busy ? 'Preparing…' : 'Save draft and prepare transaction'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Drawer>
  );
}
