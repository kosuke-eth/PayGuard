import { hashApproval } from '@payguard/integration';
import { useState } from 'react';
import { reasonText, toUiError, type UiError, WalletError } from '../../lib/errors';
import { findRoute, formatUnixSeconds, routeLabel, shortHex } from '../../lib/labels';
import { api, newIdempotencyKey } from '../../lib/payguard-client';
import type { ApprovalTypedData, PaymentRecord, Profile } from '../../lib/types';
import { readAccounts, readChainId, signTypedData } from '../../lib/wallet';
import { useApp, useConfig } from '../../state/app';
import { Amount } from '../ui/Amount';
import { DecisionBadge } from '../ui/Badges';
import { ErrorNotice } from '../ui/ErrorNotice';
import { Party } from '../ui/Party';

type Phase = 'idle' | 'loading' | 'wallet' | 'storing' | 'submitting' | 'queued';

/**
 * Checks done in the browser BEFORE the wallet is asked to sign. They never decide policy; they
 * only make sure the owner signs the approval for the payment that is on screen, with the account
 * and vault the API says it expects. The digest is recomputed with the shared EIP-712 encoder.
 */
function verifyTypedData(
  data: ApprovalTypedData,
  payment: PaymentRecord,
  vaultAddress: string | undefined,
  account: string,
  chainId: string,
): string | null {
  const { domain, message } = data.typedData;
  if (String(domain.chainId) !== chainId)
    return 'The approval is for a different network than your wallet.';
  if (vaultAddress && domain.verifyingContract.toLowerCase() !== vaultAddress.toLowerCase()) {
    return 'The approval names a different vault than this payment’s vault.';
  }
  if (!data.expectedSigner || data.expectedSigner.toLowerCase() !== account.toLowerCase()) {
    return `The vault owner is ${shortHex(data.expectedSigner)}, not the connected account.`;
  }
  if (data.review.exactOutputAtomic !== payment.invoice?.outputAmountAtomic) {
    return 'The approval amount differs from the payment on screen.';
  }
  if (data.review.merchant.toLowerCase() !== payment.invoice?.recipient.toLowerCase()) {
    return 'The approval recipient differs from the payment on screen.';
  }
  const recomputed = hashApproval(
    { chainId: domain.chainId, verifyingContract: domain.verifyingContract as `0x${string}` },
    message,
  );
  if (recomputed.toLowerCase() !== data.computedDigest.toLowerCase()) {
    return 'The typed data does not hash to the digest the backend reported.';
  }
  if (data.nonceUsedOrCancelled === true)
    return 'This approval’s nonce was already used or cancelled.';
  return null;
}

export function ApprovalCard({
  payment,
  profile,
  label,
  onOpenPayment,
  onChanged,
}: {
  payment: PaymentRecord;
  profile: Profile | undefined;
  label: string | null;
  onOpenPayment: (paymentId: string) => void;
  onChanged: (paymentId: string) => void;
}) {
  const config = useConfig();
  const { canAct, handleApiError } = useApp();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<UiError | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const route = findRoute(config, payment.authorized?.routeId);
  const policy = profile?.policy.config;

  async function approve() {
    if (!payment.intentId) return;
    setError(null);
    try {
      setPhase('loading');
      const data = await api.getApprovalTypedData(payment.intentId);
      const [account] = await readAccounts();
      const chainId = await readChainId();
      if (!account || !chainId) throw new WalletError('Connect your wallet first.');
      const problem = verifyTypedData(data, payment, profile?.vault.address, account, chainId);
      if (problem) throw new WalletError(`${problem} Nothing was signed.`, true);

      setPhase('wallet');
      const signature = await signTypedData(account, data.typedData);

      // The signature is stored as SIGNED. That is not an on-chain approval and not a payment.
      setPhase('storing');
      await api.submitApproval(payment.intentId, data.typedData.message, signature);

      // Submit the SAME stored intent. Nothing about merchant, amount or route is re-sent.
      setPhase('submitting');
      await api.submitIntent(payment.intentId, newIdempotencyKey());
      setPhase('queued');
      onChanged(payment.paymentId);
    } catch (caught) {
      setPhase('idle');
      setError(toUiError(caught));
      handleApiError(caught);
    }
  }

  if (dismissed) {
    return (
      <div className="panel spread">
        <span className="muted">
          {label ?? shortHex(payment.invoice?.recipient)} is still waiting. Nothing was signed or
          cancelled.
        </span>
        <button type="button" className="btn" onClick={() => setDismissed(false)}>
          Review again
        </button>
      </div>
    );
  }

  const busy = phase !== 'idle' && phase !== 'queued';

  return (
    <article className="panel stack approval">
      <div className="spread" style={{ alignItems: 'start' }}>
        <div>
          <Party address={payment.invoice?.recipient} suggested={label} kind="merchant" />
          <div className="display-amount">
            <Amount
              atomic={payment.invoice?.outputAmountAtomic}
              token={payment.invoice?.outputToken}
            />
          </div>
        </div>
        <DecisionBadge decision={payment.policyDecision} />
      </div>

      <p>{reasonText(payment.reasonCode) ?? 'This payment is above the automatic limit.'}</p>

      <dl className="ledger">
        {policy && (
          <div>
            <dt>Automatic limit</dt>
            <dd>
              <Amount atomic={policy.automaticOutputCap} token={policy.settlementToken} />
            </dd>
          </div>
        )}
        {policy && (
          <div>
            <dt>Most you can approve</dt>
            <dd>
              <Amount atomic={policy.escalationOutputCap} token={policy.settlementToken} />
            </dd>
          </div>
        )}
        <div>
          <dt>Source asset</dt>
          <dd>
            <Amount
              atomic={payment.authorized?.maxInputAtomic}
              token={payment.authorized?.inputToken}
              precise
            />{' '}
            <span className="muted small">at most</span>
          </dd>
        </div>
        <div>
          <dt>Settlement route</dt>
          <dd>{routeLabel(route?.kind)}</dd>
        </div>
        <div>
          <dt>Merchant receives exactly</dt>
          <dd>
            <Amount
              atomic={payment.invoice?.outputAmountAtomic}
              token={payment.invoice?.outputToken}
              precise
            />
          </dd>
        </div>
        {policy && (
          <div>
            <dt>Policy valid until</dt>
            <dd>{formatUnixSeconds(policy.validUntil)}</dd>
          </div>
        )}
      </dl>

      <p className="small muted">
        Your signature applies only to this exact payment and lifts only the automatic limit.
        Budgets and the route stay enforced; if capacity changes before execution, the payment can
        still fail.
      </p>

      {error && <ErrorNotice error={error} />}

      {phase === 'queued' ? (
        <div className="notice notice-info" role="status">
          <div className="notice-title">Signed and queued</div>
          The relayer will execute the stored intent. The merchant is not paid until the receipt is
          verified.{' '}
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => onOpenPayment(payment.paymentId)}
          >
            Follow the payment
          </button>
        </div>
      ) : (
        <div className="approval-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => setDismissed(true)}>
            Not now
          </button>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={busy || !canAct || !payment.intentId}
            onClick={() => void approve()}
          >
            {phase === 'idle' && 'Approve and sign'}
            {phase === 'loading' && 'Checking the exact approval…'}
            {phase === 'wallet' && 'Waiting for your wallet…'}
            {phase === 'storing' && 'Storing your signature…'}
            {phase === 'submitting' && 'Submitting the stored intent…'}
          </button>
        </div>
      )}
    </article>
  );
}
