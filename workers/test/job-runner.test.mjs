import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJobRunner } from '../src/job-runner.mjs';
import { MemoryStreamAdapter } from '../src/stream-adapter.mjs';

test('a stable job id prevents a duplicate side effect', async () => {
  const stream = new MemoryStreamAdapter();
  let calls = 0;
  const runner = createJobRunner({
    stream,
    handler: async () => {
      calls += 1;
      return { ok: true };
    }
  });

  const first = await runner.process({ id: 'event-1', type: 'claim.recompute' });
  const duplicate = await runner.process({ id: 'event-1', type: 'claim.recompute' });

  assert.equal(first.status, 'completed');
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(calls, 1);
});

test('jobs without a stable identity are rejected', async () => {
  const runner = createJobRunner({
    stream: new MemoryStreamAdapter(),
    handler: async () => undefined
  });

  await assert.rejects(
    () => runner.process({ type: 'worker.job' }),
    /A job id, eventId, or idempotencyKey is required/
  );
});

test('a retry is appended with an incremented attempt and then completes', async () => {
  const stream = new MemoryStreamAdapter();
  let calls = 0;
  const runner = createJobRunner({
    stream,
    retryPolicy: {
      shouldRetry: (_error, attempt) => attempt < 2,
      delayFor: () => 0
    },
    handler: async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary failure');
      return { recovered: true };
    }
  });

  const first = await runner.process({ id: 'event-2', type: 'claim.recompute' });
  const [message] = await stream.read('accessmap:jobs', { group: 'accessmap-workers', blockMs: 0 });
  const second = await runner.process(message.data, {
    messageId: message.id,
    sourceStream: message.stream
  });

  assert.equal(first.status, 'retrying');
  assert.equal(message.data.attempts, 1);
  assert.equal(second.status, 'completed');
  assert.equal(calls, 2);
});

test('stop resolves a runner started without an external abort signal', async () => {
  const runner = createJobRunner({
    stream: new MemoryStreamAdapter(),
    handler: async () => undefined
  });

  await runner.start();
  await runner.stop();
  assert.equal(runner.runPromise, null);
});

test('the runner recovers pending work before polling new messages', async () => {
  const recoveryCalls = [];
  const acknowledgements = [];
  let recoveryCount = 0;
  let handled = null;
  const stream = {
    async recoverPending(streamName, options) {
      recoveryCalls.push({ streamName, options });
      recoveryCount += 1;
      return recoveryCount === 1
        ? [{ id: 'pending-1', stream: streamName, data: { id: 'job-1', type: 'claim.recompute' } }]
        : [];
    },
    async read() {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [];
    },
    async ack(streamName, group, messageId) {
      acknowledgements.push({ streamName, group, messageId });
      return 1;
    }
  };
  const runner = createJobRunner({
    stream,
    streamName: 'events',
    consumerGroup: 'claims',
    consumerName: 'worker-2',
    pendingRecoveryIdleMs: 0,
    pendingRecoveryCount: 3,
    pendingRecoveryIntervalMs: 0,
    handler: async (job) => {
      handled = job;
    }
  });

  await runner.start();
  for (let attempt = 0; attempt < 20 && !handled; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await runner.stop();

  assert.equal(handled.id, 'job-1');
  assert.deepEqual(recoveryCalls[0], {
    streamName: 'events',
    options: {
      group: 'claims',
      consumer: 'worker-2',
      minIdleMs: 0,
      count: 3
    }
  });
  assert.deepEqual(acknowledgements, [{
    streamName: 'events',
    group: 'claims',
    messageId: 'pending-1'
  }]);
});

test('a permanent failure records a durable dead letter before acknowledging', async () => {
  const calls = [];
  const stream = {
    async append(name, job) {
      calls.push({ operation: 'append', name, job });
      return 'dead-letter-1';
    },
    async ack(name, group, messageId) {
      calls.push({ operation: 'ack', name, group, messageId });
      return 1;
    }
  };
  const deadLetterStore = {
    async record(input) {
      calls.push({ operation: 'dead-letter-record', input });
      return { created: true, id: 'dlq-1' };
    }
  };
  const runner = createJobRunner({
    stream,
    deadLetterStore,
    retryPolicy: { shouldRetry: () => false, delayFor: () => 0 },
    handler: async () => {
      throw new Error('postgresql://private:password@db/accessmap');
    }
  });

  const result = await runner.process({ id: 'event-4', type: 'claim.recompute' }, {
    messageId: '1-0',
    sourceStream: 'events'
  });

  assert.equal(result.status, 'dead-lettered');
  assert.equal(calls[0].operation, 'dead-letter-record');
  assert.equal(calls[1].operation, 'append');
  assert.equal(calls[2].operation, 'ack');
  assert.doesNotMatch(JSON.stringify(calls), /private:password/);
});
