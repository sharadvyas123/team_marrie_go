import StatusBadge from './StatusBadge';
import { formatObservedDate, labelForFeature, sourceLabel, statusLabel, valueLabel } from '../lib/api/normalizers';

export default function ClaimCard({ claim }) {
  const label = labelForFeature(claim.featureCode, claim.featureLabel);
  return (
    <details className="claim-card" open={claim.status === 'recently_observed' || claim.status === 'community_corroborated'}>
      <summary>
        <span className="claim-summary-main">
          <span className="feature-icon" aria-hidden="true">↗</span>
          <span>
            <strong>{label}</strong>
            <span className="claim-summary-meta">{valueLabel(claim.summaryValue)} · {statusLabel(claim.status)}</span>
          </span>
        </span>
        <StatusBadge status={claim.status}>{statusLabel(claim.status)}</StatusBadge>
      </summary>
      <div className="claim-detail">
        <dl className="detail-list">
          <div><dt>Value</dt><dd>{valueLabel(claim.summaryValue)}</dd></div>
          <div><dt>Source</dt><dd>{sourceLabel(claim.source)}</dd></div>
          <div><dt>Observed</dt><dd>{formatObservedDate(claim.observedAt)}</dd></div>
          <div><dt>Freshness</dt><dd>{statusLabel(claim.freshnessState)}</dd></div>
          <div><dt>Support</dt><dd>{claim.supportingCount ?? 0} supporting observations · {claim.disputingCount ?? 0} disputes</dd></div>
        </dl>
        <div className="claim-explanation">
          <span className="info-icon" aria-hidden="true">i</span>
          <p>This is feature-level information, not a universal accessibility label. Missing information is not treated as a confirmed match or a barrier.</p>
        </div>
      </div>
    </details>
  );
}
