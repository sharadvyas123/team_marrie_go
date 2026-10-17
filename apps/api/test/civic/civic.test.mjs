import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCivicService,
  normalizeBbox,
  serializePublicAccessibility
} from '../../src/civic/index.mjs';

test('public civic serializer redacts private fields and unapproved claims', () => {
  const result = serializePublicAccessibility({
    place: { id: 'place-1', name: 'Library', status: 'active', managerId: 'private-manager', email: 'private@example.test' },
    claims: [
      { id: 'claim-1', featureCode: 'lift', status: 'approved', contributorId: 'private-user' },
      { id: 'claim-2', featureCode: 'toilet', status: 'pending', moderatorNotes: 'private' }
    ]
  });
  assert.equal(result.claims.length, 1);
  assert.equal(Object.hasOwn(result.place, 'managerId'), false);
  assert.doesNotMatch(JSON.stringify(result), /private@example|private-manager|private-user|moderatorNotes/);
});

test('civic listing is paginated, bounded, filtered, and rate-limited through ports', async () => {
  const calls = [];
  const service = createCivicService({
    publicRepository: {
      async listPublicIncidents(options) {
        calls.push(options);
        return { items: [
          { id: 'incident-public', status: 'published', placeId: 'place-1', explanation: 'Ramp blocked' },
          { id: 'incident-private', status: 'reported', placeId: 'place-1', reporterId: 'private-user' }
        ], total: 2 };
      }
    },
    rateLimitPort: { async check(input) { calls.push(input); return { allowed: true }; } }
  });
  const result = await service.listIncidents({ page: 2, pageSize: 10, bbox: '-1,-1,1,1', activeOnly: true }, { apiKeyId: 'key-1' });
  assert.equal(result.items.length, 1);
  assert.equal(result.pagination.page, 2);
  assert.equal(calls[0].action, 'civic-api:incidents');
  assert.equal(calls[1].bbox.minLng, -1);
  await assert.rejects(() => service.listIncidents({ pageSize: 101 }), (error) => error.code === 'CIVIC_BOUND_INVALID');

  const limited = createCivicService({ publicRepository: { async listPublicIncidents() { return []; } }, rateLimitPort: { async check() { return { allowed: false, retryAfter: 30 }; } } });
  await assert.rejects(() => limited.listIncidents(), (error) => error.code === 'CIVIC_RATE_LIMITED' && error.status === 429 && error.retryAfter === 30);
});

test('civic bbox rejects overly broad requests', () => {
  assert.throws(() => normalizeBbox('-180,-90,180,90'), (error) => error.code === 'CIVIC_BBOX_TOO_LARGE');
});
