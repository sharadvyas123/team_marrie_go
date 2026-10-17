import { ROUTE_REQUEST_VERSION, normalizeRouteRequest } from './request.mjs';

export const ROUTE_CACHE_VERSION = 1;

export function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function createRouteCacheKey(request, {
  graphVersion = 0,
  incidentVersion = 0,
  scope = null,
  cacheVersion = ROUTE_CACHE_VERSION
} = {}) {
  const normalized = request?.version === ROUTE_REQUEST_VERSION
    ? request
    : normalizeRouteRequest(request);
  const payload = stableSerialize({
    requestVersion: ROUTE_REQUEST_VERSION,
    graphVersion: normalizeVersion(graphVersion),
    incidentVersion: normalizeVersion(incidentVersion),
    scope: normalizeScope(scope),
    request: cacheableRequest(normalized)
  });
  const configuredScope = normalizeScope(scope);
  const scopes = configuredScope === null
    ? routeScopes(normalized)
    : Array.isArray(configuredScope) ? configuredScope : [configuredScope];
  const scopeToken = encodeURIComponent(scopes.join(','));
  return `route:v${cacheVersion}:g${normalizeVersion(graphVersion)}:i${normalizeVersion(incidentVersion)}:s${scopeToken}:${hash(payload)}`;
}

export const routeCacheKey = createRouteCacheKey;
export const buildRouteCacheKey = createRouteCacheKey;

export function routeCacheMetadata(request, versions = {}) {
  const normalized = request?.version === ROUTE_REQUEST_VERSION
    ? request
    : normalizeRouteRequest(request);
  return {
    key: createRouteCacheKey(normalized, versions),
    request: normalized,
    graphVersion: normalizeVersion(versions.graphVersion ?? 0),
    incidentVersion: normalizeVersion(versions.incidentVersion ?? 0),
    scope: normalizeScope(versions.scope),
    scopes: routeScopes(normalized)
  };
}

export function routeScopes(request, route = null) {
  const scopes = new Set();
  for (const endpoint of [request?.origin, request?.destination]) {
    if (endpoint?.placeId) scopes.add(`place:${endpoint.placeId}`);
    if (endpoint?.nodeId) scopes.add(`node:${endpoint.nodeId}`);
    if (endpoint?.latitude !== undefined) scopes.add(`cell:${cell(endpoint.latitude, endpoint.longitude)}`);
  }
  for (const segment of route?.segments ?? []) {
    for (const value of [segment.id, segment.segmentId, segment.edgeId, segment.accessEdgeId,
      segment.accessNodeId, segment.placeId]) {
      if (value) scopes.add(`edge:${value}`);
    }
  }
  return [...scopes].sort();
}

export function incidentInvalidationScopes(incident) {
  if (!incident || typeof incident !== 'object') return [];
  const scopes = [];
  for (const [field, prefix] of [
    ['placeId', 'place'],
    ['accessNodeId', 'node'],
    ['accessEdgeId', 'edge'],
    ['featureId', 'feature'],
    ['routeSegmentId', 'edge'],
    ['edgeId', 'edge'],
    ['nodeId', 'node']
  ]) {
    const value = incident[field] ?? incident[field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
    if (typeof value === 'string' && value.trim()) scopes.push(`${prefix}:${value.trim()}`);
  }
  for (const value of [...(Array.isArray(incident.affectedScopes ?? incident.affected_scopes)
    ? (incident.affectedScopes ?? incident.affected_scopes) : []),
    ...(Array.isArray(incident.cellIds) ? incident.cellIds.map((item) => `cell:${item}`) : [])]) {
    if (typeof value === 'string' && value.trim()) scopes.push(value.includes(':') ? value : `edge:${value}`);
  }
  return [...new Set(scopes)].sort();
}

export function isRouteCacheEntryAffected(entry, incident) {
  const entryScopes = new Set([
    ...(entry?.scopes ?? []),
    ...routeScopes(entry?.request, entry?.route),
    ...(Array.isArray(entry?.scope) ? entry.scope : entry?.scope ? [entry.scope] : []),
    ...scopesFromKey(entry?.key)
  ]);
  const incidentScopes = incidentInvalidationScopes(incident);
  if (entryScopes.size === 0 || incidentScopes.length === 0) return false;
  return incidentScopes.some((scope) => entryScopes.has(scope) ||
    (scope.startsWith('edge:') && entryScopes.has(`segment:${scope.slice(5)}`)));
}

export function invalidateAffectedRouteKeys(entries, incident) {
  const list = Array.isArray(entries) ? entries : [];
  return list.filter((entry) => isRouteCacheEntryAffected(
    typeof entry === 'string' ? { key: entry } : entry,
    incident
  )).map((entry) => typeof entry === 'string' ? entry : entry.key).filter(Boolean);
}

export const selectAffectedRouteKeys = invalidateAffectedRouteKeys;
export const affectedRouteCacheKeys = invalidateAffectedRouteKeys;

export function createRouteInvalidationMessage(incident, { reason = 'incident_changed', occurredAt } = {}) {
  return {
    schemaVersion: 'route-invalidation.v1',
    reason,
    occurredAt: occurredAt ?? new Date().toISOString(),
    incidentId: incident?.id ?? incident?.incidentId ?? null,
    scopes: incidentInvalidationScopes(incident)
  };
}

function normalizeVersion(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function normalizeScope(value) {
  if (Array.isArray(value)) return [...new Set(value.filter(Boolean).map(String))].sort();
  return value ? String(value) : null;
}

function cacheableRequest(request) {
  const { requestId: _requestId, ...stableRequest } = request;
  return stableRequest;
}

function cell(latitude, longitude) {
  return `${Math.round(latitude * 100)}:${Math.round(longitude * 100)}`;
}

function hash(value) {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

function scopesFromKey(key) {
  if (typeof key !== 'string') return [];
  const marker = ':s';
  const start = key.indexOf(marker);
  if (start < 0) return [];
  const end = key.indexOf(':', start + marker.length);
  if (end < 0) return [];
  try {
    const value = decodeURIComponent(key.slice(start + marker.length, end));
    return value ? value.split(',').filter(Boolean) : [];
  } catch {
    return [];
  }
}
