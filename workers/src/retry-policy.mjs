const DEFAULT_RETRY_OPTIONS = Object.freeze({
  maxAttempts: 5,
  baseDelayMs: 250,
  maxDelayMs: 30_000,
  jitter: 0,
  random: Math.random
});

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeNumber(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative number`);
  }
  return value;
}

/**
 * Return the delay before the next attempt after `attempt` failed.
 * Attempt numbers are one-based: the first failure uses the base delay.
 */
export function calculateBackoff(
  attempt,
  {
    baseDelayMs = DEFAULT_RETRY_OPTIONS.baseDelayMs,
    maxDelayMs = DEFAULT_RETRY_OPTIONS.maxDelayMs,
    jitter = DEFAULT_RETRY_OPTIONS.jitter,
    random = Math.random
  } = {}
) {
  positiveInteger(attempt, 'attempt');
  nonNegativeNumber(baseDelayMs, 'baseDelayMs');
  nonNegativeNumber(maxDelayMs, 'maxDelayMs');
  if (baseDelayMs > maxDelayMs) throw new RangeError('baseDelayMs cannot exceed maxDelayMs');
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
    throw new RangeError('jitter must be between 0 and 1');
  }
  if (typeof random !== 'function') throw new TypeError('random must be a function');

  const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  if (jitter === 0 || exponentialDelay === 0) return Math.round(exponentialDelay);

  const spread = exponentialDelay * jitter;
  const jitteredDelay = exponentialDelay - spread + random() * spread * 2;
  return Math.max(0, Math.round(Math.min(maxDelayMs, jitteredDelay)));
}

export function createRetryPolicy(options = {}) {
  const settings = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options
  };
  positiveInteger(settings.maxAttempts, 'maxAttempts');
  nonNegativeNumber(settings.baseDelayMs, 'baseDelayMs');
  nonNegativeNumber(settings.maxDelayMs, 'maxDelayMs');
  if (settings.baseDelayMs > settings.maxDelayMs) {
    throw new RangeError('baseDelayMs cannot exceed maxDelayMs');
  }
  if (!Number.isFinite(settings.jitter) || settings.jitter < 0 || settings.jitter > 1) {
    throw new RangeError('jitter must be between 0 and 1');
  }
  if (typeof settings.random !== 'function') throw new TypeError('random must be a function');
  settings.isRetryable ??= () => true;

  return Object.freeze({
    ...settings,
    canRetry(attempt) {
      return Number.isInteger(attempt) && attempt < settings.maxAttempts;
    },
    delayFor(attempt) {
      return calculateBackoff(attempt, settings);
    },
    shouldRetry(error, attempt) {
      return settings.isRetryable(error) && this.canRetry(attempt);
    },
    isRetryable: settings.isRetryable
  });
}

export const DEFAULT_RETRY_POLICY = createRetryPolicy();
