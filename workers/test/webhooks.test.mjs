import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWebhookHandlers } from '../src/webhooks.mjs';

test('webhook worker handles only delivery requests and passes a stable event identity', async () => {
  const calls = [];
  const handlers = createWebhookHandlers({
    webhookService: {
      async deliver(subscriptionId, event, options) {
        calls.push({ subscriptionId, event, options });
        return { status: 'delivered' };
      }
    }
  });
  assert.deepEqual(await handlers.handle({ type: 'claim.recomputed', id: 'ignored' }), {
    ignored: true,
    eventType: 'claim.recomputed'
  });
  assert.deepEqual(await handlers.handle({
    type: 'webhook.delivery.requested',
    eventId: 'event-1',
    payload: { subscriptionId: 'subscription-1', event: { eventType: 'claim.recomputed', placeId: 'place-1' } }
  }), { status: 'delivered' });
  assert.deepEqual(calls, [{
    subscriptionId: 'subscription-1',
    event: { eventType: 'claim.recomputed', placeId: 'place-1' },
    options: { eventId: 'event-1' }
  }]);
});
