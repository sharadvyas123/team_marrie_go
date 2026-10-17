import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { FacilityError, facilityValidationError } from './errors.mjs';

export const QR_CONTEXT_TYPES = Object.freeze(['facility', 'entrance', 'lift', 'toilet', 'stop', 'feature']);
const TOKEN_PREFIX = 'accessmap-qr-v1';

export function createQrContext(input, {
  secret,
  secretProvider,
  clock = () => Date.now(),
  idFactory = randomUUID,
  ttlMs = 30 * 24 * 60 * 60 * 1_000
} = {}) {
  const key = resolveSecret(secret, secretProvider);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 366 * 24 * 60 * 60 * 1_000) {
    throw new RangeError('ttlMs must be between 1 millisecond and one year.');
  }
  const context = normalizeQrContext(input);
  const issuedAt = Math.floor(clock() / 1_000);
  const payload = {
    version: 1,
    type: TOKEN_PREFIX,
    jti: normalizeId(idFactory(), 'jti'),
    facilityId: context.facilityId,
    placeId: context.placeId,
    contextType: context.contextType,
    ...(context.contextId ? { contextId: context.contextId } : {}),
    ...(context.featureCode ? { featureCode: context.featureCode } : {}),
    iat: issuedAt,
    exp: issuedAt + Math.ceil(ttlMs / 1_000)
  };
  const encoded = encode(payload);
  const signature = sign(encoded, key);
  return {
    token: `${TOKEN_PREFIX}.${encoded}.${signature}`,
    jti: payload.jti,
    expiresAt: new Date(payload.exp * 1_000).toISOString(),
    context: { ...context },
    payload: { ...payload }
  };
}

export async function validateQrContext(token, {
  secret,
  secretProvider,
  clock = () => Date.now(),
  revocationPort,
  contextPort,
  allowExpired = false
} = {}) {
  const key = await resolveSecretAsync(secret, secretProvider);
  const payload = parseAndVerify(token, key);
  const now = Math.floor(clock() / 1_000);
  if (!allowExpired && payload.exp <= now) throw qrError('QR_CONTEXT_EXPIRED', 'This QR context has expired.', 410);
  if (payload.iat > now + 60) throw qrError('QR_CONTEXT_NOT_YET_VALID', 'This QR context is not valid yet.', 400);
  if (revocationPort) {
    const revoked = await checkRevocation(revocationPort, payload);
    if (revoked) throw qrError('QR_CONTEXT_REVOKED', 'This QR context has been revoked.', 410);
  }
  if (contextPort) {
    const resolved = await resolveContext(contextPort, payload);
    if (!resolved) throw qrError('QR_CONTEXT_NOT_FOUND', 'The QR context no longer identifies a public facility resource.', 404);
    if (resolved.facilityId && resolved.facilityId !== payload.facilityId) {
      throw qrError('QR_CONTEXT_SCOPE_MISMATCH', 'The QR context does not match its facility.', 409);
    }
    if (resolved.placeId && resolved.placeId !== payload.placeId) {
      throw qrError('QR_CONTEXT_SCOPE_MISMATCH', 'The QR context does not match its place.', 409);
    }
    if (resolved.private === true || resolved.public === false || resolved.visibility === 'private') {
      throw qrError('QR_CONTEXT_PRIVATE', 'Private resources cannot be selected by a public QR context.', 403);
    }
  }
  return {
    valid: true,
    token,
    jti: payload.jti,
    expiresAt: new Date(payload.exp * 1_000).toISOString(),
    context: contextFromPayload(payload),
    payload: { ...payload }
  };
}

export function revokeQrContext(jti, revocationPort, { expiresAt } = {}) {
  if (!revocationPort || typeof revocationPort.revoke !== 'function') throw new TypeError('revocationPort.revoke is required.');
  return revocationPort.revoke(normalizeId(jti, 'jti'), { expiresAt });
}

export function parseQrContext(token) {
  const parts = splitToken(token);
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw qrError('QR_CONTEXT_INVALID', 'The QR context payload is invalid.', 400); }
}

function normalizeQrContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw facilityValidationError('QR_CONTEXT_INPUT_INVALID', 'QR context must be an object.', 'context');
  const facilityId = normalizeId(input.facilityId ?? input.facility_id, 'facilityId');
  const placeId = normalizeId(input.placeId ?? input.place_id ?? facilityId, 'placeId');
  const contextType = enumValue(input.contextType ?? input.context_type ?? 'facility', QR_CONTEXT_TYPES, 'contextType');
  const contextId = input.contextId ?? input.context_id;
  const featureCode = input.featureCode ?? input.feature_code;
  if (contextType !== 'facility' && !contextId && !featureCode) {
    throw facilityValidationError('QR_CONTEXT_TARGET_REQUIRED', 'A non-facility QR context needs contextId or featureCode.', 'contextId');
  }
  if (contextId !== undefined && contextId !== null) normalizeId(contextId, 'contextId');
  if (featureCode !== undefined && featureCode !== null) normalizeId(featureCode, 'featureCode');
  return {
    facilityId,
    placeId,
    contextType,
    ...(contextId ? { contextId: normalizeId(contextId, 'contextId') } : {}),
    ...(featureCode ? { featureCode: normalizeId(featureCode, 'featureCode') } : {})
  };
}

function parseAndVerify(token, key) {
  const parts = splitToken(token);
  const expected = sign(parts[1], key);
  const provided = Buffer.from(parts[2]);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
    throw qrError('QR_CONTEXT_SIGNATURE_INVALID', 'The QR context signature is invalid.', 400);
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw qrError('QR_CONTEXT_INVALID', 'The QR context payload is invalid.', 400); }
  const normalized = normalizeQrContext(payload);
  if (payload.type !== TOKEN_PREFIX || payload.version !== 1 || !payload.jti || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.exp <= payload.iat) {
    throw qrError('QR_CONTEXT_INVALID', 'The QR context payload is invalid.', 400);
  }
  return { ...payload, ...normalized };
}

function splitToken(token) {
  if (typeof token !== 'string') throw qrError('QR_CONTEXT_INVALID', 'A QR context token is required.', 400);
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX || !parts[1] || !parts[2]) throw qrError('QR_CONTEXT_INVALID', 'The QR context token is invalid.', 400);
  return parts;
}

async function resolveContext(port, payload) {
  const method = ['resolveContext', 'getContext', 'findContext', 'validateContext'].find((name) => typeof port[name] === 'function');
  if (!method) throw new TypeError('contextPort needs resolveContext, getContext, findContext, or validateContext.');
  return port[method]({ ...contextFromPayload(payload), jti: payload.jti }, payload);
}

async function checkRevocation(port, payload) {
  const method = ['isRevoked', 'hasRevoked', 'contains'].find((name) => typeof port[name] === 'function');
  if (!method) throw new TypeError('revocationPort needs isRevoked, hasRevoked, or contains.');
  return Boolean(await port[method](payload.jti, payload));
}

function contextFromPayload(payload) {
  return {
    facilityId: payload.facilityId,
    placeId: payload.placeId,
    contextType: payload.contextType,
    ...(payload.contextId ? { contextId: payload.contextId } : {}),
    ...(payload.featureCode ? { featureCode: payload.featureCode } : {})
  };
}

function resolveSecret(secret, provider) {
  if (typeof secret === 'string' || Buffer.isBuffer(secret)) return secret;
  if (typeof provider === 'function') {
    const value = provider();
    if (value && typeof value.then === 'function') throw new TypeError('Use validateQrContext with an async secretProvider.');
    return resolveSecret(value);
  }
  throw new TypeError('A QR signing secret is required.');
}

async function resolveSecretAsync(secret, provider) {
  if (typeof secret === 'string' || Buffer.isBuffer(secret)) return secret;
  if (typeof provider === 'function') return resolveSecret(await provider());
  throw new TypeError('A QR signing secret is required.');
}

function sign(value, key) { return createHmac('sha256', key).update(value).digest('base64url'); }
function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function normalizeId(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 160) throw facilityValidationError('QR_CONTEXT_IDENTIFIER_INVALID', `${field} must be a non-empty string.`, field);
  return value.trim();
}
function enumValue(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.includes(value.trim().toLowerCase())) throw facilityValidationError('QR_CONTEXT_VALUE_INVALID', `${field} must be one of: ${allowed.join(', ')}.`, field);
  return value.trim().toLowerCase();
}
function qrError(code, detail, status) { return new FacilityError(code, detail, { status, title: 'QR context invalid' }); }
