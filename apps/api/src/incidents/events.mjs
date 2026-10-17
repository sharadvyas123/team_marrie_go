import { serializePublicIncident } from './serializers.mjs';

export const PUBLIC_INCIDENT_EVENTS = Object.freeze([
  'incident.created',
  'incident.updated',
  'incident.resolved',
  'barrier.created',
  'barrier.resolved',
  'route.invalidated'
]);

export function createPublicIncidentEvent(record, {
  eventType = record?.status === 'resolved' ? 'incident.resolved' : 'incident.updated',
  occurredAt = new Date().toISOString(),
  routeInvalidation = null
} = {}) {
  const incident = serializePublicIncident(record, { includeUnpublished: false });
  if (!incident) return null;
  return {
    schemaVersion: 'incident-event.v1',
    eventType,
    occurredAt,
    incidentId: incident.id,
    placeId: incident.placeId,
    status: incident.status,
    severity: incident.severity,
    type: incident.type,
    observedAt: incident.observedAt,
    expectedExpiryAt: incident.expectedExpiryAt,
    incident,
    ...(routeInvalidation ? {
      routeInvalidation: {
        schemaVersion: 'route-invalidation.v1',
        ...routeInvalidation
      }
    } : {})
  };
}

export const publicIncidentEvent = createPublicIncidentEvent;

export function createPublicRouteUpdate({ incident, routeId = null, occurredAt = new Date().toISOString() } = {}) {
  const publicIncident = serializePublicIncident(incident, { includeUnpublished: false });
  if (!publicIncident) return null;
  return {
    schemaVersion: 'route-update.v1',
    eventType: 'route.invalidated',
    occurredAt,
    routeId,
    incidentId: publicIncident.id,
    placeId: publicIncident.placeId,
    status: publicIncident.status,
    severity: publicIncident.severity,
    explanation: publicIncident.explanation
  };
}

export function publicSsePayload(event) {
  if (!event || typeof event !== 'object') return null;
  const allowed = ['schemaVersion', 'eventType', 'occurredAt', 'incident', 'routeInvalidation',
    'routeId', 'incidentId', 'placeId', 'status', 'severity', 'type', 'observedAt',
    'expectedExpiryAt', 'explanation'];
  return Object.fromEntries(allowed.filter((key) => event[key] !== undefined)
    .map((key) => [key, event[key]]));
}
