import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHttpWebhookDelivery } from '../../src/webhooks/http-delivery.mjs';

test('HTTP webhook delivery refuses redirects and bounds response bodies', async () => {
  let request;
  const delivery = createHttpWebhookDelivery({
    fetchImpl: async (endpoint, options) => {
      request = { endpoint, options };
      return { ok: true, status: 204, async text() { return ''; } };
    }
  });
  const result = await delivery.send({
    endpoint: 'https://hooks.example.test/accessmap',
    body: '{}',
    headers: { 'x-accessmap-event': 'claim.recomputed' }
  });
  assert.deepEqual(result, { ok: true, status: 204 });
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.method, 'POST');
});
