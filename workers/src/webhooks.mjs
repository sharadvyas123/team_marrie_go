const WEBHOOK_DELIVERY_EVENTS = new Set(['webhook.delivery.requested']);

export function createWebhookHandlers({ webhookService }) {
  if (!webhookService || typeof webhookService.deliver !== 'function') {
    throw new TypeError('webhookService.deliver is required');
  }
  return {
    async handle(job) {
      if (!WEBHOOK_DELIVERY_EVENTS.has(job.type)) return { ignored: true, eventType: job.type };
      const subscriptionId = job.payload?.subscriptionId;
      const event = job.payload?.event ?? job.payload?.publicEvent;
      if (typeof subscriptionId !== 'string' || !event || typeof event !== 'object') {
        const error = new Error('Webhook delivery event is missing subscriptionId or public event.');
        error.code = 'INVALID_WEBHOOK_DELIVERY_EVENT';
        throw error;
      }
      return webhookService.deliver(subscriptionId, event, { eventId: job.eventId ?? job.id });
    }
  };
}

export { WEBHOOK_DELIVERY_EVENTS };
