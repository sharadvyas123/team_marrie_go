const ROUTING_PROBLEM_TYPE = 'https://accessmap.example/problems/routing';

export class RouteRequestError extends Error {
  constructor(detail, { code = 'ROUTE_REQUEST_INVALID', field = null, status = 422, cause } = {}) {
    super(detail, cause ? { cause } : undefined);
    this.name = 'RouteRequestError';
    this.code = code;
    this.field = field;
    this.status = status;
    this.title = status === 400 ? 'Invalid route request' : 'Invalid route request';
    this.type = ROUTING_PROBLEM_TYPE;
    this.detail = detail;
  }

  toProblem() {
    return {
      schemaVersion: 'problem.v1',
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
      code: this.code,
      ...(this.field ? { field: this.field } : {})
    };
  }
}

export function routeRequestError(code, detail, options = {}) {
  return new RouteRequestError(detail, { ...options, code });
}

export function createRoutingProblem(error) {
  if (error instanceof RouteRequestError) return error.toProblem();
  return {
    schemaVersion: 'problem.v1',
    type: ROUTING_PROBLEM_TYPE,
    title: 'Route request failed',
    status: Number.isInteger(error?.status) ? error.status : 500,
    detail: Number.isInteger(error?.status)
      ? error.message
      : 'The route request could not be completed.',
    code: error?.code ?? 'ROUTE_REQUEST_FAILED'
  };
}
