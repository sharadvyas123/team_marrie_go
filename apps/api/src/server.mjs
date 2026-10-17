import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { evaluateMatch } from '../../../packages/domain/src/matching/index.mjs';
import { createProblem } from '../../../packages/validation/src/index.mjs';
import {
  AuthError,
  FixedWindowRateLimiter,
  applySecurityHeaders,
  createAuthProblem,
  hasFacilityScope,
  hasRole,
  readJsonBody,
  requireActiveSession,
  requireFacilityScope,
  requireRole,
  validateRequest,
  validateSession
} from './auth/index.mjs';
import { createCache, MemoryCache } from './cache/index.mjs';
import { createDatabasePool, DatabaseUnavailableError } from './db/pool.mjs';
import { SqlRepository } from './db/repository.mjs';
import {
  ObservationRepository,
  observationClientRequestId,
  privateObservation,
  publicObservation
} from './db/observations.mjs';
import { EvidenceRepository } from './db/evidence.mjs';
import {
  createLocalRoutingEngine,
} from '../../../packages/domain/src/routing/index.mjs';
import {
  createRoutingService,
} from './routing/index.mjs';
import { createIncidentService } from './incidents/index.mjs';
import {
  createFacilityHandlers,
  createFacilityService,
  createQrContext,
  validateQrContext
} from './facility/index.mjs';
import { createCivicHandlers, createCivicService } from './civic/index.mjs';
import { createWebhookHandlers, createWebhookService } from './webhooks/index.mjs';
import {
  createEvidenceUploadService,
  canExposePublicDerivative,
  serializePrivateEvidence,
  serializePublicEvidence,
  serializeUploadIntent,
  validateUploadMetadata
} from './evidence/index.mjs';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3001;
const APPLICATION_VERSION = process.env.APP_VERSION ?? '0.1.0';
const OBSERVATION_VALUES = new Set(['yes', 'no', 'partial', 'temporarily_unavailable', 'unknown']);
const REQUIREMENT_LEVELS = new Set(['required', 'preferred', 'avoid']);
const PUBLIC_STREAM_EVENTS = new Set([
  'place.created',
  'place.updated',
  'claim.recomputed',
  'barrier.created',
  'barrier.updated',
  'barrier.resolved',
  'incident.created',
  'incident.updated',
  'incident.resolved',
  'facility.response.published',
  'route.invalidated',
  'change.published'
]);

export function healthPayload(version = APPLICATION_VERSION, checks = { process: 'ok' }) {
  return {
    schemaVersion: 'health.v1',
    service: 'accessmap-api',
    status: Object.values(checks).every((value) => value === 'ok') ? 'ok' : 'degraded',
    version,
    checks
  };
}

function sendJson(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(body);
}

function sendNoContent(response) {
  response.statusCode = 204;
  response.removeHeader('Content-Length');
  response.end();
}

function sendMetrics(response, metrics) {
  const lines = [
    '# HELP accessmap_up API process availability.',
    '# TYPE accessmap_up gauge',
    'accessmap_up 1',
    '# HELP accessmap_cache_hits_total Cache hits observed by this API process.',
    '# TYPE accessmap_cache_hits_total counter',
    `accessmap_cache_hits_total ${Number(metrics?.hits ?? 0)}`,
    '# HELP accessmap_cache_misses_total Cache misses observed by this API process.',
    '# TYPE accessmap_cache_misses_total counter',
    `accessmap_cache_misses_total ${Number(metrics?.misses ?? 0)}`,
    '# HELP accessmap_cache_degraded Cache is operating without the durable Redis/Valkey backend.',
    '# TYPE accessmap_cache_degraded gauge',
    `accessmap_cache_degraded ${metrics?.degraded ? 1 : 0}`
  ];
  const body = `${lines.join('\n')}\n`;
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(body);
}

function routeSegments(pathname) {
  return pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
}

function integerQuery(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : NaN;
}

function decimalQuery(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseBbox(value) {
  if (!value) return null;
  const parts = String(value).split(',').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return 'invalid';
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = parts;
  if (minLongitude < -180 || maxLongitude > 180 || minLatitude < -90 || maxLatitude > 90 || minLongitude >= maxLongitude || minLatitude >= maxLatitude) return 'invalid';
  return { minLongitude, minLatitude, maxLongitude, maxLatitude };
}

function problem(status, title, detail, traceId, type = 'https://accessmap.example/problems/invalid-request') {
  return createProblem({ status, title, detail, traceId, type });
}

function errorStatus(error) {
  if (error instanceof AuthError || error instanceof DatabaseUnavailableError) return error.status ?? 503;
  return Number.isInteger(error?.status) ? error.status : 500;
}

function databaseProblem(error, traceId) {
  if (error?.code === 'SELF_VERIFICATION') {
    return {
      status: 403,
      body: problem(403, 'Verification not allowed', error.message, traceId, 'https://accessmap.example/problems/forbidden')
    };
  }
  if (error?.code === 'OBSERVATION_NOT_PUBLIC') {
    return {
      status: 409,
      body: problem(409, 'Observation is not verifiable', error.message, traceId, 'https://accessmap.example/problems/conflict')
    };
  }
  if (error?.code === '23505') {
    return {
      status: 409,
      body: problem(409, 'Duplicate request', 'The request has already been applied.', traceId, 'https://accessmap.example/problems/conflict')
    };
  }
  return null;
}

function errorResponse(error, traceId) {
  if (error instanceof AuthError) return { status: error.status, body: { ...createAuthProblem(error), traceId } };
  if (error instanceof DatabaseUnavailableError) {
    return {
      status: 503,
      body: problem(503, 'Service unavailable', 'The durable data service is not available.', traceId, 'https://accessmap.example/problems/unavailable')
    };
  }
  if (typeof error?.toProblem === 'function') {
    return {
      status: error.status ?? 500,
      body: { ...error.toProblem(), traceId }
    };
  }
  const databaseError = databaseProblem(error, traceId);
  if (databaseError) return databaseError;
  if (Number.isInteger(error?.status)) {
    return {
      status: error.status,
      body: problem(error.status, error.status === 404 ? 'Resource not found' : 'Invalid request', error.message, traceId)
    };
  }
  return {
    status: 500,
    body: problem(500, 'Internal server error', 'The request could not be completed.', traceId, 'https://accessmap.example/problems/internal')
  };
}

function ensureRepository(repository) {
  if (!repository) throw new DatabaseUnavailableError();
  return repository;
}

function validateRequirements(requirements) {
  if (!Array.isArray(requirements)) {
    const error = new Error('requirements must be an array.');
    error.status = 422;
    throw error;
  }
  const seen = new Set();
  for (const requirement of requirements) {
    if (!requirement || typeof requirement !== 'object' || typeof requirement.featureCode !== 'string' || !REQUIREMENT_LEVELS.has(requirement.level)) {
      const error = new Error('Each requirement needs a featureCode and a valid level.');
      error.status = 422;
      throw error;
    }
    if (seen.has(requirement.featureCode)) {
      const error = new Error(`Duplicate match requirement: ${requirement.featureCode}`);
      error.status = 422;
      throw error;
    }
    seen.add(requirement.featureCode);
  }
  return requirements.map(({ featureCode, level }) => ({ featureCode: featureCode.trim(), level }));
}

function validateObservationInput(input, { requireClientRequestId = true } = {}) {
  if (!input || typeof input !== 'object') {
    const error = new Error('A JSON observation object is required.');
    error.status = 422;
    throw error;
  }
  const value = input.value ?? input.observedCondition ?? input.status;
  const normalized = {
    placeId: input.placeId,
    featureCode: input.featureCode,
    value,
    details: input.details ?? input.description ?? null,
    measuredValue: input.measuredValue ?? input.measurement ?? null,
    observedAt: input.observedAt,
    clientRequestId: observationClientRequestId(input),
    evidence: validateEvidenceReferences(input.evidence ?? input.evidenceRefs)
  };
  if (typeof normalized.placeId !== 'string' || normalized.placeId.length === 0) {
    const error = new Error('placeId is required.');
    error.status = 422;
    throw error;
  }
  if (typeof normalized.featureCode !== 'string' || !/^[a-z][a-z0-9_]{1,63}$/.test(normalized.featureCode)) {
    const error = new Error('featureCode is invalid.');
    error.status = 422;
    throw error;
  }
  if (!OBSERVATION_VALUES.has(normalized.value)) {
    const error = new Error('value must be yes, no, partial, temporarily_unavailable, or unknown.');
    error.status = 422;
    throw error;
  }
  if (typeof normalized.observedAt !== 'string' || Number.isNaN(Date.parse(normalized.observedAt))) {
    const error = new Error('observedAt must be a valid ISO date.');
    error.status = 422;
    throw error;
  }
   if (requireClientRequestId && (
     typeof normalized.clientRequestId !== 'string'
     || normalized.clientRequestId.length < 8
     || normalized.clientRequestId.length > 128
   )) {
     const error = new Error('clientRequestId is required for idempotent observation submission.');
    error.status = 422;
    throw error;
  }
  return normalized;
}

function validateEvidenceReferences(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 10) {
    const error = new Error('evidence must be an array containing at most 10 references.');
    error.status = 422;
    throw error;
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object') {
      const error = new Error('Each evidence reference must be an object.');
      error.status = 422;
      throw error;
    }
    const evidenceId = item.evidenceId ?? item.evidence_id ?? item.id;
    if (typeof evidenceId !== 'string' || !/^[0-9a-f-]{8,128}$/i.test(evidenceId.trim())) {
      const error = new Error('Each evidence reference must contain an evidenceId returned by the upload-intent endpoint.');
      error.status = 422;
      throw error;
    }
    return { evidenceId: evidenceId.trim() };
  });
}

function publicSession(session) {
  return {
    schemaVersion: 'session.v1',
    authenticated: session.authenticated,
    role: session.authenticated ? session.user.role : 'anonymous'
  };
}

function requestContext(session, request) {
  return {
    session,
    actorId: session.authenticated ? session.user.id : null,
    userId: session.authenticated ? session.user.id : null,
    role: session.authenticated ? session.user.role : 'anonymous',
    ip: request.socket?.remoteAddress ?? 'anonymous',
    apiKeyId: request.headers['x-api-key'] ?? null
  };
}

async function civicRequestContext(session, request, repository) {
  const rawKey = request.headers['x-api-key'];
  const required = process.env.CIVIC_API_KEY_REQUIRED === 'true';
  if (!rawKey) {
    if (required) throw Object.assign(new Error('A civic API key is required.'), { status: 401, code: 'CIVIC_API_KEY_REQUIRED' });
    return requestContext(session, request);
  }
  if (!repository || typeof repository.findCivicApiKey !== 'function') {
    throw serviceUnavailable('Civic API key validation is not configured.');
  }
  const consumer = await repository.findCivicApiKey(rawKey);
  if (!consumer) throw Object.assign(new Error('The civic API key is invalid or revoked.'), { status: 401, code: 'CIVIC_API_KEY_INVALID' });
  return {
    ...requestContext(session, request),
    apiKeyId: consumer.id,
    consumerId: consumer.id,
    civicConsumer: { id: consumer.id, rateLimitPerMinute: consumer.rate_limit_per_minute ?? consumer.rateLimitPerMinute }
  };
}

async function invokeHandler(handler, request) {
  const result = await handler(request);
  return result?.body ?? result;
}

function parseJsonQuery(value, field) {
  if (value === null || value === undefined || value === '') return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed;
  } catch {
    throw Object.assign(new Error(`${field} must be a JSON object.`), { status: 422 });
  }
}

function routeRequestFromQuery(url) {
  const origin = parseJsonQuery(url.searchParams.get('origin'), 'origin') ??
    (url.searchParams.get('originPlaceId') ? { placeId: url.searchParams.get('originPlaceId') } : null) ??
    (url.searchParams.get('from') ? { placeId: url.searchParams.get('from') } : null);
  const destination = parseJsonQuery(url.searchParams.get('destination'), 'destination') ??
    (url.searchParams.get('destinationPlaceId') ? { placeId: url.searchParams.get('destinationPlaceId') } : null) ??
    (url.searchParams.get('to') ? { placeId: url.searchParams.get('to') } : null);
  const constraints = parseJsonQuery(url.searchParams.get('constraints'), 'constraints') ?? {};
  for (const [name, key] of [
    ['noStairs', 'avoidStairs'],
    ['avoidStairs', 'avoidStairs'],
    ['requireCurbRamps', 'requireCurbRamps'],
    ['requireWorkingLift', 'requireWorkingLift'],
    ['avoidUnknown', 'avoidUnknown'],
    ['avoidStale', 'avoidStale'],
    ['avoidBarriers', 'avoidBarriers']
  ]) {
    if (url.searchParams.has(name)) constraints[key] = url.searchParams.get(name);
  }
  for (const [name, key] of [['maxSlope', 'maxSlope'], ['minWidth', 'minWidth']]) {
    if (url.searchParams.has(name)) constraints[key] = url.searchParams.get(name);
  }
  if (!origin || !destination) throw Object.assign(new Error('origin and destination are required.'), { status: 422 });
  return {
    origin,
    destination,
    constraints,
    maxAlternatives: url.searchParams.get('maxAlternatives') ?? undefined,
    timeoutMs: url.searchParams.get('timeoutMs') ?? undefined,
    mode: url.searchParams.get('mode') ?? undefined,
    locale: url.searchParams.get('locale') ?? undefined
  };
}

function createCivicRateLimitPort(limiter) {
  return {
    check({ identity, action }) {
      const result = limiter.consume(`civic:${action}:${identity}`);
      return { allowed: result.allowed, retryAfter: result.retryAfterSeconds };
    }
  };
}

function serviceUnavailable(message) {
  const error = new DatabaseUnavailableError(message);
  error.status = 503;
  return error;
}

async function loadSession(request, { repository, authSecret }) {
  return validateSession(request, {
    secret: authSecret,
    loadUser: repository ? async ({ subject }) => repository.getUserByAuthSubject(subject) : undefined
  });
}

async function handleRequest(request, response, context) {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? DEFAULT_HOST}`);
  const traceId = request.headers['x-trace-id'] ?? randomUUID();
  const segments = routeSegments(requestUrl.pathname);
  const method = request.method ?? 'GET';
  const {
    repository,
    observationRepository,
    evidenceRepository,
    evidenceUploadService,
    evidencePublicUrl,
    cache,
    limiter,
    authSecret,
    version,
    eventHub,
    routingService,
    incidentService,
    facilityHandlers,
    civicHandlers,
    webhookHandlers,
    facilityService,
    qrService,
    evidenceStorage
  } = context;
  const session = await loadSession(request, { repository, authSecret });

  if (method === 'GET' && requestUrl.pathname === '/health') {
    const checks = { process: 'ok' };
    if (repository) {
      try {
        checks.database = (await repository.health()) ? 'ok' : 'degraded';
      } catch {
        checks.database = 'degraded';
      }
    }
    sendJson(response, 200, healthPayload(version, checks), { 'X-Trace-Id': traceId });
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/readyz') {
    const checks = { process: 'ok' };
    if (repository) {
      try {
        checks.database = (await repository.health()) ? 'ok' : 'degraded';
      } catch {
        checks.database = 'degraded';
      }
    }
    try {
      const cacheStats = await cache?.stats?.();
      if (cacheStats?.degraded) checks.cache = 'degraded';
      else if (cacheStats) checks.cache = 'ok';
    } catch {
      checks.cache = 'degraded';
    }
    const ready = Object.values(checks).every((value) => value === 'ok');
    sendJson(response, ready ? 200 : 503, {
      schemaVersion: 'ready.v1',
      status: ready ? 'ok' : 'degraded',
      checks
    }, { 'X-Trace-Id': traceId });
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/metrics') {
    sendMetrics(response, await cache?.stats?.());
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/api/session') {
    sendJson(response, 200, publicSession(session), { 'X-Trace-Id': traceId });
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/api/categories') {
    sendJson(response, 200, { items: await ensureRepository(repository).listCategories(), schemaVersion: 'categories.v1' });
    return;
  }
  if (method === 'GET' && requestUrl.pathname === '/api/features') {
    sendJson(response, 200, { items: await ensureRepository(repository).listFeatures(), schemaVersion: 'features.v1' });
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/api/routes') {
    if (!routingService) throw serviceUnavailable('Routing is not configured for this deployment.');
    const result = await routingService.calculate(routeRequestFromQuery(requestUrl));
    sendJson(response, 200, result, { 'X-Trace-Id': traceId });
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/api/v1/places/accessibility') {
    throw Object.assign(new Error('placeId is required in the civic URL.'), { status: 404 });
  }
  if (method === 'GET' && segments[0] === 'api' && segments[1] === 'v1' && segments[2] === 'places' && segments[3] && segments[4] === 'accessibility') {
    if (!civicHandlers) throw serviceUnavailable('The civic API is not configured for this deployment.');
    const civicContext = await civicRequestContext(session, request, repository);
    const body = await invokeHandler(civicHandlers.getPlaceAccessibility, {
      params: { placeId: segments[3] },
      query: Object.fromEntries(requestUrl.searchParams),
      context: civicContext
    });
    sendJson(response, 200, body, { 'X-Trace-Id': traceId });
    return;
  }
  if (method === 'GET' && requestUrl.pathname === '/api/v1/incidents') {
    if (!civicHandlers) throw serviceUnavailable('The civic API is not configured for this deployment.');
    const body = await invokeHandler(civicHandlers.listIncidents, {
      query: Object.fromEntries(requestUrl.searchParams),
      context: await civicRequestContext(session, request, repository)
    });
    sendJson(response, 200, { schemaVersion: 'civic-incidents.v1', ...body }, { 'X-Trace-Id': traceId });
    return;
  }
  if (method === 'GET' && requestUrl.pathname === '/api/v1/changes') {
    if (!civicHandlers) throw serviceUnavailable('The civic API is not configured for this deployment.');
    const body = await invokeHandler(civicHandlers.listChanges, {
      query: Object.fromEntries(requestUrl.searchParams),
      context: await civicRequestContext(session, request, repository)
    });
    sendJson(response, 200, { schemaVersion: 'civic-changes.v1', ...body }, { 'X-Trace-Id': traceId });
    return;
  }

  if (method === 'GET' && (requestUrl.pathname === '/api/places' || requestUrl.pathname === '/api/search')) {
    const page = integerQuery(requestUrl.searchParams.get('page'), 1, { min: 1, max: 10_000 });
    const pageSize = integerQuery(requestUrl.searchParams.get('pageSize'), 20, { min: 1, max: 100 });
    const latitude = decimalQuery(requestUrl.searchParams.get('latitude'));
    const longitude = decimalQuery(requestUrl.searchParams.get('longitude'));
    const radius = integerQuery(requestUrl.searchParams.get('radius'), null, { min: 1, max: 50_000 });
    const bbox = parseBbox(requestUrl.searchParams.get('bbox'));
    if ([page, pageSize, latitude, longitude, radius].some((value) => Number.isNaN(value)) || bbox === 'invalid') {
      throw Object.assign(new Error('Search coordinates, radius, bbox, page, or pageSize are invalid.'), { status: 422 });
    }
    const result = await ensureRepository(repository).searchPlaces({
      query: requestUrl.searchParams.get('query') ?? requestUrl.searchParams.get('q') ?? '',
      category: requestUrl.searchParams.get('category'),
      city: requestUrl.searchParams.get('city'),
      latitude,
      longitude,
      radius,
      bbox,
      features: requestUrl.searchParams.get('features'),
      page,
      pageSize,
      sort: requestUrl.searchParams.get('sort') ?? 'distance'
    });
    sendJson(response, 200, { schemaVersion: 'place-search.v1', ...result }, { 'X-Trace-Id': traceId });
    return;
  }

  if (segments[0] === 'api' && segments[1] === 'places' && segments[2] && segments[3] === 'claim' && method === 'POST') {
    requireActiveSession(session);
    if (!facilityHandlers) throw serviceUnavailable('Facility operations are not configured for this deployment.');
    validateRequest(request, { maxBytes: 64 * 1024 });
    const body = await readJsonBody(request, { maxBytes: 64 * 1024 });
    const result = await invokeHandler(facilityHandlers.requestClaim, {
      body: { ...body, placeId: segments[2] },
      context: requestContext(session, request)
    });
    sendJson(response, 201, result, { 'X-Trace-Id': traceId });
    return;
  }

  if (segments[0] === 'api' && segments[1] === 'facility') {
    if (!facilityHandlers) throw serviceUnavailable('Facility operations are not configured for this deployment.');
    const contextValue = requestContext(session, request);
    if (method === 'GET' && segments[2] === 'places' && !segments[3]) {
      requireActiveSession(session);
      const result = await invokeHandler(facilityHandlers.listPlaces, {
        query: Object.fromEntries(requestUrl.searchParams),
        context: contextValue
      });
      sendJson(response, 200, { schemaVersion: 'facility-places.v1', ...result }, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'GET' && segments[2] === 'places' && segments[3]) {
      requireActiveSession(session);
      const result = await invokeHandler(facilityHandlers.getPlace, {
        params: { placeId: segments[3] },
        context: contextValue
      });
      if (!result) throw Object.assign(new Error('Facility place not found.'), { status: 404 });
      sendJson(response, 200, result, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'POST' && segments[2] === 'responses') {
      requireActiveSession(session);
      validateRequest(request, { maxBytes: 128 * 1024 });
      const result = await invokeHandler(facilityHandlers.createResponse, {
        body: await readJsonBody(request, { maxBytes: 128 * 1024 }),
        context: contextValue
      });
      sendJson(response, 201, result, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'PATCH' && segments[2] === 'responses' && segments[3]) {
      requireActiveSession(session);
      validateRequest(request, { maxBytes: 128 * 1024 });
      const result = await invokeHandler(facilityHandlers.updateResponse, {
        params: { responseId: segments[3] },
        body: await readJsonBody(request, { maxBytes: 128 * 1024 }),
        context: contextValue
      });
      sendJson(response, 200, result, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'POST' && segments[2] === 'incidents') {
      requireActiveSession(session);
      validateRequest(request, { maxBytes: 128 * 1024 });
      const result = await invokeHandler(facilityHandlers.createIncident, {
        body: await readJsonBody(request, { maxBytes: 128 * 1024 }),
        context: contextValue
      });
      sendJson(response, 201, result, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'PATCH' && segments[2] === 'incidents' && segments[3]) {
      requireActiveSession(session);
      validateRequest(request, { maxBytes: 128 * 1024 });
      const result = await invokeHandler(facilityHandlers.updateIncident, {
        params: { incidentId: segments[3] },
        body: await readJsonBody(request, { maxBytes: 128 * 1024 }),
        context: contextValue
      });
      sendJson(response, 200, result, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'POST' && segments[2] === 'qr-codes') {
      requireActiveSession(session);
      if (!qrService) throw serviceUnavailable('QR signing is not configured for this deployment.');
      validateRequest(request, { maxBytes: 32 * 1024 });
      const result = await invokeHandler(facilityHandlers.createQrCode, {
        body: await readJsonBody(request, { maxBytes: 32 * 1024 }),
        context: contextValue
      });
      sendJson(response, 201, result, { 'X-Trace-Id': traceId });
      return;
    }
  }

  if (method === 'POST' && requestUrl.pathname === '/api/qr/validate') {
    if (!facilityService || !qrService) throw serviceUnavailable('QR validation is not configured for this deployment.');
    validateRequest(request, { maxBytes: 16 * 1024 });
    const body = await readJsonBody(request, { maxBytes: 16 * 1024 });
    const result = await facilityService.validateQrContext(body.token, {
      secret: process.env.QR_SIGNING_SECRET ?? authSecret,
      contextPort: repository,
      revocationPort: repository
    });
    sendJson(response, 200, result, { 'X-Trace-Id': traceId });
    return;
  }

  if (segments[0] === 'api' && segments[1] === 'v1' && segments[2] === 'webhooks') {
    requireActiveSession(session);
    if (!webhookHandlers) throw serviceUnavailable('Webhook operations are not configured for this deployment.');
    const webhookContext = requestContext(session, request);
    if (method === 'POST' && segments.length === 3) {
      validateRequest(request, { maxBytes: 32 * 1024 });
      const result = await invokeHandler(webhookHandlers.createSubscription, {
        body: await readJsonBody(request, { maxBytes: 32 * 1024 }),
        context: webhookContext
      });
      sendJson(response, 201, result, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'GET' && segments.length === 3) {
      const result = await invokeHandler(webhookHandlers.listSubscriptions, { context: webhookContext });
      sendJson(response, 200, { schemaVersion: 'webhook-subscriptions.v1', items: result }, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'GET' && segments[3] && segments.length === 4) {
      const result = await invokeHandler(webhookHandlers.getSubscription, { params: { subscriptionId: segments[3] }, context: webhookContext });
      sendJson(response, 200, result, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'POST' && segments[3] && ['pause', 'revoke'].includes(segments[4])) {
      const operation = segments[4] === 'pause' ? webhookHandlers.pauseSubscription : webhookHandlers.revokeSubscription;
      const result = await invokeHandler(operation, { params: { subscriptionId: segments[3] }, context: webhookContext });
      sendJson(response, 200, result, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'GET' && segments[3] === 'deliveries' && segments[4]) {
      if (!webhookHandlers.getDelivery) throw serviceUnavailable('Webhook delivery status is not configured for this deployment.');
      const result = await invokeHandler(webhookHandlers.getDelivery, { params: { deliveryId: segments[4] }, context: webhookContext });
      if (!result) throw Object.assign(new Error('Webhook delivery not found.'), { status: 404 });
      sendJson(response, 200, result, { 'X-Trace-Id': traceId });
      return;
    }
  }

  if (segments[0] === 'api' && segments[1] === 'places' && segments[2]) {
    const placeId = segments[2];
    if (method === 'GET' && segments.length === 3) {
      const place = await ensureRepository(repository).getPlace(placeId);
      if (!place) throw Object.assign(new Error('Place not found.'), { status: 404 });
      sendJson(response, 200, { schemaVersion: 'place-detail.v1', ...place }, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'GET' && segments[3] === 'claims') {
      sendJson(response, 200, { schemaVersion: 'claims.v1', items: await ensureRepository(repository).listClaims(placeId) }, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'GET' && segments[3] === 'incidents') {
      const items = incidentService
        ? await incidentService.list({ placeId, page: 1, pageSize: 100 })
        : { items: await ensureRepository(repository).listIncidents({ placeId }) };
      sendJson(response, 200, { schemaVersion: 'incidents.v1', ...items }, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'GET' && segments[3] === 'access-graph') {
      sendJson(response, 200, { schemaVersion: 'access-graph.v1', ...await ensureRepository(repository).getAccessGraph(placeId) }, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'GET' && segments[3] === 'match') {
      requireActiveSession(session);
      const profile = await ensureRepository(repository).getProfile(session.user.id);
      const claims = await ensureRepository(repository).claimsForMatch(placeId);
      sendJson(response, 200, { schemaVersion: 'match-explanation.v1', ...evaluateMatch(profile, claims) }, { 'X-Trace-Id': traceId });
      return;
    }
  }

  if (method === 'GET' && requestUrl.pathname === '/api/incidents') {
    const bbox = parseBbox(requestUrl.searchParams.get('bbox'));
    if (bbox === 'invalid') throw Object.assign(new Error('bbox is invalid.'), { status: 422 });
    const items = incidentService
      ? (await incidentService.list({ bbox, page: integerQuery(requestUrl.searchParams.get('page'), 1, { min: 1, max: 10_000 }), pageSize: integerQuery(requestUrl.searchParams.get('pageSize'), 20, { min: 1, max: 100 }) }))
      : { items: await ensureRepository(repository).listIncidents({ bbox }) };
    sendJson(response, 200, { schemaVersion: 'incidents.v1', ...items }, { 'X-Trace-Id': traceId });
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/api/incidents') {
    requireActiveSession(session);
    if (!incidentService) throw serviceUnavailable('Incident operations are not configured for this deployment.');
    validateRequest(request, { maxBytes: 128 * 1024 });
    const body = await readJsonBody(request, { maxBytes: 128 * 1024 });
    const role = session.user.role;
    if (role === 'facility_manager') {
      throw Object.assign(new Error('Facility managers must use the scoped facility incident endpoint.'), { status: 403 });
    }
    if (!['user', 'moderator', 'admin'].includes(role)) requireRole(session, ['user']);
    if (role === 'user' && (body.status && body.status !== 'reported' || body.source && body.source !== 'community')) {
      throw Object.assign(new Error('Only moderators and administrators may publish or attribute incidents.'), { status: 403 });
    }
    const result = await incidentService.create({
      ...body,
      reporterId: session.user.id,
      source: role === 'user' ? 'community' : body.source ?? 'moderator'
    }, requestContext(session, request));
    sendJson(response, 201, result, { 'X-Trace-Id': traceId });
    return;
  }

  if (segments[0] === 'api' && segments[1] === 'incidents' && segments[2] && method === 'PATCH') {
    requireActiveSession(session);
    if (!incidentService) throw serviceUnavailable('Incident operations are not configured for this deployment.');
    requireRole(session, ['moderator', 'admin']);
    validateRequest(request, { maxBytes: 128 * 1024 });
    const result = await incidentService.update(
      segments[2],
      await readJsonBody(request, { maxBytes: 128 * 1024 }),
      requestContext(session, request)
    );
    sendJson(response, 200, result, { 'X-Trace-Id': traceId });
    return;
  }

  if (segments[0] === 'api' && segments[1] === 'me' && segments[2] === 'access-match-profile') {
    requireActiveSession(session);
    if (method === 'GET') {
      const profile = await ensureRepository(repository).getProfile(session.user.id);
      sendJson(response, 200, profile ?? { userId: session.user.id, requirements: [], version: 0 }, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'PATCH') {
      validateRequest(request);
      const body = await readJsonBody(request);
      const requirements = validateRequirements(body.requirements);
      const saved = await ensureRepository(repository).upsertProfile(session.user.id, requirements);
      sendJson(response, 200, saved, { 'X-Trace-Id': traceId });
      return;
    }
  }

  if (method === 'POST' && requestUrl.pathname === '/api/matches/places') {
    validateRequest(request);
    const body = await readJsonBody(request);
    const requirements = validateRequirements(body.profile?.requirements ?? body.requirements ?? []);
    const placeIds = body.placeIds ?? (body.placeId ? [body.placeId] : []);
    if (!Array.isArray(placeIds) || placeIds.length === 0 || placeIds.length > 50) throw Object.assign(new Error('placeId or placeIds is required.'), { status: 422 });
    const items = [];
    for (const placeId of placeIds) {
      const claims = await ensureRepository(repository).claimsForMatch(placeId);
      items.push({ placeId, ...evaluateMatch({ requirements }, claims) });
    }
    sendJson(response, 200, { schemaVersion: 'match-results.v1', items }, { 'X-Trace-Id': traceId });
    return;
  }

  if (segments[0] === 'api' && segments[1] === 'me' && segments[2] === 'observations' && method === 'GET') {
    requireActiveSession(session);
    const page = integerQuery(requestUrl.searchParams.get('page'), 1, { min: 1, max: 10_000 });
    const pageSize = integerQuery(requestUrl.searchParams.get('pageSize'), 20, { min: 1, max: 100 });
    if ([page, pageSize].some((value) => Number.isNaN(value))) throw Object.assign(new Error('Pagination is invalid.'), { status: 422 });
    sendJson(response, 200, await ensureRepository(observationRepository).listForUser(session.user.id, { page, pageSize }), { 'X-Trace-Id': traceId });
    return;
  }

  if (method === 'POST' && (requestUrl.pathname === '/api/observations' || requestUrl.pathname === '/api/observations/sync')) {
    requireActiveSession(session);
    const key = `reports:${session.user.id}`;
    const rate = limiter.consume(key);
    if (!rate.allowed) {
      sendJson(response, 429, problem(429, 'Too many requests', 'Please wait before submitting another report.', traceId, 'https://accessmap.example/problems/rate-limit'), rate.headers);
      return;
    }
    validateRequest(request, { maxBytes: 256 * 1024 });
    const body = await readJsonBody(request, { maxBytes: 256 * 1024 });
    const items = requestUrl.pathname.endsWith('/sync') ? body.items : [body];
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) throw Object.assign(new Error('The observation payload must contain between 1 and 50 items.'), { status: 422 });
    const results = [];
    for (const item of items) {
       const input = validateObservationInput(item, { requireClientRequestId: true });
      const result = await ensureRepository(observationRepository).createObservation(session.user.id, input);
      results.push({ ...result.observation, synced: result.duplicate || requestUrl.pathname.endsWith('/sync'), duplicate: result.duplicate });
    }
    sendJson(response, requestUrl.pathname.endsWith('/sync') ? 200 : 201, requestUrl.pathname.endsWith('/sync') ? { items: results } : results[0], { 'X-Trace-Id': traceId, ...rate.headers });
    return;
  }

  if (segments[0] === 'api' && segments[1] === 'observations' && segments[2]) {
    const observationId = segments[2];
    if (method === 'POST' && segments[3] === 'evidence' && segments[4] === 'upload-intent') {
      requireActiveSession(session);
      validateRequest(request, { maxBytes: 32 * 1024 });
      if (!evidenceUploadService) throw new DatabaseUnavailableError('Evidence storage is not configured.');
      const body = await readJsonBody(request, { maxBytes: 32 * 1024 });
      const metadata = validateUploadMetadata(body);
      const intent = await evidenceUploadService.createUploadIntent({
        observationId,
        ownerId: session.user.id,
        role: session.user.role,
        metadata
      });
      sendJson(response, 201, { schemaVersion: 'evidence-upload-intent.v1', ...serializeUploadIntent(intent) }, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'GET' && segments[3] === 'evidence') {
      const viewerId = session.authenticated ? session.user.id : null;
      const role = session.authenticated ? session.user.role : 'anonymous';
      if (!evidenceRepository || typeof evidenceRepository.listForObservation !== 'function') {
        throw serviceUnavailable('Evidence status is not configured for this deployment.');
      }
      const records = await evidenceRepository.listForObservation(observationId, { viewerId, role });
      if (segments[4]) {
        const record = records.find((item) => item.id === segments[4]);
        if (!record) throw Object.assign(new Error('Evidence not found.'), { status: 404 });
        const publicUrl = typeof evidencePublicUrl === 'function' ? await evidencePublicUrl(record) : null;
        if (canExposePublicDerivative(record) && !publicUrl) throw serviceUnavailable('Public evidence URL generation is not configured.');
        const publicView = serializePublicEvidence(record, { publicUrl });
        if (publicView) {
          sendJson(response, 200, { schemaVersion: 'evidence.v1', ...publicView }, { 'X-Trace-Id': traceId });
          return;
        }
        requireActiveSession(session);
        sendJson(response, 200, { schemaVersion: 'evidence-private.v1', ...serializePrivateEvidence(record) }, { 'X-Trace-Id': traceId });
        return;
      }
      const items = [];
      for (const record of records) {
        const publicUrl = typeof evidencePublicUrl === 'function' ? await evidencePublicUrl(record) : null;
        const publicView = serializePublicEvidence(record, { publicUrl });
        if (publicView) items.push(publicView);
        else if (session.authenticated) items.push(serializePrivateEvidence(record));
      }
      sendJson(response, 200, { schemaVersion: 'evidence-status-list.v1', items }, { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'PATCH' && segments.length === 3) {
      requireActiveSession(session);
      validateRequest(request);
      const body = await readJsonBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw Object.assign(new Error('A JSON object is required.'), { status: 422 });
      }
      const detailsProvided = Object.hasOwn(body, 'details');
      const measuredValueProvided = Object.hasOwn(body, 'measuredValue') || Object.hasOwn(body, 'measurement');
      if (!detailsProvided && !measuredValueProvided) {
        throw Object.assign(new Error('At least one mutable observation field is required.'), { status: 422 });
      }
      if (detailsProvided && body.details !== null && (typeof body.details !== 'string' || body.details.length > 2000)) {
        throw Object.assign(new Error('details must be a string of at most 2000 characters or null.'), { status: 422 });
      }
      const measuredValue = body.measuredValue ?? body.measurement ?? null;
      if (measuredValueProvided && measuredValue !== null && (typeof measuredValue !== 'object' || Array.isArray(measuredValue))) {
        throw Object.assign(new Error('measuredValue must be an object or null.'), { status: 422 });
      }
      sendJson(response, 200, await ensureRepository(observationRepository).amendObservation(session.user.id, observationId, {
        details: body.details ?? null,
        measuredValue,
        detailsProvided,
        measuredValueProvided
      }), { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'GET' && segments.length === 3) {
      const observation = await ensureRepository(observationRepository).getById(observationId, {
        viewerId: session.authenticated ? session.user.id : null,
        role: session.authenticated ? session.user.role : 'anonymous'
      });
      if (!observation) throw Object.assign(new Error('Observation not found.'), { status: 404 });
      const privileged = session.authenticated
        && (observation.contributor_id === session.user.id || ['moderator', 'admin'].includes(session.user.role));
      if (!privileged && (observation.visibility !== 'public' || observation.moderation_status !== 'approved')) {
        requireActiveSession(session);
        throw Object.assign(new Error('The observation is not available to this account.'), { status: 403 });
      }
      sendJson(response, 200, privileged ? privateObservation(observation) : publicObservation(observation), { 'X-Trace-Id': traceId });
      return;
    }
    if (method === 'POST' && ['verify', 'dispute', 'outdated'].includes(segments[3])) {
      requireActiveSession(session);
      validateRequest(request);
      const body = await readJsonBody(request);
      const eventType = segments[3] === 'verify'
        ? 'confirmed'
        : segments[3] === 'dispute'
          ? 'disputed'
          : segments[3];
      sendJson(response, 201, await ensureRepository(observationRepository).verify(session.user.id, observationId, eventType, body.comment ?? null), { 'X-Trace-Id': traceId });
      return;
    }
  }

  if (method === 'GET' && requestUrl.pathname === '/api/moderation/queue') {
    requireActiveSession(session);
    requireRole(session, ['moderator', 'admin']);
    const page = integerQuery(requestUrl.searchParams.get('page'), 1, { min: 1, max: 10_000 });
    const pageSize = integerQuery(requestUrl.searchParams.get('pageSize'), 20, { min: 1, max: 100 });
    if ([page, pageSize].some((value) => Number.isNaN(value))) throw Object.assign(new Error('Pagination is invalid.'), { status: 422 });
    const status = requestUrl.searchParams.get('status') ?? 'open';
    if (!['open', 'assigned', 'resolved', 'escalated', 'all'].includes(status)) {
      throw Object.assign(new Error('Moderation status is invalid.'), { status: 422 });
    }
    sendJson(response, 200, {
      schemaVersion: 'moderation-queue.v1',
      ...(await ensureRepository(observationRepository).listModeration({
        status,
        page,
        pageSize,
        viewerId: session.user.id,
        role: session.user.role
      }))
    }, { 'X-Trace-Id': traceId });
    return;
  }

  if (method === 'GET' && segments[0] === 'api' && segments[1] === 'moderation' && segments[2] === 'items' && segments[3]) {
    requireActiveSession(session);
    requireRole(session, ['moderator', 'admin']);
    const item = await ensureRepository(observationRepository).getModerationItem(segments[3], {
      viewerId: session.user.id,
      role: session.user.role
    });
    if (!item) throw Object.assign(new Error('Moderation item not found.'), { status: 404 });
    sendJson(response, 200, { schemaVersion: 'moderation-item.v1', ...item }, { 'X-Trace-Id': traceId });
    return;
  }

  if (segments[0] === 'api' && segments[1] === 'moderation' && segments[2] === 'items' && segments[3] && method === 'POST') {
    requireActiveSession(session);
    requireRole(session, ['moderator', 'admin']);
    const action = segments[4] === 'request-changes' ? 'request-changes' : segments[4];
    validateRequest(request);
    const body = await readJsonBody(request);
    sendJson(response, 200, await ensureRepository(observationRepository).moderate({ moderatorId: session.user.id, itemId: segments[3], action, resolution: body.resolution ?? null }), { 'X-Trace-Id': traceId });
    return;
  }

  if (method === 'GET' && segments[0] === 'api' && segments[1] === 'evidence' && segments[2]) {
    const evidenceId = segments[2];
    const record = await ensureRepository(evidenceRepository).get(evidenceId, {
      viewerId: session.authenticated ? session.user.id : null,
      role: session.authenticated ? session.user.role : 'anonymous'
    });
    if (!record) throw Object.assign(new Error('Evidence not found.'), { status: 404 });
    const publicUrl = typeof evidencePublicUrl === 'function'
      ? await evidencePublicUrl(record)
      : null;
    if (canExposePublicDerivative(record) && !publicUrl) throw serviceUnavailable('Public evidence URL generation is not configured.');
    const publicView = serializePublicEvidence(record, { publicUrl });
    if (publicView) {
      sendJson(response, 200, { schemaVersion: 'evidence.v1', ...publicView }, { 'X-Trace-Id': traceId });
      return;
    }
    requireActiveSession(session);
    if (record.ownerId !== session.user.id && !['moderator', 'admin'].includes(session.user.role)) {
      throw Object.assign(new Error('The evidence is not available to this account.'), { status: 403 });
    }
    sendJson(response, 200, { schemaVersion: 'evidence-private.v1', ...serializePrivateEvidence(record) }, { 'X-Trace-Id': traceId });
    return;
  }

  if (method === 'GET' && requestUrl.pathname.startsWith('/api/stream/')) {
    if (requestUrl.pathname === '/api/stream/map' && parseBbox(requestUrl.searchParams.get('bbox')) === 'invalid') {
      throw Object.assign(new Error('bbox is invalid.'), { status: 422 });
    }
    if (requestUrl.pathname !== '/api/stream/map' && !(
      segments[0] === 'api'
      && segments[1] === 'stream'
      && segments[2] === 'places'
      && segments[3]
      && segments.length === 4
    )) {
      throw Object.assign(new Error('The requested stream scope does not exist.'), { status: 404 });
    }
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-store');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Trace-Id', traceId);
    response.write(`event: ready\ndata: ${JSON.stringify({ schemaVersion: 'stream.v1', traceId })}\n\n`);
    const unsubscribe = eventHub.subscribe(response, requestUrl.pathname);
    request.on('close', unsubscribe);
    return;
  }

  sendJson(response, 404, problem(404, 'Resource not found', 'The requested API resource does not exist.', traceId, 'https://accessmap.example/problems/not-found'), { 'X-Trace-Id': traceId });
}

export class EventHub {
  constructor() {
    this.subscribers = new Map();
    this.nextId = 1;
  }

  subscribe(response, topic) {
    const id = this.nextId++;
    this.subscribers.set(id, { response, topic });
    return () => this.subscribers.delete(id);
  }

  publish(topic, event, payload) {
    if (!PUBLIC_STREAM_EVENTS.has(event)) return false;
    if (['barrier.created', 'barrier.updated', 'barrier.resolved', 'incident.created', 'incident.updated', 'incident.resolved'].includes(event)
      && !['published', 'disputed', 'resolved', 'archived'].includes(payload?.status)) return false;
    const publicPayload = publicEventPayload({ ...(payload ?? {}), eventType: event });
    const body = `id: ${event}\nevent: ${event}\ndata: ${JSON.stringify(publicPayload)}\n\n`;
    for (const [id, subscriber] of this.subscribers) {
      if (subscriber.topic !== topic && subscriber.topic !== '/api/stream/map') continue;
      try {
        subscriber.response.write(body);
      } catch {
        this.subscribers.delete(id);
      }
    }
    return true;
  }

  publishEvent(event) {
    const eventType = event?.eventType ?? event?.event_type ?? event?.type;
    const payload = event?.payload ?? event?.data ?? event ?? {};
    const placeId = payload.placeId ?? payload.place_id ?? event?.placeId ?? null;
    const topic = placeId ? `/api/stream/places/${placeId}` : '/api/stream/map';
    return this.publish(topic, eventType, payload);
  }
}

function publicEventPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const allowed = [
    'placeId',
    'incidentId',
    'accessNodeId',
    'accessEdgeId',
    'featureId',
    'type',
    'severity',
    'source',
    'startsAt',
    'reviewAt',
    'expectedExpiryAt',
    'resolvedAt',
    'routeId',
    'featureCode',
    'claimsVersion',
    'graphVersion',
    'occurredAt',
    'status'
  ];
  const result = Object.fromEntries(allowed.filter((key) => payload[key] !== undefined)
    .map((key) => [key, payload[key]]));
  if (payload.incident && typeof payload.incident === 'object'
    && ['published', 'disputed', 'resolved', 'archived'].includes(payload.incident.status)) {
    result.incident = {
      id: payload.incident.id ?? payload.incident.incidentId,
      placeId: payload.incident.placeId ?? payload.incident.place_id ?? null,
      accessNodeId: payload.incident.accessNodeId ?? payload.incident.access_node_id ?? null,
      accessEdgeId: payload.incident.accessEdgeId ?? payload.incident.access_edge_id ?? null,
      type: payload.incident.type ?? payload.incident.incidentType ?? null,
      severity: payload.incident.severity ?? null,
      source: typeof payload.incident.source === 'string' ? payload.incident.source : null,
      startsAt: payload.incident.startsAt ?? payload.incident.starts_at ?? null,
      reviewAt: payload.incident.reviewAt ?? payload.incident.review_at ?? null,
      status: payload.incident.status ?? null,
      explanation: payload.incident.explanation ?? payload.incident.description ?? null,
      resolvedAt: payload.incident.resolvedAt ?? payload.incident.resolved_at ?? null
    };
  }
  if (payload.routeInvalidation && typeof payload.routeInvalidation === 'object') {
    result.routeInvalidation = Object.fromEntries([
      'schemaVersion', 'reason', 'occurredAt', 'incidentId', 'scopes',
      'affectedPlaceId', 'affectedAccessNodeId', 'affectedAccessEdgeId'
    ].filter((key) => payload.routeInvalidation[key] !== undefined)
      .map((key) => [key, payload.routeInvalidation[key]]));
  }
  return result;
}

export function createApiServer({
  version = APPLICATION_VERSION,
  pool = createDatabasePool(),
  repository = pool ? new SqlRepository(pool) : null,
  observationRepository = pool ? new ObservationRepository(pool) : null,
  evidenceRepository = pool ? new EvidenceRepository(pool) : null,
  evidenceStorage = null,
  evidenceUploadService = evidenceStorage && evidenceRepository
    ? createEvidenceUploadService({
        storage: evidenceStorage,
        evidenceStore: evidenceRepository,
        maxBytes: Number(process.env.EVIDENCE_MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),
        uploadTtlMs: Number(process.env.EVIDENCE_UPLOAD_TTL_MS ?? 15 * 60 * 1_000)
      })
    : null,
  evidencePublicUrl = null,
  cache = new MemoryCache(),
  limiter = new FixedWindowRateLimiter(),
  authSecret = process.env.AUTH_SECRET,
  eventHub = new EventHub(),
  routingEngine = null,
  routingService = null,
  incidentService = null,
  facilityService = null,
  facilityHandlers = null,
  civicHandlers = null,
  webhookHandlers = null,
  outboxEventSource = null
} = {}) {
  const routeService = routingService ?? (repository
    ? createRoutingService({
        routingEngine: routingEngine ?? createLocalRoutingEngine(),
        accessGraphRepository: repository,
        incidentRepository: repository,
        versionPort: repository,
        cache,
        clock: () => Date.now()
      })
    : null);
  const lifecycleService = incidentService ?? (repository
    ? createIncidentService({
        repository,
        routeInvalidationPort: routeService,
        eventPort: { publish: (eventType, payload) => eventHub.publishEvent({ eventType, payload }) }
      })
    : null);
  const qrSecret = process.env.QR_SIGNING_SECRET ?? authSecret;
  const qrService = repository && qrSecret
    ? {
        create: (input) => createQrContext(input, { secret: qrSecret }),
        validate: (token, options = {}) => validateQrContext(token, {
          secret: qrSecret,
          contextPort: repository,
          revocationPort: repository,
          ...options
        })
      }
    : null;
  const operationsService = facilityService ?? (repository
    ? createFacilityService({
        repository,
        authorizationPort: {
          requireRole,
          hasRole,
          requireFacilityScope,
          hasFacilityScope,
          requireApprovedFacilityScope: async (candidateSession, placeId) => {
            const user = requireRole(candidateSession, ['facility_manager', 'moderator', 'admin']);
            if (['moderator', 'admin'].includes(candidateSession.user.role)) return user;
            const claim = await repository.findApprovedClaim(placeId, candidateSession.user.id);
            return claim ? user : false;
          }
        },
        qrService,
        routeInvalidationPort: routeService,
        eventPort: { publish: (eventType, payload) => eventHub.publishEvent({ eventType, payload }) }
      })
    : null);
  const operationsHandlers = facilityHandlers ?? (operationsService ? createFacilityHandlers({ service: operationsService }) : null);
  const publicCivicHandlers = civicHandlers ?? (repository
    ? createCivicHandlers({
        service: createCivicService({ repository, rateLimitPort: createCivicRateLimitPort(limiter) })
      })
    : null);
  const publicWebhookHandlers = webhookHandlers ?? (repository
    ? createWebhookHandlers({
        service: createWebhookService({
          subscriptionStore: repository,
          deliveryStore: repository,
          authorizationPort: { requireRole, hasRole },
          secretStore: {
            storeSecret: (input) => repository.storeWebhookSecret(input),
            getSecret: (id) => repository.getWebhookSecret(id)
          }
        })
      })
    : null);
  const publicEvidenceUrl = evidencePublicUrl ?? (evidenceStorage && typeof evidenceStorage.getPublicUrl === 'function'
    ? (record) => evidenceStorage.getPublicUrl(record)
    : null);
  const outboxUnsubscribe = outboxEventSource && typeof outboxEventSource.subscribe === 'function'
    ? outboxEventSource.subscribe((event) => eventHub.publishEvent(event))
    : null;
  const server = createServer(async (request, response) => {
    applySecurityHeaders(response, { https: process.env.NODE_ENV === 'production' });
    try {
      await handleRequest(request, response, {
        version,
        pool,
        repository,
        observationRepository,
          evidenceRepository,
          evidenceUploadService,
          evidencePublicUrl: publicEvidenceUrl,
        cache,
        limiter,
        authSecret,
          eventHub,
          routingService: routeService,
          incidentService: lifecycleService,
          facilityHandlers: operationsHandlers,
          facilityService: operationsService,
          civicHandlers: publicCivicHandlers,
          webhookHandlers: publicWebhookHandlers,
          qrService,
          evidenceStorage
        });
    } catch (error) {
      const traceId = request.headers['x-trace-id'] ?? randomUUID();
      const result = errorResponse(error, traceId);
      sendJson(response, result.status, result.body, {
        'X-Trace-Id': traceId,
        ...(error.headers ?? {})
      });
    }
  });
  if (typeof outboxUnsubscribe === 'function') server.once('close', () => outboxUnsubscribe());
  return server;
}

export async function startApiServer({
  host = process.env.API_HOST ?? DEFAULT_HOST,
  port = Number(process.env.API_PORT ?? DEFAULT_PORT),
  cache,
  version,
  ...options
} = {}) {
  const server = createApiServer({
    version,
    cache: cache ?? await createCache(),
    ...options
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve({ server, host, port: server.address().port });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { host, port } = await startApiServer();
  process.stdout.write(`AccessMap API listening at http://${host}:${port}\n`);
}
