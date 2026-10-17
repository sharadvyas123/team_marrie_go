import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateMatch } from '../../src/matching/index.mjs';

const CLAIMS_VERSION = 12;

function profile(...requirements) {
  return { requirements };
}

function claim(featureCode, options = {}) {
  return {
    featureCode,
    status: 'recently_observed',
    summaryValue: 'yes',
    freshnessState: 'fresh',
    source: 'community',
    latestObservedAt: '2026-10-10T10:00:00Z',
    ...options
  };
}

function claims(...entries) {
  return {
    claimsVersion: CLAIMS_VERSION,
    calculationVersion: 1,
    claims: entries
  };
}

test('a missing profile returns no_profile without exposing profile data', () => {
  const result = evaluateMatch(null, claims());

  assert.deepEqual(result, {
    decision: 'no_profile',
    required: { total: 0, confirmed: 0, knownBarriers: 0, partial: 0, unknown: 0 },
    preferred: { total: 0, confirmed: 0, partial: 0, unknown: 0 },
    avoidanceWarnings: [],
    items: [],
    claimsVersion: CLAIMS_VERSION,
    calculationVersion: 1
  });
  assert.equal('score' in result, false);
});

test('all required features with recent positive claims are confirmed', () => {
  const result = evaluateMatch({
    profileSnapshot: profile(
      { featureCode: 'accessible_toilet', level: 'required' },
      { featureCode: 'step_free_entrance', level: 'required' }
    ),
    claimsSnapshot: claims(
      claim('step_free_entrance', { latestObservedAt: '2026-10-01T09:00:00Z' }),
      claim('accessible_toilet', { latestObservedAt: '2026-10-02T09:00:00Z' })
    )
  });

  assert.equal(result.decision, 'meets_known_requirements');
  assert.deepEqual(result.required, { total: 2, confirmed: 2, knownBarriers: 0, partial: 0, unknown: 0 });
  assert.deepEqual(result.items, [
    {
      featureCode: 'accessible_toilet',
      level: 'required',
      result: 'confirmed',
      reason: 'Recent supporting claim confirms this feature',
      claimStatus: 'recently_observed',
      source: 'community',
      observedAt: '2026-10-02T09:00:00Z'
    },
    {
      featureCode: 'step_free_entrance',
      level: 'required',
      result: 'confirmed',
      reason: 'Recent supporting claim confirms this feature',
      claimStatus: 'recently_observed',
      source: 'community',
      observedAt: '2026-10-01T09:00:00Z'
    }
  ]);
});

test('a required unknown feature needs more information', () => {
  const result = evaluateMatch(
    profile({ featureCode: 'working_lift', level: 'required' }),
    claims()
  );

  assert.equal(result.decision, 'needs_more_information');
  assert.deepEqual(result.required, { total: 1, confirmed: 0, knownBarriers: 0, partial: 0, unknown: 1 });
  assert.deepEqual(result.items[0], {
    featureCode: 'working_lift',
    level: 'required',
    result: 'unknown',
    reason: 'No recent supporting claim',
    claimStatus: 'not_assessed'
  });
});

test('a recent negative claim is a known required barrier', () => {
  const result = evaluateMatch(
    profile({ featureCode: 'step_free_entrance', level: 'required' }),
    claims(
      claim('step_free_entrance', {
        summaryValue: 'no',
        latestObservedAt: '2026-10-11T09:00:00Z'
      })
    )
  );

  assert.equal(result.decision, 'known_barrier');
  assert.deepEqual(result.required, { total: 1, confirmed: 0, knownBarriers: 1, partial: 0, unknown: 0 });
  assert.equal(result.items[0].result, 'barrier');
  assert.equal(result.items[0].observedAt, '2026-10-11T09:00:00Z');
});

test('a preferred unknown feature remains visible without blocking the match', () => {
  const result = evaluateMatch(
    profile(
      { featureCode: 'step_free_entrance', level: 'required' },
      { featureCode: 'quiet_space', level: 'preferred' }
    ),
    claims(claim('step_free_entrance'))
  );

  assert.equal(result.decision, 'meets_known_requirements');
  assert.deepEqual(result.preferred, { total: 1, confirmed: 0, partial: 0, unknown: 1 });
  assert.deepEqual(result.items.find((item) => item.featureCode === 'quiet_space'), {
    featureCode: 'quiet_space',
    level: 'preferred',
    result: 'unknown',
    reason: 'No recent supporting claim',
    claimStatus: 'not_assessed'
  });
});

test('a known avoided condition is returned as an avoidance warning', () => {
  const result = evaluateMatch(
    profile(
      { featureCode: 'step_free_entrance', level: 'required' },
      { featureCode: 'stairs', level: 'avoid' }
    ),
    claims(claim('step_free_entrance'), claim('stairs'))
  );

  assert.equal(result.decision, 'meets_known_requirements');
  assert.deepEqual(result.avoidanceWarnings, [
    result.items.find((item) => item.featureCode === 'stairs')
  ]);
  const warning = result.items.find((item) => item.featureCode === 'stairs');
  assert.equal(warning.result, 'warning');
  assert.match(warning.reason, /avoid preference/);
});

test('stale and conflicted claims stay unknown and cannot confirm requirements', () => {
  const result = evaluateMatch(
    profile(
      { featureCode: 'accessible_toilet', level: 'required' },
      { featureCode: 'working_lift', level: 'required' }
    ),
    claims(
      claim('accessible_toilet', {
        freshnessState: 'stale',
        latestObservedAt: '2024-01-10T09:00:00Z'
      }),
      claim('working_lift', {
        status: 'conflicting_information',
        summaryValue: 'unknown'
      })
    )
  );

  assert.equal(result.decision, 'needs_more_information');
  assert.deepEqual(result.required, { total: 2, confirmed: 0, knownBarriers: 0, partial: 0, unknown: 2 });
  assert.equal(result.items[0].result, 'unknown');
  assert.equal(result.items[0].claimStatus, 'recently_observed');
  assert.equal(result.items[1].result, 'unknown');
  assert.equal(result.items[1].claimStatus, 'conflicting_information');
  assert.equal(result.items[1].observedAt, '2026-10-10T10:00:00Z');
});

test('an active barrier for an avoided feature is an avoidance warning', () => {
  const result = evaluateMatch({
    profileSnapshot: profile({ featureCode: 'stairs', level: 'avoid' }),
    claimsSnapshot: {
      claimsVersion: CLAIMS_VERSION,
      claims: [],
      barriers: [{ featureCode: 'stairs', status: 'published', observedAt: '2026-10-11T09:00:00Z' }]
    }
  });

  assert.equal(result.decision, 'meets_known_requirements');
  assert.equal(result.items[0].result, 'warning');
  assert.deepEqual(result.avoidanceWarnings, [result.items[0]]);
  assert.match(result.items[0].reason, /avoid preference/);
});

test('partial required claims are counted as partial rather than unknown', () => {
  const result = evaluateMatch(
    profile({ featureCode: 'step_free_entrance', level: 'required' }),
    claims(claim('step_free_entrance', { summaryValue: 'partial' }))
  );

  assert.equal(result.decision, 'partial');
  assert.deepEqual(result.required, { total: 1, confirmed: 0, knownBarriers: 0, partial: 1, unknown: 0 });
});
