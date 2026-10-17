import { isIP } from 'node:net';
import { WebhookError, webhookValidationError } from './errors.mjs';

export const WEBHOOK_STATUSES = Object.freeze(['active', 'paused', 'revoked']);
export const WEBHOOK_MAX_EVENTS = 25;
export const PUBLIC_WEBHOOK_EVENTS = Object.freeze([
  'place.created',
  'place.updated',
  'claim.recomputed',
  'facility.response.published',
  'incident.created',
  'incident.updated',
  'incident.resolved',
  'barrier.created',
  'barrier.resolved',
  'route.invalidated',
  'change.published'
]);

export function normalizeWebhookSubscriptionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw webhookValidationError('WEBHOOK_INPUT_INVALID', 'A webhook subscription object is required.', 'subscription');
  const endpoint = normalizeWebhookEndpoint(input.endpoint ?? input.url);
  const events = normalizeWebhookEvents(input.events ?? input.eventTypes ?? input.event_types);
  return { endpoint, events };
}

export function normalizeWebhookEvents(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > WEBHOOK_MAX_EVENTS) {
    throw webhookValidationError('WEBHOOK_EVENTS_INVALID', `events must contain between 1 and ${WEBHOOK_MAX_EVENTS} event types.`, 'events');
  }
  const events = [...new Set(value.map((item) => {
    if (typeof item !== 'string' || !PUBLIC_WEBHOOK_EVENTS.includes(item.trim())) throw webhookValidationError('WEBHOOK_EVENT_NOT_ALLOWED', 'The subscription contains an unsupported public event.', 'events');
    return item.trim();
  }))];
  return events;
}

/**
 * Syntactic endpoint validation. `validateWebhookEndpoint` additionally checks
 * injected DNS answers so callers can prevent DNS rebinding/SSRF at delivery.
 */
export function normalizeWebhookEndpoint(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 2_048) throw webhookValidationError('WEBHOOK_ENDPOINT_INVALID', 'endpoint must be a URL of at most 2048 characters.', 'endpoint');
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw webhookValidationError('WEBHOOK_ENDPOINT_INVALID', 'endpoint must be a valid URL.', 'endpoint'); }
  if (parsed.protocol !== 'https:') throw webhookValidationError('WEBHOOK_ENDPOINT_HTTPS_REQUIRED', 'Webhook endpoints must use HTTPS.', 'endpoint');
  if (parsed.username || parsed.password) throw webhookValidationError('WEBHOOK_ENDPOINT_CREDENTIALS_FORBIDDEN', 'Webhook endpoints may not contain URL credentials.', 'endpoint');
  if (!parsed.hostname || isBlockedHostname(parsed.hostname)) throw webhookValidationError('WEBHOOK_ENDPOINT_HOST_FORBIDDEN', 'This webhook endpoint host is not allowed.', 'endpoint');
  if (parsed.port && (!/^\d+$/.test(parsed.port) || Number(parsed.port) < 1 || Number(parsed.port) > 65_535)) throw webhookValidationError('WEBHOOK_ENDPOINT_PORT_INVALID', 'Webhook endpoint port is invalid.', 'endpoint');
  const address = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isPrivateAddress(address)) throw webhookValidationError('WEBHOOK_ENDPOINT_PRIVATE_ADDRESS', 'Webhook endpoints may not target private or special-use addresses.', 'endpoint');
  parsed.hash = '';
  return parsed.toString();
}

export async function validateWebhookEndpoint(value, { dnsResolver, requireDnsResolution = false } = {}) {
  const endpoint = normalizeWebhookEndpoint(value);
  const hostname = new URL(endpoint).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!dnsResolver) {
    if (requireDnsResolution && !isIP(hostname)) throw new WebhookError('WEBHOOK_DNS_RESOLUTION_REQUIRED', 'A DNS resolver is required to validate this hostname.', { status: 503, title: 'Webhook endpoint cannot be validated' });
    return endpoint;
  }
  if (isIP(hostname)) return endpoint;
  let addresses;
  try {
    addresses = await resolveAddresses(dnsResolver, hostname);
  } catch (error) {
    throw new WebhookError('WEBHOOK_DNS_UNRESOLVED', 'The webhook endpoint hostname could not be resolved safely.', { status: 400, title: 'Webhook endpoint invalid', cause: error });
  }
  if (addresses.length === 0) throw webhookValidationError('WEBHOOK_DNS_EMPTY', 'The webhook endpoint hostname has no usable address.', 'endpoint');
  if (addresses.some((address) => isPrivateAddress(address))) throw webhookValidationError('WEBHOOK_ENDPOINT_PRIVATE_ADDRESS', 'Webhook endpoints may not resolve to private or special-use addresses.', 'endpoint');
  return endpoint;
}

export async function validateWebhookSubscription(input, options = {}) {
  const normalized = normalizeWebhookSubscriptionInput(input);
  return { ...normalized, endpoint: await validateWebhookEndpoint(normalized.endpoint, options) };
}

function isBlockedHostname(hostname) {
  const value = hostname.toLowerCase().replace(/\.$/, '');
  return value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || value.endsWith('.internal') || value === 'metadata.google.internal' || value === 'host.docker.internal';
}

export function isPrivateAddress(address) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(normalized) === 4) {
    const octets = normalized.split('.').map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0) || a >= 224;
  }
  if (isIP(normalized) === 6) {
    if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('ff')) return true;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return Boolean(mapped && isPrivateAddress(mapped[1]));
  }
  return false;
}

async function resolveAddresses(resolver, hostname) {
  if (typeof resolver.lookup === 'function') {
    const result = await resolver.lookup(hostname, { all: true, verbatim: true });
    return (Array.isArray(result) ? result : [result]).map((entry) => typeof entry === 'string' ? entry : entry?.address).filter(Boolean);
  }
  if (typeof resolver.resolve === 'function') {
    const result = await resolver.resolve(hostname);
    return (Array.isArray(result) ? result : [result]).map((entry) => typeof entry === 'string' ? entry : entry?.address).filter(Boolean);
  }
  throw new TypeError('dnsResolver needs lookup or resolve.');
}
