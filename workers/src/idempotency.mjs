/**
 * A small process-local idempotency store for tests and single-process workers.
 * Production deployments can inject a Redis or database-backed implementation
 * with the same claim/complete/release methods.
 */
export class MemoryIdempotencyStore {
  #records = new Map();

  async claim(key) {
    const existing = this.#records.get(String(key));
    if (existing?.state === 'completed') {
      return { acquired: false, state: 'completed', result: existing.result };
    }
    if (existing?.state === 'processing') {
      return { acquired: false, state: 'processing' };
    }

    this.#records.set(String(key), { state: 'processing', claimedAt: new Date().toISOString() });
    return { acquired: true, state: 'processing' };
  }

  async complete(key, result = null) {
    this.#records.set(String(key), {
      state: 'completed',
      result,
      completedAt: new Date().toISOString()
    });
  }

  async release(key) {
    const normalizedKey = String(key);
    const existing = this.#records.get(normalizedKey);
    if (existing?.state === 'processing') this.#records.delete(normalizedKey);
  }

  async get(key) {
    return this.#records.get(String(key)) ?? null;
  }

  clear() {
    this.#records.clear();
  }
}

export function jobIdempotencyKey(job) {
  const key = job?.idempotencyKey ?? job?.eventId ?? job?.id;
  if (key === undefined || key === null || String(key).length === 0) {
    throw new TypeError('A job idempotencyKey, eventId, or id is required');
  }
  return String(key);
}
