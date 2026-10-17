import { civicValidationError } from './errors.mjs';

export const CIVIC_MAX_PAGE_SIZE = 100;
export const CIVIC_MAX_BBOX_AREA_DEGREES = 25 * 25;

export function normalizeCivicPagination(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw civicValidationError('CIVIC_PAGINATION_INVALID', 'Pagination must be an object.', 'pagination');
  const page = boundedInteger(input.page ?? 1, 1, 10_000, 'page');
  const pageSize = boundedInteger(input.pageSize ?? input.page_size ?? input.limit ?? 20, 1, CIVIC_MAX_PAGE_SIZE, 'pageSize');
  const output = { page, pageSize, offset: (page - 1) * pageSize };
  if (input.cursor !== undefined) {
    if (typeof input.cursor !== 'string' || input.cursor.length > 512) throw civicValidationError('CIVIC_CURSOR_INVALID', 'cursor must be an opaque string of at most 512 characters.', 'cursor');
    output.cursor = input.cursor;
  }
  return output;
}

export function normalizeCivicIncidentFilters(input = {}) {
  assertObject(input, 'filters');
  const allowed = ['page', 'pageSize', 'page_size', 'limit', 'cursor', 'bbox', 'status', 'placeId', 'activeOnly'];
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw civicValidationError('CIVIC_FILTER_INVALID', `Unsupported civic filter: ${unknown}.`, unknown);
  const pagination = normalizeCivicPagination(input);
  if (input.status !== undefined && !['validated', 'published', 'disputed', 'resolved'].includes(input.status)) {
    throw civicValidationError('CIVIC_FILTER_INVALID', 'status is not a public incident status.', 'status');
  }
  return {
    ...pagination,
    ...(input.bbox !== undefined ? { bbox: normalizeBbox(input.bbox) } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.placeId !== undefined ? { placeId: identifier(input.placeId, 'placeId') } : {}),
    ...(input.activeOnly !== undefined ? { activeOnly: booleanValue(input.activeOnly, 'activeOnly') } : {})
  };
}

export function normalizeCivicChangeFilters(input = {}) {
  assertObject(input, 'filters');
  const allowed = ['page', 'pageSize', 'page_size', 'limit', 'cursor', 'since', 'placeId', 'eventType'];
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw civicValidationError('CIVIC_FILTER_INVALID', `Unsupported civic filter: ${unknown}.`, unknown);
  const pagination = normalizeCivicPagination(input);
  const output = { ...pagination };
  if (input.since !== undefined) output.since = validDate(input.since, 'since');
  if (input.placeId !== undefined) output.placeId = identifier(input.placeId, 'placeId');
  if (input.eventType !== undefined) output.eventType = boundedString(input.eventType, 'eventType', 120);
  return output;
}

export function normalizeBbox(value) {
  let parts;
  if (typeof value === 'string') parts = value.split(',').map((item) => Number(item.trim()));
  else if (Array.isArray(value)) parts = value.map(Number);
  else if (value && typeof value === 'object') {
    parts = [Number(value.minLng ?? value.west), Number(value.minLat ?? value.south), Number(value.maxLng ?? value.east), Number(value.maxLat ?? value.north)];
  }
  if (!Array.isArray(parts) || parts.length !== 4 || parts.some((item) => !Number.isFinite(item))) {
    throw civicValidationError('CIVIC_BBOX_INVALID', 'bbox must contain min longitude, min latitude, max longitude, and max latitude.', 'bbox');
  }
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 || minLng >= maxLng || minLat >= maxLat) {
    throw civicValidationError('CIVIC_BBOX_INVALID', 'bbox coordinates are outside valid bounds.', 'bbox');
  }
  if ((maxLng - minLng) * (maxLat - minLat) > CIVIC_MAX_BBOX_AREA_DEGREES) {
    throw civicValidationError('CIVIC_BBOX_TOO_LARGE', 'bbox is too large; narrow the requested area.', 'bbox');
  }
  return { minLng, minLat, maxLng, maxLat };
}

export function makeCivicPagination(options, { total, hasNext } = {}) {
  const safeTotal = Number.isSafeInteger(total) && total >= 0 ? total : undefined;
  return {
    page: options.page,
    pageSize: options.pageSize,
    ...(safeTotal === undefined ? {} : { total: safeTotal }),
    hasNext: hasNext === undefined ? (safeTotal === undefined ? false : options.offset + options.pageSize < safeTotal) : Boolean(hasNext)
  };
}

function assertObject(value, field) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw civicValidationError('CIVIC_INPUT_INVALID', `${field} must be an object.`, field); }
function boundedInteger(value, minimum, maximum, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw civicValidationError('CIVIC_BOUND_INVALID', `${field} must be an integer between ${minimum} and ${maximum}.`, field);
  return number;
}
function identifier(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 160) throw civicValidationError('CIVIC_IDENTIFIER_INVALID', `${field} is invalid.`, field);
  return value.trim();
}
function boundedString(value, field, maximum) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maximum) throw civicValidationError('CIVIC_VALUE_INVALID', `${field} is invalid.`, field);
  return value.trim();
}
function booleanValue(value, field) {
  if (typeof value !== 'boolean') throw civicValidationError('CIVIC_VALUE_INVALID', `${field} must be a boolean.`, field);
  return value;
}
function validDate(value, field) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw civicValidationError('CIVIC_DATE_INVALID', `${field} must be a valid date.`, field);
  return parsed.toISOString();
}
