function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Graceful shutdown timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

/** Coordinates aborting loops and closing injected resources on process exit. */
export class ShutdownController {
  constructor({ resources = [], timeoutMs = 10_000, logger = console, signals = ['SIGTERM', 'SIGINT'] } = {}) {
    this.resources = resources;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.signals = signals;
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.#installed = false;
    this.#shutdownPromise = null;
    this.#handlers = new Map();
  }

  #installed;
  #shutdownPromise;
  #handlers;

  install() {
    if (this.#installed) return this;
    for (const signalName of this.signals) {
      const handler = () => {
        void this.shutdown(signalName);
      };
      process.once(signalName, handler);
      this.#handlers.set(signalName, handler);
    }
    this.#installed = true;
    return this;
  }

  async shutdown(reason = 'shutdown') {
    if (this.#shutdownPromise) return this.#shutdownPromise;
    this.#shutdownPromise = this.#close(reason);
    return this.#shutdownPromise;
  }

  async #close(reason) {
    this.controller.abort(new Error(String(reason)));
    for (const [signalName, handler] of this.#handlers) process.removeListener(signalName, handler);
    this.#handlers.clear();

    try {
      await withTimeout(
        Promise.all(
          this.resources.map(async (resource) => {
            if (typeof resource.stop === 'function') return resource.stop({ reason, signal: this.signal });
            if (typeof resource.close === 'function') return resource.close();
            return undefined;
          })
        ),
        this.timeoutMs
      );
    } catch (error) {
      this.logger.error?.({ reason, error: error?.message ?? String(error) }, 'Graceful shutdown failed');
      throw error;
    }
  }
}

export function createShutdownController(options) {
  return new ShutdownController(options);
}
