import { IncidentError, incidentValidationError } from './errors.mjs';

export const INCIDENT_STATUSES = Object.freeze([
  'reported',
  'validated',
  'published',
  'disputed',
  'resolved',
  'archived'
]);
export const INCIDENT_SEVERITIES = Object.freeze(['info', 'low', 'medium', 'high', 'critical']);
export const INCIDENT_TYPES = Object.freeze([
  'blocked_ramp',
  'blocked_path',
  'broken_lift',
  'closed_toilet',
  'construction',
  'flooding',
  'inaccessible_transport_stop',
  'surface_damage',
  'temporary_closure',
  'other'
]);
export const INCIDENT_SOURCES = Object.freeze(['community', 'facility', 'authority', 'moderator', 'system']);
export const MAX_INCIDENT_LIST_SIZE = 100;

export function normalizeIncidentInput(input, { now = () => Date.now(), partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw incidentValidationError('INCIDENT_INPUT_INVALID', 'An incident object is required.', 'incident');
  }
  const normalized = {};
  if (!partial || hasAny(input, ['placeId', 'place_id'])) {
    const placeId = input.placeId ?? input.place_id;
    if (placeId !== undefined && placeId !== null && placeId !== '') normalized.placeId = id(placeId, 'placeId');
  }
  if (!partial || hasAny(input, ['accessNodeId', 'access_node_id', 'nodeId'])) {
    const value = input.accessNodeId ?? input.access_node_id ?? input.nodeId;
    if (value !== undefined && value !== null && value !== '') normalized.accessNodeId = id(value, 'accessNodeId');
  }
  if (!partial || hasAny(input, ['accessEdgeId', 'access_edge_id', 'edgeId', 'routeSegmentId'])) {
    const value = input.accessEdgeId ?? input.access_edge_id ?? input.edgeId ?? input.routeSegmentId;
    if (value !== undefined && value !== null && value !== '') normalized.accessEdgeId = id(value, 'accessEdgeId');
  }
  if (!partial || hasAny(input, ['featureId', 'feature_id'])) {
    const value = input.featureId ?? input.feature_id;
    if (value !== undefined && value !== null && value !== '') normalized.featureId = id(value, 'featureId');
  }
  if (!partial || hasAny(input, ['geometry', 'geom'])) {
    const value = input.geometry ?? input.geom;
    if (value !== undefined && value !== null) normalized.geometry = normalizeGeometry(value);
  }

  const affectedEntity = input.affectedEntity ?? input.affected_entity;
  if (affectedEntity !== undefined) {
    if (!affectedEntity || typeof affectedEntity !== 'object' || Array.isArray(affectedEntity)) {
      throw incidentValidationError('INCIDENT_ENTITY_INVALID', 'affectedEntity must be an object.', 'affectedEntity');
    }
    if (affectedEntity.type !== undefined) normalized.affectedEntityType = id(affectedEntity.type, 'affectedEntity.type');
    if (affectedEntity.id !== undefined) normalized.affectedEntityId = id(affectedEntity.id, 'affectedEntity.id');
  }

  if (!partial || hasAny(input, ['type', 'incidentType', 'incident_type'])) {
    normalized.type = normalizeEnum(input.type ?? input.incidentType ?? input.incident_type,
      INCIDENT_TYPES, 'type');
  }
  if (!partial || hasAny(input, ['severity'])) {
    normalized.severity = normalizeEnum(input.severity ?? 'medium', INCIDENT_SEVERITIES, 'severity');
  }
  if (!partial || hasAny(input, ['source', 'sourceType', 'source_type'])) {
    normalized.source = normalizeSource(input.source ?? input.sourceType ?? input.source_type ?? 'community');
  }
  if (!partial || hasAny(input, ['startsAt', 'startAt', 'start_time'])) {
    normalized.startsAt = normalizeDate(input.startsAt ?? input.startAt ?? input.start_time ?? now(), 'startsAt');
  }
  if (!partial || hasAny(input, ['expectedExpiryAt', 'expiresAt', 'expected_expiry_at'])) {
    const value = input.expectedExpiryAt ?? input.expiresAt ?? input.expected_expiry_at;
    normalized.expectedExpiryAt = value == null || value === '' ? null : normalizeDate(value, 'expectedExpiryAt');
  }
  if (!partial || hasAny(input, ['reviewAt', 'review_at'])) {
    const value = input.reviewAt ?? input.review_at;
    normalized.reviewAt = value == null || value === '' ? null : normalizeDate(value, 'reviewAt');
  }
  if (!partial || hasAny(input, ['observedAt', 'observed_at'])) {
    const value = input.observedAt ?? input.observed_at;
    normalized.observedAt = value == null || value === '' ? normalized.startsAt ?? null : normalizeDate(value, 'observedAt');
  }
  if (!partial || hasAny(input, ['explanation', 'details', 'description'])) {
    const value = input.explanation ?? input.details ?? input.description;
    normalized.explanation = value == null ? null : boundedText(value, 'explanation', 2_000);
  }
  if (!partial || hasAny(input, ['evidenceIds', 'evidence_ids'])) {
    normalized.evidenceIds = normalizeIds(input.evidenceIds ?? input.evidence_ids ?? [], 'evidenceIds', 10);
  }
  if (!partial || hasAny(input, ['affectedScopes', 'affected_scopes'])) {
    normalized.affectedScopes = normalizeIds(input.affectedScopes ?? input.affected_scopes ?? [], 'affectedScopes', 20);
  }
  if (!partial || hasAny(input, ['status'])) {
    const value = input.status ?? (partial ? undefined : 'reported');
    if (value !== undefined) normalized.status = normalizeEnum(value, INCIDENT_STATUSES, 'status');
  }

  if (!partial) {
    if (!normalized.placeId && !normalized.accessNodeId && !normalized.accessEdgeId && !normalized.featureId && !normalized.geometry &&
      !(normalized.affectedEntityType && normalized.affectedEntityId)) {
      throw incidentValidationError(
        'INCIDENT_AFFECTED_ENTITY_REQUIRED',
        'An incident must identify a place, access node, or access edge.',
        'affectedEntity'
      );
    }
    if (normalized.expectedExpiryAt && normalized.startsAt &&
      Date.parse(normalized.expectedExpiryAt) < Date.parse(normalized.startsAt)) {
      throw incidentValidationError('INCIDENT_DATE_ORDER_INVALID',
        'expectedExpiryAt must be on or after startsAt.', 'expectedExpiryAt');
    }
    if (normalized.reviewAt && normalized.startsAt && Date.parse(normalized.reviewAt) < Date.parse(normalized.startsAt)) {
      throw incidentValidationError('INCIDENT_DATE_ORDER_INVALID',
        'reviewAt must be on or after startsAt.', 'reviewAt');
    }
  }
  return normalized;
}

export function validateIncidentInput(input, options = {}) {
  return normalizeIncidentInput(input, options);
}

export const normalizeIncident = normalizeIncidentInput;

export function normalizeIncidentPatch(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length === 0) {
    throw incidentValidationError('INCIDENT_PATCH_EMPTY', 'At least one incident field is required.', 'incident');
  }
  const patch = normalizeIncidentInput(input, { ...options, partial: true });
  if (Object.keys(patch).length === 0) {
    throw incidentValidationError('INCIDENT_PATCH_EMPTY', 'No mutable incident fields were supplied.', 'incident');
  }
  return patch;
}

export function validateIncidentPatch(input, options = {}) {
  return normalizeIncidentPatch(input, options);
}

export function canTransitionIncident(from, to) {
  if (!INCIDENT_STATUSES.includes(from) || !INCIDENT_STATUSES.includes(to)) return false;
  if (from === to) return true;
  return {
    reported: new Set(['validated', 'published', 'disputed', 'resolved', 'archived']),
    validated: new Set(['published', 'disputed', 'resolved', 'archived']),
    published: new Set(['disputed', 'resolved', 'archived']),
    disputed: new Set(['validated', 'published', 'resolved', 'archived']),
    resolved: new Set(['archived']),
    archived: new Set()
  }[from].has(to);
}

export function assertIncidentTransition(from, to) {
  if (!canTransitionIncident(from, to)) {
    throw new IncidentError('INCIDENT_STATUS_TRANSITION_INVALID',
      `Incident cannot transition from ${from} to ${to}.`, { status: 409, field: 'status' });
  }
}

function normalizeSource(value) {
  if (typeof value === 'string') return normalizeEnum(value, INCIDENT_SOURCES, 'source');
  if (value && typeof value === 'object') {
    return normalizeEnum(value.type ?? value.sourceType, INCIDENT_SOURCES, 'source.type');
  }
  throw incidentValidationError('INCIDENT_SOURCE_INVALID', 'source must identify a public source type.', 'source');
}

function normalizeEnum(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.includes(value.trim().toLowerCase())) {
    throw incidentValidationError('INCIDENT_VALUE_INVALID',
      `${field} must be one of: ${allowed.join(', ')}.`, field);
  }
  return value.trim().toLowerCase();
}

function normalizeDate(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw incidentValidationError('INCIDENT_DATE_INVALID', `${field} must be a valid ISO date.`, field);
  }
  return date.toISOString();
}

function id(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 160) {
    throw incidentValidationError('INCIDENT_IDENTIFIER_INVALID',
      `${field} must be a non-empty string of at most 160 characters.`, field);
  }
  return value.trim();
}

function boundedText(value, field, maximum) {
  if (typeof value !== 'string' || value.trim().length > maximum) {
    throw incidentValidationError('INCIDENT_TEXT_INVALID',
      `${field} must be a string of at most ${maximum} characters.`, field);
  }
  return value.trim();
}

function normalizeIds(value, field, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw incidentValidationError('INCIDENT_LIST_INVALID',
      `${field} must contain at most ${maximum} identifiers.`, field);
  }
  return [...new Set(value.map((item) => id(item, field)))];
}

function normalizeGeometry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.type !== 'Point' || !Array.isArray(value.coordinates) || value.coordinates.length !== 2) {
    throw incidentValidationError('INCIDENT_GEOMETRY_INVALID', 'geometry must be a GeoJSON Point.', 'geometry');
  }
  const [longitude, latitude] = value.coordinates.map(Number);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
    || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw incidentValidationError('INCIDENT_GEOMETRY_INVALID', 'geometry coordinates are out of range.', 'geometry');
  }
  return { type: 'Point', coordinates: [longitude, latitude] };
}

function hasAny(input, fields) {
  return fields.some((field) => Object.hasOwn(input, field));
}
