import { validateWebhookEndpoint } from './validation.mjs';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * Minimal outbound adapter for the webhook service. It refuses redirects,
 * validates DNS answers when a resolver is supplied, bounds response bodies,
 * and never logs request payloads or endpoint credentials.
 */
export function createHttpWebhookDelivery({
  fetchImpl = globalThis.fetch,
  dnsResolver = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw new RangeError('timeoutMs is invalid.');
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 1_048_576) throw new RangeError('maxResponseBytes is invalid.');

  return {
    async send({ endpoint, body, headers }) {
      const safeEndpoint = await validateWebhookEndpoint(endpoint, {
        dnsResolver,
        requireDnsResolution: Boolean(dnsResolver)
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(safeEndpoint, {
          method: 'POST',
          redirect: 'error',
          headers: { ...headers },
          body,
          signal: controller.signal
        });
        const text = await response.text();
        if (Buffer.byteLength(text) > maxResponseBytes) {
          return { ok: false, status: response.status, error: 'response_too_large' };
        }
        return { ok: response.ok, status: response.status };
      } catch (error) {
        const wrapped = new Error('Webhook delivery failed.');
        wrapped.code = error?.name === 'AbortError' ? 'WEBHOOK_DELIVERY_TIMEOUT' : 'WEBHOOK_DELIVERY_NETWORK_ERROR';
        wrapped.retryable = true;
        throw wrapped;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

export { DEFAULT_TIMEOUT_MS, DEFAULT_MAX_RESPONSE_BYTES };
