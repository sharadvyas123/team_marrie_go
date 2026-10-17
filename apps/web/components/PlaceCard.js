import Link from 'next/link';
import StatusBadge from './StatusBadge';
import { formatDistance, formatObservedDate, labelForFeature } from '../lib/fixture-client';
import { decisionLabel } from '../lib/match-client';

export default function PlaceCard({ place, matchExplanation }) {
  return (
    <article className="place-card">
      <div className="place-card-topline">
        <span className="place-category"><span className="category-icon" aria-hidden="true">⌂</span>{place.categoryLabel}</span>
        <span className="sample-chip">Sample</span>
      </div>
      <div className="place-card-content">
        <div>
          <h3><Link href={`/places/${place.id}`}>{place.name}</Link></h3>
          <p className="place-address">{place.address}</p>
        </div>
        <span className="distance-label">{formatDistance(place.distanceMeters)}</span>
      </div>
      <div className="place-card-statuses" aria-label="Accessibility information summary">
        <StatusBadge status={place.claims[0].status}>Step-free entrance · {place.claims[0].status === 'recently_observed' ? 'confirmed' : 'needs review'}</StatusBadge>
        <StatusBadge status="not_assessed">Accessible toilet · unknown</StatusBadge>
      </div>
      {matchExplanation ? <div className="place-match-card" aria-label="Personalized accessibility match">
        <div className="place-match-heading"><span className="place-match-label">For your profile</span><StatusBadge status={matchExplanation.decision}>{decisionLabel(matchExplanation.decision)}</StatusBadge></div>
        {matchExplanation.decision === 'no_profile' ? <p className="place-match-copy">Add your access needs to see whether this place fits you.</p> : <div className="place-match-counts"><span><strong>{matchExplanation.required.confirmed}</strong>/{matchExplanation.required.total} required confirmed</span><span><strong>{matchExplanation.required.knownBarriers}</strong> barriers</span><span><strong>{matchExplanation.required.unknown}</strong> unknown</span><span><strong>{matchExplanation.preferred.confirmed}</strong> preferred</span>{matchExplanation.avoidanceWarnings.length > 0 ? <span><strong>{matchExplanation.avoidanceWarnings.length}</strong> avoid warning{matchExplanation.avoidanceWarnings.length === 1 ? '' : 's'}</span> : null}</div>}
      </div> : null}
      <p className="place-card-note">
        <span className="note-icon" aria-hidden="true">↗</span>
        {labelForFeature(place.claims[0].featureCode)} was observed on {formatObservedDate(place.claims[0].observedAt)} by the community. Other features may not be assessed.
      </p>
      <div className="place-card-actions">
        <Link className="text-link" href={`/places/${place.id}`}>View place details <span aria-hidden="true">→</span></Link>
        <Link className="text-link text-link-muted" href={`/places/${place.id}/report`}>Report an issue</Link>
      </div>
    </article>
  );
}
