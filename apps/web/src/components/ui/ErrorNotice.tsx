import type { UiError } from '../../lib/errors';

/** Product wording first, then the backend's own code, message and request id -- never hidden. */
export function ErrorNotice({ error, onRetry }: { error: UiError; onRetry?: () => void }) {
  const problems = (error.details as { problems?: unknown } | undefined)?.problems;
  return (
    <div className={`notice notice-${error.kind}`} role="alert">
      <div className="notice-title">{error.title} error</div>
      <div>{error.text}</div>
      {Array.isArray(problems) && (
        <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {problems.map((problem) => (
            <li key={String(problem)}>{String(problem)}</li>
          ))}
        </ul>
      )}
      {(error.code || error.backendMessage) && (
        <div className="small muted mono">
          {error.code ?? 'TRANSPORT'}
          {error.backendMessage ? ` · ${error.backendMessage}` : ''}
          {error.requestId ? ` · request ${error.requestId}` : ''}
        </div>
      )}
      {onRetry && error.retryable && (
        <div>
          <button type="button" className="btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

export function StaleNote({
  refreshedAt,
  error,
}: {
  refreshedAt: number | null;
  error: UiError | null;
}) {
  if (!error || !refreshedAt) return null;
  return (
    <div className="notice notice-NETWORK small" role="status">
      Refresh failed ({error.code ?? 'backend unreachable'}). Showing values last confirmed at{' '}
      {new Date(refreshedAt).toLocaleTimeString()}.
    </div>
  );
}
