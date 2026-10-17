export default function EmptyState({ query, onClear }) {
  return (
    <section className="empty-state" aria-labelledby="empty-title">
      <div className="empty-state-icon" aria-hidden="true">⌕</div>
      <p className="section-label">No places found</p>
      <h2 id="empty-title">We could not find “{query}”.</h2>
      <p>Try a different place, category, or area. You can also clear the search and browse the directory.</p>
      <button className="button button-secondary" type="button" onClick={onClear}>Clear search</button>
    </section>
  );
}
