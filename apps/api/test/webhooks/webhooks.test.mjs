import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createWebhookIdempotencyKey,
  createWebhookService,
  generateWebhookSecret,
  hashWebhookSecret,
  nextWebhookRetryState,
  normalizeWebhookEndpoint,
  serializeWebhookSubscription,
  signWebhookPayload,
  validateWebhookEndpoint,
  verifyWebhookSecret,
  verifyWebhookSignature
} from '../../src/webhooks/index.mjs';

const NOW = Date.parse('2026-10-17T10:00:00.000Z');

test('webhook endpoints require HTTPS and reject SSRF addresses, including DNS answers', async () => {
  assert.throws(() => normalizeWebhookEndpoint('http://hooks.example.test'), (error) => error.code === 'WEBHOOK_ENDPOINT_HTTPS_REQUIRED');
  assert.throws(() => normalizeWebhookEndpoint('https://127.0.0.1/hook'), (error) => error.code === 'WEBHOOK_ENDPOINT_PRIVATE_ADDRESS');
  await assert.rejects(
    () => validateWebhookEndpoint('https://hooks.example.test/hook', { dnsResolver: { async lookup() { return [{ address: '10.0.0.5' }]; } } }),
    (error) => error.code === 'WEBHOOK_ENDPOINT_PRIVATE_ADDRESS'
  );
  await assert.doesNotReject(() => validateWebhookEndpoint('https://hooks.example.test/hook', { dnsResolver: { async lookup() { return [{ address: '93.184.216.34' }]; } } }));
});

test('webhook secret is hash-verifiable and redacted from subscription views', () => {
  const secret = generateWebhookSecret();
  assert.equal(verifyWebhookSecret(secret, hashWebhookSecret(secret)), true);
  assert.equal(verifyWebhookSecret('wrong-secret-long-enough', hashWebhookSecret(secret)), false);
  const output = serializeWebhookSubscription({ id: 'sub-1', endpoint: 'https://hooks.example.test', secret, secretHash: hashWebhookSecret(secret), ownerId: 'owner-1' });
  assert.equal(Object.hasOwn(output, 'secret'), false);
  assert.equal(Object.hasOwn(output, 'secretHash'), false);
  assert.doesNotMatch(JSON.stringify(output), /owner-1|whsec_/);
});

test('webhook HMAC verification rejects tampering and replay', async () => {
  const secret = 'webhook-secret-that-is-long-enough';
  const body = JSON.stringify({ eventType: 'incident.updated', public: true });
  const timestamp = Math.floor(NOW / 1_000);
  const nonce = 'nonce-123456';
  const signature = signWebhookPayload({ body, timestamp, nonce, secret });
  const seen = new Set();
  const replayPort = { async claim(key) { if (seen.has(key)) return false; seen.add(key); return true; } };
  assert.deepEqual(await verifyWebhookSignature({ body, timestamp, nonce, signature, secret, replayPort, clock: () => NOW }), { valid: true, timestamp, nonce });
  await assert.rejects(() => verifyWebhookSignature({ body, timestamp, nonce, signature, secret, replayPort, clock: () => NOW }), (error) => error.code === 'WEBHOOK_REPLAY_DETECTED');
  await assert.rejects(() => verifyWebhookSignature({ body: `${body}x`, timestamp, nonce: 'nonce-654321', signature, secret, clock: () => NOW }), (error) => error.code === 'WEBHOOK_SIGNATURE_INVALID');
});

test('webhook delivery is idempotent and records retry/dead-letter state without exposing secrets', async () => {
  const records = new Map();
  const secrets = new Map();
  const deliveries = [];
  let sendCount = 0;
  const service = createWebhookService({
    subscriptionStore: {
      async createSubscription(record) { records.set(record.id, record); return record; },
      async getSubscription(id) { return records.get(id) ?? null; }
    },
    deliveryStore: {
      claimed: new Set(),
      async claimIdempotency(key) { if (this.claimed.has(key)) return false; this.claimed.add(key); return true; },
      async recordDelivery(record) { deliveries.push(record); }
    },
    secretStore: {
      async storeSecret({ id, secret }) { secrets.set(id, secret); },
      async getSecret(id) { return secrets.get(id); }
    },
    authorizationPort: { requireRole(session) { return session.user; } },
    deliveryPort: { async send() { sendCount += 1; return sendCount === 1 ? { status: 503 } : { status: 204 }; } },
    clock: () => NOW,
    idFactory: (() => { let count = 0; return () => `id-${++count}-long`; })(),
    maxAttempts: 3,
    sleep: async () => {}
  });
  const context = { session: { user: { id: 'owner-1', role: 'admin' } } };
  const created = await service.createSubscription({ endpoint: 'https://hooks.example.test/hook', events: ['incident.updated'] }, context);
  assert.match(created.secret, /^whsec_/);
  assert.equal(Object.hasOwn(created.subscription, 'secret'), false);
  const event = { eventId: 'event-1', eventType: 'incident.updated', public: true, payload: { placeId: 'place-1' } };
  const delivered = await service.deliver(created.subscription.id, event);
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.attempts.length, 2);
  assert.equal(deliveries[0].error, null);
  const duplicate = await service.deliver(created.subscription.id, event);
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(createWebhookIdempotencyKey(created.subscription.id, 'event-1'), `webhook:${created.subscription.id}:event-1`);
  assert.equal(nextWebhookRetryState({}, { status: 500 }, { now: NOW }).status, 'retry_scheduled');
  assert.equal(nextWebhookRetryState({ attempts: 4 }, { status: 500 }).status, 'dead_letter');
  assert.doesNotMatch(JSON.stringify(deliveries), /whsec_|webhook-secret/);
});
