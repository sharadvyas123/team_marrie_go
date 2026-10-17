import { createShutdownController } from './shutdown.mjs';

/** Starts and stops the injected publisher, processors, and stream resources. */
export class WorkerRuntime {
  constructor({ publisher = null, processors = [], resources = [], shutdown = null, logger = console } = {}) {
    this.publisher = publisher;
    this.processors = processors;
    this.resources = resources;
    this.logger = logger;
    this.shutdownController = shutdown ?? createShutdownController({
      resources: [publisher, ...processors, ...resources].filter(Boolean),
      logger
    });
    this.started = false;
  }

  get signal() {
    return this.shutdownController.signal;
  }

  async start({ installSignals = true } = {}) {
    if (this.started) return this;
    if (installSignals) this.shutdownController.install();
    if (this.publisher?.start) await this.publisher.start({ signal: this.signal });
    for (const processor of this.processors) {
      if (processor.start) await processor.start({ signal: this.signal });
    }
    this.started = true;
    return this;
  }

  async stop(reason = 'shutdown') {
    await this.shutdownController.shutdown(reason);
    this.started = false;
  }

  async health() {
    const components = {};
    for (const [name, component] of [
      ['publisher', this.publisher],
      ...this.processors.map((processor, index) => [`processor-${index + 1}`, processor]),
      ...this.resources.map((resource, index) => [`resource-${index + 1}`, resource])
    ]) {
      if (typeof component?.health === 'function') components[name] = await component.health();
      else if (typeof component?.metrics === 'function') components[name] = await component.metrics();
    }
    return {
      status: Object.values(components).some((component) => component?.degraded) ? 'degraded' : 'ok',
      started: this.started,
      components
    };
  }
}

export function createWorkerRuntime(options) {
  return new WorkerRuntime(options);
}
