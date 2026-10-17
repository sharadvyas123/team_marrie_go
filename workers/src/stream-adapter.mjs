import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

const DEFAULT_GROUP = 'accessmap-workers';

export class StreamUnavailableError extends Error {
  constructor(message = 'The durable stream is unavailable.') {
    super(message);
    this.name = 'StreamUnavailableError';
    this.code = 'STREAM_UNAVAILABLE';
    this.status = 503;
  }
}

function streamKey(streamName, keyPrefix) {
  return keyPrefix ? `${keyPrefix}${streamName}` : streamName;
}

function parsePayload(value) {
  if (value === undefined) return {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function positiveInteger(value, name, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${name} must be an integer between 1 and ${max}`);
  }
  return value;
}

function nonNegativeInteger(value, name, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be an integer between 0 and ${max}`);
  }
  return value;
}

function normalizePendingOptions(options = {}) {
  return {
    group: options.group ?? DEFAULT_GROUP,
    consumer: options.consumer ?? `worker-${randomUUID()}`,
    minIdleMs: nonNegativeInteger(options.minIdleMs ?? 60_000, 'minIdleMs'),
    count: positiveInteger(options.count ?? 10, 'count', 100)
  };
}

function mapStreamMessages(messages, streamName) {
  return (messages ?? [])
    .filter((message) => message?.id !== undefined && message?.id !== null)
    .map((message) => ({
      id: message.id,
      stream: streamName,
      data: parsePayload(message.message?.payload)
    }));
}

function normalizeReadOptions(options = {}) {
  return {
    group: options.group ?? DEFAULT_GROUP,
    consumer: options.consumer ?? `worker-${randomUUID()}`,
    count: options.count ?? 1,
    blockMs: options.blockMs ?? 1_000
  };
}

/**
 * In-memory Streams-like adapter. It intentionally has the same small API as
 * the Redis adapter so tests can exercise workers without a running Valkey.
 */
export class MemoryStreamAdapter {
  #streams = new Map();
  #groups = new Map();
  #waiters = new Map();
  #sequence = 0;
  #closed = false;

  constructor({ clock = () => Date.now() } = {}) {
    this.clock = clock;
    this.mode = 'memory';
    this.degraded = false;
    this.durable = false;
  }

  async connect() {
    return this;
  }

  async append(streamName, data) {
    if (this.#closed) throw new Error('Memory stream adapter is closed');
    const id = `memory-${++this.#sequence}`;
    const entry = { id, data, createdAt: this.clock() };
    const entries = this.#streams.get(streamName) ?? [];
    entries.push(entry);
    this.#streams.set(streamName, entries);
    this.#wake(streamName);
    return id;
  }

  publish(streamName, data) {
    return this.append(streamName, data);
  }

  async read(streamName, options = {}) {
    if (this.#closed) return [];
    const { group, count, blockMs } = normalizeReadOptions(options);
    const groupKey = `${streamName}:${group}`;
    const entries = this.#streams.get(streamName) ?? [];
    const state = this.#groups.get(groupKey) ?? { delivered: new Set(), pending: new Set() };
    const available = entries
      .filter((entry) => !state.delivered.has(entry.id) && !state.pending.has(entry.id))
      .slice(0, count);
    if (available.length > 0) {
      for (const entry of available) {
        state.delivered.add(entry.id);
        state.pending.add(entry.id);
      }
      this.#groups.set(groupKey, state);
      return available.map((entry) => ({ ...entry, stream: streamName }));
    }
    if (blockMs <= 0) return [];

    await this.#wait(streamName, blockMs);
    return this.read(streamName, { ...options, blockMs: 0 });
  }

  async recoverPending() {
    return [];
  }

  async ack(streamName, group, messageId) {
    const groupKey = `${streamName}:${group ?? DEFAULT_GROUP}`;
    const state = this.#groups.get(groupKey);
    if (!state?.pending.has(messageId)) return 0;
    state.pending.delete(messageId);
    return 1;
  }

  async health() {
    return { status: 'ok', mode: this.mode, degraded: this.degraded };
  }

  async metrics() {
    return { streamLength: 0, pendingCount: 0, degraded: this.degraded, mode: this.mode };
  }

  async close() {
    this.#closed = true;
    for (const waiters of this.#waiters.values()) {
      for (const waiter of waiters) waiter.resolve([]);
    }
    this.#waiters.clear();
    this.#groups.clear();
  }

  async size(streamName) {
    return (this.#streams.get(streamName) ?? []).length;
  }

  #wake(streamName) {
    const waiters = this.#waiters.get(streamName) ?? [];
    this.#waiters.delete(streamName);
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve();
    }
  }

  #wait(streamName, timeoutMs) {
    return new Promise((resolve) => {
      const waiter = {
        resolve,
        timeout: setTimeout(() => {
          const waiters = this.#waiters.get(streamName) ?? [];
          this.#waiters.set(
            streamName,
            waiters.filter((candidate) => candidate !== waiter)
          );
          resolve();
        }, timeoutMs)
      };
      const waiters = this.#waiters.get(streamName) ?? [];
      waiters.push(waiter);
      this.#waiters.set(streamName, waiters);
    });
  }
}

export class RedisStreamAdapter {
  constructor({ client, keyPrefix = '', group = DEFAULT_GROUP, consumer = `worker-${randomUUID()}`, ownsClient = false, logger = console } = {}) {
    if (!client) throw new TypeError('A Redis client is required');
    this.client = client;
    this.keyPrefix = keyPrefix;
    this.group = group;
    this.consumer = consumer;
    this.ownsClient = ownsClient;
    this.logger = logger;
    this.mode = 'redis';
    this.degraded = false;
    this.durable = true;
    this.#groups = new Set();
    this.client.on?.('error', (error) => {
      this.logger.warn?.({ error: error?.message ?? String(error) }, 'Redis stream client error');
    });
  }

  #groups;

  async connect() {
    if (this.client.isOpen === false && typeof this.client.connect === 'function') await this.client.connect();
    if (typeof this.client.ping === 'function') await this.client.ping();
    return this;
  }

  async append(streamName, data) {
    const key = streamKey(streamName, this.keyPrefix);
    const id = await this.client.xAdd(key, '*', { payload: JSON.stringify(data) });
    return id;
  }

  publish(streamName, data) {
    return this.append(streamName, data);
  }

  async read(streamName, options = {}) {
    const normalized = normalizeReadOptions({
      group: this.group,
      consumer: this.consumer,
      ...options
    });
    const key = streamKey(streamName, this.keyPrefix);
    await this.#ensureGroup(key, normalized.group);
    const response = await this.client.xReadGroup(
      normalized.group,
      normalized.consumer,
      [{ key, id: '>' }],
      { COUNT: normalized.count, BLOCK: normalized.blockMs }
    );
    if (!response) return [];
    const stream = response.find((item) => item.name === key) ?? response[0];
    return mapStreamMessages(stream?.messages, streamName);
  }

  async recoverPending(streamName, options = {}) {
    const normalized = normalizePendingOptions({
      group: this.group,
      consumer: this.consumer,
      ...options
    });
    const key = streamKey(streamName, this.keyPrefix);
    await this.#ensureGroup(key, normalized.group);

    const recovered = [];
    const visitedCursors = new Set();
    let cursor = '0-0';

    while (true) {
      const result = await this.client.xAutoClaim(
        key,
        normalized.group,
        normalized.consumer,
        normalized.minIdleMs,
        cursor,
        { COUNT: normalized.count }
      );
      recovered.push(...mapStreamMessages(result?.messages, streamName));

      const nextCursor = String(result?.nextId ?? '0-0');
      if (nextCursor === '0-0') break;
      if (nextCursor === cursor || visitedCursors.has(nextCursor)) {
        this.logger.warn?.({ streamName, group: normalized.group, cursor: nextCursor }, 'Redis pending recovery cursor did not advance');
        break;
      }
      visitedCursors.add(cursor);
      cursor = nextCursor;
    }

    return recovered;
  }

  async ack(streamName, group, messageId) {
    return this.client.xAck(streamKey(streamName, this.keyPrefix), group ?? this.group, messageId);
  }

  async health() {
    await this.client.ping();
    return { status: 'ok', mode: this.mode, degraded: this.degraded };
  }

  async metrics(streamName, { group = this.group } = {}) {
    const key = streamKey(streamName, this.keyPrefix);
    const [streamLength, pending] = await Promise.all([
      this.client.xLen(key),
      this.client.xPending(key, group)
    ]);
    return {
      streamLength: Number(streamLength ?? 0),
      pendingCount: Number(pending?.pending ?? 0),
      oldestPendingId: pending?.smallestId ?? null,
      mode: this.mode,
      degraded: this.degraded
    };
  }

  async close() {
    if (this.ownsClient && this.client.isOpen) await this.client.quit();
  }

  async #ensureGroup(key, group) {
    const groupKey = `${key}:${group}`;
    if (this.#groups.has(groupKey)) return;
    try {
      await this.client.xGroupCreate(key, group, '0-0', { MKSTREAM: true });
    } catch (error) {
      if (!String(error?.message ?? '').includes('BUSYGROUP')) throw error;
    }
    this.#groups.add(groupKey);
  }
}

/**
 * Uses Redis when available and switches to memory when Redis is absent or
 * becomes unavailable. The fallback is intentionally injectable for tests.
 */
export class ResilientStreamAdapter {
  #primary;
  #fallback;
  #logger;
  #active;

  constructor({ primary = null, fallback = new MemoryStreamAdapter(), logger = console, allowVolatileFallback = false } = {}) {
    this.#primary = primary;
    this.#fallback = fallback;
    this.#logger = logger;
    this.allowVolatileFallback = allowVolatileFallback;
    this.#active = primary ? 'primary' : 'fallback';
    this.degraded = false;
    this.mode = primary ? 'redis' : 'memory';
    this.durable = Boolean(primary && primary.durable !== false);
  }

  async initialize() {
    if (!this.#primary) return this;
    try {
      await this.#primary.connect();
    } catch (error) {
      await this.#degrade(error);
    }
    return this;
  }

  append(streamName, data) {
    return this.#run('append', [streamName, data]);
  }

  publish(streamName, data) {
    return this.append(streamName, data);
  }

  read(streamName, options = {}) {
    return this.#run('read', [streamName, options]);
  }

  ack(streamName, group, messageId) {
    return this.#run('ack', [streamName, group, messageId]);
  }

  recoverPending(streamName, options = {}) {
    return this.#run('recoverPending', [streamName, options]);
  }

  async health() {
    if (this.#active === 'fallback') return this.#fallback.health();
    try {
      return await this.#primary.health();
    } catch (error) {
      await this.#degrade(error);
      return this.#fallback.health();
    }
  }

  metrics(streamName, options = {}) {
    return this.#run('metrics', [streamName, options]);
  }

  async close() {
    const resources = [];
    if (this.#primary?.close) resources.push(this.#primary.close());
    if (this.#fallback?.close) resources.push(this.#fallback.close());
    await Promise.all(resources);
  }

  status() {
    return { mode: this.mode, degraded: this.degraded };
  }

  async #run(method, args) {
    if (this.#active === 'fallback') return this.#fallbackOrThrow(method, args);
    try {
      return await this.#primary[method](...args);
    } catch (error) {
      await this.#degrade(error);
      return this.#fallbackOrThrow(method, args);
    }
  }

  #fallbackOrThrow(method, args) {
    if (!this.allowVolatileFallback && ['append', 'publish', 'ack', 'recoverPending'].includes(method)) {
      throw new StreamUnavailableError();
    }
    return this.#fallback[method](...args);
  }

  async #degrade(error) {
    if (this.#active === 'fallback') return;
    this.#active = 'fallback';
    this.mode = 'memory';
    this.degraded = true;
    this.durable = false;
    this.#logger.warn?.({ error: error?.message ?? String(error) }, 'Redis stream adapter degraded to memory');
    try {
      await this.#primary?.close?.();
    } catch {
      // The fallback is still usable when Redis shutdown also fails.
    }
  }
}

export async function createStreamAdapter({
  redisUrl = process.env.REDIS_URL ?? process.env.VALKEY_URL,
  redisClient = null,
  fallback = new MemoryStreamAdapter(),
  keyPrefix = '',
  group = DEFAULT_GROUP,
  consumer = `worker-${randomUUID()}`,
  logger = console,
  allowVolatileFallback = false
} = {}) {
  if (!redisClient && !redisUrl) return new ResilientStreamAdapter({ fallback, logger, allowVolatileFallback: true });
  const client = redisClient ?? createClient({ url: redisUrl });
  const primary = new RedisStreamAdapter({
    client,
    keyPrefix,
    group,
    consumer,
    ownsClient: !redisClient,
    logger
  });
  const adapter = new ResilientStreamAdapter({ primary, fallback, logger, allowVolatileFallback });
  await adapter.initialize();
  return adapter;
}

export { DEFAULT_GROUP };
