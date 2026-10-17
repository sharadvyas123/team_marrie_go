import { notFound } from 'next/navigation';
import Link from 'next/link';
import SiteHeader from '../../../components/SiteHeader';
import SampleDataNotice from '../../../components/SampleDataNotice';
import StatusBadge from '../../../components/StatusBadge';
import MatchSummary from '../../../components/MatchSummary';
import ClaimCard from '../../../components/ClaimCard';
import { featureCatalog, formatObservedDate, getMatchItem, labelForFeature, samplePlace } from '../../../lib/fixture-client';

export async function generateMetadata({ params }) {
  const { placeId } = await params;
  return { title: placeId === samplePlace.id ? `${samplePlace.name} · AccessMap` : 'Place · AccessMap' };
}

export default async function PlacePage({ params }) {
  const { placeId } = await params;
  if (placeId !== samplePlace.id) notFound();

  const knownClaimCodes = new Set(samplePlace.claims.map((item) => item.featureCode));
  const unknownFeatures = featureCatalog.filter((feature) => !knownClaimCodes.has(feature.code) && feature.code !== 'ramp_available');
  const rampStatus = samplePlace.observation;

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SiteHeader active="explore" />
      <main id="main-content" className="app-main">
        <div className="shell">
          <nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/search">Explore places</Link><span aria-hidden="true">/</span><span aria-current="page">{samplePlace.name}</span></nav>
          <SampleDataNotice />

          <section className="place-hero" aria-labelledby="place-title">
            <div className="place-hero-copy"><div className="place-card-topline"><span className="place-category"><span className="category-icon" aria-hidden="true">⌂</span>{samplePlace.categoryLabel}</span><span className="sample-chip">Sample place</span></div><h1 id="place-title">{samplePlace.name}</h1><p className="place-address place-address-large">{samplePlace.address}</p><p className="place-hero-description">A fixture place used to show how AccessMap presents feature-level information. Contact details, hours, and coordinates are not included in this sample.</p><div className="place-actions"><Link className="button button-primary" href={`/places/${samplePlace.id}/report`}>Report an issue <span aria-hidden="true">↗</span></Link><Link className="button button-secondary" href="/search">Back to places</Link></div></div>
            <div className="place-hero-aside"><span className="aside-label">Information coverage</span><strong>1 feature observed</strong><span>Other access details are unknown in this sample.</span><div className="coverage-meter" aria-label="One of four sample feature groups has information"><span /></div><Link className="text-link" href="/profile">Compare with your profile <span aria-hidden="true">→</span></Link></div>
          </section>

          <div className="place-layout">
            <div className="place-main-column">
              <section className="content-block" aria-labelledby="access-title"><div className="section-heading-row"><div><p className="section-label">Feature-level evidence</p><h2 id="access-title">What is known about access</h2></div><span className="heading-helper">Source and date shown for each claim</span></div><div className="claims-list"><ClaimCard claim={samplePlace.claims[0]} explanationItem={getMatchItem(samplePlace.claims[0].featureCode)} />{unknownFeatures.map((feature) => <details className="claim-card claim-card-unknown" key={feature.code}><summary><span className="claim-summary-main"><span className="feature-icon feature-icon-unknown" aria-hidden="true">?</span><span><strong>{feature.label}</strong><span className="claim-summary-meta">{feature.description}</span></span></span><StatusBadge status="not_assessed">Not assessed</StatusBadge></summary><div className="claim-detail"><p className="unknown-copy">This place has not been assessed for this feature in the sample data. Unknown is different from unavailable — you can contact the facility or contribute an observation.</p><Link className="text-link" href={`/places/${samplePlace.id}/report?feature=${feature.code}`}>Report or update this feature <span aria-hidden="true">→</span></Link></div></details>)}
                <details className="claim-card claim-card-warning"><summary><span className="claim-summary-main"><span className="feature-icon feature-icon-warning" aria-hidden="true">!</span><span><strong>{labelForFeature(rampStatus.featureCode)}</strong><span className="claim-summary-meta">Current report is awaiting review</span></span></span><StatusBadge status="pending">Pending review</StatusBadge></summary><div className="claim-detail"><dl className="detail-list"><div><dt>Observed</dt><dd>{formatObservedDate(rampStatus.observedAt)}</dd></div><div><dt>Observation</dt><dd>Temporarily unavailable</dd></div><div><dt>Public state</dt><dd>Not server-confirmed in this fixture preview</dd></div></dl></div></details>
              </div></section>

              <section className="content-block incident-block" aria-labelledby="incident-title"><div className="section-heading-row"><div><p className="section-label">AccessPulse</p><h2 id="incident-title">Current barrier</h2></div><StatusBadge status="published">Published</StatusBadge></div><div className="incident-card"><div className="incident-icon" aria-hidden="true">!</div><div><h3>Ramp reported blocked</h3><p>This published sample incident may affect the ramp approach. It does not replace the permanent feature record.</p><dl className="incident-meta"><div><dt>Started</dt><dd>{formatObservedDate(samplePlace.incidents[0].startsAt)}</dd></div><div><dt>Review by</dt><dd>{formatObservedDate(samplePlace.incidents[0].reviewAt)}</dd></div><div><dt>Severity</dt><dd>Major</dd></div></dl></div></div></section>

              <section className="content-block" aria-labelledby="activity-title"><div className="section-heading-row"><div><p className="section-label">Community activity</p><h2 id="activity-title">Recent observation</h2></div></div><div className="activity-card"><div className="activity-status"><StatusBadge status="pending">Pending review</StatusBadge><span>Sample observation</span></div><h3>Ramp availability update</h3><p>This observation is waiting for review. It has not been turned into a public claim.</p><span className="activity-date">Observed {formatObservedDate(rampStatus.observedAt)}</span></div></section>
            </div>
             <aside className="place-side-column"><MatchSummary explanation={samplePlace.matchExplanation} initialProfile={samplePlace.matchProfile} claims={samplePlace.claims} barriers={samplePlace.activeBarriers} /><div className="side-help"><p className="section-label">Have you visited?</p><h2>Help keep this place useful.</h2><p>Share one specific observation. You do not need to complete a full accessibility survey.</p><Link className="button button-secondary button-full" href={`/places/${samplePlace.id}/report`}>Report an issue</Link></div><div className="side-note"><span className="info-icon" aria-hidden="true">i</span><p>AccessMap never converts missing information into a confirmed match or an automatic failure.</p></div></aside>
          </div>
        </div>
      </main>
      <footer className="site-footer"><div className="shell footer-inner"><div><Link className="footer-brand" href="/">AccessMap</Link><p>Feature-level information for better-informed visits.</p></div><Link className="text-link" href="/search">Explore another place <span aria-hidden="true">→</span></Link></div></footer>
    </>
  );
}
