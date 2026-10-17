import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { test } from 'node:test';
import { RedisStreamAdapter } from '../src/stream-adapter.mjs';

test('Valkey recovers an unacknowledged message for a new consumer', async (t) => {
  const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
  if (!redisUrl) {
    t.skip('set TEST_REDIS_URL or REDIS_URL to a disposable Valkey instance');
    return;
  }

  const client = createClient({ url: redisUrl });
  const streamName = `accessmap:test:stream:${randomUUID()}`;
  const group = `accessmap-test-group-${randomUUID()}`;
  const firstConsumer = `accessmap-test-consumer-a-${randomUUID()}`;
  const secondConsumer = `accessmap-test-consumer-b-${randomUUID()}`;
  const firstAdapter = new RedisStreamAdapter({ client, group, consumer: firstConsumer });
  const secondAdapter = new RedisStreamAdapter({ client, group, consumer: secondConsumer });

  t.after(async () => {
    if (client.isOpen) {
      await client.del(streamName);
      await client.quit();
    }
  });
  await client.connect();

  await firstAdapter.append(streamName, { id: 'pending-job', type: 'claim.recompute' });
  const delivered = await firstAdapter.read(streamName, { group, consumer: firstConsumer, blockMs: 0 });
  assert.equal(delivered.length, 1);

  const recovered = await secondAdapter.recoverPending(streamName, {
    group,
    consumer: secondConsumer,
    minIdleMs: 0,
    count: 10
  });
  assert.deepEqual(recovered, [{
    id: delivered[0].id,
    stream: streamName,
    data: { id: 'pending-job', type: 'claim.recompute' }
  }]);

  assert.equal(await secondAdapter.ack(streamName, group, recovered[0].id), 1);
  assert.deepEqual(
    await secondAdapter.recoverPending(streamName, { group, consumer: secondConsumer, minIdleMs: 0 }),
    []
  );
});
