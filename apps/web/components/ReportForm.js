'use client';

import { startTransition, useEffect, useRef, useState } from 'react';
import { labelForFeature } from '../lib/api/normalizers';

const draftKey = 'accessmap.sample.report-draft';

const emptyForm = {
  feature: '',
  status: '',
  observedAt: '',
  details: ''
};

export default function ReportForm({ place, features = [], initialFeature }) {
  const [form, setForm] = useState({ ...emptyForm, feature: initialFeature });
  const [errors, setErrors] = useState({});
  const [draftState, setDraftState] = useState('');
  const [submissionState, setSubmissionState] = useState('');
  const errorSummaryRef = useRef(null);

  useEffect(() => {
    try {
      const draft = JSON.parse(window.localStorage.getItem(draftKey) ?? 'null');
      if (draft) startTransition(() => setForm((current) => ({ ...current, ...draft })));
    } catch {
      // A blocked or malformed draft should not stop a new report.
    }
  }, []);

  useEffect(() => {
    if (Object.keys(errors).length > 0) errorSummaryRef.current?.focus();
  }, [errors]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setDraftState('');
    setSubmissionState('');
  }

  function validate() {
    const nextErrors = {};
    if (!form.feature) nextErrors.feature = 'Choose the feature or area you observed.';
    if (!form.status) nextErrors.status = 'Choose what you observed.';
    if (!form.observedAt) nextErrors.observedAt = 'Add the date you observed this condition.';
    if (form.observedAt && new Date(form.observedAt) > new Date()) nextErrors.observedAt = 'Observation dates cannot be in the future.';
    return nextErrors;
  }

  function saveDraft() {
    try { window.localStorage.setItem(draftKey, JSON.stringify(form)); } catch { /* The form remains usable in memory. */ }
    setDraftState('saved');
    setSubmissionState('');
  }

  function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setDraftState('');
      setSubmissionState('');
      return;
    }
    setErrors({});
    setSubmissionState('fixture');
  }

  const fieldClass = (field) => errors[field] ? 'form-field form-field-error' : 'form-field';

  return (
    <div className="report-layout">
      <form className="report-card" onSubmit={handleSubmit} noValidate>
        {Object.keys(errors).length > 0 ? <div className="error-summary" ref={errorSummaryRef} tabIndex="-1" role="alert" aria-labelledby="error-summary-title"><strong id="error-summary-title">Check your report before continuing.</strong><ul>{Object.entries(errors).map(([field, error]) => <li key={field}><a href={`#report-${field}`}>{error}</a></li>)}</ul></div> : null}
        <div className="report-card-heading"><div><p className="section-label">Observation details</p><h2>What did you notice?</h2></div><span className="required-note">* Required</span></div>
        <p className="report-intro">Select one feature and describe the condition as you saw it. You can save this report on your device if you are not ready to continue.</p>
          <div className={fieldClass('feature')}><label htmlFor="report-feature">Feature or area <span aria-hidden="true">*</span></label><select id="report-feature" value={form.feature} onChange={(event) => updateField('feature', event.target.value)} aria-invalid={Boolean(errors.feature)} aria-describedby={errors.feature ? 'report-feature-error' : 'report-feature-help'}><option value="">Choose a feature</option>{features.map((feature) => <option value={feature.code} key={feature.code}>{feature.label}</option>)}</select><p className="field-help" id="report-feature-help">Choose the most specific feature you can describe.</p>{errors.feature ? <p className="field-error" id="report-feature-error">{errors.feature}</p> : null}</div>
        <div className={fieldClass('status')}><label htmlFor="report-status">What was the status? <span aria-hidden="true">*</span></label><select id="report-status" value={form.status} onChange={(event) => updateField('status', event.target.value)} aria-invalid={Boolean(errors.status)} aria-describedby={errors.status ? 'report-status-error' : 'report-status-help'}><option value="">Choose a status</option><option value="available">Available</option><option value="partial">Partially available</option><option value="unavailable">Unavailable</option><option value="temporarily_unavailable">Temporarily unavailable</option><option value="incorrect">Information seems incorrect</option><option value="unknown">I could not tell</option></select><p className="field-help" id="report-status-help">Use “temporarily unavailable” for a condition that may change.</p>{errors.status ? <p className="field-error" id="report-status-error">{errors.status}</p> : null}</div>
        <div className={fieldClass('observedAt')}><label htmlFor="report-observedAt">When did you observe this? <span aria-hidden="true">*</span></label><input id="report-observedAt" type="date" value={form.observedAt} onChange={(event) => updateField('observedAt', event.target.value)} max={new Date().toISOString().slice(0, 10)} aria-invalid={Boolean(errors.observedAt)} aria-describedby={errors.observedAt ? 'report-observedAt-error' : 'report-observedAt-help'} /><p className="field-help" id="report-observedAt-help">Use the date of your visit, not the date you are submitting.</p>{errors.observedAt ? <p className="field-error" id="report-observedAt-error">{errors.observedAt}</p> : null}</div>
        <div className="form-field"><label htmlFor="report-details">What should someone know? <span className="optional-label">Optional</span></label><textarea id="report-details" value={form.details} onChange={(event) => updateField('details', event.target.value)} rows="5" maxLength="500" placeholder="For example: the ramp was blocked by a delivery trolley near the side entrance." /><p className="field-help">Avoid names, contact details, addresses, or other private information.</p></div>

        <fieldset className="evidence-fieldset"><legend>Evidence <span className="optional-label">Optional</span></legend><div className="evidence-guidance"><span className="evidence-icon" aria-hidden="true">⌁</span><div><strong>Privacy guidance</strong><p>Do not include people, documents, private addresses, or other personal information in an image. Evidence upload is not connected in this sample flow; your text report can still continue without a photo.</p></div></div></fieldset>

        <div className="report-form-actions"><button className="button button-primary" type="submit">Review report</button><button className="button button-secondary" type="button" onClick={saveDraft}>Save on this device</button></div>
        <p className="report-form-note"><span className="info-icon" aria-hidden="true">i</span> In the real application, reports wait for server confirmation before they can affect public information.</p>
        {draftState === 'saved' ? <div className="inline-success" role="status"><span aria-hidden="true">✓</span><div><strong>Saved on this device.</strong><p>It is a local draft and has not been sent to AccessMap.</p></div></div> : null}
        {submissionState === 'fixture' ? <div className="fixture-result" role="status"><div className="fixture-result-icon" aria-hidden="true">✓</div><div><strong>Fixture preview ready</strong><p>Your valid report is ready to be sent, but this repository has no report API yet. Nothing was submitted and no public claim changed.</p><button className="button button-text" type="button" onClick={() => setSubmissionState('')}>Edit report</button></div></div> : null}
      </form>

       <aside className="report-side"><div className="report-context-card"><p className="section-label">Reporting about</p><h2>{place.name}</h2><p>{place.address}</p>{place.sampleData ? <span className="sample-chip">Sample context</span> : <span className="live-chip">Directory context</span>}<div className="context-feature"><span className="feature-icon" aria-hidden="true">⌂</span><div><strong>{form.feature ? labelForFeature(form.feature, features.find((feature) => feature.code === form.feature)?.label) : 'Choose a feature'}</strong><span>{form.status ? form.status.replaceAll('_', ' ') : 'Status will appear here'}</span></div></div></div><div className="report-trust-card"><span className="trust-icon" aria-hidden="true">✦</span><h2>Small details help.</h2><p>One dated, specific observation is more useful than a broad accessibility label. It is okay to report that you are unsure.</p></div></aside>
    </div>
  );
}
