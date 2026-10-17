import SiteHeader from '../../components/SiteHeader';
import SampleDataNotice from '../../components/SampleDataNotice';
import ProfileEditor from '../../components/ProfileEditor';
import Link from 'next/link';
import { featureCatalog, samplePlace } from '../../lib/fixture-client';

export const metadata = {
  title: 'My access profile · AccessMap',
  description: 'Keep a private list of accessibility features that matter to you.'
};

export default function ProfilePage() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SiteHeader active="profile" />
      <main id="main-content" className="app-main">
        <div className="shell">
          <div className="page-heading profile-heading"><div><p className="eyebrow"><span className="eyebrow-line" />Private by default</p><h1>Build your access profile.</h1><p>Choose the features that help you decide whether a place is right for your day. You can change or clear these choices at any time.</p></div><div className="privacy-seal"><span aria-hidden="true">⌁</span><strong>Private</strong><span>not a diagnosis</span></div></div>
          <SampleDataNotice />
          <ProfileEditor initialProfile={samplePlace.matchProfile} features={featureCatalog} claims={samplePlace.claims} barriers={samplePlace.activeBarriers} />
        </div>
      </main>
      <footer className="site-footer"><div className="shell footer-inner"><div><Link className="footer-brand" href="/">AccessMap</Link><p>Your access profile stays in this browser for this preview.</p></div><Link className="text-link" href="/search">Browse places <span aria-hidden="true">→</span></Link></div></footer>
    </>
  );
}
