import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IdempotencyError, PostgresIdempotencyStore } from '../src/postgres-idempotency.mjs';

function fakePool(handler) {
  const calls = [];
  let releases = 0;
  const client = {
    async query(text, parameters = []) {
      calls.push({ text, parameters });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] };
      if (text.includes("set_config('app.role'")) return { rows: [] };
      return handler(text, parameters);
    },
    release() {
      releases += 1;
    }
  };
  return { calls, get releases() { return releases; }, async connect() { return client; } };
}

test('Postgres idempotency claims once and returns completed duplicates', async () => {
  let inserted = true;
  const pool = fakePool((text) => {
    if (text.trimStart().startsWith('INSERT')) {
      if (inserted) {
        inserted = false;
        return { rows: [{ idempotency_key: 'event-1', state: 'processing', result: null }] };
      }
      return { rows: [] };
    }
    if (text.trimStart().startsWith('SELECT idempotency_key')) {
      return { rows: [{ idempotency_key: 'event-1', state: 'completed', result: { sent: true } }] };
    }
    return { rows: [] };
  });
  const store = new PostgresIdempotencyStore({ pool, owner: 'worker-1' });

  assert.deepEqual(await store.claim('event-1'), { acquired: true, state: 'processing' });
  assert.deepEqual(await store.claim('event-1'), { acquired: false, state: 'completed', result: { sent: true } });
  assert.equal(pool.releases, 2);
});

test('Postgres idempotency completion is owner-fenced', async () => {
  const pool = fakePool((text) => {
    if (text.trimStart().startsWith('UPDATE')) return { rows: [] };
    return { rows: [{ idempotency_key: 'event-2', state: 'processing', result: null }] };
  });
  const store = new PostgresIdempotencyStore({ pool, owner: 'worker-1' });

  await assert.rejects(
    () => store.complete('event-2', { ok: true }),
    (error) => error instanceof IdempotencyError && error.code === 'IDEMPOTENCY_LEASE_LOST'
  );
});
