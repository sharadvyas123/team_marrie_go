import { randomUUID } from 'node:crypto';
import { EvidenceError, evidenceValidationError } from './errors.mjs';
import { validateUploadMetadata } from './validation.mjs';

function requireAdapter(adapter, name, methods) {
  if (!adapter || typeof adapter !== 'object' || methods.some((method) => typeof adapter[method] !== 'function')) {
    throw new TypeError(`${name} must implement ${methods.join(', ')}`);
  }
}

function normalizeSubject(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200) {
    throw evidenceValidationError('EVIDENCE_SUBJECT_INVALID', `${field} is required.`);
  }
  return value.trim();
}

function safeUploadIntent({ evidenceId, uploadUrl, headers, expiresAt, metadata }) {
  return Object.freeze({
    evidenceId,
    uploadUrl,
    headers: { ...headers },
    expiresAt,
    mediaType: metadata.mediaType,
    maxBytes: metadata.maxBytes,
    status: 'awaiting_upload'
  });
}

/**
 * Issue a short-lived upload intent for a private original.
 *
 * `storage.createPrivateUpload` receives the private storage key internally,
 * while the returned object deliberately contains only an upload URL and
 * upload constraints. `evidenceStore.createIntent` is the persistence port.
 */
export async function createUploadIntent(
  { observationId, ownerId, metadata, role = 'user' },
  {
    storage,
    evidenceStore,
    clock = () => Date.now(),
    idFactory = randomUUID,
    uploadTtlMs = 15 * 60 * 1_000,
    maxBytes,
    allowedMediaTypes
  } = {}
) {
  requireAdapter(storage, 'storage', ['createPrivateUpload']);
  requireAdapter(evidenceStore, 'evidenceStore', ['createIntent']);
  const normalizedObservationId = normalizeSubject(observationId, 'observationId');
  const normalizedOwnerId = normalizeSubject(ownerId, 'ownerId');
  if (!Number.isSafeInteger(uploadTtlMs) || uploadTtlMs < 1) {
    throw new RangeError('uploadTtlMs must be a positive safe integer');
  }
  const validated = validateUploadMetadata(metadata, { maxBytes, allowedMediaTypes });
  const evidenceId = normalizeSubject(idFactory(), 'evidenceId');
  const expiresAt = new Date(clock() + uploadTtlMs).toISOString();

  const privateUpload = await storage.createPrivateUpload({
    evidenceId,
    observationId: normalizedObservationId,
    ownerId: normalizedOwnerId,
    fileName: validated.fileName,
    mediaType: validated.mediaType,
    sizeBytes: validated.sizeBytes,
    checksumSha256: validated.checksumSha256,
    expiresAt,
    visibility: 'private'
  });
  if (
    !privateUpload
    || typeof privateUpload.uploadUrl !== 'string'
    || privateUpload.uploadUrl.trim().length === 0
    || typeof privateUpload.storageKey !== 'string'
    || privateUpload.storageKey.trim().length === 0
  ) {
    throw new EvidenceError({
      code: 'EVIDENCE_STORAGE_INTENT_FAILED',
      status: 503,
      title: 'Evidence storage unavailable',
      detail: 'A private upload intent could not be created.'
    });
  }

  await evidenceStore.createIntent({
    id: evidenceId,
    observationId: normalizedObservationId,
    ownerId: normalizedOwnerId,
    storageKey: privateUpload.storageKey,
    fileName: validated.fileName,
    mediaType: validated.mediaType,
    sizeBytes: validated.sizeBytes,
    checksumSha256: validated.checksumSha256,
    role,
    state: 'awaiting_upload',
    uploadExpiresAt: privateUpload.expiresAt ?? expiresAt,
    moderationStatus: 'pending'
  });

  return safeUploadIntent({
    evidenceId,
    uploadUrl: privateUpload.uploadUrl,
    headers: privateUpload.headers ?? {},
    expiresAt: privateUpload.expiresAt ?? expiresAt,
    metadata: validated
  });
}

export function createEvidenceUploadService(dependencies) {
  return {
    createUploadIntent: (input) => createUploadIntent(input, dependencies)
  };
}
