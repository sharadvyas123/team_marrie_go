import { randomUUID } from 'node:crypto';

export const EVENT_NAMES = Object.freeze([
  'place.created',
  'place.updated',
  'observation.submitted',
  'observation.approved',
  'observation.rejected',
  'observation.changes_requested',
  'observation.confirmed',
  'observation.disputed',
  'observation.outdated',
  'observation.amended',
  'barrier.created',
  'barrier.updated',
  'barrier.resolved',
  'incident.created',
  'incident.updated',
  'incident.resolved',
  'claim.recomputed',
  'facility.response.published',
  'change.published',
  'route.invalidated',
  'evidence.processed',
  'evidence.failed',
  'notification.requested',
  'webhook.delivery.requested',
  'webhook.delivery.succeeded',
  'webhook.delivery.failed'
]);

export function createEventEnvelope({
  eventType,
  aggregateType,
  aggregateId,
  payload,
  actorId = null,
  traceId = null,
  eventId = randomUUID(),
  occurredAt = new Date().toISOString(),
  version = 1
}) {
  if (!EVENT_NAMES.includes(eventType)) {
    throw new RangeError(`Unsupported AccessMap event: ${eventType}`);
  }
  if (!aggregateType || !aggregateId) {
    throw new TypeError('aggregateType and aggregateId are required');
  }
  if (payload === undefined) {
    throw new TypeError('payload is required');
  }

  return Object.freeze({
    eventId,
    eventType,
    aggregateType,
    aggregateId,
    version,
    occurredAt,
    actorId,
    traceId,
    payload
  });
}
