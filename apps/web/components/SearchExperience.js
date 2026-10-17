'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import EmptyState from './EmptyState';
import PlaceCard from './PlaceCard';
import Link from 'next/link';
import { decisionLabel } from '../lib/match-client';
import { evaluatePlaceMatch, loadStoredProfile, profileChangeEvent } from '../lib/match-client';

const decisionRank = {
  meets_known_requirements: 0,
  partial: 1,
  needs_more_information: 2,
  known_barrier: 3,
  no_profile: 4
};

export default function SearchExperience({ initialQuery, initialPlaces, initialProfile }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [view, setView] = useState('list');
  const [featureFilter, setFeatureFilter] = useState('all');
  const [sort, setSort] = useState('match');
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

  const matches = useMemo(() => new Map(
    initialPlaces.map((place) => [place.id, evaluatePlaceMatch(profile, place)])
  ), [initialPlaces, profile]);
  const hasProfile = (profile.requirements ?? []).length > 0;

  const filteredPlaces = useMemo(() => {
    const places = initialPlaces.filter((place) => {
      if (featureFilter === 'step-free') return place.claims.some((item) => item.featureCode === 'step_free_entrance');
      if (featureFilter === 'profile-fit') return hasProfile && matches.get(place.id)?.decision === 'meets_known_requirements';
      return true;
    });

    return [...places].sort((left, right) => {
      if (sort === 'distance') return left.distanceMeters - right.distanceMeters;
      if (sort === 'match') {
        const rankDifference = decisionRank[matches.get(left.id)?.decision] - decisionRank[matches.get(right.id)?.decision];
        if (rankDifference !== 0) return rankDifference;
      }
      return left.name.localeCompare(right.name);
    });
  }, [featureFilter, hasProfile, initialPlaces, matches, sort]);

  function handleSubmit(event) {
    event.preventDefault();
    const nextQuery = query.trim();
    router.push(nextQuery ? `/search?query=${encodeURIComponent(nextQuery)}` : '/search');
  }

  function clearSearch() {
    setQuery('');
    router.push('/search');
  }

  return (
    <section className="directory-panel" aria-labelledby="results-title">
      <form className="directory-search" onSubmit={handleSubmit} role="search">
        <label htmlFor="directory-search-input">Search places</label>
        <div className="directory-search-controls"><div className="search-input-wrap"><span aria-hidden="true">⌕</span><input id="directory-search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by place, category, or area" /></div><button className="button button-primary" type="submit">Search</button></div>
      </form>

      <div className="profile-context" role="status">
        <span className="profile-context-icon" aria-hidden="true">⌁</span>
        <p>{hasProfile ? <>Results are personalized to <strong>{profile.requirements.length} access {profile.requirements.length === 1 ? 'need' : 'needs'}</strong>. Each place keeps barriers and unknowns visible.</> : <>Set your access needs to compare places for you, rather than relying on a universal accessibility label.</>}</p>
        <Link className="text-link" href="/profile">{hasProfile ? 'Edit profile' : 'Build my profile'} <span aria-hidden="true">→</span></Link>
      </div>

      <div className="directory-toolbar">
        <div><h2 id="results-title">{filteredPlaces.length} {filteredPlaces.length === 1 ? 'place' : 'places'} found</h2><p>{initialQuery ? <>Showing results for <strong>“{initialQuery}”</strong></> : hasProfile ? `Sorted by: ${decisionLabel(matches.get(initialPlaces[0]?.id)?.decision ?? 'no_profile')}` : 'Start with the sample place or try a search above.'}</p></div>
        <div className="toolbar-controls">
          <label htmlFor="feature-filter">Filter</label>
          <select id="feature-filter" value={featureFilter} onChange={(event) => setFeatureFilter(event.target.value)}><option value="all">All information</option><option value="profile-fit" disabled={!hasProfile}>Meets my required needs</option><option value="step-free">Step-free entrance observed</option></select>
          <label htmlFor="sort-results">Sort</label>
          <select id="sort-results" value={sort} onChange={(event) => setSort(event.target.value)}><option value="match">My profile match</option><option value="relevance">Name</option><option value="distance">Distance</option></select>
        </div>
      </div>

      <div className="view-switcher" role="group" aria-label="Choose results view"><button className={view === 'list' ? 'view-button view-button-active' : 'view-button'} type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><span aria-hidden="true">☷</span> Accessible list</button><button className={view === 'map' ? 'view-button view-button-active' : 'view-button'} type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}><span aria-hidden="true">⌖</span> Visual preview</button></div>

      {filteredPlaces.length === 0 ? <EmptyState query={initialQuery || query || 'that filter'} onClear={clearSearch} /> : null}

      {filteredPlaces.length > 0 && view === 'list' ? <div className="result-list" aria-live="polite">{filteredPlaces.map((place) => <PlaceCard place={place} matchExplanation={matches.get(place.id)} key={place.id} />)}</div> : null}

      {filteredPlaces.length > 0 && view === 'map' ? <div className="directory-map-preview" aria-label="Visual preview of the sample place location">
        <div className="map-preview-copy"><span className="map-preview-icon" aria-hidden="true">⌖</span><div><p className="section-label">Optional visual preview</p><h3>Sample Street, Pilot District</h3><p>The list remains the source of truth. This fixture preview does not load map tiles or use your location.</p><button className="button button-secondary" type="button" onClick={() => setView('list')}>Return to accessible list</button></div></div>
        <div className="map-preview-art" aria-hidden="true"><div className="map-grid-lines" /><span className="preview-pin">●</span><span className="preview-label">Sample Community Centre</span></div>
      </div> : null}
    </section>
  );
}
