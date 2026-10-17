import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createS006Handlers } from '../src/s006.mjs';

test('S-006 handlers recompute claims for observation lifecycle events and ignore other events', async () => {
  const calls = [];
  const handlers = createS006Handlers({
    observationRepository: {
      async recomputeClaim(placeId, featureCode) {
        calls.push({ placeId, featureCode });
        return { changed: true };
      }
    }
  });

  assert.deepEqual(
    await handlers.handle({
      type: 'observation.confirmed',
      payload: { placeId: 'place-1', featureCode: 'step_free_entrance' }
    }),
    { changed: true }
  );
  assert.deepEqual(
    await handlers.handle({
      type: 'observation.amended',
      payload: { placeId: 'place-1', featureCode: 'step_free_entrance' }
    }),
    { changed: true }
  );
  assert.deepEqual(await handlers.handle({ type: 'barrier.created', payload: {} }), {
    ignored: true,
    eventType: 'barrier.created'
  });
  assert.deepEqual(calls, [
    { placeId: 'place-1', featureCode: 'step_free_entrance' },
    { placeId: 'place-1', featureCode: 'step_free_entrance' }
  ]);
});
