/** Transport-neutral adapters for versioned public civic routes. */
export function createCivicHandlers({ service } = {}) {
  if (!service || typeof service !== 'object') throw new TypeError('A civic service is required.');
  return {
    getPlaceAccessibility: (request) => ok(service.getPlaceAccessibility(param(request, 'placeId'), context(request))),
    listIncidents: (request) => ok(service.listIncidents(query(request), context(request))),
    listChanges: (request) => ok(service.listChanges(query(request), context(request)))
  };
}

function param(request = {}, name) { return request.params?.[name] ?? request[name]; }
function query(request = {}) { return request.query ?? {}; }
function context(request = {}) { return request.context ?? {}; }
function ok(body) { return Promise.resolve(body).then((value) => ({ status: 200, body: value })); }
