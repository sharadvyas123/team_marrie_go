const MAX_BATCH_SIZE = 100;
const MAX_OWNER_LENGTH = 128;
const MAX_ERROR_LENGTH = 2_000;

const CLAIM_PENDING_SQL = `
WITH candidates AS (
  SELECT id
    FROM outbox_events
   WHERE published_at IS NULL
     AND dead_lettered_at IS NULL
     AND (
       lease_expires_at IS NULL
       OR lease_expires_at <= clock_timestamp()
     )
   ORDER BY created_at ASC, id ASC
   FOR UPDATE SKIP LOCKED
   LIMIT $1
)
UPDATE outbox_events AS event
   SET lease_owner = $2,
       lease_expires_at =
         clock_timestamp() + ($3::double precision * interval '1 millisecond'),
       attempt_count = event.attempt_count + 1
  FROM candidates
 WHERE event.id = candidates.id
RETURNING event.id,
          event.event_type,
          event.aggregate_type,
          event.aggregate_id,
          event.payload,
          event.created_at,
          event.attempt_count`;

const MARK_PUBLISHED_SQL = `
UPDATE outbox_events
   SET published_at = clock_timestamp(),
       lease_owner = NULL,
       lease_expires_at = NULL,
       last_error = NULL
 WHERE id = $1
   AND published_at IS NULL
   AND lease_owner = $2
   AND lease_expires_at > clock_timestamp()
RETURNING id, published_at`;

const SELECT_OUTBOX_STATE_SQL = `
SELECT id, published_at, lease_owner, lease_expires_at
  FROM outbox_events
 WHERE id = $1`;

const RELEASE_CLAIM_SQL = `
UPDATE outbox_events
   SET lease_owner = NULL,
       lease_expires_at = NULL,
       last_error = $3
 WHERE id = $1
   AND published_at IS NULL
   AND lease_owner = $2
   AND lease_expires_at > clock_timestamp()
 RETURNING id`;

const MOVE_TO_DEAD_LETTER_SQL = `
WITH inserted AS (
  INSERT INTO worker_dead_letters
    (outbox_event_id, event_type, payload, error_message, attempt_count, status)
  SELECT id, event_type,
         jsonb_build_object(
           'aggregateType', aggregate_type,
           'aggregateId', aggregate_id
         ),
         $3, attempt_count, 'open'
    FROM outbox_events
   WHERE id = $1
     AND published_at IS NULL
     AND dead_lettered_at IS NULL
     AND lease_owner = $2
   ON CONFLICT DO NOTHING
   RETURNING id
)
UPDATE outbox_events
   SET dead_lettered_at = clock_timestamp(),
       lease_owner = NULL,
       lease_expires_at = NULL,
       last_error = $3
 WHERE id = $1
   AND published_at IS NULL
   AND dead_lettered_at IS NULL
   AND lease_owner = $2
RETURNING id, (SELECT id FROM inserted) AS dead_letter_id`;

const HEALTH_SQL = `
SELECT
  count(*) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL)::integer AS pending_count,
  count(*) FILTER (
    WHERE published_at IS NULL
      AND dead_lettered_at IS NULL
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at <= clock_timestamp()
  )::integer AS stale_lease_count,
  coalesce(max(attempt_count) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL), 0)::integer AS max_attempt_count
FROM outbox_events`;

const DEAD_LETTER_COUNT_SQL = `
SELECT count(*)::integer AS dead_letter_count
  FROM worker_dead_letters
 WHERE status = 'open'`;

export class OutboxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OutboxError';
    this.code = code;
  }
}

function validatePool(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('pool must implement connect');
  }
  return pool;
}

function validateOwner(ownerId) {
  if (typeof ownerId !== 'string' || ownerId.trim().length === 0 || ownerId.length > MAX_OWNER_LENGTH) {
    throw new TypeError(`ownerId must be a non-empty string of at most ${MAX_OWNER_LENGTH} characters`);
  }
  return ownerId;
}

function validateEventId(eventId) {
  if (eventId === undefined || eventId === null || String(eventId).trim().length === 0) {
    throw new TypeError('eventId is required');
  }
  return String(eventId);
}

function validateLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_BATCH_SIZE}`);
  }
  return limit;
}

function validateLeaseMs(leaseMs) {
  if (!Number.isInteger(leaseMs) || leaseMs < 1) {
    throw new RangeError('leaseMs must be a positive integer');
  }
  return leaseMs;
}

function redactMessage(message) {
  return String(message ?? 'Unknown outbox error')
    .replace(/(?:postgres(?:ql)?|redis|rediss):\/\/[^\s]+/gi, '[redacted-url]')
    .replace(/bearer\s+[^\s]+/gi, 'Bearer [redacted-token]')
    .replace(/(authorization\s*[:=]\s*)[^,;\s]+/gi, '$1[redacted-token]')
    .slice(0, MAX_ERROR_LENGTH);
}

export function serializeOutboxError(error) {
  const payload = {
    name: String(error?.name ?? 'Error').slice(0, 100),
    code: error?.code ? String(error.code).slice(0, 100) : null,
    message: redactMessage(error?.message ?? error)
  };
  let serialized = JSON.stringify(payload);
  while (serialized.length > MAX_ERROR_LENGTH && payload.message.length > 0) {
    payload.message = payload.message.slice(0, Math.max(0, payload.message.length - 100));
    serialized = JSON.stringify(payload);
  }
  return serialized;
}

function mapOutboxEvent(row) {
  return {
    id: row.id,
    event_type: row.event_type,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    payload: row.payload ?? {},
    created_at: row.created_at,
    attempt_count: Number(row.attempt_count ?? 0)
  };
}

export class PostgresOutbox {
  constructor({ pool, leaseMs = 60_000, workerRole = null } = {}) {
    this.pool = validatePool(pool);
    this.leaseMs = validateLeaseMs(leaseMs);
    this.workerRole = workerRole === null ? null : validateOwner(workerRole);
  }

  async claimPending({ limit = 25, ownerId } = {}) {
    const normalizedLimit = validateLimit(limit);
    const normalizedOwner = validateOwner(ownerId);

    return this.#transaction(async (client) => {
      const result = await client.query(CLAIM_PENDING_SQL, [normalizedLimit, normalizedOwner, this.leaseMs]);
      return result.rows.map(mapOutboxEvent);
    });
  }

  async markPublished(eventId, { ownerId } = {}) {
    const normalizedEventId = validateEventId(eventId);
    const normalizedOwner = validateOwner(ownerId);

    return this.#transaction(async (client) => {
      const updated = await client.query(MARK_PUBLISHED_SQL, [normalizedEventId, normalizedOwner]);
      if (updated.rows[0]) {
        return {
          status: 'published',
          publishedAt: updated.rows[0].published_at
        };
      }

      const current = await client.query(SELECT_OUTBOX_STATE_SQL, [normalizedEventId]);
      const row = current.rows[0];
      if (!row) throw new OutboxError('OUTBOX_NOT_FOUND', 'The outbox event no longer exists.');
      if (row.published_at) return { status: 'already_published' };
      throw new OutboxError('OUTBOX_LEASE_LOST', 'The outbox event lease is no longer owned by this worker.');
    });
  }

  async releaseClaim(eventId, { ownerId, error } = {}) {
    const normalizedEventId = validateEventId(eventId);
    const normalizedOwner = validateOwner(ownerId);
    const errorText = serializeOutboxError(error);

    return this.#transaction(async (client) => {
      const result = await client.query(RELEASE_CLAIM_SQL, [normalizedEventId, normalizedOwner, errorText]);
      return { released: Boolean(result.rows[0]) };
    });
  }

  async moveToDeadLetter(event, { ownerId, error } = {}) {
    const normalizedEventId = validateEventId(event?.id ?? event);
    const normalizedOwner = validateOwner(ownerId);
    const errorText = serializeOutboxError(error);

    return this.#transaction(async (client) => {
      const result = await client.query(MOVE_TO_DEAD_LETTER_SQL, [normalizedEventId, normalizedOwner, errorText]);
      return {
        deadLettered: Boolean(result.rows[0]),
        deadLetterId: result.rows[0]?.dead_letter_id ?? null
      };
    });
  }

  async metrics() {
    return this.#transaction(async (client) => {
      const [outbox, deadLetters] = await Promise.all([
        client.query(HEALTH_SQL),
        client.query(DEAD_LETTER_COUNT_SQL)
      ]);
      return {
        pendingCount: Number(outbox.rows[0]?.pending_count ?? 0),
        staleLeaseCount: Number(outbox.rows[0]?.stale_lease_count ?? 0),
        maxAttemptCount: Number(outbox.rows[0]?.max_attempt_count ?? 0),
        deadLetterCount: Number(deadLetters.rows[0]?.dead_letter_count ?? 0)
      };
    });
  }

  async #transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (this.workerRole !== null) {
        await client.query("SELECT set_config('app.role', $1, true)", [this.workerRole]);
      }
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original database error; the lease will expire if needed.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createPostgresOutbox(options) {
  return new PostgresOutbox(options);
}

export {
  CLAIM_PENDING_SQL,
  MARK_PUBLISHED_SQL,
  RELEASE_CLAIM_SQL,
  SELECT_OUTBOX_STATE_SQL,
  MOVE_TO_DEAD_LETTER_SQL,
  HEALTH_SQL,
  DEAD_LETTER_COUNT_SQL
};
