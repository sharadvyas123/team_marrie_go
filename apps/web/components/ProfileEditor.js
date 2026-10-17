'use client';

import { startTransition, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import StatusBadge from './StatusBadge';
import { formatObservedDate, labelForFeature } from '../lib/fixture-client';
import {
  clearStoredProfile,
  decisionLabel,
  evaluatePlaceMatch,
  levelLabel,
  loadStoredProfile,
  profileFromRequirements,
  saveStoredProfile
} from '../lib/match-client';

const presets = [
  {
    label: 'Mobility starter',
    values: { step_free_entrance: 'required', accessible_toilet: 'preferred', working_lift: 'required' }
  },
  {
    label: 'Visual access starter',
    values: { tactile_paving: 'required', audio_directions: 'preferred', high_contrast_signage: 'preferred' }
  },
  {
    label: 'Hearing & communication',
    values: { visual_alerts: 'required', captioned_information: 'required', hearing_loop: 'preferred' }
  },
  {
    label: 'Sensory-friendly',
    values: { quiet_space: 'required', clear_signage: 'preferred', seating_available: 'preferred' }
  }
];

function iconForGroup(group) {
  if (group === 'Mobility') return '↗';
  if (group === 'Visual access') return '◉';
  if (group === 'Hearing and communication') return '▣';
  return '◌';
}

export default function ProfileEditor({ initialProfile, features, claims = [], barriers = [] }) {
  const initialValues = useMemo(() => profileFromRequirements(initialProfile?.requirements), [initialProfile]);
  const [profile, setProfile] = useState(initialValues);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = loadStoredProfile(initialProfile);
    startTransition(() => setProfile(profileFromRequirements(stored.requirements)));
  }, [initialProfile]);

  const explanation = useMemo(
    () => evaluatePlaceMatch(profile, { claims, activeBarriers: barriers }),
    [barriers, claims, profile]
  );
  const selectedCount = useMemo(() => Object.values(profile).filter((level) => level !== 'none').length, [profile]);
  const groups = useMemo(() => [...new Set(features.map((feature) => feature.group))], [features]);

  function updateFeature(featureCode, level) {
    setSaved(false);
    setProfile((current) => ({ ...current, [featureCode]: level }));
  }

  function applyPreset(values) {
    setSaved(false);
    setProfile(values);
  }

  function saveProfile() {
    saveStoredProfile(profile);
    setSaved(true);
  }

  function clearProfile() {
    setProfile({});
    clearStoredProfile();
    setSaved(true);
  }

  function resetProfile() {
    setProfile(initialValues);
    setSaved(false);
    saveStoredProfile(initialValues);
  }

  return (
    <div className="profile-layout">
      <section className="profile-editor-card" aria-labelledby="profile-editor-title">
        <div className="profile-card-heading">
          <div><p className="section-label">Choose what matters</p><h2 id="profile-editor-title">Your access needs</h2></div>
          <span className="selection-count">{selectedCount} selected</span>
        </div>
        <p className="profile-card-intro">Choose concrete features you need, prefer, or want to avoid. You do not need to name a diagnosis.</p>

        <div className="profile-presets" aria-label="Optional profile starters">
          <span className="profile-presets-label">Start with a profile</span>
          <div className="profile-preset-list">
            {presets.map((preset) => <button className="profile-preset" type="button" key={preset.label} onClick={() => applyPreset(preset.values)}>{preset.label}</button>)}
          </div>
        </div>

        <div className="feature-editor-list">
          {groups.map((group) => (
            <fieldset className="feature-group" key={group}>
              <legend>{group}</legend>
              {features.filter((feature) => feature.group === group).map((feature) => (
                <div className="feature-editor-row" key={feature.code}>
                  <div className="feature-editor-copy"><span className="feature-icon" aria-hidden="true">{iconForGroup(group)}</span><div><label htmlFor={`profile-${feature.code}`}>{feature.label}</label><p>{feature.description}</p></div></div>
                  <select id={`profile-${feature.code}`} value={profile[feature.code] ?? 'none'} onChange={(event) => updateFeature(feature.code, event.target.value)} aria-describedby={`profile-help-${feature.code}`}>
                    <option value="none">Not selected</option>
                    <option value="required">Required</option>
                    <option value="preferred">Preferred</option>
                    <option value="avoid">Avoid</option>
                  </select>
                  <span className="sr-only" id={`profile-help-${feature.code}`}>Choose whether {feature.label} is required, preferred, something to avoid, or not selected.</span>
                </div>
              ))}
            </fieldset>
          ))}
        </div>

        <div className="profile-actions"><button className="button button-primary" type="button" onClick={saveProfile}>Save profile</button><button className="button button-text" type="button" onClick={clearProfile}>Clear all</button><button className="button button-text button-text-muted" type="button" onClick={resetProfile}>Reset sample</button></div>
        <p className="save-status" aria-live="polite">{saved ? <><span aria-hidden="true">✓</span> Saved privately in this browser.</> : 'Changes are local until you save them.'}</p>
        <div className="privacy-message"><span className="info-icon" aria-hidden="true">i</span><p>This is a private preference tool. It is not a medical record, is not added to place links, and is never shown as part of a public place response.</p></div>
      </section>

      <aside className="profile-preview-card" aria-labelledby="profile-preview-title">
        <div className="profile-card-heading"><div><p className="section-label">Live sample preview</p><h2 id="profile-preview-title">How your match reads</h2></div><StatusBadge status={explanation.decision}>{decisionLabel(explanation.decision)}</StatusBadge></div>
        <p className="profile-preview-intro">This is evaluated against the sample place using the same feature-level logic as place results. Unknown information is never treated as a yes or no.</p>
        <div className="preview-metrics">
          <div><strong>{explanation.required.confirmed}</strong><span>required confirmed</span></div>
          <div><strong>{explanation.required.knownBarriers}</strong><span>required barriers</span></div>
          <div><strong>{explanation.required.unknown}</strong><span>required unknown</span></div>
          <div><strong>{explanation.preferred.confirmed}</strong><span>preferred confirmed</span></div>
          <div><strong>{explanation.avoidanceWarnings.length}</strong><span>avoid warnings</span></div>
        </div>
        {explanation.items.length > 0 ? <div className="preview-list">
          {explanation.items.map((item) => <div key={item.featureCode}><span className={`metric-icon metric-icon-${item.result}`} aria-hidden="true">{item.result === 'confirmed' ? '✓' : item.result === 'unknown' ? '?' : item.result === 'warning' ? '!' : '×'}</span><span><strong>{labelForFeature(item.featureCode)}</strong><small>{levelLabel(item.level)} · {item.reason}</small></span><b>{item.observedAt ? formatObservedDate(item.observedAt) : item.result === 'unknown' ? 'No recent data' : item.result}</b></div>)}
        </div> : <div className="profile-no-selection"><strong>Nothing is selected yet.</strong><span>Add a requirement to see a personal place match.</span></div>}
        <Link className="text-link" href="/places/place_sample_community_centre">See this place’s evidence <span aria-hidden="true">→</span></Link>
      </aside>
    </div>
  );
}
