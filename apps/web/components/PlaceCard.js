import Link from 'next/link';
import StatusBadge from './StatusBadge';
import { formatDistance, formatObservedDate, labelForFeature, sourceLabel, statusLabel, valueLabel } from '../lib/api/normalizers';

function claimText(claim) {
  return `${labelForFeature(claim.featureCode, claim.featureLabel)} · ${valueLabel(claim.summaryValue)}`;
}

export default function PlaceCard({ place }) {
  const claims = place.claimSummary ?? [];
  const incidents = place.activeIncidents ?? [];
  const leadClaim = claims[0];

  return (
    <article className="place-card">
      <div className="place-card-topline">
        <span className="place-category"><span className="category-icon" aria-hidden="true">⌂</span>{place.categoryLabel || place.category}</span>
        {place.sampleData ? <span className="sample-chip">Sample data</span> : <span className="live-chip">Directory</span>}
      </div>
      <div className="place-card-content">
        <div>
          <h3><Link href={`/places/${place.id}`}>{place.name}</Link></h3>
          <p className="place-address">{place.address}{place.city ? ` · ${place.city}` : ''}</p>
        </div>
        <span className="distance-label">{formatDistance(place.distanceMeters)}</span>
      </div>
      <div className="place-card-statuses" aria-label="Accessibility information summary">
        {claims.slice(0, 3).map((claim) => <StatusBadge status={claim.status} key={claim.featureCode}>{claimText(claim)}</StatusBadge>)}
        {claims.length === 0 ? <StatusBadge status="not_assessed">No features assessed</StatusBadge> : null}
        {incidents.length > 0 ? <StatusBadge status="published">{incidents.length} public incident{incidents.length === 1 ? '' : 's'}</StatusBadge> : null}
      </div>
      <p className="place-card-note">
        <span className="note-icon" aria-hidden="true">↗</span>
        {leadClaim ? <>{labelForFeature(leadClaim.featureCode, leadClaim.featureLabel)} is {valueLabel(leadClaim.summaryValue).toLowerCase()} based on {sourceLabel(place.sampleData ? 'sample data' : 'published information')} {leadClaim.observedAt ? `observed on ${formatObservedDate(leadClaim.observedAt)}` : ''}. Other features may not be assessed.</> : <>No feature-level information has been published for this place yet. Unknown is different from unavailable.</>}
      </p>
      <div className="place-card-actions">
        <Link className="text-link" href={`/places/${place.id}`}>View place details <span aria-hidden="true">→</span></Link>
        <Link className="text-link text-link-muted" href={`/places/${place.id}/report`}>Report an issue</Link>
      </div>
    </article>
  );
}
