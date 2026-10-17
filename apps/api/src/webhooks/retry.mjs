export const DEFAULT_WEBHOOK_MAX_ATTEMPTS = 5;
export const DEFAULT_WEBHOOK_BASE_DELAY_MS = 1_000;
export const DEFAULT_WEBHOOK_MAX_DELAY_MS = 15 * 60 * 1_000;

export function isRetryableWebhookStatus(status) {
  return status === undefined || status === null || status === 408 || status === 425 || status === 429 || status >= 500;
}

export function webhookRetryDelay(attempt, { baseDelayMs = DEFAULT_WEBHOOK_BASE_DELAY_MS, maxDelayMs = DEFAULT_WEBHOOK_MAX_DELAY_MS, jitter = 0 } = {}) {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new RangeError('attempt must be a positive integer.');
  if (!Number.isSafeInteger(baseDelayMs) || baseDelayMs < 1 || !Number.isSafeInteger(maxDelayMs) || maxDelayMs < baseDelayMs) throw new RangeError('retry delay bounds are invalid.');
  const capped = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.min(attempt - 1, 30)));
  const randomJitter = typeof jitter === 'function' ? Number(jitter(capped)) : capped * Math.max(0, Math.min(1, Number(jitter) || 0));
  return Math.min(maxDelayMs, Math.max(0, Math.round(capped + randomJitter)));
}

export const calculateWebhookRetryDelay = webhookRetryDelay;

export function nextWebhookRetryState(current = {}, result = {}, options = {}) {
  const attempts = Number.isSafeInteger(current.attempts) ? current.attempts : 0;
  const attempt = attempts + 1;
  const success = result.ok === true || (Number.isInteger(result.status) && result.status >= 200 && result.status < 300);
  const retryable = !success && isRetryableWebhookStatus(result.status);
  const maxAttempts = options.maxAttempts ?? DEFAULT_WEBHOOK_MAX_ATTEMPTS;
  const exhausted = !retryable || attempt >= maxAttempts;
  return {
    attempts: attempt,
    status: success ? 'delivered' : exhausted ? 'dead_letter' : 'retry_scheduled',
    lastStatus: result.status ?? null,
    lastError: success ? null : redactError(result.error),
    nextAttemptAt: success || exhausted ? null : new Date((options.now ?? Date.now()) + webhookRetryDelay(attempt, options)).toISOString()
  };
}

export function createWebhookIdempotencyKey(subscriptionId, eventId) {
  if (!subscriptionId || !eventId) throw new TypeError('subscriptionId and eventId are required.');
  return `webhook:${subscriptionId}:${eventId}`;
}

export const buildWebhookDeliveryIdempotencyKey = createWebhookIdempotencyKey;
export const isRetryableStatus = isRetryableWebhookStatus;

export function redactDeliveryError(error) { return redactError(error); }

function redactError(error) {
  if (!error) return null;
  return typeof error === 'string' ? error.slice(0, 500) : String(error.code ?? error.message ?? 'delivery_failed').slice(0, 500);
}
