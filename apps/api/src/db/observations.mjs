import { withDatabase, withTransaction } from './pool.mjs';

function mapObservation(row) {
  return {
    id: row.id,
    placeId: row.place_id,
    featureCode: row.feature_code,
    value: row.value,
    details: row.details ?? null,
    measuredValue: row.measured_value ?? null,
    observedAt: row.observed_at,
    submittedAt: row.submitted_at,
    status: row.moderation_status,
    visibility: row.visibility,
    clientRequestId: row.client_request_id ?? null,
    sampleData: Boolean(row.is_sample),
    evidence: Array.isArray(row.evidence) ? row.evidence.map(mapPrivateEvidence) : [],
    amendments: Array.isArray(row.amendments) ? row.amendments.map(mapAmendment) : []
  };
}

function mapPrivateEvidence(row) {
  return {
    id: row.id,
    storageKey: row.storage_key,
    publicKey: row.public_key ?? null,
    mediaType: row.media_type,
    contentMediaType: row.content_media_type ?? null,
    state: row.state ?? null,
    moderationStatus: row.moderation_status,
    altText: row.alt_text ?? null,
    altTextStatus: row.alt_text_status ?? 'pending',
    privacyProcessed: row.privacy_processed ?? null,
    publicAvailable: row.public_available ?? null,
    sensitiveFlags: Array.isArray(row.sensitive_flags) ? row.sensitive_flags : []
  };
}

function mapPublicEvidence(row) {
  return {
    id: row.id,
    mediaType: row.media_type,
    altText: row.alt_text
  };
}

function mapAmendment(row) {
  return {
    id: row.id,
    previousDetails: row.previous_details ?? null,
    previousMeasuredValue: row.previous_measured_value ?? null,
    details: row.details ?? null,
    measuredValue: row.measured_value ?? null,
    createdAt: row.created_at
  };
}

export function publicObservation(row) {
  return {
    id: row.id,
    placeId: row.place_id ?? row.placeId,
    featureCode: row.feature_code ?? row.featureCode,
    value: row.value,
    details: row.details ?? null,
    measuredValue: row.measured_value ?? row.measuredValue ?? null,
    observedAt: row.observed_at ?? row.observedAt,
    status: 'approved',
    sampleData: Boolean(row.is_sample ?? row.sampleData),
    evidence: Array.isArray(row.evidence)
      ? row.evidence
        .filter((evidence) => evidence.moderation_status === 'approved'
          && evidence.public_key
          && (evidence.state === undefined || evidence.state === 'approved')
          && (evidence.privacy_processed === undefined || evidence.privacy_processed === true)
          && (evidence.public_available === undefined || evidence.public_available === true))
        .map(mapPublicEvidence)
      : []
  };
}

export function privateObservation(row) {
  return mapObservation(row);
}

function mapModerationItem(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    reason: row.reason,
    priority: row.priority,
    status: row.status,
    assignedTo: row.assigned_to ?? null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
    resolution: row.resolution ?? null,
    observation: row.place_id
      ? {
          placeId: row.place_id,
          featureCode: row.feature_code,
          value: row.value,
          details: row.details ?? null,
          observedAt: row.observed_at,
          status: row.moderation_status,
          visibility: row.visibility
        }
      : null,
    evidence: row.entity_type === 'evidence' && row.evidence_id
      ? {
          id: row.evidence_id,
          storageKey: row.storage_key,
          publicKey: row.public_key ?? null,
          mediaType: row.media_type,
          moderationStatus: row.evidence_moderation_status,
          altText: row.alt_text ?? null
        }
      : null
  };
}

export class ObservationRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findByClientRequestId(userId, clientRequestId) {
    if (!clientRequestId) return null;
    return withDatabase(this.pool, async (client) => {
      const result = await client.query(
        `SELECT o.id, o.place_id, f.code AS feature_code, o.value, o.details,
                o.measured_value, o.observed_at, o.submitted_at, o.moderation_status,
                o.visibility, o.client_request_id, o.is_sample
           FROM observations o
           JOIN accessibility_features f ON f.id = o.feature_id
          WHERE o.contributor_id = $1 AND o.client_request_id = $2`,
        [userId, clientRequestId]
      );
      if (!result.rows[0]) return null;
      const evidence = await client.query(
        `SELECT id, storage_key, public_key, media_type, content_media_type, state,
                moderation_status, alt_text, alt_text_status, privacy_processed,
                public_available, sensitive_flags
           FROM evidence_assets WHERE observation_id = $1 ORDER BY created_at ASC`,
        [result.rows[0].id]
      );
      return mapObservation({ ...result.rows[0], evidence: evidence.rows });
    }, { userId, role: 'user' });
  }

  async createObservation(userId, input) {
    return withTransaction(this.pool, async (client) => {
      const feature = await client.query(
        `SELECT id, code FROM accessibility_features WHERE code = $1 AND is_active = true`,
        [input.featureCode]
      );
      if (!feature.rows[0]) {
        const error = new Error('The requested accessibility feature does not exist.');
        error.code = 'FEATURE_NOT_FOUND';
        error.status = 422;
        throw error;
      }
      const place = await client.query(
        `SELECT id FROM places WHERE id = $1 AND status IN ('active', 'temporarily_closed')`,
        [input.placeId]
      );
      if (!place.rows[0]) {
        const error = new Error('The requested place does not exist or is not reportable.');
        error.code = 'PLACE_NOT_FOUND';
        error.status = 404;
        throw error;
      }

      const inserted = await client.query(
        `INSERT INTO observations
          (place_id, feature_id, contributor_id, value, details, measured_value,
           observed_at, source_type, client_request_id, visibility, moderation_status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'community', $8, 'public', 'pending')
          ON CONFLICT (contributor_id, client_request_id) DO NOTHING
          RETURNING id, place_id, feature_id, value, details, measured_value,
                    observed_at, submitted_at, moderation_status, visibility,
                    client_request_id, is_sample`,
        [
          input.placeId,
          feature.rows[0].id,
          userId,
          input.value,
          input.details ?? null,
          input.measuredValue ? JSON.stringify(input.measuredValue) : null,
          input.observedAt,
          input.clientRequestId
        ]
      );
      if (inserted.rows.length === 0) {
        const existing = await client.query(
          `SELECT o.id, o.place_id, f.code AS feature_code, o.value, o.details,
                  o.measured_value, o.observed_at, o.submitted_at, o.moderation_status,
                  o.visibility, o.client_request_id, o.is_sample
             FROM observations o
             JOIN accessibility_features f ON f.id = o.feature_id
            WHERE o.contributor_id = $1 AND o.client_request_id = $2
            FOR SHARE`,
          [userId, input.clientRequestId]
        );
        if (existing.rows[0]) {
          const evidence = await client.query(
            `SELECT id, storage_key, public_key, media_type, content_media_type, state,
                    moderation_status, alt_text, alt_text_status, privacy_processed,
                    public_available, sensitive_flags
               FROM evidence_assets WHERE observation_id = $1 ORDER BY created_at ASC`,
            [existing.rows[0].id]
          );
          return { observation: mapObservation({ ...existing.rows[0], evidence: evidence.rows }), duplicate: true };
        }
        throw new Error('The observation could not be read after an idempotent retry.');
      }
      const row = inserted.rows[0];
      const evidenceRows = [];
      for (const evidence of input.evidence ?? []) {
        const attached = await client.query(
          `SELECT id, storage_key, public_key, media_type, content_media_type, state,
                  moderation_status, alt_text, alt_text_status, privacy_processed,
                  public_available, sensitive_flags
             FROM evidence_assets
            WHERE id = $1 AND observation_id = $2
            FOR UPDATE`,
          [evidence.evidenceId, row.id]
        );
        if (!attached.rows[0]) {
          const error = new Error('Evidence must be uploaded through an owned upload intent before it can be attached.');
          error.status = 422;
          error.code = 'EVIDENCE_NOT_ATTACHED';
          throw error;
        }
        evidenceRows.push(attached.rows[0]);
      }
      await client.query(
        `INSERT INTO moderation_items (entity_type, entity_id, reason, priority)
         VALUES ('observation', $1, $2, $3)`,
        [row.id, input.value === 'unknown' ? 'other' : 'other', 'normal']
      );
      for (const evidence of evidenceRows) {
        await client.query(
          `INSERT INTO moderation_items (entity_type, entity_id, reason, priority)
            SELECT 'evidence', $1, $2, 'normal'
           WHERE NOT EXISTS (
             SELECT 1 FROM moderation_items WHERE entity_type = 'evidence' AND entity_id = $1
           )`,
          [evidence.id, evidence.media_type === 'image' ? 'sensitive_image' : 'other']
        );
      }
      await client.query(
        `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
         VALUES ('observation.submitted', 'observation', $1, $2::jsonb)`,
        [row.id, JSON.stringify({
          observationId: row.id,
          placeId: row.place_id,
          featureCode: input.featureCode,
           value: input.value,
           observedAt: input.observedAt,
           evidenceIds: evidenceRows.map((evidence) => evidence.id)
         })]
      );
      return {
        observation: mapObservation({
          ...row,
          feature_code: input.featureCode,
          evidence: evidenceRows
        }),
        duplicate: false
      };
    }, { userId, role: 'user' });
  }

  async listForUser(userId, { page = 1, pageSize = 20 } = {}) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT o.id, o.place_id, f.code AS feature_code, o.value, o.details,
              o.measured_value, o.observed_at, o.submitted_at, o.moderation_status,
              o.visibility, o.client_request_id, o.is_sample,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', e.id,
                  'storage_key', e.storage_key,
                  'public_key', e.public_key,
                   'media_type', e.media_type,
                   'content_media_type', e.content_media_type,
                   'state', e.state,
                   'moderation_status', e.moderation_status,
                   'alt_text', e.alt_text,
                   'alt_text_status', e.alt_text_status,
                   'privacy_processed', e.privacy_processed,
                   'public_available', e.public_available,
                   'sensitive_flags', e.sensitive_flags
                ) ORDER BY e.created_at)
                FROM evidence_assets e
               WHERE e.observation_id = o.id
              ), '[]'::json) AS evidence,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', a.id,
                  'previous_details', a.previous_details,
                  'previous_measured_value', a.previous_measured_value,
                  'details', a.details,
                  'measured_value', a.measured_value,
                  'created_at', a.created_at
                ) ORDER BY a.created_at)
                FROM observation_amendments a
               WHERE a.observation_id = o.id
              ), '[]'::json) AS amendments
         FROM observations o
         JOIN accessibility_features f ON f.id = o.feature_id
        WHERE o.contributor_id = $1
        ORDER BY o.created_at DESC
        LIMIT $2 OFFSET $3`,
      [userId, pageSize, (page - 1) * pageSize]
    ), { userId, role: 'user' });
    const count = await withDatabase(this.pool, (client) => client.query(
      `SELECT count(*)::integer AS total FROM observations WHERE contributor_id = $1`,
      [userId]
    ), { userId, role: 'user' });
    const total = count.rows[0]?.total ?? 0;
    return {
      items: result.rows.map(mapObservation),
      pagination: { page, pageSize, total, hasNext: page * pageSize < total }
    };
  }

  async getById(observationId, { viewerId = null, role = 'anonymous' } = {}) {
    return withDatabase(this.pool, async (client) => {
      const result = await client.query(
        `SELECT o.id, o.place_id, f.code AS feature_code, o.value, o.details,
                o.measured_value, o.observed_at, o.submitted_at, o.moderation_status,
                o.visibility, o.client_request_id, o.is_sample, o.contributor_id
           FROM observations o
           JOIN accessibility_features f ON f.id = o.feature_id
          WHERE o.id = $1`,
        [observationId]
      );
      if (!result.rows[0]) return null;
      const [evidence, amendments] = await Promise.all([
        client.query(
          `SELECT id, storage_key, public_key, media_type, content_media_type, state,
                  moderation_status, alt_text, alt_text_status, privacy_processed,
                  public_available, sensitive_flags
             FROM evidence_assets
            WHERE observation_id = $1
            ORDER BY created_at ASC`,
          [observationId]
        ),
        client.query(
          `SELECT id, previous_details, previous_measured_value, details, measured_value, created_at
             FROM observation_amendments
            WHERE observation_id = $1
            ORDER BY created_at ASC`,
          [observationId]
        )
      ]);
      return {
        ...result.rows[0],
        evidence: evidence.rows,
        amendments: amendments.rows
      };
    }, { userId: viewerId, role });
  }

  async amendObservation(userId, observationId, { details, measuredValue, detailsProvided, measuredValueProvided }) {
    return withTransaction(this.pool, async (client) => {
      const current = await client.query(
        `SELECT o.id, o.place_id, f.code AS feature_code, o.value, o.details,
                o.measured_value, o.observed_at, o.submitted_at, o.moderation_status,
                o.visibility, o.client_request_id, o.is_sample, o.contributor_id
           FROM observations o
           JOIN accessibility_features f ON f.id = o.feature_id
          WHERE o.id = $1
          FOR UPDATE`,
        [observationId]
      );
      if (!current.rows[0]) {
        const error = new Error('Observation not found.');
        error.status = 404;
        error.code = 'OBSERVATION_NOT_FOUND';
        throw error;
      }
      const row = current.rows[0];
      const nextDetails = detailsProvided ? details : row.details;
      const nextMeasuredValue = measuredValueProvided ? measuredValue : row.measured_value;
      await client.query(
        `INSERT INTO observation_amendments
          (observation_id, author_id, previous_details, previous_measured_value, details, measured_value)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)`,
        [
          observationId,
          userId,
          row.details,
          row.measured_value === null ? null : JSON.stringify(row.measured_value),
          nextDetails,
          nextMeasuredValue === null ? null : JSON.stringify(nextMeasuredValue)
        ]
      );
      const updated = await client.query(
        `UPDATE observations
            SET details = $2,
                measured_value = $3::jsonb
          WHERE id = $1
          RETURNING id, place_id, value, details, measured_value, observed_at,
                    submitted_at, moderation_status, visibility, client_request_id, is_sample`,
        [
          observationId,
          nextDetails,
          nextMeasuredValue === null ? null : JSON.stringify(nextMeasuredValue)
        ]
      );
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'observation.amended', 'observation', $2, $3::jsonb)`,
        [userId, observationId, JSON.stringify({ changedDetails: detailsProvided, changedMeasuredValue: measuredValueProvided })]
      );
      await client.query(
        `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
         VALUES ('observation.amended', 'observation', $1, $2::jsonb)`,
        [observationId, JSON.stringify({
          observationId,
          placeId: row.place_id,
          featureCode: row.feature_code
        })]
      );
      return mapObservation({ ...updated.rows[0], feature_code: row.feature_code });
    }, { userId, role: 'user' });
  }

  async verify(userId, observationId, eventType, comment = null) {
    return withTransaction(this.pool, async (client) => {
      const observation = await client.query(
        `SELECT o.id, o.place_id, o.feature_id, f.code AS feature_code,
                o.contributor_id, o.moderation_status, o.visibility
           FROM observations o
           JOIN accessibility_features f ON f.id = o.feature_id
          WHERE o.id = $1
          FOR SHARE`,
        [observationId]
      );
      if (!observation.rows[0]) {
        const error = new Error('Observation not found.');
        error.status = 404;
        error.code = 'OBSERVATION_NOT_FOUND';
        throw error;
      }
      const target = observation.rows[0];
      if (target.contributor_id === userId) {
        const error = new Error('Contributors cannot verify their own observations.');
        error.code = 'SELF_VERIFICATION';
        error.status = 403;
        throw error;
      }
      if (target.moderation_status !== 'approved' || target.visibility !== 'public') {
        const error = new Error('Only approved public observations can be verified.');
        error.code = 'OBSERVATION_NOT_PUBLIC';
        error.status = 409;
        throw error;
      }
      const insertedVerification = await client.query(
        `INSERT INTO verification_events (observation_id, user_id, event_type, comment)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (observation_id, user_id, event_type) DO NOTHING
          RETURNING id`,
        [observationId, userId, eventType, comment]
      );
      if (insertedVerification.rows.length > 0) {
        await client.query(
          `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
            VALUES ($1, $2, 'observation', $3, $4::jsonb)`,
          [userId, `observation.${eventType}`, observationId, JSON.stringify({ comment: comment ?? null })]
        );
      }
      if (insertedVerification.rows.length > 0) {
        await client.query(
          `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
            VALUES ($1, 'observation', $2, $3::jsonb)`,
          [
            `observation.${eventType}`,
            observationId,
            JSON.stringify({
              observationId,
              placeId: target.place_id,
              featureCode: target.feature_code
            })
          ]
        );
      }
      return {
        observationId,
        placeId: target.place_id,
        featureCode: target.feature_code,
        eventType,
        duplicate: insertedVerification.rows.length === 0
      };
    }, { userId, role: 'user' });
  }

  async moderate({ moderatorId, itemId, action, resolution = null }) {
    const actionMap = {
      approve: { observationStatus: 'approved', itemStatus: 'resolved', event: 'observation.approved' },
      reject: { observationStatus: 'rejected', itemStatus: 'resolved', event: 'observation.rejected' },
      'request-changes': { observationStatus: 'changes_requested', itemStatus: 'resolved', event: 'observation.changes_requested' },
      escalate: { observationStatus: null, itemStatus: 'escalated', event: null }
    };
    const selected = actionMap[action];
    if (!selected) {
      const error = new Error('Unsupported moderation action.');
      error.status = 422;
      error.code = 'INVALID_MODERATION_ACTION';
      throw error;
    }
    return withTransaction(this.pool, async (client) => {
      const item = await client.query(
         `SELECT m.id, m.entity_type, m.entity_id, o.place_id, f.code AS feature_code,
                 e.observation_id AS evidence_observation_id, e.state AS evidence_state,
                 e.privacy_processed AS evidence_privacy_processed,
                 e.public_available AS evidence_public_available
           FROM moderation_items m
           LEFT JOIN observations o ON o.id = m.entity_id AND m.entity_type = 'observation'
           LEFT JOIN accessibility_features f ON f.id = o.feature_id
           LEFT JOIN evidence_assets e ON e.id = m.entity_id AND m.entity_type = 'evidence'
          WHERE m.id = $1
          FOR UPDATE`,
        [itemId]
      );
      if (!item.rows[0]) {
        const error = new Error('Moderation item not found.');
        error.status = 404;
        error.code = 'MODERATION_ITEM_NOT_FOUND';
        throw error;
      }
      const row = item.rows[0];
      await client.query(
        `UPDATE moderation_items
            SET status = $2, resolution = $3, assigned_to = $4,
                resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE NULL END
          WHERE id = $1`,
        [itemId, selected.itemStatus, resolution, moderatorId]
      );
      if (row.entity_type === 'evidence') {
        if (action === 'approve' && !['held', 'privacy_processed', 'approved'].includes(row.evidence_state)) {
          const error = new Error('Evidence must finish privacy processing before moderator approval.');
          error.status = 409;
          error.code = 'EVIDENCE_NOT_PRIVACY_PROCESSED';
          throw error;
        }
        const evidenceStatus = action === 'approve'
          ? 'approved'
          : action === 'reject'
            ? 'rejected'
            : 'pending';
        await client.query(
          `UPDATE evidence_assets
              SET moderation_status = $2
            WHERE id = $1`,
          [row.entity_id, evidenceStatus]
        );
      } else if (selected.observationStatus) {
        await client.query(
          `UPDATE observations SET moderation_status = $2, visibility = CASE WHEN $2 = 'approved' THEN 'public' ELSE visibility END WHERE id = $1`,
          [row.entity_id, selected.observationStatus]
        );
      }
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, $2, 'moderation_item', $3, $4::jsonb)`,
        [moderatorId, `moderation.${action}`, itemId, JSON.stringify({ resolution })]
      );
      const moderationEvent = row.entity_type === 'evidence' ? 'evidence.processed' : selected.event;
      if (moderationEvent) {
        await client.query(
          `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
            VALUES ($1, $2, $3, $4::jsonb)`,
          [moderationEvent, row.entity_type, row.entity_id, JSON.stringify({
             observationId: row.entity_type === 'evidence' ? row.evidence_observation_id : row.entity_id,
             placeId: row.place_id,
             featureCode: row.feature_code,
             entityType: row.entity_type,
             moderationStatus: selected.observationStatus ?? selected.itemStatus
          })]
        );
      }
      return { itemId, action, status: selected.itemStatus };
    }, { userId: moderatorId, role: 'moderator' });
  }

  async listModeration({ status = 'open', page = 1, pageSize = 20, viewerId = null, role = 'moderator' } = {}) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT m.id, m.entity_type, m.entity_id, m.reason, m.priority, m.status,
              m.assigned_to, m.created_at, m.resolved_at, m.resolution,
              o.place_id, f.code AS feature_code, o.value, o.observed_at,
               o.moderation_status, o.visibility,
               e.id AS evidence_id, e.storage_key, e.public_key,
                e.media_type, e.content_media_type, e.state AS evidence_state,
                e.moderation_status AS evidence_moderation_status,
                e.alt_text, e.alt_text_status, e.privacy_processed,
                e.public_available, e.sensitive_flags
         FROM moderation_items m
           LEFT JOIN observations o ON o.id = m.entity_id AND m.entity_type = 'observation'
           LEFT JOIN accessibility_features f ON f.id = o.feature_id
           LEFT JOIN evidence_assets e ON e.id = m.entity_id AND m.entity_type = 'evidence'
        WHERE ($1 = 'all' OR m.status = $1)
        ORDER BY CASE m.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                 m.created_at ASC
        LIMIT $2 OFFSET $3`,
      [status, pageSize, (page - 1) * pageSize]
    ), { userId: viewerId, role });
    const count = await withDatabase(this.pool, (client) => client.query(
      `SELECT count(*)::integer AS total FROM moderation_items WHERE ($1 = 'all' OR status = $1)`,
      [status]
    ), { userId: viewerId, role });
    return {
      items: result.rows.map(mapModerationItem),
      pagination: {
        page,
        pageSize,
        total: Number(count.rows[0]?.total ?? 0),
        hasNext: page * pageSize < Number(count.rows[0]?.total ?? 0)
      }
    };
  }

  async getModerationItem(itemId, { viewerId = null, role = 'moderator' } = {}) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT m.id, m.entity_type, m.entity_id, m.reason, m.priority, m.status,
              m.assigned_to, m.created_at, m.resolved_at, m.resolution,
          o.place_id, f.code AS feature_code, o.value, o.details,
               o.observed_at, o.moderation_status, o.visibility,
               e.id AS evidence_id, e.storage_key, e.public_key,
                e.media_type, e.content_media_type, e.state AS evidence_state,
                e.moderation_status AS evidence_moderation_status,
                e.alt_text, e.alt_text_status, e.privacy_processed,
                e.public_available, e.sensitive_flags
          FROM moderation_items m
          LEFT JOIN observations o ON o.id = m.entity_id AND m.entity_type = 'observation'
          LEFT JOIN accessibility_features f ON f.id = o.feature_id
          LEFT JOIN evidence_assets e ON e.id = m.entity_id AND m.entity_type = 'evidence'
         WHERE m.id = $1`,
      [itemId]
    ), { userId: viewerId, role });
    return result.rows[0] ? mapModerationItem(result.rows[0]) : null;
  }

  async recomputeClaim(placeId, featureCode) {
    return withTransaction(this.pool, async (client) => {
      const feature = await client.query(
        `SELECT id, freshness_days FROM accessibility_features WHERE code = $1`,
        [featureCode]
      );
      if (!feature.rows[0]) return null;
      const featureId = feature.rows[0].id;
      const observations = await client.query(
        `SELECT o.id, o.value, o.observed_at, o.contributor_id,
                COALESCE(json_agg(
                  json_build_object('userId', v.user_id, 'eventType', v.event_type, 'createdAt', v.created_at)
                ) FILTER (WHERE v.id IS NOT NULL), '[]'::json) AS verification_events
           FROM observations o
           LEFT JOIN verification_events v ON v.observation_id = o.id
          WHERE o.place_id = $1 AND o.feature_id = $2
            AND o.visibility = 'public' AND o.moderation_status = 'approved'
          GROUP BY o.id
          ORDER BY o.observed_at DESC`,
        [placeId, featureId]
      );
      const freshnessLimit = Date.now() - Number(feature.rows[0].freshness_days) * 86_400_000;
      const eligible = observations.rows
        .map((row) => ({
          ...row,
          verificationEvents: Array.isArray(row.verification_events) ? row.verification_events : [],
          outdated: (Array.isArray(row.verification_events) ? row.verification_events : [])
            .some((event) => event.eventType === 'outdated')
        }))
        .filter((row) => !row.outdated);
      const latest = eligible[0] ?? null;
      const freshRows = eligible.filter((row) => new Date(row.observed_at).getTime() >= freshnessLimit);
      const values = new Set(freshRows.map((row) => row.value).filter((value) => value !== 'unknown'));
      const supporting = new Set();
      const disputing = new Set();
      for (const row of freshRows) {
        if (row.value === 'yes') supporting.add(row.contributor_id);
        if (row.value === 'no' || row.value === 'temporarily_unavailable') disputing.add(row.contributor_id);
        for (const event of row.verificationEvents) {
          if (event.eventType === 'confirmed') supporting.add(event.userId);
          if (event.eventType === 'disputed') disputing.add(event.userId);
        }
      }
      const supportingCount = supporting.size;
      const disputingCount = disputing.size;
      const conflict = (values.has('yes') && (values.has('no') || values.has('temporarily_unavailable'))) ||
        (supportingCount > 0 && disputingCount > 0);
      let status = 'not_assessed';
      let summaryValue = 'unknown';
      let freshnessState = 'needs_reverification';
      if (latest) {
        const fresh = freshRows.length > 0;
        freshnessState = fresh ? 'fresh' : 'stale';
        if (!fresh) status = 'needs_reverification';
        else if (conflict) status = 'conflicting_information';
        else if (latest.value === 'temporarily_unavailable') status = 'temporarily_unavailable';
        else if (latest.value === 'no') status = 'community_reported';
        else if (supportingCount > 1) status = 'community_corroborated';
        else status = 'recently_observed';
        summaryValue = conflict ? 'unknown' : latest.value;
      }
      const existing = await client.query(
        `SELECT id, status, summary_value, latest_observed_at, freshness_state,
                supporting_count, disputing_count, claims_version, calculation_version
           FROM claims WHERE place_id = $1 AND feature_id = $2 FOR UPDATE`,
        [placeId, featureId]
      );
      const existingRow = existing.rows[0] ?? null;
      const latestObservedAt = latest?.observed_at ?? null;
      const calculationVersion = 2;
      const unchanged = existingRow
        && existingRow.status === status
        && existingRow.summary_value === summaryValue
        && String(existingRow.latest_observed_at ?? '') === String(latestObservedAt ?? '')
        && existingRow.freshness_state === freshnessState
        && Number(existingRow.supporting_count) === supportingCount
        && Number(existingRow.disputing_count) === disputingCount
        && Number(existingRow.calculation_version) === calculationVersion;
      if (unchanged) {
        return {
          id: existingRow.id,
          placeId,
          featureCode,
          status,
          summaryValue,
          claimsVersion: Number(existingRow.claims_version),
          changed: false
        };
      }
      let row;
      if (existingRow) {
        const updated = await client.query(
          `UPDATE claims
              SET status = $3, summary_value = $4, latest_observed_at = $5,
                  freshness_state = $6, supporting_count = $7, disputing_count = $8,
                  calculation_version = $9,
                  claims_version = claims.claims_version + 1
            WHERE id = $1
            RETURNING id, claims_version, calculation_version`,
          [existingRow.id, placeId, status, summaryValue, latestObservedAt, freshnessState, supportingCount, disputingCount, calculationVersion]
        );
        row = updated.rows[0];
      } else {
        const inserted = await client.query(
          `INSERT INTO claims
            (place_id, feature_id, status, summary_value, latest_observed_at,
              freshness_state, supporting_count, disputing_count, claims_version, calculation_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 2)
            RETURNING id, claims_version, calculation_version`,
          [placeId, featureId, status, summaryValue, latestObservedAt, freshnessState, supportingCount, disputingCount]
        );
        row = inserted.rows[0];
      }
      await client.query(
        `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
          VALUES ('claim.recomputed', 'claim', $1, $2::jsonb)`,
        [row.id, JSON.stringify({ placeId, featureCode, claimsVersion: row.claims_version })]
      );
      return {
        id: row.id,
        placeId,
        featureCode,
        status,
        summaryValue,
        claimsVersion: Number(row.claims_version),
        changed: true
      };
    }, { role: 'worker' });
  }
}

export function observationClientRequestId(input) {
  const value = input.clientRequestId ?? input.client_request_id ?? null;
  return typeof value === 'string' ? value.trim() : value;
}
