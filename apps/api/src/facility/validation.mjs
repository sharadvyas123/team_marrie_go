import { FacilityError, facilityValidationError } from './errors.mjs';

export const FACILITY_CLAIM_STATUSES = Object.freeze(['pending', 'approved', 'rejected', 'revoked']);
export const FACILITY_VERIFICATION_METHODS = Object.freeze([
  'official_email',
  'phone_callback',
  'document_review',
  'admin_invitation'
]);
export const FACILITY_RESPONSE_VALUES = Object.freeze([
  'yes',
  'no',
  'partial',
  'temporarily_unavailable',
  'unknown'
]);
export const FACILITY_INCIDENT_STATUSES = Object.freeze([
  'reported',
  'acknowledged',
  'in_progress',
  'resolved',
  'archived'
]);
export const FACILITY_INCIDENT_TYPES = Object.freeze([
  'blocked_ramp',
  'blocked_path',
  'broken_lift',
  'closed_toilet',
  'construction',
  'temporary_closure',
  'other'
]);

const MAX_ID = 160;

export function normalizeFacilityClaimInput(input) {
  assertObject(input, 'claim');
  return {
    placeId: id(input.placeId ?? input.place_id, 'placeId'),
    organizationName: text(input.organizationName ?? input.organization_name, 'organizationName', 200),
    verificationMethod: enumValue(
      input.verificationMethod ?? input.verification_method ?? 'official_email',
      FACILITY_VERIFICATION_METHODS,
      'verificationMethod'
    )
  };
}

export function normalizeFacilityResponseInput(input, { partial = false } = {}) {
  assertObject(input, 'response');
  const output = {};
  if (!partial || has(input, 'placeId', 'place_id')) output.placeId = id(input.placeId ?? input.place_id, 'placeId');
  if (has(input, 'featureId', 'feature_id')) output.featureId = nullableId(input.featureId ?? input.feature_id, 'featureId');
  if (!partial || has(input, 'response', 'text', 'message')) {
    output.response = text(input.response ?? input.text ?? input.message, 'response', 5_000);
  }
  if (has(input, 'statusValue', 'status_value')) {
    output.statusValue = nullableEnum(input.statusValue ?? input.status_value, FACILITY_RESPONSE_VALUES, 'statusValue');
  }
  if (has(input, 'evidence', 'details', 'officialDetails')) {
    output.evidence = boundedJsonObject(input.evidence ?? input.details ?? input.officialDetails, 'evidence', 8_000);
  }
  if (has(input, 'effectiveAt', 'effective_at')) {
    output.effectiveAt = nullableDate(input.effectiveAt ?? input.effective_at, 'effectiveAt');
  }
  if (Object.keys(output).length === 0) {
    throw facilityValidationError('FACILITY_RESPONSE_EMPTY', 'A facility response must contain a mutable field.', 'response');
  }
  return output;
}

export function normalizeFacilityIncidentInput(input, { partial = false } = {}) {
  assertObject(input, 'incident');
  const output = {};
  if (!partial || has(input, 'placeId', 'place_id')) output.placeId = id(input.placeId ?? input.place_id, 'placeId');
  if (has(input, 'accessNodeId', 'access_node_id')) output.accessNodeId = nullableId(input.accessNodeId ?? input.access_node_id, 'accessNodeId');
  if (has(input, 'accessEdgeId', 'access_edge_id')) output.accessEdgeId = nullableId(input.accessEdgeId ?? input.access_edge_id, 'accessEdgeId');
  if (!partial || has(input, 'type', 'incidentType')) {
    output.type = enumValue(input.type ?? input.incidentType, FACILITY_INCIDENT_TYPES, 'type');
  }
  if (has(input, 'status')) output.status = enumValue(input.status, FACILITY_INCIDENT_STATUSES, 'status');
  if (has(input, 'severity')) output.severity = enumValue(input.severity, ['info', 'low', 'medium', 'high', 'critical'], 'severity');
  if (has(input, 'explanation', 'details', 'description')) {
    output.explanation = text(input.explanation ?? input.details ?? input.description, 'explanation', 2_000);
  }
  if (has(input, 'startsAt', 'starts_at')) output.startsAt = date(input.startsAt ?? input.starts_at, 'startsAt');
  if (has(input, 'expectedExpiryAt', 'expiresAt', 'expected_expiry_at')) {
    output.expectedExpiryAt = nullableDate(input.expectedExpiryAt ?? input.expiresAt ?? input.expected_expiry_at, 'expectedExpiryAt');
  }
  if (!partial && !output.placeId) throw facilityValidationError('FACILITY_INCIDENT_PLACE_REQUIRED', 'placeId is required.', 'placeId');
  if (output.expectedExpiryAt && output.startsAt && Date.parse(output.expectedExpiryAt) < Date.parse(output.startsAt)) {
    throw facilityValidationError('FACILITY_INCIDENT_DATE_ORDER_INVALID', 'expectedExpiryAt must be on or after startsAt.', 'expectedExpiryAt');
  }
  if (Object.keys(output).length === 0) throw facilityValidationError('FACILITY_INCIDENT_EMPTY', 'An incident change is required.', 'incident');
  return output;
}

export function normalizeFacilityListFilters(filters = {}) {
  assertObject(filters, 'filters');
  const allowed = ['page', 'pageSize', 'status', 'city', 'category', 'placeId'];
  const unknown = Object.keys(filters).find((key) => !allowed.includes(key));
  if (unknown) throw facilityValidationError('FACILITY_FILTER_INVALID', `Unsupported facility filter: ${unknown}.`, unknown);
  const page = boundedInteger(filters.page ?? 1, 1, 10_000, 'page');
  const pageSize = boundedInteger(filters.pageSize ?? filters.page_size ?? 20, 1, 100, 'pageSize');
  const output = { page, pageSize };
  if (filters.status !== undefined) output.status = enumValue(filters.status, FACILITY_CLAIM_STATUSES, 'status');
  for (const field of ['city', 'category', 'placeId']) {
    if (filters[field] !== undefined) output[field] = text(filters[field], field, field === 'placeId' ? MAX_ID : 120);
  }
  return output;
}

export function normalizeIdentifier(value, field = 'id') {
  return id(value, field);
}

function assertObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw facilityValidationError('FACILITY_INPUT_INVALID', `${field} must be an object.`, field);
  }
}

function has(input, ...fields) { return fields.some((field) => Object.hasOwn(input, field)); }

function id(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_ID) {
    throw facilityValidationError('FACILITY_IDENTIFIER_INVALID', `${field} must be a non-empty string of at most ${MAX_ID} characters.`, field);
  }
  return value.trim();
}

function nullableId(value, field) { return value == null || value === '' ? null : id(value, field); }

function text(value, field, maximum) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maximum) {
    throw facilityValidationError('FACILITY_TEXT_INVALID', `${field} must be between 1 and ${maximum} characters.`, field);
  }
  return value.trim();
}

function enumValue(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.includes(value.trim().toLowerCase())) {
    throw facilityValidationError('FACILITY_VALUE_INVALID', `${field} must be one of: ${allowed.join(', ')}.`, field);
  }
  return value.trim().toLowerCase();
}

function nullableEnum(value, allowed, field) { return value == null || value === '' ? null : enumValue(value, allowed, field); }

function date(value, field) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw facilityValidationError('FACILITY_DATE_INVALID', `${field} must be a valid date.`, field);
  return parsed.toISOString();
}

function nullableDate(value, field) { return value == null || value === '' ? null : date(value, field); }

function boundedInteger(value, minimum, maximum, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw facilityValidationError('FACILITY_BOUND_INVALID', `${field} must be an integer between ${minimum} and ${maximum}.`, field);
  }
  return number;
}

function boundedJsonObject(value, field, maximumCharacters) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw facilityValidationError('FACILITY_OBJECT_INVALID', `${field} must be an object.`, field);
  }
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw facilityValidationError('FACILITY_OBJECT_INVALID', `${field} must be JSON serializable.`, field); }
  if (serialized.length > maximumCharacters) throw facilityValidationError('FACILITY_OBJECT_TOO_LARGE', `${field} is too large.`, field);
  return structuredClone(value);
}
