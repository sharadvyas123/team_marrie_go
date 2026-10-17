import { randomUUID } from 'node:crypto';
import { createJobRunner } from './job-runner.mjs';

function eventId(event) {
  const id = event?.eventId ?? event?.id;
  if (id === undefined || id === null || String(id).length === 0) {
    throw new TypeError('Outbox events require eventId or id');
  }
  return String(id);
}

function normalizeEvent(event, clock) {
  const id = eventId(event);
  const eventType = event?.eventType ?? event?.event_type ?? event?.type;
  const aggregateType = event?.aggregateType ?? event?.aggregate_type;
  const aggregateId = event?.aggregateId ?? event?.aggregate_id;
  if (!eventType || !aggregateType || !aggregateId) {
    throw new TypeError('Outbox events require event type and aggregate identity');
  }
  return {
    eventId: id,
    eventType: String(eventType),
    aggregateType: String(aggregateType),
    aggregateId: String(aggregateId),
    version: event?.version ?? 1,
    occurredAt: event?.occurredAt ?? event?.occurred_at ?? event?.createdAt ?? event?.created_at ?? new Date(clock()).toISOString(),
    actorId: event?.actorId ?? event?.actor_id ?? null,
    traceId: event?.traceId ?? event?.trace_id ?? null,
    payload: event?.payload ?? {}
  };
}

function safeError(error) {
  return {
    name: error?.name ?? 'Error',
    message: String(error?.message ?? error)
      .replace(/(?:postgres(?:ql)?|redis|rediss):\/\/[^\s]+/gi, '[redacted-url]')
      .replace(/bearer\s+[^\s]+/gi, 'Bearer [redacted-token]')
      .slice(0, 500),
    code: error?.code ?? null
  };
}

/**
 * Publishes committed outbox rows. The database adapter is deliberately
 * injected: this module does not assume a schema or make a database claim.
 *
 * Required adapter methods:
 *   claimPending({ limit, ownerId }): Promise<Array<Event>>
 *   markPublished(eventId, metadata): Promise<void>
 * Optional failure methods: releaseClaim or markPublishFailed.
 */
export class OutboxPublisher {
  constructor({
    outbox,
    stream,
    streamName = 'accessmap:events',
    batchSize = 25,
    ownerId = `outbox-${randomUUID()}`,
    logger = console,
    intervalMs = 1_000,
    maxAttempts = 5,
    clock = () => Date.now()
  } = {}) {
    if (!outbox || typeof outbox.claimPending !== 'function' || typeof outbox.markPublished !== 'function') {
      throw new TypeError('outbox must implement claimPending and markPublished');
    }
    if (!stream || typeof stream.append !== 'function') throw new TypeError('stream must implement append');
    this.outbox = outbox;
    this.stream = stream;
    this.streamName = streamName;
    this.batchSize = batchSize;
    this.ownerId = ownerId;
    this.logger = logger;
    this.intervalMs = intervalMs;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('maxAttempts must be a positive integer');
    this.maxAttempts = maxAttempts;
    this.clock = clock;
    this.published = new Set();
    this.counts = { published: 0, failed: 0, skipped: 0, deadLettered: 0 };
    this.#stopped = false;
  }

  #stopped;

  async publishOnce() {
    const events = await this.outbox.claimPending({ limit: this.batchSize, ownerId: this.ownerId });
    const results = { published: 0, failed: 0, skipped: 0 };
    for (const event of events ?? []) {
      const id = eventId(event);
      if (this.published.has(id)) {
        results.skipped += 1;
        this.counts.skipped += 1;
        continue;
      }
      let appended = false;
      try {
        const normalizedEvent = normalizeEvent(event, this.clock);
        let messageId;
        messageId = await this.stream.append(this.streamName, normalizedEvent);
        appended = true;
        if (this.stream.durable === false) {
          const error = new Error('A durable stream is required before marking an outbox event published');
          error.code = 'NON_DURABLE_STREAM';
          throw error;
        }
        await this.outbox.markPublished(id, {
          messageId,
          publishedAt: new Date(this.clock()).toISOString(),
          ownerId: this.ownerId
        });
        this.published.add(id);
        results.published += 1;
        this.counts.published += 1;
      } catch (error) {
        results.failed += 1;
        this.counts.failed += 1;
        if (
          !appended
          &&
          Number(event.attempt_count ?? 0) >= this.maxAttempts
          && typeof this.outbox.moveToDeadLetter === 'function'
        ) {
          try {
            await this.outbox.moveToDeadLetter(event, { ownerId: this.ownerId, error });
            this.counts.deadLettered += 1;
          } catch (deadLetterError) {
            this.logger.error?.({ eventId: id, error: safeError(deadLetterError) }, 'Outbox dead-letter persistence failed');
            await this.#releaseOrMarkFailed(id, error);
          }
        } else {
          await this.#releaseOrMarkFailed(id, error);
        }
        this.logger.error?.({ eventId: id, error: safeError(error) }, 'Outbox event publication failed');
      }
    }
    return results;
  }

  async start({ signal } = {}) {
    if (this.loopPromise) return this;
    this.#stopped = false;
    this.loopPromise = this.#run(signal);
    return this;
  }

  async stop() {
    this.#stopped = true;
    if (this.loopPromise) await this.loopPromise;
  }

  async metrics() {
    const durable = typeof this.outbox.metrics === 'function'
      ? await this.outbox.metrics()
      : {};
    return {
      ...durable,
      ...this.counts,
      durableStream: this.stream.durable !== false
    };
  }

  async #run(signal) {
    try {
      while (!this.#stopped && !signal?.aborted) {
        try {
          await this.publishOnce();
        } catch (error) {
          this.logger.error?.({ error: safeError(error) }, 'Outbox polling failed');
        }
        if (this.#stopped || signal?.aborted) break;
        await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
      }
    } finally {
      this.loopPromise = null;
    }
  }

  async #releaseOrMarkFailed(id, error) {
    const metadata = { ownerId: this.ownerId, error: safeError(error) };
    try {
      if (typeof this.outbox.releaseClaim === 'function') {
        await this.outbox.releaseClaim(id, metadata);
      } else if (typeof this.outbox.markPublishFailed === 'function') {
        await this.outbox.markPublishFailed(id, metadata);
      }
    } catch (releaseError) {
      this.logger.error?.(
        { eventId: id, error: safeError(releaseError) },
        'Outbox claim release failed; the lease will expire'
      );
    }
  }
}

/**
 * Adapts the generic idempotent JobRunner to an outbox event stream. Event
 * handlers can be keyed by eventType (or type) and remain fully injectable.
 */
export class OutboxProcessor {
  constructor({ runner, stream, streamName = 'accessmap:events', ...runnerOptions } = {}) {
    this.runner = runner ?? createJobRunner({ stream, streamName, ...runnerOptions });
  }

  process(message, options = {}) {
    const event = message?.data ?? message;
    const messageOptions = message?.data
      ? {
          messageId: message.id,
          sourceStream: message.stream ?? this.runner.streamName,
          ...options
        }
      : options;
    return this.runner.process(event, messageOptions);
  }

  start(options = {}) {
    return this.runner.start(options);
  }

  stop(options = {}) {
    return this.runner.stop(options);
  }
}

export function createOutboxPublisher(options) {
  return new OutboxPublisher(options);
}

export function createOutboxProcessor(options) {
  return new OutboxProcessor(options);
}
