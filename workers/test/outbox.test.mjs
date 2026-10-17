import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OutboxPublisher } from '../src/outbox.mjs';
import { MemoryStreamAdapter } from '../src/stream-adapter.mjs';

function outboxFor(event) {
  const calls = { marked: [], released: [] };
  return {
    calls,
    async claimPending() {
      return [event];
    },
    async markPublished(id, metadata) {
      calls.marked.push({ id, metadata });
    },
    async releaseClaim(id, metadata) {
      calls.released.push({ id, metadata });
    }
  };
}

test('outbox rows are not marked published into a memory fallback', async () => {
  const outbox = outboxFor({
    id: 'event-1',
    eventType: 'observation.submitted',
    aggregateType: 'observation',
    aggregateId: 'observation-1'
  });
  const publisher = new OutboxPublisher({
    outbox,
    stream: new MemoryStreamAdapter(),
    logger: { error() {} }
  });

  const result = await publisher.publishOnce();

  assert.deepEqual(result, { published: 0, failed: 1, skipped: 0 });
  assert.equal(outbox.calls.marked.length, 0);
  assert.equal(outbox.calls.released.length, 1);
  assert.equal(outbox.calls.released[0].metadata.error.code, 'NON_DURABLE_STREAM');
});

test('outbox rows are marked only after a durable stream append', async () => {
  const event = {
    id: 'event-2',
    event_type: 'observation.submitted',
    aggregate_type: 'observation',
    aggregate_id: 'observation-2',
    payload: { observationId: 'observation-2' },
    created_at: '2026-10-17T00:00:00.000Z'
  };
  const outbox = outboxFor(event);
  const appended = [];
  const stream = {
    durable: true,
    async append(name, event) {
      appended.push({ name, event });
      return 'redis-1';
    }
  };
  const publisher = new OutboxPublisher({ outbox, stream, ownerId: 'publisher-1' });

  const result = await publisher.publishOnce();

  assert.deepEqual(result, { published: 1, failed: 0, skipped: 0 });
  assert.deepEqual(appended, [{
    name: 'accessmap:events',
    event: {
      eventId: 'event-2',
      eventType: 'observation.submitted',
      aggregateType: 'observation',
      aggregateId: 'observation-2',
      version: 1,
      occurredAt: '2026-10-17T00:00:00.000Z',
      actorId: null,
      traceId: null,
      payload: { observationId: 'observation-2' }
    }
  }]);
  assert.equal(outbox.calls.marked.length, 1);
  assert.equal(outbox.calls.marked[0].id, 'event-2');
  assert.equal(outbox.calls.released.length, 0);
});

test('a failed lease release is logged without aborting the publication batch', async () => {
  const errors = [];
  const event = {
    id: 'event-3',
    eventType: 'observation.submitted',
    aggregateType: 'observation',
    aggregateId: 'observation-3'
  };
  const outbox = {
    async claimPending() {
      return [event];
    },
    async markPublished() {
      throw new Error('Redis publish failed');
    },
    async releaseClaim() {
      throw new Error('database unavailable while releasing lease');
    }
  };
  const publisher = new OutboxPublisher({
    outbox,
    stream: { durable: true, async append() { return 'redis-3'; } },
    logger: { error(entry) { errors.push(entry); } }
  });

  const result = await publisher.publishOnce();

  assert.deepEqual(result, { published: 0, failed: 1, skipped: 0 });
  assert.equal(errors.length, 2);
});
