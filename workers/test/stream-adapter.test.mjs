import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MemoryStreamAdapter,
  RedisStreamAdapter,
  ResilientStreamAdapter,
  StreamUnavailableError
} from '../src/stream-adapter.mjs';

test('memory streams keep delivery state independent for each consumer group', async () => {
  const stream = new MemoryStreamAdapter();
  await stream.append('events', { eventId: 'event-1' });

  const firstGroup = await stream.read('events', { group: 'claims', blockMs: 0 });
  assert.equal(firstGroup.length, 1);
  assert.equal(await stream.ack('events', 'claims', firstGroup[0].id), 1);

  const secondGroup = await stream.read('events', { group: 'notifications', blockMs: 0 });
  assert.equal(secondGroup.length, 1);
  assert.deepEqual(secondGroup[0].data, { eventId: 'event-1' });
});

test('redis stream groups start at the beginning of an existing stream', async () => {
  const calls = [];
  const client = {
    on() {},
    async xGroupCreate(...args) {
      calls.push(args);
    },
    async xReadGroup() {
      return null;
    }
  };
  const stream = new RedisStreamAdapter({ client });

  await stream.read('events', { group: 'claims', consumer: 'worker-1', blockMs: 0 });

  assert.deepEqual(calls, [['events', 'claims', '0-0', { MKSTREAM: true }]]);
  assert.equal(stream.durable, true);
});

test('redis pending recovery follows XAUTOCLAIM cursors and filters deleted entries', async () => {
  const groupCalls = [];
  const claimCalls = [];
  const client = {
    on() {},
    async xGroupCreate(...args) {
      groupCalls.push(args);
    },
    async xAutoClaim(...args) {
      claimCalls.push(args);
      if (claimCalls.length === 1) {
        return {
          nextId: '2-0',
          messages: [
            { id: '1-0', message: { payload: JSON.stringify({ id: 'job-1' }) } },
            null
          ],
          deletedMessages: ['deleted-1']
        };
      }
      return {
        nextId: '0-0',
        messages: [{ id: '2-0', message: { payload: JSON.stringify({ id: 'job-2' }) } }],
        deletedMessages: []
      };
    }
  };
  const stream = new RedisStreamAdapter({ client });

  const recovered = await stream.recoverPending('events', {
    group: 'claims',
    consumer: 'worker-2',
    minIdleMs: 0,
    count: 10
  });

  assert.deepEqual(groupCalls, [['events', 'claims', '0-0', { MKSTREAM: true }]]);
  assert.deepEqual(claimCalls, [
    ['events', 'claims', 'worker-2', 0, '0-0', { COUNT: 10 }],
    ['events', 'claims', 'worker-2', 0, '2-0', { COUNT: 10 }]
  ]);
  assert.deepEqual(recovered, [
    { id: '1-0', stream: 'events', data: { id: 'job-1' } },
    { id: '2-0', stream: 'events', data: { id: 'job-2' } }
  ]);
});

test('a resilient stream reports non-durable degraded mode after Redis fails', async () => {
  const fallback = new MemoryStreamAdapter();
  const primary = {
    durable: true,
    async append() {
      throw new Error('Redis unavailable');
    },
    async close() {}
  };
  const stream = new ResilientStreamAdapter({
    primary,
    fallback,
    logger: { warn() {} },
    allowVolatileFallback: true
  });

  await stream.initialize();
  await stream.append('events', { eventId: 'event-2' });

  assert.equal(stream.degraded, true);
  assert.equal(stream.mode, 'memory');
  assert.equal(stream.durable, false);
});

test('a Redis outage does not accept durable queue writes into memory by default', async () => {
  const primary = {
    durable: true,
    async append() {
      throw new Error('Redis unavailable');
    },
    async close() {}
  };
  const stream = new ResilientStreamAdapter({ primary, logger: { warn() {} } });

  await assert.rejects(
    () => stream.append('events', { eventId: 'event-3' }),
    (error) => error instanceof StreamUnavailableError && error.code === 'STREAM_UNAVAILABLE'
  );
});

test('a memory-only resilient stream is never reported as durable', () => {
  const stream = new ResilientStreamAdapter({ fallback: new MemoryStreamAdapter() });

  assert.equal(stream.mode, 'memory');
  assert.equal(stream.durable, false);
});
