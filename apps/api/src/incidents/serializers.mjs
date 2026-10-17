const PUBLIC_STATUSES = new Set(['published', 'disputed', 'resolved', 'archived']);

/**
 * Public incident data intentionally contains source type only. Reporter IDs,
 * emails, moderator notes, workflow assignments, and private evidence keys
 * never cross this serializer boundary.
 */
export function serializePublicIncident(record, { includeUnpublished = true } = {}) {
  if (!record || typeof record !== 'object') return null;
  const status = value(record.status, 'reported');
  if (!includeUnpublished && !PUBLIC_STATUSES.has(status)) return null;
  return {
    id: value(record.id ?? record.incidentId),
    placeId: nullable(record.placeId ?? record.place_id),
    accessNodeId: nullable(record.accessNodeId ?? record.access_node_id),
    accessEdgeId: nullable(record.accessEdgeId ?? record.access_edge_id ?? record.routeSegmentId),
    featureId: nullable(record.featureId ?? record.feature_id),
    type: value(record.type ?? record.incidentType ?? record.incident_type),
    severity: value(record.severity),
    source: publicSource(record.source ?? record.sourceType ?? record.source_type),
    startsAt: nullable(record.startsAt ?? record.startAt ?? record.start_time),
    expectedExpiryAt: nullable(record.expectedExpiryAt ?? record.expiresAt ?? record.expected_expiry_at),
    reviewAt: nullable(record.reviewAt ?? record.review_at),
    observedAt: nullable(record.observedAt ?? record.observed_at),
    status,
    explanation: nullable(record.explanation ?? record.details ?? record.description),
    resolvedAt: nullable(record.resolvedAt ?? record.resolved_at),
    affectedScopes: safeIds(record.affectedScopes ?? record.affected_scopes)
  };
}

export const publicIncident = serializePublicIncident;

export function serializePrivateIncident(record) {
  if (!record || typeof record !== 'object') return null;
  return { ...record };
}

export function serializeIncidentList(records, options = {}) {
  return (Array.isArray(records) ? records : []).map((record) => serializePublicIncident(record, options))
    .filter(Boolean);
}

function publicSource(source) {
  if (typeof source === 'string') return source;
  if (source && typeof source === 'object') {
    return value(source.type ?? source.sourceType, 'community');
  }
  return 'community';
}

function safeIds(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string').map((item) => item.slice(0, 160)).slice(0, 20);
}

function nullable(value) {
  return value === undefined || value === null || value === '' ? null : value;
}

function value(input, fallback = null) {
  return input === undefined || input === null || input === '' ? fallback : input;
}
