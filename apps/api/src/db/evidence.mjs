import { withDatabase, withTransaction } from './pool.mjs';

const PATCH_COLUMNS = Object.freeze({
  fileName: 'file_name',
  sizeBytes: 'size_bytes',
  checksumSha256: 'checksum_sha256',
  uploadExpiresAt: 'upload_expires_at',
  uploadedAt: 'uploaded_at',
  processingStartedAt: 'processing_started_at',
  privacyProcessed: 'privacy_processed',
  privacyProcessedAt: 'privacy_processed_at',
  metadataRemoved: 'metadata_removed',
  privateDerivativeKey: 'private_derivative_key',
  derivativeMediaType: 'derivative_media_type',
  sensitiveFlags: 'sensitive_flags',
  holdReason: 'hold_reason',
  altText: 'alt_text',
  altTextStatus: 'alt_text_status',
  publicAvailable: 'public_available',
  publicKey: 'public_key',
  failureCode: 'failure_code',
  retryCount: 'retry_count',
  failedAt: 'failed_at',
  approvedAt: 'approved_at',
  cleanedAt: 'cleaned_at',
  processingVersion: 'processing_version',
  moderationStatus: 'moderation_status'
});

const MIME_TO_MEDIA_TYPE = Object.freeze({
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'application/pdf': 'document'
});

function mapEvidence(row) {
  if (!row) return null;
  return {
    id: row.id,
    observationId: row.observation_id,
    ownerId: row.owner_id ?? null,
    storageKey: row.storage_key,
    fileName: row.file_name ?? null,
    mediaType: row.media_type,
    contentMediaType: row.content_media_type ?? null,
    sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    checksumSha256: row.checksum_sha256 ?? null,
    uploadExpiresAt: row.upload_expires_at ?? null,
    uploadedAt: row.uploaded_at ?? null,
    processingStartedAt: row.processing_started_at ?? null,
    state: row.state,
    moderationStatus: row.moderation_status,
    privacyProcessed: Boolean(row.privacy_processed),
    privacyProcessedAt: row.privacy_processed_at ?? null,
    metadataRemoved: Boolean(row.metadata_removed),
    privateDerivativeKey: row.private_derivative_key ?? null,
    derivativeMediaType: row.derivative_media_type ?? null,
    sensitiveFlags: Array.isArray(row.sensitive_flags) ? row.sensitive_flags : [],
    holdReason: row.hold_reason ?? null,
    altText: row.alt_text ?? null,
    altTextStatus: row.alt_text_status ?? 'pending',
    publicAvailable: Boolean(row.public_available),
    publicKey: row.public_key ?? null,
    publicDerivative: row.public_key ? { publicKey: row.public_key } : null,
    failureCode: row.failure_code ?? null,
    retryCount: Number(row.retry_count ?? 0),
    failedAt: row.failed_at ?? null,
    approvedAt: row.approved_at ?? null,
    cleanedAt: row.cleaned_at ?? null,
    processingVersion: Number(row.processing_version ?? 1)
  };
}

const SELECT_COLUMNS = `
  e.id, e.observation_id, o.contributor_id AS owner_id, e.storage_key,
  e.file_name, e.media_type, e.content_media_type, e.size_bytes,
  e.checksum_sha256, e.upload_expires_at, e.uploaded_at,
  e.processing_started_at, e.state, e.moderation_status,
  e.privacy_processed, e.privacy_processed_at, e.metadata_removed,
  e.private_derivative_key, e.derivative_media_type, e.sensitive_flags,
  e.hold_reason, e.public_key, e.alt_text, e.alt_text_status,
  e.public_available, e.failure_code, e.retry_count, e.failed_at,
  e.approved_at, e.cleaned_at, e.processing_version`;

function patchValue(column, value) {
  if (column === 'sensitive_flags') return JSON.stringify(Array.isArray(value) ? value : []);
  return value;
}

export class EvidenceRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async createIntent(input) {
    const mediaType = MIME_TO_MEDIA_TYPE[input.contentMediaType ?? input.mediaType] ?? input.mediaType;
    return withTransaction(this.pool, async (client) => {
      const owner = await client.query(
        `SELECT id FROM observations WHERE id = $1 AND contributor_id = $2`,
        [input.observationId, input.ownerId]
      );
      if (!owner.rows[0]) {
        const error = new Error('The observation is not owned by this account.');
        error.status = 403;
        error.code = 'EVIDENCE_OBSERVATION_NOT_OWNED';
        throw error;
      }
      const inserted = await client.query(
        `INSERT INTO evidence_assets
          (id, observation_id, storage_key, media_type, content_media_type,
           file_name, size_bytes, checksum_sha256, upload_expires_at, state,
            moderation_status, alt_text_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'awaiting_upload', 'pending', 'pending')
         RETURNING id`,
        [
          input.id,
           input.observationId,
           input.storageKey,
           mediaType,
           input.contentMediaType ?? null,
           input.fileName,
           input.sizeBytes,
           input.checksumSha256 ?? null,
           input.uploadExpiresAt
        ]
      );
      const record = await client.query(
        `SELECT ${SELECT_COLUMNS}
           FROM evidence_assets e
           JOIN observations o ON o.id = e.observation_id
          WHERE e.id = $1`,
        [inserted.rows[0].id]
      );
      return mapEvidence(record.rows[0]);
    }, { userId: input.ownerId, role: input.role ?? 'user' });
  }

  async get(id, { viewerId = null, role = 'anonymous' } = {}) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT ${SELECT_COLUMNS}
         FROM evidence_assets e
         JOIN observations o ON o.id = e.observation_id
        WHERE e.id = $1
          AND (
            o.contributor_id = $2
            OR $3 IN ('moderator', 'admin', 'worker')
            OR (
              e.state = 'approved'
              AND e.public_available = true
              AND e.privacy_processed = true
              AND e.moderation_status = 'approved'
              AND e.public_key IS NOT NULL
            )
          )`,
      [id, viewerId, role]
    ), { userId: viewerId, role });
     return mapEvidence(result.rows[0]);
  }

  async listForObservation(observationId, { viewerId = null, role = 'anonymous' } = {}) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT ${SELECT_COLUMNS}
         FROM evidence_assets e
         JOIN observations o ON o.id = e.observation_id
        WHERE e.observation_id = $1
          AND (
            o.contributor_id = $2
            OR $3 IN ('moderator', 'admin', 'worker')
            OR (
              e.state = 'approved'
              AND e.public_available = true
              AND e.privacy_processed = true
              AND e.moderation_status = 'approved'
              AND e.public_key IS NOT NULL
            )
          )
        ORDER BY e.created_at ASC`,
      [observationId, viewerId, role]
    ), { userId: viewerId, role });
    return result.rows.map(mapEvidence);
  }

  async transition(id, { from, to, patch = {} }) {
    const entries = Object.entries(patch).filter(([key]) => Object.hasOwn(PATCH_COLUMNS, key));
    const values = [id, from, to];
    const assignments = ['state = $3', 'updated_at = now()'];
    for (const [key, value] of entries) {
      values.push(patchValue(PATCH_COLUMNS[key], value));
      assignments.push(`${PATCH_COLUMNS[key]} = $${values.length}${PATCH_COLUMNS[key] === 'sensitive_flags' ? '::jsonb' : ''}`);
    }
    const result = await withTransaction(this.pool, async (client) => client.query(
      `UPDATE evidence_assets e
          SET ${assignments.join(', ')}
        FROM observations o
       WHERE e.id = $1
         AND e.state = $2
         AND o.id = e.observation_id
       RETURNING ${SELECT_COLUMNS}`,
      values
    ), { userId: null, role: 'worker' });
    return mapEvidence(result.rows[0]);
  }

  async listAbandoned({ before, states, limit = 100 } = {}) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT ${SELECT_COLUMNS}
         FROM evidence_assets e
         JOIN observations o ON o.id = e.observation_id
        WHERE e.state = ANY($1::text[])
          AND COALESCE(e.upload_expires_at, e.created_at) < $2
        ORDER BY e.created_at ASC
        LIMIT $3`,
      [states, before, limit]
    ), { role: 'worker' });
    return result.rows.map(mapEvidence);
  }

  async markEvidenceFailure({ evidenceId, status = 'failed', code }) {
    return withTransaction(this.pool, async (client) => {
      const moderationStatus = status === 'rejected' ? 'rejected' : 'pending';
      const result = await client.query(
        `UPDATE evidence_assets e
            SET failure_code = $2,
                moderation_status = $3,
                updated_at = now()
          FROM observations o
          WHERE e.id = $1
            AND o.id = e.observation_id
          RETURNING ${SELECT_COLUMNS}`,
        [evidenceId, code, moderationStatus]
      );
      return mapEvidence(result.rows[0]);
    }, { role: 'worker' });
  }
}

export function createEvidenceRepository(pool) {
  return new EvidenceRepository(pool);
}

export { mapEvidence, MIME_TO_MEDIA_TYPE };
