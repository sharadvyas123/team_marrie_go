import Link from 'next/link';
import SiteHeader from '../components/SiteHeader';
import SampleDataNotice from '../components/SampleDataNotice';

const steps = [
  {
    number: '01',
    title: 'Search the places you need',
    text: 'Start with a facility, category, or neighbourhood. Browse a readable list first; the map is optional.'
  },
  {
    number: '02',
    title: 'Compare what matters to you',
    text: 'Keep a private profile of required, preferred, and avoid features. No diagnosis or public label is needed.'
  },
  {
    number: '03',
    title: 'Decide with context',
    text: 'See source, date, barriers, conflicts, and unknowns before you travel — then add what you learn.'
  }
];

const principles = [
  {
    icon: '01',
    title: 'Specific, not simplistic',
    text: 'Step-free entrance, lift status, toilet access, and route details are more useful than one universal score.'
  },
  {
    icon: '02',
    title: 'Freshness you can see',
    text: 'Every meaningful claim includes when it was observed and whether it may need re-verification.'
  },
  {
    icon: '03',
    title: 'Community, with care',
    text: 'Visitors can contribute structured observations while evidence and privacy states remain transparent.'
  }
];

function HeroMapPreview() {
  return (
    <div className="hero-visual" aria-label="Illustration of a place search with accessibility details" role="img">
      <div className="visual-window-bar"><span /><span /><span /><p>Explore places</p></div>
      <div className="visual-map-area">
        <div className="map-road map-road-one" />
        <div className="map-road map-road-two" />
        <div className="map-road map-road-three" />
        <div className="map-block map-block-one" />
        <div className="map-block map-block-two" />
        <div className="map-block map-block-three" />
        <span className="map-pin map-pin-one" aria-hidden="true">●</span>
        <span className="map-pin map-pin-two" aria-hidden="true">●</span>
        <span className="map-pin map-pin-three" aria-hidden="true">●</span>
        <div className="visual-place-card">
          <div className="visual-place-card-top"><span className="visual-place-icon">⌂</span><span className="visual-sample">SAMPLE</span></div>
          <strong>Sample Community Centre</strong>
          <span className="visual-place-address">Sample Street · 420 m away</span>
          <div className="visual-feature-row"><span className="visual-check">✓</span> Step-free entrance <span className="visual-status">Observed</span></div>
          <div className="visual-feature-row visual-feature-unknown"><span className="visual-question">?</span> Accessible toilet <span className="visual-status">Unknown</span></div>
        </div>
      </div>
      <div className="visual-legend"><span><i className="legend-dot legend-dot-green" />Observed</span><span><i className="legend-dot legend-dot-amber" />Needs information</span></div>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SiteHeader />
      <main id="main-content">
        <section className="hero" aria-labelledby="hero-title">
          <div className="shell hero-grid">
            <div className="hero-copy-column">
              <p className="eyebrow"><span className="eyebrow-line" />Community-verified access information</p>
              <h1 id="hero-title">Know what to expect before you go.</h1>
              <p className="hero-copy">AccessMap helps you discover public places with the access details that matter to you — clear, dated, and honest about what is still unknown.</p>
              <div className="hero-actions">
                <Link className="button button-primary" href="/search">Explore accessible places <span aria-hidden="true">→</span></Link>
                <Link className="button button-secondary" href="/places/13000000-0000-0000-0000-000000000001/report">Report a barrier <span aria-hidden="true">↗</span></Link>
              </div>
              <p className="hero-note"><span className="note-check" aria-hidden="true">✓</span> No diagnosis required · preferences stay private</p>
            </div>
            <HeroMapPreview />
          </div>
        </section>

        <section className="search-strip" aria-labelledby="search-title">
          <div className="shell search-strip-inner">
            <div className="search-strip-copy">
              <p className="section-label">Start with a place</p>
              <h2 id="search-title">Where are you going?</h2>
              <p>Search by place, category, or area. You can browse without sharing your location.</p>
            </div>
            <form className="home-search-form" action="/search" method="get" role="search">
              <label htmlFor="home-search">Place, category, or neighbourhood</label>
              <div className="search-input-wrap">
                <span aria-hidden="true">⌕</span>
                <input id="home-search" name="query" type="search" placeholder="e.g. library or Pilot District" />
                <button className="button button-primary" type="submit">Search</button>
              </div>
              <p className="form-hint">Try the sample: <button className="inline-button" type="submit" name="query" value="community centre">community centre</button></p>
            </form>
          </div>
        </section>

        <section className="section section-light" id="how-it-works" aria-labelledby="how-title">
          <div className="shell">
            <div className="section-intro section-intro-centered">
              <p className="section-label">A clearer way to plan</p>
              <h2 id="how-title">Information that respects your decision.</h2>
              <p>Access needs are personal. AccessMap brings the evidence together without pretending that one label can describe every experience.</p>
            </div>
            <div className="steps-grid">
              {steps.map((step) => (
                <article className="step-card" key={step.number}>
                  <span className="step-number">{step.number}</span>
                  <div><h3>{step.title}</h3><p>{step.text}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section profile-section" aria-labelledby="profile-title">
          <div className="shell profile-grid">
            <div className="profile-illustration" aria-hidden="true">
              <div className="profile-orbit profile-orbit-one" />
              <div className="profile-orbit profile-orbit-two" />
              <div className="profile-center"><span>⌁</span><strong>Your needs</strong><small>Private by default</small></div>
              <div className="profile-pill profile-pill-one">Step-free entrance <b>Required</b></div>
              <div className="profile-pill profile-pill-two">Quiet space <b>Preferred</b></div>
              <div className="profile-pill profile-pill-three">Stairs <b>Avoid</b></div>
            </div>
            <div className="section-intro">
              <p className="section-label">Your access profile</p>
              <h2 id="profile-title">Make the search work for you.</h2>
              <p>Choose features you need, prefer, or want to avoid. Your profile is an optional private decision-making tool — not a medical record or public identity.</p>
              <Link className="text-link text-link-large" href="/profile">Set up your private profile <span aria-hidden="true">→</span></Link>
            </div>
          </div>
        </section>

        <section className="section section-soft" id="principles" aria-labelledby="principles-title">
          <div className="shell">
            <div className="section-intro">
              <p className="section-label">Trust, made visible</p>
              <h2 id="principles-title">No greenwashing. No guesswork.</h2>
              <p>Every place can have a different access story. We make the useful detail — and the uncertainty — easy to find.</p>
            </div>
            <div className="principles-grid">
              {principles.map((principle) => (
                <article className="principle-card" key={principle.icon}>
                  <span className="principle-icon">{principle.icon}</span>
                  <h3>{principle.title}</h3>
                  <p>{principle.text}</p>
                </article>
              ))}
            </div>
            <SampleDataNotice compact />
          </div>
        </section>

        <section className="cta-section" aria-labelledby="cta-title">
          <div className="shell cta-card">
            <div><p className="section-label">Start with what is known</p><h2 id="cta-title">A better-informed visit starts here.</h2><p>Explore the sample directory or add an observation from your own experience.</p></div>
             <div className="cta-actions"><Link className="button button-primary" href="/search">Explore places <span aria-hidden="true">→</span></Link><Link className="button button-light" href="/places/13000000-0000-0000-0000-000000000001/report">Report a barrier</Link></div>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <div className="shell footer-inner"><div><Link className="footer-brand" href="/">AccessMap</Link><p>Community-verified accessibility information for public spaces.</p></div><div className="footer-links"><Link href="/search">Explore</Link><Link href="/profile">Access profile</Link><Link href="/#how-it-works">How it works</Link></div></div>
      </footer>
    </>
  );
}
