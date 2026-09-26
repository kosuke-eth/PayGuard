import { isAddress } from '@payguard/integration';
import { useState } from 'react';
import { parseDecimalToAtomic } from '../../lib/amounts';
import { toUiError, type UiError } from '../../lib/errors';
import { findToken } from '../../lib/labels';
import { api, newIdempotencyKey, type VaultAction } from '../../lib/payguard-client';
import type { PreparedVaultTransactions, Profile } from '../../lib/types';
import { useApp, useConfig } from '../../state/app';
import { Amount, Hex } from '../ui/Amount';
import { Drawer } from '../ui/Drawer';
import { ErrorNotice } from '../ui/ErrorNotice';
import { OwnerTxFlow } from './OwnerTxFlow';

type Mode = 'DEPOSIT' | 'WITHDRAW';

export function VaultDrawer({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const config = useConfig();
  const { canAct, account, refreshProfiles, handleApiError } = useApp();
  const { vault, policy } = profile;
  const [mode, setMode] = useState<Mode>('DEPOSIT');
  const [token, setToken] = useState(vault.balances[0]?.token ?? '');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState(account ?? '');
  const [prepared, setPrepared] = useState<{
    label: string;
    data: PreparedVaultTransactions;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const tokenInfo = findToken(config, token);
  const parsed = tokenInfo ? parseDecimalToAtomic(amount || '0', tokenInfo.decimals) : null;
  const amountProblem =
    amount && parsed && !parsed.ok
      ? parsed.problem
      : amount && parsed?.ok && parsed.atomic === '0'
        ? 'Enter an amount above zero.'
        : null;
  const recipientProblem =
    mode === 'WITHDRAW' && recipient && !isAddress(recipient) ? 'Not a valid address.' : null;

  async function prepare(action: VaultAction, label: string) {
    setBusy(true);
    setError(null);
    try {
      const data = await api.prepareVaultAction(vault.vaultId, action, newIdempotencyKey());
      setPrepared({ label, data });
    } catch (caught) {
      setError(toUiError(caught));
      handleApiError(caught);
    } finally {
      setBusy(false);
    }
  }

  function prepareFunding() {
    if (!parsed?.ok || !tokenInfo || parsed.atomic === '0') return;
    const action: VaultAction =
      mode === 'DEPOSIT'
        ? { action: 'DEPOSIT', token, amountAtomic: parsed.atomic }
        : { action: 'WITHDRAW', token, amountAtomic: parsed.atomic, recipient };
    void prepare(
      action,
      `${mode === 'DEPOSIT' ? 'Deposit' : 'Withdraw'} ${amount} ${tokenInfo.symbol}`,
    );
  }

  if (prepared) {
    return (
      <Drawer title={prepared.label} onClose={onClose}>
        <p className="muted">
          PayGuard prepared{' '}
          {prepared.data.transactions.length > 1 ? 'these transactions' : 'this transaction'}; your
          wallet signs and broadcasts. Nothing takes effect until it executes on-chain.
        </p>
        <OwnerTxFlow
          transactions={prepared.data.transactions}
          vaultAddress={vault.address}
          relatedResourceId={vault.vaultId}
          completionNote="The vault figures on Overview refresh from the chain in a few seconds."
          onFinished={() => void refreshProfiles()}
        />
        <div>
          <button type="button" className="btn" onClick={() => setPrepared(null)}>
            Back to vault controls
          </button>
        </div>
      </Drawer>
    );
  }

  const paused = vault.executionPaused;

  return (
    <Drawer title="Vault controls" onClose={onClose}>
      <dl className="ledger">
        <div>
          <dt>Vault</dt>
          <dd>
            <Hex value={vault.address} />
          </dd>
        </div>
        {vault.balances.map((balance) => (
          <div key={balance.token}>
            <dt>Holds</dt>
            <dd>
              <Amount atomic={balance.amountAtomic} token={balance.token} />
            </dd>
          </div>
        ))}
        <div>
          <dt>Payment execution</dt>
          <dd>
            {paused === null ? 'Unknown — chain not readable' : paused ? 'Paused' : 'Running'}
          </dd>
        </div>
      </dl>

      <section className="stack">
        <div className="spread">
          <h3>Move funds</h3>
          <div className="segmented">
            {(['DEPOSIT', 'WITHDRAW'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
              >
                {option === 'DEPOSIT' ? 'Deposit' : 'Withdraw'}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="vault-token">Token</label>
          <select
            id="vault-token"
            className="select"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          >
            {vault.balances.map((balance) => (
              <option key={balance.token} value={balance.token}>
                {balance.symbol} · {balance.token.slice(0, 10)}…
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="vault-amount">Amount</label>
          <div className="input-unit">
            <input
              id="vault-amount"
              className="input num"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <span>{tokenInfo?.symbol ?? 'token'}</span>
          </div>
          {amountProblem && <span className="problem">{amountProblem}</span>}
          {mode === 'DEPOSIT' && (
            <span className="hint">
              If the vault’s allowance is too low, a token approval is prepared first. The approval
              alone is not a deposit.
            </span>
          )}
        </div>
        {mode === 'WITHDRAW' && (
          <div className="field">
            <label htmlFor="vault-recipient">Send to</label>
            <input
              id="vault-recipient"
              className="input mono"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
            {recipientProblem && <span className="problem">{recipientProblem}</span>}
            <span className="hint">
              Withdrawals stay available while payment execution is paused.
            </span>
          </div>
        )}
        <div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              !canAct ||
              busy ||
              !parsed?.ok ||
              !!amountProblem ||
              !amount ||
              (mode === 'WITHDRAW' && (!recipient || !!recipientProblem))
            }
            onClick={prepareFunding}
          >
            Prepare {mode === 'DEPOSIT' ? 'deposit' : 'withdrawal'}
          </button>
        </div>
      </section>

      <section className="stack">
        <h3>Emergency controls</h3>
        <p className="muted small">
          Each control is an owner transaction. Signing out of this page does not revoke an agent.
        </p>
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={!canAct || busy || paused === null}
            onClick={() =>
              void prepare(
                { action: 'SET_EXECUTION_PAUSED', paused: !paused },
                paused ? 'Resume payment execution' : 'Pause payment execution',
              )
            }
          >
            {paused ? 'Resume payment execution' : 'Pause payment execution'}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={!canAct || busy}
            onClick={() =>
              void prepare({ action: 'REVOKE_AGENT', agent: policy.config.agent }, 'Revoke agent')
            }
          >
            Revoke agent {policy.config.agent.slice(0, 8)}…
          </button>
        </div>
      </section>
      {!canAct && (
        <p className="small muted">
          Actions are disabled until the signed-in owner wallet is connected on the right network.
        </p>
      )}
      {error && <ErrorNotice error={error} />}
    </Drawer>
  );
}
