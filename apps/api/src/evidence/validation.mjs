import { evidenceValidationError } from './errors.mjs';

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const SUPPORTED_MEDIA_TYPES = Object.freeze({
  'image/jpeg': Object.freeze({ extensions: ['jpg', 'jpeg'], derivativeMediaType: 'image/jpeg' }),
  'image/png': Object.freeze({ extensions: ['png'], derivativeMediaType: 'image/png' }),
  'image/webp': Object.freeze({ extensions: ['webp'], derivativeMediaType: 'image/webp' }),
  'application/pdf': Object.freeze({ extensions: ['pdf'], derivativeMediaType: 'application/pdf' })
});

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw evidenceValidationError('EVIDENCE_FIELD_REQUIRED', `${field} is required.`);
  }
  return value.trim();
}

function normalizeFileName(value) {
  const fileName = nonEmptyString(value, 'fileName');
  if (
    fileName.length > 255
    || fileName.includes('\0')
    || fileName.includes('/')
    || fileName.includes('\\')
    || fileName === '.'
    || fileName === '..'
  ) {
    throw evidenceValidationError('EVIDENCE_FILENAME_INVALID', 'fileName must be a simple file name.');
  }
  return fileName;
}

function normalizeMediaType(value, allowedMediaTypes) {
  const mediaType = nonEmptyString(value, 'mediaType').toLowerCase();
  if (!Object.hasOwn(allowedMediaTypes, mediaType)) {
    throw evidenceValidationError('EVIDENCE_MEDIA_TYPE_UNSUPPORTED', 'This evidence media type is not supported.');
  }
  return mediaType;
}

function normalizeSize(value, maxBytes) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw evidenceValidationError('EVIDENCE_SIZE_INVALID', 'sizeBytes must be a positive integer.');
  }
  if (value > maxBytes) {
    throw evidenceValidationError('EVIDENCE_SIZE_LIMIT_EXCEEDED', 'The evidence file is too large.', {
      status: 413
    });
  }
  return value;
}

function normalizeChecksum(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value.trim())) {
    throw evidenceValidationError('EVIDENCE_CHECKSUM_INVALID', 'checksumSha256 must be a SHA-256 hexadecimal digest.');
  }
  return value.trim().toLowerCase();
}

function validateExtension(fileName, mediaType, allowedMediaTypes) {
  const extension = fileName.toLowerCase().split('.').pop();
  if (!extension || !allowedMediaTypes[mediaType].extensions.includes(extension)) {
    throw evidenceValidationError('EVIDENCE_EXTENSION_MISMATCH', 'fileName does not match mediaType.');
  }
}

/**
 * Validate client-supplied upload metadata before an upload URL is issued.
 * Storage keys, public keys, and moderation fields are intentionally ignored
 * rather than accepted from the caller.
 */
export function validateUploadMetadata(
  input,
  { maxBytes = DEFAULT_MAX_UPLOAD_BYTES, allowedMediaTypes = SUPPORTED_MEDIA_TYPES } = {}
) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw evidenceValidationError('EVIDENCE_METADATA_INVALID', 'Upload metadata must be an object.');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('maxBytes must be a positive safe integer');
  }

  const fileName = normalizeFileName(input.fileName ?? input.filename ?? input.name);
  const mediaType = normalizeMediaType(input.mediaType ?? input.contentType ?? input.mimeType, allowedMediaTypes);
  const sizeBytes = normalizeSize(input.sizeBytes ?? input.size, maxBytes);
  validateExtension(fileName, mediaType, allowedMediaTypes);

  return Object.freeze({
    fileName,
    mediaType,
    sizeBytes,
    checksumSha256: normalizeChecksum(input.checksumSha256 ?? input.checksum),
    maxBytes
  });
}

export function mediaTypeDefinition(mediaType, allowedMediaTypes = SUPPORTED_MEDIA_TYPES) {
  const normalized = normalizeMediaType(mediaType, allowedMediaTypes);
  return allowedMediaTypes[normalized];
}
