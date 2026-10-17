import pg from 'pg';

const { Pool } = pg;

export class DatabaseUnavailableError extends Error {
  constructor(message = 'The database is not configured or unavailable.') {
    super(message);
    this.name = 'DatabaseUnavailableError';
    this.code = 'DATABASE_UNAVAILABLE';
  }
}

export function databaseConnectionString(env = process.env) {
  return env.DATABASE_URL ?? env.TEST_DATABASE_URL ?? null;
}

export function createDatabasePool({ connectionString = databaseConnectionString(), max = 10 } = {}) {
  if (!connectionString) return null;
  return new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    application_name: 'accessmap-api'
  });
}

export async function withDatabase(pool, callback, context = null) {
  if (!pool) throw new DatabaseUnavailableError();
  const client = await pool.connect();
  try {
    if (context) await setDatabaseContext(client, context, { local: false });
    return await callback(client);
  } finally {
    if (context) {
      await setDatabaseContext(client, {}, { local: false });
    }
    client.release();
  }
}

export async function withTransaction(pool, callback, context = null) {
  return withDatabase(pool, async (client) => {
    await client.query('BEGIN');
    try {
      if (context) await setDatabaseContext(client, context, { local: true });
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function setDatabaseContext(
  client,
  { userId = null, role = 'anonymous', authSubject = null } = {},
  { local = true } = {}
) {
  const settingScope = local ? 'true' : 'false';
  await client.query(
    `SELECT set_config('app.user_id', $1, ${settingScope}),
            set_config('app.role', $2, ${settingScope}),
            set_config('app.auth_subject', $3, ${settingScope})`,
    [
    userId ?? '',
    role,
    authSubject ?? ''
    ]
  );
}

export async function closeDatabasePool(pool) {
  if (pool) await pool.end();
}
