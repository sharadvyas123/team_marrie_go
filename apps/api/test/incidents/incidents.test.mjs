import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createIncidentService,
  createPublicIncidentEvent,
  serializePublicIncident
} from '../../src/incidents/index.mjs';

const NOW = Date.parse('2026-10-17T10:00:00.000Z');

function fixture() {
  const records = new Map();
  const invalidations = [];
  const events = [];
  const repository = {
    async createIncident(record) {
      const stored = { ...record };
      records.set(stored.id, stored);
      return stored;
    },
    async getIncident(id) { return records.get(id) ?? null; },
    async updateIncident(id, record) {
      records.set(id, { ...record, id });
      return records.get(id);
    },
    async listIncidents() { return [...records.values()]; }
  };
  const service = createIncidentService({
    repository,
    clock: () => NOW,
    idFactory: () => 'incident-1',
    routeInvalidationPort: {
      async invalidateAffected(message) { invalidations.push(message); }
    },
    eventPort: {
      async publish(type, payload) { events.push({ type, payload }); }
    }
  });
  return { service, records, invalidations, events };
}

test('incident validation rejects missing targets and unbounded listings', async () => {
  const { service } = fixture();
  await assert.rejects(
    () => service.create({ type: 'blocked_path', severity: 'high' }),
    (error) => error.code === 'INCIDENT_AFFECTED_ENTITY_REQUIRED'
  );
  await assert.rejects(
    () => service.list({ pageSize: 101 }),
    (error) => error.code === 'INCIDENT_BOUND_INVALID'
  );
});

test('incident create, update, resolve, selective invalidation, and public events work', async () => {
  const { service, records, invalidations, events } = fixture();
  const created = await service.create({
    id: 'incident-1',
    placeId: 'place-1',
    accessEdgeId: 'edge-1',
    type: 'blocked_ramp',
    severity: 'high',
    source: 'community',
    startsAt: '2026-10-17T09:00:00Z',
    expectedExpiryAt: '2026-10-18T09:00:00Z',
    explanation: 'Delivery vehicle blocks the curb ramp.',
    reporterId: 'private-user',
    moderatorNotes: 'private note'
  });
  assert.equal(created.status, 'reported');
  assert.equal(created.accessEdgeId, 'edge-1');
  assert.equal(records.get('incident-1').reporterId, 'private-user');
  assert.equal(invalidations.length, 1);

  const published = await service.update('incident-1', { status: 'published' });
  assert.equal(published.status, 'published');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'incident.updated');

  const resolved = await service.resolve('incident-1', { explanation: 'Ramp cleared.' });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.resolvedAt, new Date(NOW).toISOString());
  assert.equal(invalidations.length, 3);
  assert.equal(events[1].type, 'incident.resolved');
  assert.equal(events[1].payload.incident.status, 'resolved');
  assert.equal(Object.hasOwn(events[1].payload.incident, 'reporterId'), false);
});

test('public serializer and SSE payload redact private contributor and moderator data', () => {
  const record = {
    id: 'incident-2',
    placeId: 'place-2',
    type: 'broken_lift',
    severity: 'medium',
    source: { type: 'facility', reporterId: 'secret', email: 'secret@example.test' },
    status: 'published',
    reporterId: 'private-user',
    reporterEmail: 'secret@example.test',
    moderatorId: 'private-moderator',
    moderatorNotes: 'internal',
    privateEvidenceKey: 'private/evidence'
  };
  const publicView = serializePublicIncident(record, { includeUnpublished: false });
  assert.equal(publicView.source, 'facility');
  assert.equal(Object.hasOwn(publicView, 'reporterId'), false);
  assert.equal(JSON.stringify(publicView).includes('secret@example.test'), false);
  assert.equal(JSON.stringify(createPublicIncidentEvent(record)).includes('private-user'), false);
});
