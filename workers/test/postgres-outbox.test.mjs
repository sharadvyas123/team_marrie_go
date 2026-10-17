import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OutboxError,
  PostgresOutbox,
  serializeOutboxError
} from '../src/postgres-outbox.mjs';

function fakePool(handler) {
  const calls = [];
  let releases = 0;
  const client = {
    async query(text, parameters = []) {
      calls.push({ text, parameters });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes("set_config('app.role'")) return { rows: [] };
      return handler(text, parameters);
    },
    release() {
      releases += 1;
    }
  };
  return {
    calls,
    get releases() {
      return releases;
    },
    async connect() {
      return client;
    }
  };
}

function queryContaining(calls, fragment) {
  return calls.find((call) => call.text.includes(fragment));
}

test('claimPending claims ordered unpublished rows with a lease', async () => {
  const pool = fakePool((text, parameters) => {
    assert.match(text, /FOR UPDATE SKIP LOCKED/);
    assert.deepEqual(parameters, [2, 'worker-1', 5_000]);
    return {
      rows: [{
        id: 'event-1',
        event_type: 'observation.submitted',
        aggregate_type: 'observation',
        aggregate_id: 'observation-1',
        payload: { observationId: 'observation-1' },
        created_at: '2026-10-17T00:00:00.000Z',
        attempt_count: 1
      }]
    };
  });
  const outbox = new PostgresOutbox({ pool, leaseMs: 5_000, workerRole: 'worker' });

  const rows = await outbox.claimPending({ limit: 2, ownerId: 'worker-1' });

  assert.deepEqual(rows, [{
    id: 'event-1',
    event_type: 'observation.submitted',
    aggregate_type: 'observation',
    aggregate_id: 'observation-1',
    payload: { observationId: 'observation-1' },
    created_at: '2026-10-17T00:00:00.000Z',
    attempt_count: 1
  }]);
  assert.ok(queryContaining(pool.calls, "set_config('app.role'"));
  assert.ok(queryContaining(pool.calls, 'FOR UPDATE SKIP LOCKED'));
  assert.equal(pool.calls.at(-1).text, 'COMMIT');
  assert.equal(pool.releases, 1);
});

test('claimPending rolls back and releases the client on a database error', async () => {
  const databaseError = new Error('database unavailable');
  const pool = fakePool(() => {
    throw databaseError;
  });
  const outbox = new PostgresOutbox({ pool });

  await assert.rejects(
    () => outbox.claimPending({ ownerId: 'worker-1' }),
    (error) => error === databaseError
  );
  assert.ok(queryContaining(pool.calls, 'ROLLBACK'));
  assert.equal(pool.releases, 1);
});

test('markPublished requires the lease owner and clears the lease', async () => {
  const pool = fakePool((text, parameters) => {
    assert.deepEqual(parameters, ['event-1', 'worker-1']);
    assert.match(text, /lease_expires_at > clock_timestamp\(\)/);
    return { rows: [{ id: 'event-1', published_at: '2026-10-17T00:00:01.000Z' }] };
  });
  const outbox = new PostgresOutbox({ pool });

  const result = await outbox.markPublished('event-1', { ownerId: 'worker-1', messageId: 'redis-1' });

  assert.deepEqual(result, { status: 'published', publishedAt: '2026-10-17T00:00:01.000Z' });
  assert.equal(pool.calls.at(-1).text, 'COMMIT');
});

test('markPublished treats an already-published row as an idempotent success', async () => {
  let update = true;
  const pool = fakePool((text) => {
    if (update && text.trimStart().startsWith('UPDATE outbox_events')) {
      update = false;
      return { rows: [] };
    }
    return { rows: [{ id: 'event-1', published_at: '2026-10-17T00:00:01.000Z' }] };
  });
  const outbox = new PostgresOutbox({ pool });

  const result = await outbox.markPublished('event-1', { ownerId: 'worker-1' });

  assert.deepEqual(result, { status: 'already_published' });
  assert.ok(queryContaining(pool.calls, 'SELECT id, published_at'));
});

test('markPublished rejects a lost or missing lease without claiming success', async () => {
  const lostLeasePool = fakePool((text) => {
    if (text.trimStart().startsWith('UPDATE outbox_events')) return { rows: [] };
    return { rows: [{ id: 'event-1', published_at: null, lease_owner: 'worker-2', lease_expires_at: '2026-10-17T00:01:00.000Z' }] };
  });
  const outbox = new PostgresOutbox({ pool: lostLeasePool });

  await assert.rejects(
    () => outbox.markPublished('event-1', { ownerId: 'worker-1' }),
    (error) => error instanceof OutboxError && error.code === 'OUTBOX_LEASE_LOST'
  );

  const missingPool = fakePool((text) => {
    if (text.trimStart().startsWith('UPDATE outbox_events')) return { rows: [] };
    return { rows: [] };
  });
  const missingOutbox = new PostgresOutbox({ pool: missingPool });
  await assert.rejects(
    () => missingOutbox.markPublished('event-1', { ownerId: 'worker-1' }),
    (error) => error instanceof OutboxError && error.code === 'OUTBOX_NOT_FOUND'
  );
});

test('releaseClaim clears only the current worker lease and stores bounded redacted errors', async () => {
  const pool = fakePool((text, parameters) => {
    assert.match(text, /lease_owner = \$2/);
    assert.equal(parameters[0], 'event-1');
    assert.equal(parameters[1], 'worker-1');
    assert.ok(parameters[2].length <= 2_000);
    assert.doesNotMatch(parameters[2], /postgresql:\/\/user:password/);
    assert.doesNotMatch(parameters[2], /secret-token/);
    return { rows: [{ id: 'event-1' }] };
  });
  const outbox = new PostgresOutbox({ pool });

  const result = await outbox.releaseClaim('event-1', {
    ownerId: 'worker-1',
    error: new Error(`postgresql://user:password@db/accessmap Bearer secret-token ${'x'.repeat(3_000)}`)
  });

  assert.deepEqual(result, { released: true });
  assert.equal(pool.calls.at(-1).text, 'COMMIT');
});

test('invalid lease inputs are rejected before connecting', async () => {
  const pool = fakePool(() => ({ rows: [] }));
  const outbox = new PostgresOutbox({ pool });

  await assert.rejects(() => outbox.claimPending({ limit: 101, ownerId: 'worker-1' }), RangeError);
  await assert.rejects(() => outbox.claimPending({ ownerId: '' }), TypeError);
  await assert.rejects(() => outbox.markPublished('event-1', {}), TypeError);
  assert.equal(pool.calls.length, 0);
});

test('serialized outbox errors exclude credentials and remain bounded', () => {
  const serialized = serializeOutboxError({
    name: 'DatabaseError',
    code: 'ECONNREFUSED',
    message: `redis://user:password@cache/accessmap Authorization: Bearer token ${'x'.repeat(3_000)}`
  });

  assert.ok(serialized.length <= 2_000);
  assert.doesNotMatch(serialized, /user:password/);
  assert.doesNotMatch(serialized, /Bearer token/);
});
