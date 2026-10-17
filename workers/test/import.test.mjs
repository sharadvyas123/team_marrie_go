import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as workers from '../src/index.mjs';

test('worker package imports through its public entry point', () => {
  assert.equal(typeof workers.createRetryPolicy, 'function');
  assert.equal(typeof workers.createJobRunner, 'function');
  assert.equal(typeof workers.createOutboxPublisher, 'function');
  assert.equal(typeof workers.createPostgresOutbox, 'function');
  assert.equal(typeof workers.createPostgresIdempotencyStore, 'function');
  assert.equal(typeof workers.createPostgresDeadLetterStore, 'function');
});
