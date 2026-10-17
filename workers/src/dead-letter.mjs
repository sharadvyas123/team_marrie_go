import { serializeOutboxError } from './postgres-outbox.mjs';

function validatePool(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('pool must implement connect');
  return pool;
}

function safeJobMetadata(job = {}) {
  return {
    jobId: job.id ?? job.eventId ?? null,
    eventType: job.eventType ?? job.type ?? null,
    aggregateType: job.aggregateType ?? null,
    aggregateId: job.aggregateId ?? null
  };
}

export class PostgresDeadLetterStore {
  constructor({ pool, workerRole = 'worker' } = {}) {
    this.pool = validatePool(pool);
    this.workerRole = String(workerRole);
  }

  async record({ streamName = null, messageId = null, job, attempt = 0, idempotencyKey = null, error } = {}) {
    const safeError = serializeOutboxError(error);
    const metadata = safeJobMetadata(job);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.role', $1, true)", [this.workerRole]);
      const result = await client.query(
        `INSERT INTO worker_dead_letters
          (event_type, payload, error_message, attempt_count, source_stream,
           source_message_id, source_job_id, idempotency_key, status)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, 'open')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          metadata.eventType ?? 'worker.job',
          JSON.stringify(metadata),
          safeError,
          Number.isInteger(attempt) && attempt >= 0 ? attempt : 0,
          streamName,
          messageId,
          metadata.jobId,
          idempotencyKey
        ]
      );
      await client.query('COMMIT');
      return { created: Boolean(result.rows[0]), id: result.rows[0]?.id ?? null };
    } catch (errorToThrow) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original error.
      }
      throw errorToThrow;
    } finally {
      client.release();
    }
  }

  async resolve(id) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.role', $1, true)", [this.workerRole]);
      const result = await client.query(
        `UPDATE worker_dead_letters
            SET status = 'resolved', resolved_at = clock_timestamp()
          WHERE id = $1 AND status = 'open'
        RETURNING id, status, resolved_at`,
        [id]
      );
      await client.query('COMMIT');
      return result.rows[0] ?? { id, status: 'resolved' };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original error.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createPostgresDeadLetterStore(options) {
  return new PostgresDeadLetterStore(options);
}
