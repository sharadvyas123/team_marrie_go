import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { test } from 'node:test';
import { OutboxError, PostgresOutbox } from '../src/postgres-outbox.mjs';

const { Pool } = pg;

test('two PostgreSQL workers cannot publish the same outbox lease concurrently', async (t) => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    t.skip('set TEST_DATABASE_URL to a disposable PostgreSQL database');
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const eventId = randomUUID();
  const workerA = new PostgresOutbox({ pool, leaseMs: 1_000 });
  const workerB = new PostgresOutbox({ pool, leaseMs: 1_000 });

  t.after(async () => {
    await pool.query('DELETE FROM outbox_events WHERE id = $1', [eventId]);
    await pool.end();
  });

  await pool.query(
    `INSERT INTO outbox_events
       (id, event_type, aggregate_type, aggregate_id, payload, created_at, is_sample)
     VALUES ($1, 'observation.submitted', 'observation', $2, $3::jsonb, '2000-01-01T00:00:00Z', true)`,
    [eventId, eventId, JSON.stringify({ observationId: eventId })]
  );

  const [claimsA, claimsB] = await Promise.all([
    workerA.claimPending({ limit: 1, ownerId: 'integration-worker-a' }),
    workerB.claimPending({ limit: 1, ownerId: 'integration-worker-b' })
  ]);
  const claimRecords = [
    { claims: claimsA, ownerId: 'integration-worker-a', worker: workerA },
    { claims: claimsB, ownerId: 'integration-worker-b', worker: workerB }
  ];
  const targetRecords = claimRecords.filter(({ claims }) => claims.some((claim) => claim.id === eventId));
  assert.equal(targetRecords.length, 1, 'exactly one worker should claim the new event');

  const firstRecord = targetRecords[0];
  const secondRecord = claimRecords.find((record) => record !== firstRecord);
  const firstOwner = firstRecord.ownerId;
  const firstWorker = firstRecord.worker;
  const secondWorker = secondRecord.worker;
  const secondOwner = secondRecord.ownerId;

  for (const record of claimRecords) {
    for (const claim of record.claims) {
      if (claim.id !== eventId) {
        await record.worker.releaseClaim(claim.id, {
          ownerId: record.ownerId,
          error: new Error('integration test released an unrelated claimed row')
        });
      }
    }
  }

  const initialState = await pool.query(
    'SELECT attempt_count, lease_owner, published_at FROM outbox_events WHERE id = $1',
    [eventId]
  );
  assert.equal(initialState.rows[0].attempt_count, 1);
  assert.equal(initialState.rows[0].lease_owner, firstOwner);
  assert.equal(initialState.rows[0].published_at, null);

  await new Promise((resolve) => setTimeout(resolve, 1_200));

  const reclaimed = await secondWorker.claimPending({ limit: 1, ownerId: secondOwner });
  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0].id, eventId);

  await assert.rejects(
    () => firstWorker.markPublished(eventId, { ownerId: firstOwner }),
    (error) => error instanceof OutboxError && error.code === 'OUTBOX_LEASE_LOST'
  );

  const published = await secondWorker.markPublished(eventId, { ownerId: secondOwner });
  assert.equal(published.status, 'published');

  const repeated = await secondWorker.markPublished(eventId, { ownerId: secondOwner });
  assert.equal(repeated.status, 'already_published');

  const finalState = await pool.query(
    'SELECT attempt_count, lease_owner, lease_expires_at, published_at FROM outbox_events WHERE id = $1',
    [eventId]
  );
  assert.equal(finalState.rows[0].attempt_count, 2);
  assert.equal(finalState.rows[0].lease_owner, null);
  assert.equal(finalState.rows[0].lease_expires_at, null);
  assert.ok(finalState.rows[0].published_at);
});
