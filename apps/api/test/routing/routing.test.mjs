import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoutingService, RoutingServiceError } from '../../src/routing/index.mjs';
import { createLocalRoutingEngine } from '../../../../packages/domain/src/routing/index.mjs';

const request = {
  origin: { placeId: 'origin' },
  destination: { placeId: 'destination' },
  constraints: { noStairs: true }
};

test('routing provider and cache ports are used without making cache failure fatal', async () => {
  let calculated = 0;
  const service = createRoutingService({
    routingEngine: {
      async calculate() {
        calculated += 1;
        return { id: 'route-1', segments: [{ id: 'edge-1', steps: 0, observedAt: '2026-10-16T00:00:00Z' }] };
      }
    },
    cache: {
      async get() { throw new Error('redis unavailable'); },
      async set() { throw new Error('redis unavailable'); }
    },
    clock: () => Date.parse('2026-10-17T00:00:00Z')
  });

  const result = await service.calculate(request);
  assert.equal(calculated, 1);
  assert.equal(result.cache.status, 'unavailable');
  assert.equal(result.suitable, true);
});

test('routing provider timeout returns a safe typed failure', async () => {
  const service = createRoutingService({
    routingEngine: { calculate: () => new Promise(() => {}) },
    timeoutMs: 100
  });

  await assert.rejects(
    () => service.calculate(request),
    (error) => error instanceof RoutingServiceError && error.code === 'ROUTING_PROVIDER_TIMEOUT' && error.status === 504
  );
});

test('a stale cached route is a safe timeout fallback when the provider is unavailable', async () => {
  const service = createRoutingService({
    routingEngine: { calculate: () => new Promise(() => {}) },
    cache: {
      async get() { return null; },
      async getStale() { return { id: 'stale-route', segments: [], suitable: true }; }
    },
    timeoutMs: 100
  });

  const result = await service.calculate(request);
  assert.equal(result.id, 'stale-route');
  assert.equal(result.cache.status, 'stale-fallback');
});

test('cached routes are returned before the provider and retain constraints', async () => {
  let calls = 0;
  const cache = {
    async get() {
      return {
        id: 'cached-route',
        suitable: true,
        segments: [],
        explanation: { recommendation: 'cached' }
      };
    },
    async set() { calls += 1; }
  };
  const service = createRoutingService({
    routingEngine: { async calculate() { throw new Error('provider should not run'); } },
    cache
  });

  const result = await service.calculate(request);
  assert.equal(result.id, 'cached-route');
  assert.equal(result.cache.status, 'hit');
  assert.equal(calls, 0);
});

test('the default local engine calculates a deterministic seeded access-graph route', async () => {
  const service = createRoutingService({
    routingEngine: createLocalRoutingEngine({ now: () => Date.parse('2026-10-17T00:00:00Z') }),
    accessGraphPort: {
      async getForRoute() {
        return {
          nodes: [
            { id: 'node-a', placeId: 'place-1', type: 'entrance', latitude: 1, longitude: 1 },
            { id: 'node-b', placeId: 'place-1', type: 'room', latitude: 1, longitude: 1.001 }
          ],
          edges: [{ id: 'edge-1', fromNodeId: 'node-a', toNodeId: 'node-b', stairs: false, stepFree: true, widthMeters: 1.5, slopePercent: 1, lastObservedAt: '2026-10-16T00:00:00Z', status: 'active' }]
        };
      }
    },
    incidentPort: { async listForRoute() { return []; } }
  });

  const result = await service.calculate({
    origin: { nodeId: 'node-a' },
    destination: { nodeId: 'node-b' },
    constraints: { noStairs: true }
  });
  assert.equal(result.id.startsWith('local-'), true);
  assert.equal(result.suitable, true);
  assert.deepEqual(result.segments.map((segment) => segment.id), ['edge-1']);
});
