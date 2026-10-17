import { createClient } from 'redis';

function now() {
  return Date.now();
}

export class MemoryCache {
  constructor() {
    this.entries = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  async get(key) {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= now()) {
      this.entries.delete(key);
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    return entry.value;
  }

  async set(key, value, ttlSeconds = 60) {
    this.entries.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
  }

  async delete(key) {
    this.entries.delete(key);
  }

  async deleteByPrefix(prefix) {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  async invalidateByScopes(scopes = []) {
    const target = new Set(scopes);
    let removed = 0;
    for (const key of this.entries.keys()) {
      if (routeKeyScopes(key).some((scope) => target.has(scope))) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return { removed };
  }

  async invalidateAffected(message = {}) {
    return this.invalidateByScopes(message.scopes ?? message.affectedScopes ?? []);
  }

  async stats() {
    return { hits: this.hits, misses: this.misses, degraded: true };
  }

  async close() {}
}

class RedisCache {
  constructor(client) {
    this.client = client;
    this.hits = 0;
    this.misses = 0;
  }

  async get(key) {
    const value = await this.client.get(key);
    if (value === null) {
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    return JSON.parse(value);
  }

  async set(key, value, ttlSeconds = 60) {
    await this.client.set(key, JSON.stringify(value), { EX: ttlSeconds });
  }

  async delete(key) {
    await this.client.del(key);
  }

  async deleteByPrefix(prefix) {
    for await (const key of this.client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
      await this.client.del(key);
    }
  }

  async invalidateByScopes(scopes = []) {
    const target = new Set(scopes);
    let removed = 0;
    for await (const key of this.client.scanIterator({ MATCH: 'route:v*', COUNT: 100 })) {
      if (routeKeyScopes(key).some((scope) => target.has(scope))) {
        removed += await this.client.del(key);
      }
    }
    return { removed };
  }

  async invalidateAffected(message = {}) {
    return this.invalidateByScopes(message.scopes ?? message.affectedScopes ?? []);
  }

  async stats() {
    return { hits: this.hits, misses: this.misses, degraded: false };
  }

  async close() {
    if (this.client.isOpen) await this.client.quit();
  }
}

function routeKeyScopes(key) {
  if (typeof key !== 'string') return [];
  const marker = ':s';
  const start = key.indexOf(marker);
  const end = key.indexOf(':', start + marker.length);
  if (start < 0 || end < 0) return [];
  try {
    return decodeURIComponent(key.slice(start + marker.length, end)).split(',').filter(Boolean);
  } catch {
    return [];
  }
}

export async function createCache({ url = process.env.REDIS_URL ?? process.env.VALKEY_URL } = {}) {
  if (!url) return new MemoryCache();

  const client = createClient({ url });
  client.on('error', () => {});
  try {
    await client.connect();
    return new RedisCache(client);
  } catch {
    if (client.isOpen) await client.quit();
    return new MemoryCache();
  }
}
