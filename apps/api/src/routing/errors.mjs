const ROUTING_TYPE = 'https://accessmap.example/problems/routing';

export class RoutingServiceError extends Error {
  constructor(code, detail, { status = 503, cause } = {}) {
    super(detail, cause ? { cause } : undefined);
    this.name = 'RoutingServiceError';
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.title = 'Route service unavailable';
    this.type = ROUTING_TYPE;
  }

  toProblem() {
    return {
      schemaVersion: 'problem.v1',
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
      code: this.code
    };
  }
}

export function createRoutingServiceProblem(error) {
  if (typeof error?.toProblem === 'function') return error.toProblem();
  return {
    schemaVersion: 'problem.v1',
    type: ROUTING_TYPE,
    title: 'Route service failed',
    status: Number.isInteger(error?.status) ? error.status : 500,
    detail: Number.isInteger(error?.status) ? error.message : 'The route could not be calculated.',
    code: error?.code ?? 'ROUTE_CALCULATION_FAILED'
  };
}
