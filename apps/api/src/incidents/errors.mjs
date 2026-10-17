const INCIDENT_TYPE = 'https://accessmap.example/problems/incidents';

export class IncidentError extends Error {
  constructor(code, detail, { status = 422, field = null, cause } = {}) {
    super(detail, cause ? { cause } : undefined);
    this.name = 'IncidentError';
    this.code = code;
    this.status = status;
    this.field = field;
    this.detail = detail;
    this.title = status === 404 ? 'Incident not found' : 'Invalid incident request';
    this.type = INCIDENT_TYPE;
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

export function incidentValidationError(code, detail, field = null) {
  return new IncidentError(code, detail, { field });
}

export function createIncidentProblem(error) {
  if (error instanceof IncidentError) return error.toProblem();
  return {
    schemaVersion: 'problem.v1',
    type: INCIDENT_TYPE,
    title: 'Incident request failed',
    status: Number.isInteger(error?.status) ? error.status : 500,
    detail: Number.isInteger(error?.status) ? error.message : 'The incident operation could not be completed.',
    code: error?.code ?? 'INCIDENT_OPERATION_FAILED'
  };
}
