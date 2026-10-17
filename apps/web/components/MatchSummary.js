'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import StatusBadge from './StatusBadge';
import { formatObservedDate, labelForFeature } from '../lib/fixture-client';
import { decisionLabel, evaluatePlaceMatch, levelLabel, loadStoredProfile, profileChangeEvent, resultLabel } from '../lib/match-client';

function decisionCopy(decision) {
  if (decision === 'no_profile') return 'Add your private needs to see a place-specific answer. Feature evidence remains available below.';
  if (decision === 'known_barrier') return 'At least one required feature has a current barrier. Unknown information is counted separately.';
  if (decision === 'partial') return 'Some required features are only partially supported. Check the evidence before travelling.';
  if (decision === 'meets_known_requirements') return 'All selected required features have recent supporting information. This is not a universal accessibility guarantee.';
  return 'A required feature has not been confirmed recently. Unknown is different from unavailable.';
}

export default function MatchSummary({ explanation, initialProfile, claims = [], barriers = [], profileLink = '/profile' }) {
  const [profile, setProfile] = useState(() => loadStoredProfile(initialProfile));

  useEffect(() => {
    function syncProfile(event) {
      setProfile(event.detail ?? loadStoredProfile(initialProfile));
    }

    function syncStoredProfile() {
      setProfile(loadStoredProfile(initialProfile));
    }

    window.addEventListener(profileChangeEvent, syncProfile);
    window.addEventListener('storage', syncStoredProfile);
    return () => {
      window.removeEventListener(profileChangeEvent, syncProfile);
      window.removeEventListener('storage', syncStoredProfile);
    };
  }, [initialProfile]);

  const liveExplanation = useMemo(
    () => evaluatePlaceMatch(profile, { claims, activeBarriers: barriers }) ?? explanation,
    [barriers, claims, explanation, profile]
  );
  const required = liveExplanation.required;
  const preferred = liveExplanation.preferred;

  return (
    <section className="match-summary" aria-labelledby="match-summary-title">
      <div className="match-summary-heading">
        <div><p className="section-label">Your access profile</p><h2 id="match-summary-title">Accessibility match</h2></div>
        <StatusBadge status={liveExplanation.decision}>{decisionLabel(liveExplanation.decision)}</StatusBadge>
      </div>
      <p className="match-summary-lede">{decisionCopy(liveExplanation.decision)}</p>
      <div className="match-count-grid">
        <div className="match-count match-count-confirmed"><strong>{required.confirmed}</strong><span>of {required.total} required confirmed</span></div>
        <div className="match-count match-count-barrier"><strong>{required.knownBarriers}</strong><span>required barriers</span></div>
        <div className="match-count match-count-unknown"><strong>{required.unknown}</strong><span>required unknown</span></div>
        <div className="match-count match-count-preferred"><strong>{preferred.confirmed}</strong><span>preferred confirmed</span></div>
        <div className="match-count match-count-warning"><strong>{liveExplanation.avoidanceWarnings.length}</strong><span>avoid warnings</span></div>
      </div>

      {liveExplanation.items.length > 0 ? <div className="match-item-list" aria-label="Personalized feature explanation">
        {liveExplanation.items.map((item) => <details className={`match-item match-item-${item.result}`} key={item.featureCode}>
          <summary><span><strong>{labelForFeature(item.featureCode)}</strong><small>{levelLabel(item.level)}</small></span><StatusBadge status={item.result}>{resultLabel(item.result)}</StatusBadge></summary>
          <div className="match-item-detail"><p>{item.reason}</p><dl><div><dt>Information status</dt><dd>{item.claimStatus?.replaceAll('_', ' ') ?? 'Not assessed'}</dd></div>{item.source ? <div><dt>Source</dt><dd>{item.source.replaceAll('_', ' ')}</dd></div> : null}{item.observedAt ? <div><dt>Observed</dt><dd>{formatObservedDate(item.observedAt)}</dd></div> : null}</dl></div>
        </details>)}
      </div> : null}

      <div className="match-summary-footer"><p><span className="info-icon" aria-hidden="true">i</span> Required unknown information never counts as confirmed, and a match is always specific to the selected features.</p><Link className="text-link" href={profileLink}>Edit private profile <span aria-hidden="true">→</span></Link></div>
    </section>
  );
}
