import SiteHeader from '../../components/SiteHeader';
import SampleDataNotice from '../../components/SampleDataNotice';
import SearchExperience from '../../components/SearchExperience';
import { samplePlace, searchPlaces } from '../../lib/fixture-client';
import Link from 'next/link';

export const metadata = {
  title: 'Explore places · AccessMap',
  description: 'Browse sample public places and review feature-level accessibility information.'
};

export default async function SearchPage({ searchParams }) {
  const params = await searchParams;
  const query = typeof params?.query === 'string' ? params.query : '';
  const places = searchPlaces(query);

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SiteHeader active="explore" />
      <main id="main-content" className="app-main">
        <div className="shell">
          <div className="page-heading page-heading-search">
            <div><p className="eyebrow"><span className="eyebrow-line" />Explore the directory</p><h1>Find a place that fits your day.</h1><p>Browse the sample list to see how AccessMap keeps feature details, dates, and unknowns together.</p></div>
            <div className="heading-stat"><strong>01</strong><span>sample place<br />available</span></div>
          </div>
          <SampleDataNotice />
           <SearchExperience initialQuery={query} initialPlaces={places} initialProfile={samplePlace.matchProfile} />
        </div>
      </main>
      <footer className="site-footer"><div className="shell footer-inner"><div><Link className="footer-brand" href="/">AccessMap</Link><p>Sample directory preview — no live place data connected.</p></div><Link className="text-link" href="/">Back to home <span aria-hidden="true">↗</span></Link></div></footer>
    </>
  );
}
