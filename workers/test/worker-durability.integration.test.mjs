import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { test } from 'node:test';
import { PostgresDeadLetterStore } from '../src/dead-letter.mjs';
import { PostgresIdempotencyStore } from '../src/postgres-idempotency.mjs';

const { Pool } = pg;

test('PostgreSQL idempotency and dead-letter records survive separate worker instances', async (t) => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    t.skip('set TEST_DATABASE_URL to a disposable PostgreSQL database');
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const key = `integration-idempotency-${randomUUID()}`;
  const stream = `integration-stream-${randomUUID()}`;
  const messageId = `integration-message-${randomUUID()}`;
  const storeA = new PostgresIdempotencyStore({ pool, owner: 'integration-worker-a', leaseMs: 5_000 });
  const storeB = new PostgresIdempotencyStore({ pool, owner: 'integration-worker-b', leaseMs: 5_000 });
  const deadLetters = new PostgresDeadLetterStore({ pool });

  t.after(async () => {
    await pool.query('DELETE FROM worker_idempotency WHERE idempotency_key = $1', [key]);
    await pool.query(
      'DELETE FROM worker_dead_letters WHERE source_stream = $1 AND source_message_id = $2',
      [stream, messageId]
    );
    await pool.end();
  });

  const claims = await Promise.all([
    storeA.claim(key),
    storeB.claim(key)
  ]);
  assert.equal(claims.filter((claim) => claim.acquired).length, 1);

  const ownerStore = claims[0].acquired ? storeA : storeB;
  const duplicateStore = claims[0].acquired ? storeB : storeA;
  await ownerStore.complete(key, { sideEffect: 'committed' });
  assert.deepEqual((await duplicateStore.claim(key)).state, 'completed');

  const firstDeadLetter = await deadLetters.record({
    streamName: stream,
    messageId,
    job: { id: key, type: 'notification.requested', aggregateType: 'notification', aggregateId: key },
    attempt: 5,
    idempotencyKey: key,
    error: new Error('permanent failure')
  });
  const duplicateDeadLetter = await deadLetters.record({
    streamName: stream,
    messageId,
    job: { id: key, type: 'notification.requested' },
    attempt: 6,
    idempotencyKey: key,
    error: new Error('duplicate failure')
  });

  assert.equal(firstDeadLetter.created, true);
  assert.equal(duplicateDeadLetter.created, false);
});
