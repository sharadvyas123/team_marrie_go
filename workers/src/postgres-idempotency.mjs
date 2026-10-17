const MAX_KEY_LENGTH = 512;
const MAX_OWNER_LENGTH = 128;

const INSERT_SQL = `
INSERT INTO worker_idempotency
  (idempotency_key, state, owner, lease_expires_at)
VALUES ($1, 'processing', $2,
        clock_timestamp() + ($3::double precision * interval '1 millisecond'))
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING idempotency_key, state, result`;

const TAKEOVER_SQL = `
UPDATE worker_idempotency
   SET owner = $2,
       lease_expires_at =
         clock_timestamp() + ($3::double precision * interval '1 millisecond'),
       state = 'processing',
       result = NULL,
       completed_at = NULL
 WHERE idempotency_key = $1
   AND state = 'processing'
   AND lease_expires_at <= clock_timestamp()
RETURNING idempotency_key, state, result`;

const SELECT_SQL = `
SELECT idempotency_key, state, owner, lease_expires_at, result
  FROM worker_idempotency
 WHERE idempotency_key = $1`;

const COMPLETE_SQL = `
UPDATE worker_idempotency
   SET state = 'completed',
       result = $3::jsonb,
       completed_at = clock_timestamp(),
       lease_expires_at = clock_timestamp()
 WHERE idempotency_key = $1
   AND owner = $2
   AND state = 'processing'
   AND lease_expires_at > clock_timestamp()
RETURNING idempotency_key, result`;

const RELEASE_SQL = `
DELETE FROM worker_idempotency
 WHERE idempotency_key = $1
   AND owner = $2
   AND state = 'processing'
RETURNING idempotency_key`;

function validatePool(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('pool must implement connect');
  return pool;
}

function validateKey(key) {
  const normalized = String(key ?? '').trim();
  if (!normalized || normalized.length > MAX_KEY_LENGTH) {
    throw new TypeError(`idempotency key must be 1-${MAX_KEY_LENGTH} characters`);
  }
  return normalized;
}

function validateOwner(owner) {
  if (typeof owner !== 'string' || owner.trim().length === 0 || owner.length > MAX_OWNER_LENGTH) {
    throw new TypeError(`owner must be a non-empty string of at most ${MAX_OWNER_LENGTH} characters`);
  }
  return owner;
}

function validateLease(leaseMs) {
  if (!Number.isInteger(leaseMs) || leaseMs < 1) throw new RangeError('leaseMs must be a positive integer');
  return leaseMs;
}

export class IdempotencyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IdempotencyError';
    this.code = code;
  }
}

export class PostgresIdempotencyStore {
  constructor({ pool, owner, leaseMs = 60_000, workerRole = 'worker' } = {}) {
    this.pool = validatePool(pool);
    this.owner = validateOwner(owner);
    this.leaseMs = validateLease(leaseMs);
    this.workerRole = validateOwner(workerRole);
  }

  async claim(key) {
    const normalizedKey = validateKey(key);
    return this.#transaction(async (client) => {
      const inserted = await client.query(INSERT_SQL, [normalizedKey, this.owner, this.leaseMs]);
      if (inserted.rows[0]) return { acquired: true, state: 'processing' };

      const takeover = await client.query(TAKEOVER_SQL, [normalizedKey, this.owner, this.leaseMs]);
      if (takeover.rows[0]) return { acquired: true, state: 'processing' };

      const existing = await client.query(SELECT_SQL, [normalizedKey]);
      if (!existing.rows[0]) return { acquired: true, state: 'processing' };
      return {
        acquired: false,
        state: existing.rows[0].state,
        ...(existing.rows[0].state === 'completed' ? { result: existing.rows[0].result } : {})
      };
    });
  }

  async complete(key, result = null) {
    const normalizedKey = validateKey(key);
    return this.#transaction(async (client) => {
      const updated = await client.query(COMPLETE_SQL, [normalizedKey, this.owner, JSON.stringify(result ?? null)]);
      if (updated.rows[0]) return { completed: true, result: updated.rows[0].result };

      const existing = await client.query(SELECT_SQL, [normalizedKey]);
      if (existing.rows[0]?.state === 'completed') return { completed: false, state: 'completed' };
      throw new IdempotencyError('IDEMPOTENCY_LEASE_LOST', 'The idempotency lease is no longer owned by this worker.');
    });
  }

  async release(key) {
    const normalizedKey = validateKey(key);
    return this.#transaction(async (client) => {
      const result = await client.query(RELEASE_SQL, [normalizedKey, this.owner]);
      return { released: Boolean(result.rows[0]) };
    });
  }

  async get(key) {
    const normalizedKey = validateKey(key);
    return this.#transaction(async (client) => {
      const result = await client.query(SELECT_SQL, [normalizedKey]);
      return result.rows[0] ?? null;
    });
  }

  async #transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.role', $1, true)", [this.workerRole]);
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original error; an expired lease permits recovery.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createPostgresIdempotencyStore(options) {
  return new PostgresIdempotencyStore(options);
}

export { COMPLETE_SQL, INSERT_SQL, RELEASE_SQL, SELECT_SQL, TAKEOVER_SQL };
