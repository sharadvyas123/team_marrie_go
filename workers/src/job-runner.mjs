import { randomUUID } from 'node:crypto';
import { MemoryIdempotencyStore, jobIdempotencyKey } from './idempotency.mjs';
import { createRetryPolicy } from './retry-policy.mjs';

function delay(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Operation aborted'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

function serializeError(error) {
  return {
    name: error?.name ?? 'Error',
    message: String(error?.message ?? error)
      .replace(/(?:postgres(?:ql)?|redis|rediss):\/\/[^\s]+/gi, '[redacted-url]')
      .replace(/bearer\s+[^\s]+/gi, 'Bearer [redacted-token]')
      .replace(/(authorization\s*[:=]\s*)[^,;\s]+/gi, '$1[redacted-token]')
      .slice(0, 500),
    code: error?.code ?? null
  };
}

const PRIVATE_KEY_PATTERN = /profile|evidence|token|password|secret|authorization|cookie|email|private|moderator|verifier/i;

function sanitizeValue(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return value ?? null;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_KEY_PATTERN.test(key))
      .slice(0, 100)
      .map(([key, item]) => [key, sanitizeValue(item, depth + 1)])
  );
}

function safeJob(job) {
  return sanitizeValue(job);
}

function normalizeJob(job) {
  if (!job || typeof job !== 'object') throw new TypeError('A job object is required');
  const id = job.id ?? job.eventId ?? job.idempotencyKey;
  if (id === undefined || id === null || String(id).length === 0) {
    throw new TypeError('A job id, eventId, or idempotencyKey is required');
  }
  const type = job.type ?? job.eventType ?? 'worker.job';
  return {
    ...job,
    id: String(id),
    type,
    attempts: Number.isInteger(job.attempts) && job.attempts >= 0 ? job.attempts : 0,
    createdAt: job.createdAt ?? new Date().toISOString()
  };
}

function handlerFor(handlers, type) {
  if (handlers instanceof Map) return handlers.get(type);
  return handlers?.[type];
}

/**
 * Processes jobs from any Stream adapter. A handler receives the full job and
 * a context containing the attempt, idempotency key, and abort signal.
 */
export class JobRunner {
  constructor({
    stream,
    streamName = 'accessmap:jobs',
    consumerGroup = 'accessmap-workers',
    consumerName = `worker-${randomUUID()}`,
    handlers = {},
    handler = null,
    retryPolicy = createRetryPolicy(),
    idempotencyStore = new MemoryIdempotencyStore(),
    deadLetterStream = `${streamName}:dead-letter`,
    logger = console,
    clock = () => Date.now(),
    sleep = delay,
    deadLetterStore = null,
    pendingRecovery = true,
    pendingRecoveryIdleMs = 60_000,
    pendingRecoveryCount = 10,
    pendingRecoveryIntervalMs = 5_000,
    onRetry = null,
    onDeadLetter = null
  } = {}) {
    if (!stream) throw new TypeError('A stream adapter is required');
    if (typeof handler !== 'function' && !(handlers instanceof Map) && typeof handlers !== 'object') {
      throw new TypeError('handlers must be an object or Map');
    }
    this.stream = stream;
    this.streamName = streamName;
    this.consumerGroup = consumerGroup;
    this.consumerName = consumerName;
    this.handlers = handlers;
    this.handler = handler;
    this.retryPolicy = retryPolicy;
    this.idempotencyStore = idempotencyStore;
    this.deadLetterStream = deadLetterStream;
    this.logger = logger;
    this.clock = clock;
    this.sleep = sleep;
    this.deadLetterStore = deadLetterStore;
    if (!Number.isInteger(pendingRecoveryIdleMs) || pendingRecoveryIdleMs < 0) {
      throw new RangeError('pendingRecoveryIdleMs must be a non-negative integer');
    }
    if (!Number.isInteger(pendingRecoveryCount) || pendingRecoveryCount < 1 || pendingRecoveryCount > 100) {
      throw new RangeError('pendingRecoveryCount must be an integer between 1 and 100');
    }
    if (!Number.isInteger(pendingRecoveryIntervalMs) || pendingRecoveryIntervalMs < 0) {
      throw new RangeError('pendingRecoveryIntervalMs must be a non-negative integer');
    }
    this.pendingRecovery = pendingRecovery;
    this.pendingRecoveryIdleMs = pendingRecoveryIdleMs;
    this.pendingRecoveryCount = pendingRecoveryCount;
    this.pendingRecoveryIntervalMs = pendingRecoveryIntervalMs;
    this.lastPendingRecoveryAt = null;
    this.onRetry = onRetry;
    this.onDeadLetter = onDeadLetter;
    this.counts = {
      completed: 0,
      duplicate: 0,
      retried: 0,
      deadLettered: 0
    };
    this.#running = false;
  }

  #running;

  async process(job, { messageId = null, signal = null, sourceStream = this.streamName } = {}) {
    const normalizedJob = normalizeJob(job);
    const attempt = normalizedJob.attempts + 1;
    const idempotencyKey = jobIdempotencyKey(normalizedJob);
    const claim = await this.idempotencyStore.claim(idempotencyKey);

    if (!claim?.acquired) {
      this.counts.duplicate += 1;
      await this.#acknowledge(sourceStream, messageId);
      return {
        status: 'duplicate',
        idempotencyKey,
        reason: claim?.state ?? 'already-processed'
      };
    }

    const selectedHandler = this.handler ?? handlerFor(this.handlers, normalizedJob.type);
    try {
      if (typeof selectedHandler !== 'function') {
        const error = new Error(`No handler registered for job type: ${normalizedJob.type}`);
        error.code = 'HANDLER_NOT_FOUND';
        throw error;
      }
      const result = await selectedHandler(normalizedJob, {
        attempt,
        idempotencyKey,
        signal,
        stream: this.stream
      });
      await this.idempotencyStore.complete(idempotencyKey, result);
      this.counts.completed += 1;
      await this.#acknowledge(sourceStream, messageId);
      return { status: 'completed', attempt, idempotencyKey, result };
    } catch (error) {
      await this.idempotencyStore.release(idempotencyKey);
      const retryable = this.retryPolicy.shouldRetry(error, attempt);
      if (retryable) {
        const delayMs = this.retryPolicy.delayFor(attempt);
        const retryJob = {
          ...safeJob(normalizedJob),
          attempts: attempt,
          availableAt: new Date(this.clock() + delayMs).toISOString(),
          lastError: serializeError(error)
        };
        const retryMessageId = await this.stream.append(this.streamName, retryJob);
        await this.#acknowledge(sourceStream, messageId);
        this.counts.retried += 1;
        await this.onRetry?.({
          job: retryJob,
          attempt,
          delayMs,
          messageId: retryMessageId,
          error: serializeError(error)
        });
        return { status: 'retrying', attempt, delayMs, messageId: retryMessageId };
      }

      const deadLetter = {
        ...safeJob(normalizedJob),
        attempts: attempt,
        deadLetteredAt: new Date(this.clock()).toISOString(),
        deadLetter: {
          originalJobId: normalizedJob.id,
          attempt,
          error: serializeError(error)
        }
      };
      if (this.deadLetterStore?.record) {
        await this.deadLetterStore.record({
          streamName: sourceStream,
          messageId,
          job: deadLetter,
          attempt,
          idempotencyKey,
          error
        });
      }
      const deadLetterId = await this.stream.append(this.deadLetterStream, deadLetter);
      await this.#acknowledge(sourceStream, messageId);
      this.counts.deadLettered += 1;
      await this.onDeadLetter?.({
        job: deadLetter,
        messageId: deadLetterId,
        error: serializeError(error)
      });
      return { status: 'dead-lettered', attempt, messageId: deadLetterId };
    }
  }

  async run({ signal } = {}) {
    if (this.#running) throw new Error('Job runner is already running');
    this.#running = true;
    try {
      while (this.#running && !signal?.aborted) {
        const recovered = await this.#recoverPending();
        if (recovered.length > 0) {
          await this.#processMessages(recovered, signal);
          continue;
        }

        const messages = await this.stream.read(this.streamName, {
          group: this.consumerGroup,
          consumer: this.consumerName,
          count: 1,
          blockMs: 500
        });
        await this.#processMessages(messages, signal);
      }
    } finally {
      this.#running = false;
      this.runPromise = null;
    }
  }

  async start({ signal } = {}) {
    if (this.#running) return this;
    this.runPromise = this.run({ signal });
    return this;
  }

  async stop() {
    this.#running = false;
    if (this.runPromise) await this.runPromise;
  }

  metrics() {
    return {
      ...this.counts,
      pendingRecoveryEnabled: this.pendingRecovery,
      lastPendingRecoveryAt: this.lastPendingRecoveryAt
    };
  }

  async #recoverPending() {
    if (!this.pendingRecovery || typeof this.stream.recoverPending !== 'function') return [];
    const now = this.clock();
    if (
      this.lastPendingRecoveryAt !== null
      && now - this.lastPendingRecoveryAt < this.pendingRecoveryIntervalMs
    ) {
      return [];
    }
    this.lastPendingRecoveryAt = now;
    try {
      return await this.stream.recoverPending(this.streamName, {
        group: this.consumerGroup,
        consumer: this.consumerName,
        minIdleMs: this.pendingRecoveryIdleMs,
        count: this.pendingRecoveryCount
      });
    } catch (error) {
      this.logger.error?.(
        { error: serializeError(error) },
        'Pending worker message recovery failed'
      );
      return [];
    }
  }

  async #processMessages(messages, signal) {
    for (const message of messages ?? []) {
      if (signal?.aborted) break;
      const job = message.data ?? message;
      const availableAt = Date.parse(job.availableAt ?? '');
      if (Number.isFinite(availableAt)) {
        await this.sleep(Math.max(0, availableAt - this.clock()), signal);
      }
      try {
        await this.process(job, {
          messageId: message.id,
          sourceStream: message.stream ?? this.streamName,
          signal
        });
      } catch (error) {
        this.logger.error?.({ jobId: job.id, error: serializeError(error) }, 'Worker job processing failed');
      }
    }
  }

  async #acknowledge(streamName, messageId) {
    if (messageId === null || messageId === undefined) return;
    await this.stream.ack(streamName, this.consumerGroup, messageId);
  }
}

export function createJobRunner(options) {
  return new JobRunner(options);
}

export { normalizeJob, serializeError };
