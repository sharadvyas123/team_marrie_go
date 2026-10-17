import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFacilityService,
  createQrContext,
  serializeFacilityResponse,
  validateQrContext
} from '../../src/facility/index.mjs';

const NOW = Date.parse('2026-10-17T10:00:00.000Z');

function facilityFixture() {
  const claims = new Map([
    ['manager-1:place-1', { placeId: 'place-1', userId: 'manager-1', status: 'approved' }],
    ['manager-1:place-revoked', { placeId: 'place-revoked', userId: 'manager-1', status: 'revoked' }]
  ]);
  const responses = [];
  const observations = [{ id: 'observation-1', placeId: 'place-1', details: 'Independent report', visibility: 'public' }];
  const store = {
    async createFacilityResponse(record) { responses.push({ ...record }); return record; },
    async getFacilityResponse(id) { return responses.find((record) => record.id === id) ?? null; },
    async updateFacilityResponse(id, record) { const index = responses.findIndex((item) => item.id === id); responses[index] = record; return record; },
    async getFacility(placeId) { return { id: placeId, name: 'Library', communityHistory: observations, responses }; },
    async listApprovedFacilities() { return [{ id: 'place-1', name: 'Library' }]; },
    async createFacilityClaim(record) { return record; },
    async createFacilityIncident(record) { return record; },
    async getFacilityIncident() { return null; }
  };
  const authorizationPort = {
    requireRole(session, roles) {
      if (!roles.includes(session.user.role)) throw Object.assign(new Error('forbidden'), { status: 403 });
      return session.user;
    },
    requireFacilityScope(session, placeId) {
      if (session.user.role === 'admin' || session.user.facilityIds?.includes(placeId)) return session.user;
      throw Object.assign(new Error('out of scope'), { status: 403 });
    }
  };
  const service = createFacilityService({
    store,
    authorizationPort,
    claimStore: {
      async findApprovedClaim(placeId, userId) { return claims.get(`${userId}:${placeId}`) ?? null; }
    },
    clock: () => NOW,
    idFactory: () => `facility-${responses.length + 1}`
  });
  return { service, observations, responses };
}

const manager = { session: { authenticated: true, user: { id: 'manager-1', role: 'facility_manager', status: 'active', facilityIds: ['place-1', 'place-revoked'] } } };

test('approved facility managers can publish separate responses, while revoked or out-of-scope claims cannot', async () => {
  const { service, observations, responses } = facilityFixture();
  const created = await service.createResponse({ placeId: 'place-1', featureId: 'lift', response: 'The lift is working.', statusValue: 'yes' }, manager);
  assert.equal(created.source, 'facility');
  assert.equal(created.observedAt, new Date(NOW).toISOString());
  assert.equal(responses.length, 1);
  assert.equal(observations.length, 1);

  await assert.rejects(
    () => service.createResponse({ placeId: 'place-revoked', response: 'No longer available.' }, manager),
    (error) => error.code === 'FACILITY_CLAIM_NOT_APPROVED'
  );
  await assert.rejects(
    () => service.createResponse({ placeId: 'place-2', response: 'Unauthorized.' }, manager),
    (error) => error.status === 403
  );
  await assert.rejects(() => service.deleteCommunityObservation('observation-1', manager), (error) => error.code === 'FACILITY_HISTORY_IMMUTABLE');
});

test('facility claim requests require a manager role and preserve claim status from the repository', async () => {
  const { service } = facilityFixture();
  const claim = await service.requestClaim({ placeId: 'place-new', organizationName: 'Civic Library', verificationMethod: 'phone_callback' }, manager);
  assert.equal(claim.status, 'pending');
  await assert.rejects(
    () => service.requestClaim({ placeId: 'place-new', organizationName: 'Nope', verificationMethod: 'official_email' }, { session: { user: { id: 'user-1', role: 'user' } } }),
    (error) => error.status === 403
  );
});

test('QR context signing detects tampering, expiry, revocation, and private context mismatch', async () => {
  const secret = 'qr-signing-secret-which-is-long-enough';
  const created = createQrContext({ facilityId: 'place-1', placeId: 'place-1', contextType: 'lift', contextId: 'lift-1' }, { secret, clock: () => NOW, idFactory: () => 'qr-1', ttlMs: 60_000 });
  const contextPort = { async resolveContext(context) { return { ...context, public: true }; } };
  const valid = await validateQrContext(created.token, { secret, clock: () => NOW, contextPort });
  assert.deepEqual(valid.context, { facilityId: 'place-1', placeId: 'place-1', contextType: 'lift', contextId: 'lift-1' });

  await assert.rejects(() => validateQrContext(`${created.token.slice(0, -1)}x`, { secret, clock: () => NOW }), (error) => error.code === 'QR_CONTEXT_SIGNATURE_INVALID');
  await assert.rejects(() => validateQrContext(created.token, { secret, clock: () => NOW + 61_000 }), (error) => error.code === 'QR_CONTEXT_EXPIRED');
  await assert.rejects(() => validateQrContext(created.token, { secret, clock: () => NOW, revocationPort: { async isRevoked() { return true; } } }), (error) => error.code === 'QR_CONTEXT_REVOKED');
  await assert.rejects(() => validateQrContext(created.token, { secret, clock: () => NOW, contextPort: { async resolveContext() { return { private: true }; } } }), (error) => error.code === 'QR_CONTEXT_SCOPE_MISMATCH' || error.code === 'QR_CONTEXT_PRIVATE');
});

test('facility response serializer never exposes manager identity', () => {
  const output = serializeFacilityResponse({ id: 'response-1', placeId: 'place-1', managerId: 'private-manager', response: 'Open', updatedAt: new Date(NOW).toISOString() });
  assert.equal(output.source, 'facility');
  assert.equal(Object.hasOwn(output, 'managerId'), false);
  assert.doesNotMatch(JSON.stringify(output), /private-manager/);
});
