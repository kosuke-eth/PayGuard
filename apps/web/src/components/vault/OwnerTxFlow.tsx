import type { UnsignedTransaction } from '@payguard/integration';
import { useState } from 'react';
import { toUiError, type UiError } from '../../lib/errors';
import { shortHex } from '../../lib/labels';
import { api } from '../../lib/payguard-client';
import { decodePrepared, sendPrepared, waitForReceipt } from '../../lib/wallet';
import { useApp, useConfig } from '../../state/app';
import { Hex } from '../ui/Amount';
import { ErrorNotice } from '../ui/ErrorNotice';

type StepState =
  | { kind: 'pending' }
  | { kind: 'wallet' }
  | { kind: 'mining'; hash: string }
  | { kind: 'mined'; hash: string; blockNumber: string }
  | { kind: 'reverted'; hash: string }
  | { kind: 'unknown'; hash: string };

/**
 * Runs prepared owner transactions one at a time. Each step shows the independently decoded
 * calldata, is sent only on an explicit click, and must produce a successful receipt before the
 * next step unlocks (an ERC-20 approval alone is never shown as a completed deposit). Every mined
 * hash is reported to /v1/chain-observations as an indexing hint. A receipt that does not arrive
 * is UNKNOWN -- the flow stops rather than asking the wallet to send again.
 */
export function OwnerTxFlow({
  transactions,
  vaultAddress,
  relatedResourceId,
  completionNote,
  onFinished,
}: {
  transactions: UnsignedTransaction[];
  vaultAddress: string;
  relatedResourceId: string;
  completionNote: string;
  onFinished: () => void;
}) {
  const config = useConfig();
  const { account, canAct } = useApp();
  const [steps, setSteps] = useState<StepState[]>(() =>
    transactions.map(() => ({ kind: 'pending' })),
  );
  const [error, setError] = useState<UiError | null>(null);
  const [hintNote, setHintNote] = useState<string | null>(null);

  const invalidated =
    !account || transactions.some((tx) => tx.from.toLowerCase() !== account.toLowerCase());
  const current = steps.findIndex((step) => step.kind !== 'mined');
  const allMined = current === -1;

  const update = (index: number, next: StepState) =>
    setSteps((previous) => previous.map((step, i) => (i === index ? next : step)));

  async function send(index: number) {
    const tx = transactions[index];
    if (!tx) return;
    setError(null);
    update(index, { kind: 'wallet' });
    let hash: string;
    try {
      hash = await sendPrepared(tx);
    } catch (caught) {
      update(index, { kind: 'pending' });
      setError(toUiError(caught));
      return;
    }
    update(index, { kind: 'mining', hash });
    const receipt = await waitForReceipt(hash);
    if (receipt.state === 'unknown') {
      update(index, { kind: 'unknown', hash });
      return;
    }
    if (receipt.state === 'reverted') {
      update(index, { kind: 'reverted', hash });
      return;
    }
    update(index, { kind: 'mined', hash, blockNumber: receipt.blockNumber });
    try {
      await api.reportTransaction(config.deploymentId, hash, relatedResourceId);
    } catch (caught) {
      setHintNote(
        `The transaction is mined, but reporting it to PayGuard failed (${toUiError(caught).code ?? 'unreachable'}). The indexer can still pick it up from the chain.`,
      );
    }
    if (index === transactions.length - 1) onFinished();
  }

  if (invalidated) {
    return (
      <div className="notice notice-WALLET" role="alert">
        <div className="notice-title">Wallet changed</div>
        These transactions were prepared for {shortHex(transactions[0]?.from)}. Close this and
        prepare the action again with the account you want to use.
      </div>
    );
  }

  return (
    <div className="stack">
      {transactions.map((tx, index) => {
        const step = steps[index] ?? { kind: 'pending' as const };
        const decoded = decodePrepared(tx, vaultAddress);
        return (
          <div className="panel" key={tx.calldataHash} style={{ padding: 16 }}>
            <div className="spread">
              <h3>
                {transactions.length > 1
                  ? `Transaction ${index + 1} of ${transactions.length}: `
                  : ''}
                {decoded ? decoded.functionName : 'Calldata could not be decoded'}
              </h3>
              <span className="tag">
                {decoded?.target === 'token' ? 'Token contract' : 'Vault'}
              </span>
            </div>
            <dl className="ledger small" style={{ marginTop: 8 }}>
              <div>
                <dt>To</dt>
                <dd>
                  <Hex value={tx.to} />
                </dd>
              </div>
              {decoded?.args.map((arg) => (
                <div key={arg.name}>
                  <dt>{arg.name}</dt>
                  <dd className="mono">
                    {arg.value.length > 46 ? shortHex(arg.value, 14, 12) : arg.value}
                  </dd>
                </div>
              ))}
              <div>
                <dt>Value</dt>
                <dd className="mono">{tx.value} wei</dd>
              </div>
            </dl>
            {!decoded && (
              <p className="small" style={{ color: 'var(--block)' }}>
                This frontend could not decode the bytes with the published ABI. Do not sign unless
                you can verify them another way.
              </p>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              {step.kind === 'pending' && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={index !== current || !canAct}
                  onClick={() => void send(index)}
                >
                  Review in wallet
                </button>
              )}
              {step.kind === 'wallet' && (
                <span className="exec exec-live">
                  <i />
                  Waiting for your wallet
                </span>
              )}
              {step.kind === 'mining' && (
                <span className="exec exec-live">
                  <i />
                  Sent. Waiting for a receipt · <Hex value={step.hash} />
                </span>
              )}
              {step.kind === 'mined' && (
                <span className="exec exec-done">
                  <i />
                  Mined in block {step.blockNumber} · <Hex value={step.hash} />
                </span>
              )}
              {step.kind === 'reverted' && (
                <span className="exec exec-bad">
                  <i />
                  Reverted on-chain. Nothing changed · <Hex value={step.hash} />
                </span>
              )}
              {step.kind === 'unknown' && (
                <span className="exec exec-wait">
                  <i />
                  No receipt yet. Status unknown — check <Hex value={step.hash} /> before sending
                  anything again.
                </span>
              )}
            </div>
          </div>
        );
      })}
      {error && <ErrorNotice error={error} />}
      {hintNote && <div className="notice notice-NETWORK small">{hintNote}</div>}
      {allMined && (
        <div className="notice notice-info" role="status">
          <div className="notice-title">Mined</div>
          {completionNote}
        </div>
      )}
    </div>
  );
}
