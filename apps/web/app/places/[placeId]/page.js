import { notFound } from 'next/navigation';
import Link from 'next/link';
import SiteHeader from '../../../components/SiteHeader';
import SampleDataNotice from '../../../components/SampleDataNotice';
import ApiErrorState from '../../../components/ApiErrorState';
import StatusBadge from '../../../components/StatusBadge';
import ClaimCard from '../../../components/ClaimCard';
import { ApiError } from '../../../lib/api/errors';
import { getApiJson } from '../../../lib/api/server-client';
import { normalizePlaceDetail, serializeApiErrorForView, formatObservedDate, sourceLabel, statusLabel } from '../../../lib/api/normalizers';

async function loadPlace(placeId) {
  const [placeResult, featuresResult] = await Promise.allSettled([
    getApiJson(`/api/places/${encodeURIComponent(placeId)}`),
    getApiJson('/api/features')
  ]);
  if (placeResult.status === 'rejected') throw placeResult.reason;
  return {
    place: normalizePlaceDetail(placeResult.value),
    features: featuresResult.status === 'fulfilled' ? featuresResult.value?.items ?? [] : []
  };
}

export async function generateMetadata({ params }) {
  const { placeId } = await params;
  try {
    const { place } = await loadPlace(placeId);
    return { title: `${place.name} · AccessMap`, description: place.description || 'Feature-level place information from AccessMap.' };
  } catch {
    return { title: 'Place · AccessMap' };
  }
}

function OpeningHours({ openingHours }) {
  if (!openingHours || Object.keys(openingHours).length === 0) return null;
  return <div className="place-hours"><h3>Opening hours</h3><dl className="detail-list">{Object.entries(openingHours).map(([day, hours]) => <div key={day}><dt>{day}</dt><dd>{String(hours)}</dd></div>)}</dl></div>;
}

function IncidentCard({ incident }) {
  const active = incident.status === 'published' || incident.status === 'disputed';
  return <article className="incident-card"><div className="incident-icon" aria-hidden="true">!</div><div><div className="incident-heading"><h3>{statusLabel(incident.type)}</h3><StatusBadge status={incident.status}>{statusLabel(incident.status)}</StatusBadge></div><p>{incident.explanation || 'A public incident has been recorded for this place. Check the dates and status before travelling.'}</p><dl className="incident-meta"><div><dt>Severity</dt><dd>{statusLabel(incident.severity)}</dd></div><div><dt>Started</dt><dd>{formatObservedDate(incident.startsAt)}</dd></div><div><dt>Review by</dt><dd>{formatObservedDate(incident.reviewAt)}</dd></div>{incident.source ? <div><dt>Source</dt><dd>{sourceLabel(incident.source)}</dd></div> : null}</dl>{active ? <p className="incident-active-note">This temporary incident is shown separately from permanent feature claims.</p> : null}</div></article>;
}

export default async function PlacePage({ params }) {
  const { placeId } = await params;
  let data;
  try {
    data = await loadPlace(placeId);
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) notFound();
    const viewError = serializeApiErrorForView(error);
    return <><a className="skip-link" href="#main-content">Skip to main content</a><SiteHeader active="explore" /><main id="main-content" className="app-main"><div className="shell place-error-shell"><ApiErrorState error={viewError} /><Link className="button button-secondary" href="/search">Back to places</Link></div></main></>;
  }

  const { place, features } = data;
  const claimCodes = new Set(place.claims.map((claim) => claim.featureCode));
  const unknownFeatures = features.filter((feature) => !claimCodes.has(feature.code));
  const activeIncidents = place.incidents.filter((incident) => incident.status === 'published' || incident.status === 'disputed');
  const graphNodes = place.accessGraph.nodes?.length ?? 0;
  const graphEdges = place.accessGraph.edges?.length ?? 0;
  const assessedCount = place.claims.length;
  const totalFeatures = features.length || assessedCount;
  const coverage = totalFeatures > 0 ? Math.min(100, Math.round((assessedCount / totalFeatures) * 100)) : 0;

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SiteHeader active="explore" />
      <main id="main-content" className="app-main">
        <div className="shell">
          <nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/search">Explore places</Link><span aria-hidden="true">/</span><span aria-current="page">{place.name}</span></nav>
          {place.sampleData ? <SampleDataNotice /> : null}

          <section className="place-hero" aria-labelledby="place-title">
            <div className="place-hero-copy"><div className="place-card-topline"><span className="place-category"><span className="category-icon" aria-hidden="true">⌂</span>{place.categoryLabel || place.category}</span><StatusBadge status={place.status}>{statusLabel(place.status)}</StatusBadge></div><h1 id="place-title">{place.name}</h1><p className="place-address place-address-large">{place.address}{place.city ? ` · ${place.city}` : ''}</p><p className="place-hero-description">{place.description || 'Feature-level information for this place, with sources and dates shown where available.'}</p><div className="place-contact"><span>{place.phone || 'Phone not provided'}</span>{place.website ? <a href={place.website} rel="noreferrer">Visit website</a> : <span>Website not provided</span>}</div><div className="place-actions"><Link className="button button-primary" href={`/places/${place.id}/report`}>Report an issue <span aria-hidden="true">↗</span></Link><Link className="button button-secondary" href="/search">Back to places</Link></div></div>
            <div className="place-hero-aside"><span className="aside-label">Information coverage</span><strong>{assessedCount} feature{assessedCount === 1 ? '' : 's'} assessed</strong><span>{unknownFeatures.length > 0 ? `${unknownFeatures.length} other feature${unknownFeatures.length === 1 ? '' : 's'} are not assessed.` : 'Published feature information is shown below.'}</span><div className="coverage-meter" aria-label={`${coverage}% of the available feature catalog has information`}><span style={{ width: `${coverage}%` }} /></div><Link className="text-link" href="/profile">Compare with your profile <span aria-hidden="true">→</span></Link></div>
          </section>

          <div className="place-layout">
            <div className="place-main-column">
              <section className="content-block" aria-labelledby="access-title"><div className="section-heading-row"><div><p className="section-label">Feature-level evidence</p><h2 id="access-title">What is known about access</h2></div><span className="heading-helper">Source and date shown for each claim</span></div><div className="claims-list">{place.claims.map((claim) => <ClaimCard claim={claim} key={claim.featureCode} />)}{unknownFeatures.map((feature) => <details className="claim-card claim-card-unknown" key={feature.code}><summary><span className="claim-summary-main"><span className="feature-icon feature-icon-unknown" aria-hidden="true">?</span><span><strong>{feature.label}</strong><span className="claim-summary-meta">{feature.description}</span></span></span><StatusBadge status="not_assessed">Not assessed</StatusBadge></summary><div className="claim-detail"><p className="unknown-copy">This place has no published claim for this feature. Unknown is different from unavailable, and it is not counted as a confirmed match.</p><Link className="text-link" href={`/places/${place.id}/report?feature=${feature.code}`}>Report or update this feature <span aria-hidden="true">→</span></Link></div></details>)}{place.claims.length === 0 && unknownFeatures.length === 0 ? <p className="unknown-copy">No feature-level information has been published for this place yet.</p> : null}</div></section>

              {place.incidents.length > 0 ? <section className="content-block incident-block" aria-labelledby="incident-title"><div className="section-heading-row"><div><p className="section-label">AccessPulse</p><h2 id="incident-title">Public incidents</h2></div>{activeIncidents.length > 0 ? <StatusBadge status="published">{activeIncidents.length} active</StatusBadge> : <StatusBadge status="resolved">No active incidents</StatusBadge>}</div><div className="incident-list">{place.incidents.map((incident) => <IncidentCard incident={incident} key={incident.id} />)}</div></section> : <section className="content-block" aria-labelledby="incident-title"><div className="section-heading-row"><div><p className="section-label">AccessPulse</p><h2 id="incident-title">Public incidents</h2></div><StatusBadge status="clear">None reported</StatusBadge></div><p className="unknown-copy">No public incidents are currently attached to this place. This does not replace feature-level information.</p></section>}

              <section className="content-block" aria-labelledby="details-title"><div className="section-heading-row"><div><p className="section-label">Place information</p><h2 id="details-title">Visit details</h2></div></div><div className="place-details-grid"><dl className="detail-list"><div><dt>Address</dt><dd>{place.address}{place.city ? `, ${place.city}` : ''}{place.postalCode ? ` ${place.postalCode}` : ''}</dd></div><div><dt>Source</dt><dd>{sourceLabel(place.source)}</dd></div><div><dt>Coordinates</dt><dd>{Number.isFinite(place.latitude) && Number.isFinite(place.longitude) ? `${place.latitude}, ${place.longitude}` : 'Not provided'}</dd></div></dl><OpeningHours openingHours={place.openingHours} /></div></section>
            </div>
            <aside className="place-side-column"><section className="match-summary match-summary-deferred" aria-labelledby="match-summary-title"><div className="match-summary-heading"><div><p className="section-label">Private decision tool</p><h2 id="match-summary-title">Compare with your needs</h2></div><span className="status-badge status-neutral">Coming next</span></div><p className="match-summary-lede">Your access profile stays private. Server-powered matching will compare it with these claims without turning unknown information into a confirmed match.</p><Link className="button button-secondary button-full" href="/profile">Set up my profile <span aria-hidden="true">→</span></Link></section><div className="side-help"><p className="section-label">Have you visited?</p><h2>Help keep this place useful.</h2><p>Share one specific observation. You do not need to complete a full accessibility survey.</p><Link className="button button-secondary button-full" href={`/places/${place.id}/report`}>Report an issue</Link></div><div className="side-note"><span className="info-icon" aria-hidden="true">i</span><p>{graphNodes || graphEdges ? `Access graph: ${graphNodes} node${graphNodes === 1 ? '' : 's'} and ${graphEdges} route segment${graphEdges === 1 ? '' : 's'}.` : 'No access graph has been published for this place yet.'} AccessMap never converts missing information into a confirmed match or an automatic failure.</p></div></aside>
          </div>
        </div>
      </main>
      <footer className="site-footer"><div className="shell footer-inner"><div><Link className="footer-brand" href="/">AccessMap</Link><p>Feature-level information for better-informed visits.</p></div><Link className="text-link" href="/search">Explore another place <span aria-hidden="true">→</span></Link></div></footer>
    </>
  );
}
