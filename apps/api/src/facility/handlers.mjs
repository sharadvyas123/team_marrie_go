/**
 * Transport-neutral route adapters. The shared server can map its request
 * shape to `{ params, query, body, context }` without moving facility policy
 * into the router.
 */
export function createFacilityHandlers({ service } = {}) {
  if (!service || typeof service !== 'object') throw new TypeError('A facility service is required.');
  return {
    requestClaim: (request) => created(service.requestClaim(requestBody(request), requestContext(request))),
    listPlaces: (request) => ok(service.listPlaces(requestQuery(request), requestContext(request))),
    getPlace: (request) => ok(service.getPlace(requestParam(request, 'placeId'), requestContext(request))),
    createResponse: (request) => created(service.createResponse(requestBody(request), requestContext(request))),
    updateResponse: (request) => ok(service.updateResponse(requestParam(request, 'responseId'), requestBody(request), requestContext(request))),
    createIncident: (request) => created(service.createIncident(requestBody(request), requestContext(request))),
    updateIncident: (request) => ok(service.updateIncident(requestParam(request, 'incidentId'), requestBody(request), requestContext(request))),
    acknowledgeIncident: (request) => ok(service.acknowledgeIncident(requestParam(request, 'incidentId'), requestContext(request))),
    resolveIncident: (request) => ok(service.resolveIncident(requestParam(request, 'incidentId'), requestBody(request), requestContext(request))),
    createQrCode: (request) => created(service.createQrCode(requestBody(request), requestContext(request))),
    validateQrContext: (request) => ok(service.validateQrContext(requestBody(request).token, requestBody(request).options ?? {}))
  };
}

function requestBody(request = {}) { return request.body ?? request.input ?? {}; }
function requestQuery(request = {}) { return request.query ?? {}; }
function requestContext(request = {}) { return request.context ?? {}; }
function requestParam(request = {}, name) { return request.params?.[name] ?? request[name]; }
function ok(body) { return Promise.resolve(body).then((value) => ({ status: 200, body: value })); }
function created(body) { return Promise.resolve(body).then((value) => ({ status: 201, body: value })); }
