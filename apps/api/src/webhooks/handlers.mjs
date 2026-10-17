/** Transport-neutral adapters for the authenticated webhook management API. */
export function createWebhookHandlers({ service } = {}) {
  if (!service || typeof service !== 'object') throw new TypeError('A webhook service is required.');
  return {
    createSubscription: (request) => created(service.createSubscription(request.body ?? {}, request.context ?? {})),
    getSubscription: (request) => ok(service.getSubscription(param(request, 'subscriptionId'), request.context ?? {})),
    listSubscriptions: (request) => ok(service.listSubscriptions(request.context ?? {})),
    getDelivery: (request) => ok(service.getDelivery(param(request, 'deliveryId'), request.context ?? {})),
    pauseSubscription: (request) => ok(service.pauseSubscription(param(request, 'subscriptionId'), request.context ?? {})),
    revokeSubscription: (request) => ok(service.revokeSubscription(param(request, 'subscriptionId'), request.context ?? {})),
    getDelivery: (request) => ok(service.getDelivery(param(request, 'deliveryId'), request.context ?? {}))
  };
}

function param(request = {}, name) { return request.params?.[name] ?? request[name]; }
function ok(body) { return Promise.resolve(body).then((value) => ({ status: 200, body: value })); }
function created(body) { return Promise.resolve(body).then((value) => ({ status: 201, body: value })); }
