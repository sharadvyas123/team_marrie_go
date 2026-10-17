export default function ApiErrorState({ error, onRetry, compact = false }) {
  return (
    <section className={compact ? 'api-error-state api-error-state-compact' : 'api-error-state'} aria-labelledby="api-error-title" role="alert">
      <div className="empty-state-icon" aria-hidden="true">!</div>
      <p className="section-label">Directory unavailable</p>
      <h2 id="api-error-title">{error?.title || 'We could not load the directory.'}</h2>
      <p>{error?.message || 'The directory could not be reached. Please try again.'}</p>
      {error?.traceId ? <p className="api-error-trace">Reference: <code>{error.traceId}</code></p> : null}
      {onRetry ? <button className="button button-secondary" type="button" onClick={onRetry}>Try again</button> : null}
    </section>
  );
}
