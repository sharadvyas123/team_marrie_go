import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateBackoff, createRetryPolicy } from '../src/retry-policy.mjs';

test('the default retry policy uses bounded exponential backoff', () => {
  const policy = createRetryPolicy({ maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 25 });

  assert.equal(policy.delayFor(1), 10);
  assert.equal(policy.delayFor(2), 20);
  assert.equal(policy.delayFor(3), 25);
  assert.equal(policy.canRetry(1), true);
  assert.equal(policy.canRetry(3), false);
});

test('jitter stays bounded and invalid retry configuration is rejected', () => {
  assert.equal(
    calculateBackoff(1, { baseDelayMs: 100, maxDelayMs: 100, jitter: 1, random: () => 0 }),
    0
  );
  assert.throws(() => createRetryPolicy({ jitter: 2 }), /jitter must be between 0 and 1/);
  assert.throws(() => calculateBackoff(0), /attempt must be a positive integer/);
});
