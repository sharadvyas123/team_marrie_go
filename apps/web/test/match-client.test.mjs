import assert from 'node:assert/strict';
import test from 'node:test';
import { featureCatalog, samplePlace } from '../lib/fixture-client.js';
import { evaluatePlaceMatch } from '../lib/match-client.js';

test('the profile catalog covers mobility, visual, hearing, and sensory needs', () => {
  assert.deepEqual([...new Set(featureCatalog.map((feature) => feature.group))], [
    'Mobility',
    'Sensory environment',
    'Visual access',
    'Hearing and communication'
  ]);
  assert.ok(featureCatalog.some((feature) => feature.code === 'tactile_paving'));
  assert.ok(featureCatalog.some((feature) => feature.code === 'visual_alerts'));
  assert.ok(featureCatalog.some((feature) => feature.code === 'quiet_space'));
});

test('a sample place is evaluated against the selected person, not a universal score', () => {
  const result = evaluatePlaceMatch({
    step_free_entrance: 'required',
    accessible_toilet: 'required',
    tactile_paving: 'preferred'
  }, samplePlace);

  assert.equal(result.decision, 'needs_more_information');
  assert.equal(result.required.confirmed, 1);
  assert.equal(result.required.unknown, 1);
  assert.equal(result.preferred.unknown, 1);
  assert.equal('score' in result, false);
});

test('a current sample barrier changes the result for the matching feature', () => {
  const result = evaluatePlaceMatch({ ramp_available: 'required' }, samplePlace);

  assert.equal(result.decision, 'known_barrier');
  assert.equal(result.required.knownBarriers, 1);
  assert.equal(result.items[0].result, 'barrier');
});
