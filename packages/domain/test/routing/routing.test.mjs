import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRouteCacheKey,
  enrichRouteResult,
  evaluateRouteSegment,
  invalidateAffectedRouteKeys,
  normalizeRouteRequest,
  routeCacheMetadata
} from '../../src/routing/index.mjs';

const ORIGIN = { placeId: 'origin' };
const DESTINATION = { placeId: 'destination' };

function request(constraints = {}) {
  return normalizeRouteRequest({ origin: ORIGIN, destination: DESTINATION, constraints });
}

test('route requests accept bounded aliases and reject unbounded values', () => {
  const normalized = normalizeRouteRequest({
    from: { lat: 51.5, lng: -0.1 },
    to: [ -0.11, 51.51 ],
    constraints: {
      noStairs: true,
      maximumSlope: 8,
      minimumWidth: 1.2,
      require_curb_ramps: true,
      allowedSurfaces: ['asphalt', 'concrete']
    },
    max_alternatives: 4
  });

  assert.deepEqual(normalized.origin, { latitude: 51.5, longitude: -0.1 });
  assert.equal(normalized.constraints.hard.avoidStairs, true);
  assert.equal(normalized.constraints.hard.maxSlope, 8);
  assert.equal(normalized.constraints.hard.minWidth, 1.2);
  assert.equal(normalized.constraints.hard.requireCurbRamps, true);
  assert.deepEqual(normalized.constraints.hard.allowedSurfaces, ['asphalt', 'concrete']);
  assert.equal(normalized.maxAlternatives, 4);
  assert.throws(
    () => normalizeRouteRequest({ origin: ORIGIN, destination: DESTINATION, maxAlternatives: 11 }),
    (error) => error.code === 'ROUTE_BOUND_INVALID' && error.field === 'maxAlternatives'
  );
  assert.throws(
    () => normalizeRouteRequest({ origin: ORIGIN, destination: DESTINATION, constraints: { maxSlope: 101 } }),
    (error) => error.code === 'ROUTE_CONSTRAINT_OUT_OF_RANGE'
  );
});

test('hard stairs, slope, width, curb, and surface rules make a segment unsuitable', () => {
  const evaluation = evaluateRouteSegment({
    id: 'edge-stairs',
    steps: 4,
    slopePercent: 14,
    widthMeters: 0.7,
    curbRamp: false,
    surface: 'cobblestone',
    observedAt: '2026-10-16T10:00:00Z'
  }, request({
    noStairs: true,
    maxSlope: 8,
    minWidth: 1.2,
    requireCurbRamps: true,
    allowedSurfaces: ['asphalt']
  }).constraints);

  assert.equal(evaluation.suitable, false);
  assert.deepEqual(evaluation.hardViolations.map((item) => item.code), [
    'curbRamp', 'slope', 'stairs', 'surface', 'width'
  ]);
});

test('unknown, stale, and active-barrier evidence remains visible and deterministic', () => {
  const unknown = evaluateRouteSegment({ id: 'unassessed' }, request({ unknownPolicy: 'hard' }).constraints);
  assert.equal(unknown.unknown, true);
  assert.equal(unknown.suitable, false);
  assert.equal(unknown.hardViolations[0].code, 'unknown');

  const stale = evaluateRouteSegment({
    id: 'stale-edge',
    observedAt: '2024-01-01T00:00:00Z',
    freshnessState: 'stale'
  }, request({ stalePolicy: 'hard' }).constraints);
  assert.equal(stale.stale, true);
  assert.equal(stale.hardViolations[0].code, 'stale');

  const barrier = evaluateRouteSegment({
    id: 'blocked-edge',
    observedAt: '2026-10-16T00:00:00Z',
    activeBarriers: [{ id: 'incident-2', type: 'blocked_path', severity: 'high', source: 'community' }]
  }, request().constraints);
  assert.equal(barrier.suitable, false);
  assert.equal(barrier.activeBarriers[0].id, 'incident-2');
  assert.equal(barrier.hardViolations[0].code, 'barrier');
});

test('route enrichment rejects a stairs-only route as suitable and orders explanations', () => {
  const result = enrichRouteResult({
    routes: [
      {
        id: 'stairs-route',
        distanceMeters: 100,
        durationSeconds: 60,
        segments: [{ id: 'stairs-edge', steps: 5, observedAt: '2026-10-16T00:00:00Z' }]
      },
      {
        id: 'step-free-route',
        distanceMeters: 150,
        durationSeconds: 90,
        segments: [{ id: 'flat-edge', steps: 0, slopePercent: 2, observedAt: '2026-10-16T00:00:00Z' }]
      }
    ]
  }, { constraints: request({ noStairs: true }).constraints, now: () => Date.parse('2026-10-17T00:00:00Z') });

  assert.equal(result.selectedRoute.id, 'step-free-route');
  assert.equal(result.routes.find((route) => route.id === 'stairs-route').suitable, false);
  assert.equal(result.selectedRoute.isAccessibilityGuarantee, false);
  assert.equal(result.selectedRoute.explanation.recommendation.includes('not a guarantee'), true);
});

test('cache keys are versioned and invalidation is selective by route scope', () => {
  const nearby = request();
  const unrelated = normalizeRouteRequest({ origin: { placeId: 'other-origin' }, destination: { placeId: 'other-destination' } });
  const nearbyEntry = routeCacheMetadata(nearby, { graphVersion: 3, incidentVersion: 7 });
  const unrelatedEntry = routeCacheMetadata(unrelated, { graphVersion: 3, incidentVersion: 7 });
  const key = createRouteCacheKey(nearby, { graphVersion: 3, incidentVersion: 7 });

  assert.match(key, /^route:v1:g3:i7:s/);
  assert.deepEqual(
    invalidateAffectedRouteKeys([nearbyEntry, unrelatedEntry], { placeId: 'origin' }),
    [nearbyEntry.key]
  );
  assert.deepEqual(invalidateAffectedRouteKeys([nearbyEntry, unrelatedEntry], { placeId: 'unrelated' }), []);
});
