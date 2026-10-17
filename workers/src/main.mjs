import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import {
  OutboxPublisher,
  PostgresDeadLetterStore,
  PostgresIdempotencyStore,
  PostgresOutbox,
  createOutboxProcessor,
  createEvidenceHandlers,
  createWebhookHandlers,
  createS006Handlers,
  createStreamAdapter,
  createWorkerRuntime
} from './index.mjs';
import { ObservationRepository } from '../../apps/api/src/db/observations.mjs';

const { Pool } = pg;

function requiredEnvironment(name, env = process.env) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required to start the worker`);
  }
  return value;
}

export async function createProductionWorker({ env = process.env, logger = console, evidenceProcessor = null, webhookService = null } = {}) {
  const databaseUrl = requiredEnvironment('DATABASE_URL', env);
  const redisUrl = env.REDIS_URL ?? env.VALKEY_URL;
  if (!redisUrl) throw new Error('REDIS_URL or VALKEY_URL is required to start the worker');

  const pool = new Pool({
    connectionString: databaseUrl,
    max: Number(env.WORKER_DATABASE_POOL_SIZE ?? 5),
    application_name: 'accessmap-worker',
    connectionTimeoutMillis: 3_000
  });
  const stream = await createStreamAdapter({
    redisUrl,
    keyPrefix: env.REDIS_KEY_PREFIX ?? '',
    logger,
    allowVolatileFallback: false
  });
  if (stream.durable !== true || stream.mode !== 'redis') {
    await Promise.allSettled([stream.close?.(), pool.end()]);
    throw new Error('The worker requires a durable Redis/Valkey stream connection');
  }

  const outbox = new PostgresOutbox({
    pool,
    leaseMs: Number(env.OUTBOX_LEASE_MS ?? 60_000),
    workerRole: 'worker'
  });
  const observationRepository = new ObservationRepository(pool);
  const s006Handlers = createS006Handlers({ observationRepository });
  const evidenceHandlers = evidenceProcessor ? createEvidenceHandlers({ evidenceProcessor }) : null;
  const webhookHandlers = webhookService ? createWebhookHandlers({ webhookService }) : null;
  const processor = createOutboxProcessor({
    stream,
    streamName: env.OUTBOX_STREAM ?? 'accessmap:events',
    consumerGroup: env.S006_CONSUMER_GROUP ?? 'accessmap-s006-workers',
    consumerName: env.S006_CONSUMER_NAME ?? `s006-${randomUUID()}`,
     handler: async (job, context) => {
       const s006Result = await s006Handlers.handle(job, context);
       if (!evidenceHandlers && job.type === 'observation.submitted' && (job.payload?.evidenceIds?.length ?? 0) > 0) {
         const error = new Error('Evidence processing is not configured for this worker.');
         error.code = 'EVIDENCE_PROCESSOR_NOT_CONFIGURED';
         throw error;
       }
       if (!evidenceHandlers && job.type === 'evidence.processed') {
         const error = new Error('Evidence processing is not configured for this worker.');
         error.code = 'EVIDENCE_PROCESSOR_NOT_CONFIGURED';
         throw error;
       }
       if (!webhookHandlers && job.type === 'webhook.delivery.requested') {
         const error = new Error('Webhook delivery is not configured for this worker.');
         error.code = 'WEBHOOK_DELIVERY_NOT_CONFIGURED';
         throw error;
       }
       const evidenceResult = evidenceHandlers ? await evidenceHandlers.handle(job, context) : { ignored: true };
       const webhookResult = webhookHandlers ? await webhookHandlers.handle(job, context) : { ignored: true };
       return { s006: s006Result, evidence: evidenceResult, webhook: webhookResult };
     },
    idempotencyStore: new PostgresIdempotencyStore({
      pool,
      owner: `s006-idempotency-${randomUUID()}`,
      leaseMs: Number(env.WORKER_IDEMPOTENCY_LEASE_MS ?? 60_000)
    }),
    deadLetterStore: new PostgresDeadLetterStore({ pool })
  });
  const publisher = new OutboxPublisher({
    outbox,
    stream,
    ownerId: `outbox-${randomUUID()}`,
    streamName: env.OUTBOX_STREAM ?? 'accessmap:events',
    batchSize: Number(env.OUTBOX_BATCH_SIZE ?? 25),
    maxAttempts: Number(env.OUTBOX_MAX_ATTEMPTS ?? 5),
    logger
  });
  const runtime = createWorkerRuntime({
    publisher,
    processors: [processor],
    resources: [stream, { close: () => pool.end() }],
    logger
  });
  return { runtime, publisher, outbox, stream, pool };
}

export async function startProductionWorker(options = {}) {
  const worker = await createProductionWorker(options);
  await worker.runtime.start();
  return worker;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const worker = await startProductionWorker();
  process.stdout.write('AccessMap worker started\n');
  process.on('unhandledRejection', (error) => {
    process.stderr.write(`AccessMap worker unhandled rejection: ${error?.message ?? String(error)}\n`);
  });
  void worker;
}
