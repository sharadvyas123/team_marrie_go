import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresDeadLetterStore } from '../src/dead-letter.mjs';

test('dead-letter persistence stores safe job metadata and redacted errors', async () => {
  const calls = [];
  const client = {
    async query(text, parameters = []) {
      calls.push({ text, parameters });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] };
      if (text.includes("set_config('app.role'")) return { rows: [] };
      return { rows: [{ id: 'dlq-1' }] };
    },
    release() {}
  };
  const store = new PostgresDeadLetterStore({ pool: { async connect() { return client; } } });

  const result = await store.record({
    streamName: 'events',
    messageId: '1-0',
    job: {
      id: 'event-1',
      type: 'notification.requested',
      email: 'private@example.test',
      payload: { token: 'secret-value' }
    },
    attempt: 5,
    idempotencyKey: 'event-1:notification',
    error: new Error('redis://user:password@cache Bearer private-token')
  });

  assert.deepEqual(result, { created: true, id: 'dlq-1' });
  const insert = calls.find((call) => call.text.includes('INSERT INTO worker_dead_letters'));
  assert.ok(insert);
  assert.doesNotMatch(JSON.stringify(insert.parameters), /private@example|secret-value|private-token|user:password/);
  assert.equal(insert.parameters[0], 'notification.requested');
});
