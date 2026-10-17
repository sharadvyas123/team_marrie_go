import pg from 'pg';
import { createClient } from 'redis';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL ?? process.env.VALKEY_URL;

if (!databaseUrl || !redisUrl) {
  throw new Error('DATABASE_URL and REDIS_URL (or VALKEY_URL) are required for worker readiness.');
}

try {
  process.kill(1, 0);
} catch (error) {
  throw new Error(`Worker PID 1 is not running: ${error.message}`);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 2_000,
  idleTimeoutMillis: 2_000
});
const redis = createClient({
  url: redisUrl,
  socket: { connectTimeout: 2_000 }
});

redis.on('error', () => {});

try {
  await pool.query('SELECT 1');
  await redis.connect();
  await redis.ping();
} finally {
  await Promise.allSettled([
    pool.end(),
    redis.isOpen ? redis.quit() : Promise.resolve()
  ]);
}

process.stdout.write('Worker process, PostgreSQL, and Redis/Valkey are ready.\n');
