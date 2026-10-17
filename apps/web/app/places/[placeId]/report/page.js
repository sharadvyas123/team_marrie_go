import { notFound } from 'next/navigation';
import Link from 'next/link';
import SiteHeader from '../../../../components/SiteHeader';
import SampleDataNotice from '../../../../components/SampleDataNotice';
import ApiErrorState from '../../../../components/ApiErrorState';
import ReportForm from '../../../../components/ReportForm';
import { ApiError } from '../../../../lib/api/errors';
import { getApiJson } from '../../../../lib/api/server-client';
import { normalizePlaceDetail, serializeApiErrorForView } from '../../../../lib/api/normalizers';

export const metadata = {
  title: 'Report an issue · AccessMap',
  description: 'Share a structured accessibility observation with AccessMap.'
};

export default async function ReportPage({ params, searchParams }) {
  const { placeId } = await params;
  const query = await searchParams;
  let place;
  let features;
  try {
    const [placeResponse, featureResponse] = await Promise.all([
      getApiJson(`/api/places/${encodeURIComponent(placeId)}`),
      getApiJson('/api/features')
    ]);
    place = normalizePlaceDetail(placeResponse);
    features = featureResponse?.items ?? [];
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) notFound();
    return <><a className="skip-link" href="#main-content">Skip to main content</a><SiteHeader active="explore" /><main id="main-content" className="app-main"><div className="shell report-shell"><ApiErrorState error={serializeApiErrorForView(error)} /><Link className="button button-secondary" href={`/places/${placeId}`}>Back to place</Link></div></main></>;
  }

  const requestedFeature = typeof query?.feature === 'string' && features.some((feature) => feature.code === query.feature) ? query.feature : '';
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SiteHeader active="explore" />
      <main id="main-content" className="app-main">
        <div className="shell report-shell">
          <nav className="breadcrumbs" aria-label="Breadcrumb"><Link href={`/places/${place.id}`}>{place.name}</Link><span aria-hidden="true">/</span><span aria-current="page">Report an issue</span></nav>
          <div className="page-heading report-heading"><div><p className="eyebrow"><span className="eyebrow-line" />Add what you know</p><h1>Report an issue</h1><p>Share one observation about <strong>{place.name}</strong>. A short, specific report can help someone plan with more confidence.</p></div><div className="report-step"><span>01</span><small>Report flow</small></div></div>
          {place.sampleData ? <SampleDataNotice /> : null}
          <ReportForm place={place} features={features} initialFeature={requestedFeature} />
        </div>
      </main>
      <footer className="site-footer"><div className="shell footer-inner"><div><Link className="footer-brand" href="/">AccessMap</Link><p>Reports should be specific, dated, and privacy-aware.</p></div><Link className="text-link" href={`/places/${place.id}`}>Back to place <span aria-hidden="true">→</span></Link></div></footer>
    </>
  );
}
