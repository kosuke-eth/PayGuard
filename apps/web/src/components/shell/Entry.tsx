import { useEffect, useRef } from 'react';
import { useApp } from '../../state/app';
import { VerdictGate } from '../payments/VerdictGate';
import { DecisionBadge } from '../ui/Badges';
import { ErrorNotice } from '../ui/ErrorNotice';
import { BrandMark } from './Shell';

const VERDICTS = [
  {
    decision: 'ALLOW' as const,
    title: 'Small and inside the rules',
    text: 'Payments under your automatic limit, to a merchant you permitted, settle straight away. You are not interrupted.',
  },
  {
    decision: 'ESCALATE' as const,
    title: 'Larger than you pre-approved',
    text: 'The payment stops and waits. You review the merchant, amount and route, and sign for that one payment only.',
  },
  {
    decision: 'BLOCK' as const,
    title: 'Outside the rules',
    text: 'Unknown merchant, over budget, replayed invoice: the vault refuses it on-chain. No transaction is sent and no funds move.',
  },
];

const STEPS = [
  ['1', 'You set the rules', 'A budget, an automatic limit, and the merchants you trust.'],
  ['2', 'The agent proposes', 'It signs a payment. It never holds the vault.'],
  ['3', 'PayGuard decides', 'Allow, escalate to you, or block. On-chain, every time.'],
  ['4', 'You see the receipt', 'Paid only after a verified receipt. Blocked means nothing moved.'],
];

function openVault() {
  window.location.hash = '#/overview';
}

/** Public front door. The vault app opens only after this page, at #/overview. */
export function Entry() {
  const {
    boot,
    retryBoot,
    walletAvailable,
    connect,
    connecting,
    connectError,
    session,
    sessionChecked,
  } = useApp();
  const pendingEnter = useRef(false);

  useEffect(() => {
    document.title = 'PayGuard — Spending firewall for AI agents';
  }, []);

  useEffect(() => {
    if (session && pendingEnter.current) {
      pendingEnter.current = false;
      openVault();
    } else if (!connecting && pendingEnter.current && !session) {
      pendingEnter.current = false;
    }
  }, [session, connecting]);

  function onConnect() {
    pendingEnter.current = true;
    void connect();
  }

  return (
    <div className="landing">
      <header className="landing-bar">
        <a className="brand landing-brand" href="#/">
          <BrandMark inverse />
          PayGuard
        </a>
        <nav className="landing-nav" aria-label="On this page">
          <a className="landing-link" href="#how">
            How it works
          </a>
          <a className="landing-link" href="#lanes">
            Three lanes
          </a>
          <a className="landing-link" href="#trust">
            Your vault
          </a>
          {session ? (
            <button type="button" className="btn btn-primary" onClick={openVault}>
              Open your vault
            </button>
          ) : (
            <a className="btn btn-primary" href="#signin">
              Sign in
            </a>
          )}
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-lead">
          <p className="kicker">Spending firewall for AI agents</p>
          <h1>The agent can spend. It cannot overspend.</h1>
          <p>
            You hand an agent a budget and rules, not your wallet. Every payment is checked on-chain
            before money moves: small ones pass, larger ones wait for your signature, and anything
            outside the rules is refused.
          </p>
        </div>

        <div className="signin-card" id="signin">
          <p className="signin-kicker">Your vault</p>
          <VerdictGate decision={null} status={null} />
          <SignIn
            boot={boot}
            retryBoot={retryBoot}
            walletAvailable={walletAvailable}
            connecting={connecting}
            connectError={connectError}
            session={session}
            sessionChecked={sessionChecked}
            onConnect={onConnect}
          />
        </div>
      </section>

      <section className="landing-section" id="how">
        <h2>From a budget to a receipt</h2>
        <ol className="landing-steps">
          {STEPS.map(([step, title, text]) => (
            <li key={step}>
              <i>{step}</i>
              <strong>{title}</strong>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section landing-alt" id="lanes">
        <h2>Every payment leaves by one of three lanes</h2>
        <div className="landing-cols">
          {VERDICTS.map((verdict) => (
            <article key={verdict.decision} className={`lane-card lane-${verdict.decision}`}>
              <DecisionBadge decision={verdict.decision} />
              <h3>{verdict.title}</h3>
              <p className="muted">{verdict.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section" id="trust">
        <h2>The agent never holds your wallet</h2>
        <div className="landing-cols">
          <div className="trust-card stack">
            <h3>Funds stay in your vault</h3>
            <p className="muted">
              The agent can only propose signed payments. The vault contract checks each one against
              your policy before it releases anything.
            </p>
          </div>
          <div className="trust-card stack">
            <h3>The route is bounded too</h3>
            <p className="muted">
              When a payment swaps assets on the way, you cap how much source asset it may use. The
              merchant receives the exact amount invoiced.
            </p>
          </div>
          <div className="trust-card stack">
            <h3>Proof, not promises</h3>
            <p className="muted">
              A payment shows as paid only after a verified on-chain receipt. Every receipt carries
              its transaction, block and actual amounts.
            </p>
          </div>
        </div>
      </section>

      <footer className="landing-foot">
        <span className="row">
          <BrandMark inverse /> PayGuard
        </span>
        <span className="small muted">
          You can withdraw from your vault or revoke an agent at any time, even while payments are
          paused.
        </span>
      </footer>
    </div>
  );
}

function SignIn({
  boot,
  retryBoot,
  walletAvailable,
  connecting,
  connectError,
  session,
  sessionChecked,
  onConnect,
}: {
  boot: ReturnType<typeof useApp>['boot'];
  retryBoot: () => void;
  walletAvailable: boolean;
  connecting: boolean;
  connectError: ReturnType<typeof useApp>['connectError'];
  session: ReturnType<typeof useApp>['session'];
  sessionChecked: boolean;
  onConnect: () => void;
}) {
  if (boot.phase === 'loading') {
    return <div className="skeleton" style={{ height: 52 }} />;
  }

  if (boot.phase === 'failed') {
    return (
      <div className="stack">
        <div className="notice notice-NETWORK" role="alert">
          <div className="notice-title">PayGuard is unavailable right now</div>
          We could not reach the service, so nothing can be shown or signed. Nothing about your
          vault has changed.
        </div>
        <details className="tech">
          <summary>Details for operators</summary>
          <div className="stack">
            <ErrorNotice error={boot.error} />
            {boot.problems.length > 0 && (
              <ul className="small">
                {boot.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
            <p className="small muted">
              The app needs GET /v1/config through its same-origin proxy. Check that the API and
              worker are running and that PAYGUARD_API_URL in apps/web/.env points at the API.
            </p>
          </div>
        </details>
        <div>
          <button type="button" className="btn btn-primary" onClick={retryBoot}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (session) {
    return (
      <div className="stack">
        <h2>Your vault is unlocked</h2>
        <p className="small muted">
          You are signed in. Open the vault to see the budget, the latest decision, and anything
          waiting for your signature.
        </p>
        <button type="button" className="btn btn-primary btn-lg" onClick={openVault}>
          Open your vault
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <h2>Sign in to your vault</h2>
      {!walletAvailable ? (
        <div className="notice notice-WALLET">
          <div className="notice-title">No browser wallet found</div>
          PayGuard signs you in with the wallet that owns your vault. Install MetaMask or another
          Ethereum wallet, then reload this page.
        </div>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={connecting || !sessionChecked}
            onClick={onConnect}
          >
            {connecting ? 'Waiting for your wallet…' : 'Continue with wallet'}
          </button>
          <p className="small muted">
            You sign one Sign-In with Ethereum message. It proves you own the vault. It moves
            nothing, approves nothing and costs no gas.
          </p>
        </>
      )}
      {connectError && <ErrorNotice error={connectError} />}
      <div className="row">
        <span className="tag tag-warn">
          {boot.config.environment === 'LOCAL_DEMO' ? 'Test environment' : 'Testnet'}
        </span>
        <span className="small muted">
          Chain {boot.config.chainId} · mock assets · no real funds
        </span>
      </div>
    </div>
  );
}
