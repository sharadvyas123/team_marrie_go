import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiServer, startApiServer } from '../src/server.mjs';

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('GET /health returns a versioned healthy response', async (t) => {
  const running = await startApiServer({ port: 0, version: 'test-version' });
  t.after(() => closeServer(running.server));

  const response = await fetch(`http://${running.host}:${running.port}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    schemaVersion: 'health.v1',
    service: 'accessmap-api',
    status: 'ok',
    version: 'test-version',
    checks: { process: 'ok' }
  });
});

test('unknown API resources return the problem response contract', async (t) => {
  const running = await startApiServer({ port: 0 });
  t.after(() => closeServer(running.server));

  const response = await fetch(`http://${running.host}:${running.port}/not-a-route`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.schemaVersion, 'problem.v1');
  assert.equal(body.status, 404);
});

test('readiness and metrics endpoints report dependency state without secrets', async (t) => {
  const running = await startApiServer({ port: 0 });
  t.after(() => closeServer(running.server));

  const readiness = await fetch(`http://${running.host}:${running.port}/readyz`);
  const readinessBody = await readiness.json();
  assert.equal(readiness.status, 503);
  assert.equal(readinessBody.schemaVersion, 'ready.v1');
  assert.equal(readinessBody.checks.cache, 'degraded');

  const metrics = await fetch(`http://${running.host}:${running.port}/metrics`);
  const metricsBody = await metrics.text();
  assert.equal(metrics.status, 200);
  assert.match(metricsBody, /accessmap_up 1/);
  assert.doesNotMatch(metricsBody, /DATABASE_URL|AUTH_SECRET/);
});

test('configured cache adapter makes readiness report the cache as healthy', async (t) => {
  const running = await startApiServer({
    port: 0,
    cache: {
      async stats() {
        return { hits: 0, misses: 0, degraded: false };
      }
    }
  });
  t.after(() => closeServer(running.server));

  const response = await fetch(`http://${running.host}:${running.port}/readyz`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.checks, { process: 'ok', cache: 'ok' });
});

test('API service factories initialize when durable repository services are configured', () => {
  const server = createApiServer({ pool: null, repository: {} });
  assert.ok(server);
});
