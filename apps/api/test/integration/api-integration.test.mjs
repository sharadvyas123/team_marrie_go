import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalSignedToken } from '../../src/auth/index.mjs';
import { EventHub, createApiServer } from '../../src/server.mjs';

const AUTH_SECRET = 'integration-secret-that-is-long-enough';

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function start(options = {}) {
  const server = createApiServer({
    pool: null,
    repository: null,
    authSecret: AUTH_SECRET,
    ...options
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function authHeaders(role = 'user') {
  return {
    authorization: `Bearer ${createLocalSignedToken({ sub: `${role}-1`, role }, { secret: AUTH_SECRET })}`,
    'content-type': 'application/json'
  };
}

test('shared API registers routes and incident lifecycle services with authenticated context', async (t) => {
  const calls = [];
  const running = await start({
    routingService: {
      async calculate(request) {
        calls.push({ type: 'route', request });
        return { schemaVersion: 'route.v1', id: 'route-1', recommendation: true };
      }
    },
    incidentService: {
      async create(input, context) {
        calls.push({ type: 'create', input, context });
        return { id: 'incident-1', placeId: 'place-1', status: 'reported' };
      },
      async update(id, patch, context) {
        calls.push({ type: 'update', id, patch, context });
        return { id, placeId: 'place-1', status: patch.status ?? 'published' };
      },
      async list() { return { items: [], pagination: { page: 1, pageSize: 20, total: 0, hasNext: false } }; }
    }
  });
  t.after(() => closeServer(running.server));

  const routeResponse = await fetch(`${running.baseUrl}/api/routes?originPlaceId=origin&destinationPlaceId=destination&noStairs=true`);
  assert.equal(routeResponse.status, 200);
  assert.equal((await routeResponse.json()).id, 'route-1');

  const createResponse = await fetch(`${running.baseUrl}/api/incidents`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ placeId: 'place-1', type: 'blocked_path', severity: 'high' })
  });
  assert.equal(createResponse.status, 201);

  const patchResponse = await fetch(`${running.baseUrl}/api/incidents/incident-1`, {
    method: 'PATCH',
    headers: authHeaders('moderator'),
    body: JSON.stringify({ status: 'published' })
  });
  assert.equal(patchResponse.status, 200);
  assert.equal(calls[0].request.constraints.avoidStairs, 'true');
  assert.equal(calls[1].context.actorId, 'user-1');
  assert.equal(calls[2].context.session.user.role, 'moderator');
});

test('evidence upload intent and status responses never expose private storage keys', async (t) => {
  const running = await start({
    evidenceUploadService: {
      async createUploadIntent() {
        return {
          evidenceId: 'evidence-1',
          uploadUrl: 'https://upload.example.test/signed',
          headers: { 'content-type': 'image/jpeg' },
          expiresAt: '2026-10-17T10:15:00.000Z',
          mediaType: 'image',
          maxBytes: 10,
          status: 'awaiting_upload',
          storageKey: 'private/original/should-not-return'
        };
      }
    },
    evidenceRepository: {
      async listForObservation() {
        return [{ id: 'evidence-1', observationId: 'observation-1', mediaType: 'image', state: 'processing', moderationStatus: 'pending', storageKey: 'private/original/private', sensitiveFlags: [] }];
      }
    }
  });
  t.after(() => closeServer(running.server));

  const intent = await fetch(`${running.baseUrl}/api/observations/observation-1/evidence/upload-intent`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ fileName: 'ramp.jpg', mediaType: 'image/jpeg', sizeBytes: 10 })
  });
  assert.equal(intent.status, 201);
  const intentBody = await intent.json();
  assert.equal(intentBody.evidenceId, 'evidence-1');
  assert.equal(Object.hasOwn(intentBody, 'storageKey'), false);

  const status = await fetch(`${running.baseUrl}/api/observations/observation-1/evidence`);
  assert.equal(status.status, 200);
  assert.doesNotMatch(await status.text(), /private\/original/);
});

test('outbox-to-SSE event hub allowlists public fields', () => {
  const hub = new EventHub();
  const writes = [];
  hub.subscribe({ write(value) { writes.push(value); } }, '/api/stream/places/place-1');
  assert.equal(hub.publishEvent({
    eventType: 'barrier.created',
    payload: {
      placeId: 'place-1',
      status: 'published',
      reporterId: 'private-user',
      email: 'private@example.test',
      incident: { id: 'incident-1', placeId: 'place-1', status: 'published', moderatorNotes: 'private' }
    }
  }), true);
  assert.equal(writes.length, 1);
  assert.doesNotMatch(writes[0], /private-user|private@example|moderatorNotes/);
  assert.match(writes[0], /place-1/);
});
