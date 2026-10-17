import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WebhookError } from './errors.mjs';
import { PUBLIC_WEBHOOK_EVENTS } from './validation.mjs';

const PRIVATE_KEYS = new Set([
  'secret', 'secretHash', 'secret_hash', 'secretCiphertext', 'secret_ciphertext', 'token', 'accessToken', 'refreshToken',
  'email', 'phonePrivate', 'managerId', 'manager_id', 'ownerId', 'owner_id',
  'userId', 'user_id', 'contributorId', 'contributor_id', 'moderatorId',
  'moderator_id', 'moderatorNotes', 'moderator_notes', 'storageKey',
  'privateEvidenceKey', 'original', 'reporterEmail', 'reporter_email',
  'contributorEmail', 'contributor_email', 'managerEmail', 'manager_email',
  'userEmail', 'user_email', 'privateNotes', 'private_notes', 'moderation',
  'moderatorNotes', 'moderator_notes', 'audit', 'auditLog', 'audit_log', 'internal'
]);

export function generateWebhookSecret({ bytes = 32 } = {}) {
  if (!Number.isSafeInteger(bytes) || bytes < 16 || bytes > 128) throw new RangeError('bytes must be between 16 and 128.');
  return `whsec_${randomBytes(bytes).toString('base64url')}`;
}

export function hashWebhookSecret(secret) {
  validateSecret(secret);
  return createHash('sha256').update(secret).digest('hex');
}

export function verifyWebhookSecret(secret, secretHash) {
  if (typeof secretHash !== 'string' || !/^[a-f0-9]{64}$/i.test(secretHash)) return false;
  const actual = Buffer.from(hashWebhookSecret(secret), 'hex');
  const expected = Buffer.from(secretHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function redactWebhookSecret(value) {
  return value ? '[redacted]' : null;
}

export function serializeWebhookSubscription(record) {
  if (!record) return null;
  const output = safePublicObject(record);
  delete output.secret;
  delete output.secretHash;
  delete output.secret_hash;
  delete output.ownerId;
  delete output.owner_id;
  return output;
}

export function serializeWebhookDelivery(record) {
  if (!record) return null;
  const output = safePublicObject(record);
  delete output.requestBody;
  delete output.payload;
  delete output.secret;
  delete output.headers;
  return output;
}

export function serializePublicWebhookEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new WebhookError('WEBHOOK_EVENT_INVALID', 'A webhook event object is required.');
  const eventType = event.eventType ?? event.type;
  if (typeof eventType !== 'string' || !PUBLIC_WEBHOOK_EVENTS.includes(eventType)) throw new WebhookError('WEBHOOK_EVENT_NOT_ALLOWED', 'Only approved public event types may be delivered.');
  if (event.public === false || event.visibility === 'private' || event.approved === false || ['pending', 'rejected', 'hidden'].includes(event.status)) {
    throw new WebhookError('WEBHOOK_EVENT_NOT_PUBLIC', 'Only approved public events may be delivered.');
  }
  const allowed = ['schemaVersion', 'eventId', 'eventType', 'type', 'occurredAt', 'aggregateType', 'aggregateId', 'version', 'placeId', 'incidentId', 'status', 'severity', 'routeId', 'data', 'payload', 'incident', 'change', 'claim'];
  const output = Object.fromEntries(allowed.filter((key) => event[key] !== undefined).map((key) => [key, safePublicObject(event[key])]));
  output.eventType = eventType;
  if (output.payload?.public === false || output.payload?.visibility === 'private' || output.payload?.approved === false) throw new WebhookError('WEBHOOK_EVENT_NOT_PUBLIC', 'Only approved public events may be delivered.');
  return output;
}

export function stableJson(value) {
  return JSON.stringify(sortObject(value));
}

export function signWebhookPayload({ body, timestamp, nonce, secret }) {
  validateSecret(secret);
  const normalizedTimestamp = normalizeTimestamp(timestamp);
  const normalizedNonce = normalizeNonce(nonce);
  const message = `${normalizedTimestamp}.${normalizedNonce}.${typeof body === 'string' ? body : stableJson(body)}`;
  return `sha256=${createHmac('sha256', secret).update(message).digest('hex')}`;
}

export const createWebhookSignature = signWebhookPayload;

export async function verifyWebhookSignature({ body, timestamp, nonce, signature, secret, replayPort, clock = () => Date.now(), toleranceSeconds = 300 } = {}) {
  validateSecret(secret);
  const normalizedTimestamp = normalizeTimestamp(timestamp);
  const now = Math.floor(clock() / 1_000);
  if (!Number.isSafeInteger(toleranceSeconds) || toleranceSeconds < 1) throw new RangeError('toleranceSeconds must be positive.');
  if (Math.abs(now - normalizedTimestamp) > toleranceSeconds) throw new WebhookError('WEBHOOK_SIGNATURE_EXPIRED', 'The webhook signature timestamp is outside the replay window.', { status: 401 });
  const normalizedNonce = normalizeNonce(nonce);
  const expected = signWebhookPayload({ body, timestamp: normalizedTimestamp, nonce: normalizedNonce, secret });
  if (typeof signature !== 'string') throw new WebhookError('WEBHOOK_SIGNATURE_INVALID', 'The webhook signature is invalid.', { status: 401 });
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) throw new WebhookError('WEBHOOK_SIGNATURE_INVALID', 'The webhook signature is invalid.', { status: 401 });
  if (replayPort) {
    const method = ['claim', 'checkAndStore', 'remember'].find((name) => typeof replayPort[name] === 'function');
    if (!method) throw new TypeError('replayPort needs claim, checkAndStore, or remember.');
    const accepted = await replayPort[method](`webhook:${normalizedTimestamp}:${normalizedNonce}`, { ttlSeconds: toleranceSeconds });
    if (accepted === false || accepted?.accepted === false || accepted?.acquired === false || accepted?.allowed === false || accepted?.replayed === true) throw new WebhookError('WEBHOOK_REPLAY_DETECTED', 'The webhook request has already been processed.', { status: 409 });
  }
  return { valid: true, timestamp: normalizedTimestamp, nonce: normalizedNonce };
}

function validateSecret(secret) { if (typeof secret !== 'string' && !Buffer.isBuffer(secret) || secret.length < 16) throw new TypeError('A webhook secret of at least 16 characters is required.'); }
function normalizeTimestamp(value) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new WebhookError('WEBHOOK_TIMESTAMP_INVALID', 'Webhook timestamp must be Unix seconds.');
  return number;
}
function normalizeNonce(value) { if (typeof value !== 'string' || value.length < 8 || value.length > 200) throw new WebhookError('WEBHOOK_NONCE_INVALID', 'Webhook nonce is invalid.'); return value; }
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}
function safePublicObject(value) {
  if (Array.isArray(value)) return value.map(safePublicObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_KEYS.has(key)).map(([key, child]) => [key, safePublicObject(child)]));
}
