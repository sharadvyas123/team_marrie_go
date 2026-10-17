const PUBLIC_APPROVED_STATES = new Set(['approved']);
const ALT_TEXT_MAX_LENGTH = 500;

function safeAltText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= ALT_TEXT_MAX_LENGTH ? text : null;
}

function flags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((flag) => typeof flag === 'string')
    .map((flag) => flag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function canExposePublicDerivative(record) {
  return Boolean(
    record
    && PUBLIC_APPROVED_STATES.has(record.state)
    && record.privacyProcessed === true
    && record.moderationStatus === 'approved'
    && record.publicDerivative
    && typeof record.publicDerivative.publicKey === 'string'
    && record.publicDerivative.publicKey.length > 0
  );
}

/**
 * Serialize an authorized contributor/moderator view without returning raw
 * original or derivative storage keys.
 */
export function serializePrivateEvidence(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    id: record.id,
    observationId: record.observationId,
    mediaType: record.mediaType,
    state: record.state,
    moderationStatus: record.moderationStatus ?? 'pending',
    original: {
      visibility: 'private',
      available: Boolean(record.storageKey)
    },
    publicDerivative: {
      available: canExposePublicDerivative(record),
      altText: safeAltText(record.altText),
      altTextStatus: record.altTextStatus ?? (record.altText ? 'available' : 'pending')
    },
    sensitiveFlags: flags(record.sensitiveFlags),
    failureCode: typeof record.failureCode === 'string' ? record.failureCode : null
  };
}

/**
 * Return a public evidence item only after privacy processing, moderation, and
 * derivative publication have all succeeded. `publicUrl` is supplied by a
 * storage URL adapter; no storage key is ever serialized.
 */
export function serializePublicEvidence(record, { publicUrl = record?.publicDerivative?.publicUrl } = {}) {
  if (!canExposePublicDerivative(record) || typeof publicUrl !== 'string' || publicUrl.length === 0) return null;
  const altText = safeAltText(record.altText);
  return {
    id: record.id,
    mediaType: record.mediaType,
    url: publicUrl,
    altText,
    altTextStatus: record.altTextStatus ?? (altText ? 'available' : 'pending')
  };
}

export const serializeEvidencePrivate = serializePrivateEvidence;
export const serializeEvidencePublic = serializePublicEvidence;

export function serializeUploadIntent(intent) {
  if (!intent || typeof intent !== 'object') return null;
  return {
    evidenceId: intent.evidenceId,
    uploadUrl: intent.uploadUrl,
    headers: { ...(intent.headers ?? {}) },
    expiresAt: intent.expiresAt,
    mediaType: intent.mediaType,
    maxBytes: intent.maxBytes,
    status: intent.status
  };
}
