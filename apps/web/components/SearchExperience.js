'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import EmptyState from './EmptyState';
import ApiErrorState from './ApiErrorState';
import PlaceCard from './PlaceCard';

export default function SearchExperience({
  initialQuery,
  initialCategory,
  initialCity,
  initialPlaces,
  initialPagination,
  initialPage,
  initialSort,
  categories,
  initialError
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory);
  const [city, setCity] = useState(initialCity);
  const [sort, setSort] = useState(initialSort);
  const [view, setView] = useState('list');

  function updateUrl(nextValues = {}) {
    const values = {
      query,
      category,
      city,
      sort,
      page: initialPage,
      ...nextValues
    };
    const params = new URLSearchParams();
    if (values.query?.trim()) params.set('query', values.query.trim());
    if (values.category) params.set('category', values.category);
    if (values.city?.trim()) params.set('city', values.city.trim());
    if (values.sort && values.sort !== 'name') params.set('sort', values.sort);
    if (values.page > 1) params.set('page', String(values.page));
    const queryString = params.toString();
    router.push(queryString ? `/search?${queryString}` : '/search');
  }

  function handleSubmit(event) {
    event.preventDefault();
    updateUrl({ page: 1 });
  }

  function clearSearch() {
    setQuery('');
    setCategory('');
    setCity('');
    updateUrl({ query: '', category: '', city: '', page: 1 });
  }

  function changeSort(event) {
    const nextSort = event.target.value;
    setSort(nextSort);
    updateUrl({ sort: nextSort, page: 1 });
  }

  function changeCategory(event) {
    const nextCategory = event.target.value;
    setCategory(nextCategory);
    updateUrl({ category: nextCategory, page: 1 });
  }

  function changePage(nextPage) {
    updateUrl({ page: nextPage });
  }

  const hasResults = initialPlaces.length > 0;
  const total = initialPagination?.total ?? 0;
  const hasProfile = false;
  const mapPlace = initialPlaces[0];

  return (
    <section className="directory-panel" aria-labelledby="results-title">
      <form className="directory-search" onSubmit={handleSubmit} role="search">
        <label htmlFor="directory-search-input">Search places</label>
        <div className="directory-search-controls"><div className="search-input-wrap"><span aria-hidden="true">⌕</span><input id="directory-search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by place, category, or area" /></div><button className="button button-primary" type="submit">Search</button></div>
        <div className="directory-search-secondary">
          <label htmlFor="directory-city-input">City or area <span className="optional-label">Optional</span></label>
          <input id="directory-city-input" type="search" value={city} onChange={(event) => setCity(event.target.value)} placeholder="Filter by city" />
        </div>
      </form>

      <div className="profile-context" role="status">
        <span className="profile-context-icon" aria-hidden="true">⌁</span>
        <p>Search results use the public directory data and server-side filters. Your private access profile can be used for personalized matching in the next integration step.</p>
        <Link className="text-link" href="/profile">Build my profile <span aria-hidden="true">→</span></Link>
      </div>

      <div className="directory-toolbar">
        <div><h2 id="results-title">{total} {total === 1 ? 'place' : 'places'} found</h2><p>{initialQuery ? <>Showing results for <strong>“{initialQuery}”</strong></> : initialCategory ? <>Filtered to <strong>{categories.find((item) => item.code === initialCategory)?.name ?? initialCategory}</strong></> : 'Browse places with public feature-level information.'}</p></div>
        <div className="toolbar-controls">
          <label htmlFor="category-filter">Category</label>
          <select id="category-filter" value={category} onChange={changeCategory}><option value="">All categories</option>{categories.map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}</select>
          <label htmlFor="sort-results">Sort</label>
          <select id="sort-results" value={sort} onChange={changeSort}><option value="name">Name</option><option value="distance">Distance</option><option value="freshness">Recently updated</option></select>
        </div>
      </div>

      <div className="view-switcher" role="group" aria-label="Choose results view"><button className={view === 'list' ? 'view-button view-button-active' : 'view-button'} type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><span aria-hidden="true">☷</span> Accessible list</button><button className={view === 'map' ? 'view-button view-button-active' : 'view-button'} type="button" aria-pressed={view === 'map'} disabled={!hasResults} onClick={() => setView('map')}><span aria-hidden="true">⌖</span> Visual preview</button></div>

      {initialError ? <ApiErrorState error={initialError} onRetry={() => router.refresh()} /> : null}
      {!initialError && !hasResults ? <EmptyState query={initialQuery || initialCategory || 'your search'} onClear={clearSearch} /> : null}

      {!initialError && hasResults && view === 'list' ? <div className="result-list" aria-live="polite">{initialPlaces.map((place) => <PlaceCard place={place} key={place.id} />)}</div> : null}

      {!initialError && hasResults && view === 'map' ? <div className="directory-map-preview" aria-label="Visual preview of place locations">
        <div className="map-preview-copy"><span className="map-preview-icon" aria-hidden="true">⌖</span><div><p className="section-label">Optional visual preview</p><h3>{mapPlace.name}</h3><p>The accessible list remains the source of truth. This preview does not load map tiles or use your location.</p><button className="button button-secondary" type="button" onClick={() => setView('list')}>Return to accessible list</button></div></div>
        <div className="map-preview-art" aria-hidden="true"><div className="map-grid-lines" /><span className="preview-pin">●</span><span className="preview-label">{mapPlace.name}</span></div>
      </div> : null}

      {!initialError && total > 0 ? <nav className="pagination" aria-label="Directory pages"><button className="button button-secondary" type="button" onClick={() => changePage(initialPage - 1)} disabled={initialPage <= 1}>Previous</button><span>Page {initialPage} of {Math.max(1, Math.ceil(total / (initialPagination.pageSize || 20)))}</span><button className="button button-secondary" type="button" onClick={() => changePage(initialPage + 1)} disabled={!initialPagination.hasNext}>Next</button></nav> : null}
    </section>
  );
}
