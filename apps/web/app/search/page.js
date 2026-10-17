import Link from 'next/link';
import SiteHeader from '../../components/SiteHeader';
import SearchExperience from '../../components/SearchExperience';
import { getApiJson } from '../../lib/api/server-client';
import { serializeApiErrorForView, normalizePlaceSummary } from '../../lib/api/normalizers';
import { ApiError } from '../../lib/api/errors';

export const metadata = {
  title: 'Explore places · AccessMap',
  description: 'Search public places and review feature-level accessibility information.'
};

const PAGE_SIZE = 20;
const SORTS = new Set(['name', 'distance', 'freshness']);

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function safePage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export default async function SearchPage({ searchParams }) {
  const params = await searchParams;
  const query = typeof firstParam(params?.query) === 'string' ? firstParam(params.query).trim() : '';
  const category = typeof firstParam(params?.category) === 'string' ? firstParam(params.category) : '';
  const city = typeof firstParam(params?.city) === 'string' ? firstParam(params.city) : '';
  const page = safePage(firstParam(params?.page));
  const requestedSort = firstParam(params?.sort);
  const sort = SORTS.has(requestedSort) ? requestedSort : 'name';

  const searchParamsForApi = { query, category, city, page, pageSize: PAGE_SIZE, sort };
  const [searchResult, categoryResult] = await Promise.all([
    getApiJson('/api/places', { searchParams: searchParamsForApi })
      .then((result) => ({ result, error: null }))
      .catch((error) => ({ result: null, error: serializeApiErrorForView(error) })),
    getApiJson('/api/categories')
      .then((result) => result?.items ?? [])
      .catch(() => [])
  ]);

  const places = searchResult.result?.items?.map(normalizePlaceSummary) ?? [];
  const pagination = searchResult.result?.pagination ?? {
    page,
    pageSize: PAGE_SIZE,
    total: 0,
    hasNext: false
  };

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SiteHeader active="explore" />
      <main id="main-content" className="app-main">
        <div className="shell">
          <div className="page-heading page-heading-search">
            <div>
              <p className="eyebrow"><span className="eyebrow-line" />Explore the directory</p>
              <h1>Find a place that fits your day.</h1>
              <p>Search the connected directory and keep feature evidence, dates, incidents, and unknowns visible.</p>
            </div>
            <div className="heading-stat"><strong>{pagination.total}</strong><span>{pagination.total === 1 ? 'place' : 'places'}<br />in directory</span></div>
          </div>
          <SearchExperience
            initialQuery={query}
            initialCategory={category}
            initialCity={city}
            initialPlaces={places}
            initialPagination={pagination}
            initialPage={page}
            initialSort={sort}
            categories={categoryResult}
            initialError={searchResult.error}
          />
        </div>
      </main>
      <footer className="site-footer"><div className="shell footer-inner"><div><Link className="footer-brand" href="/">AccessMap</Link><p>Feature-level information for better-informed visits.</p></div><Link className="text-link" href="/">Back to home <span aria-hidden="true">↗</span></Link></div></footer>
    </>
  );
}
