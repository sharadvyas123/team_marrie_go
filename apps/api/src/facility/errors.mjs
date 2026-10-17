const DEFAULT_PROBLEM_TYPE = 'https://accessmap.example/problems/facility';

export class FacilityError extends Error {
  constructor(code, detail, { status = 400, title = 'Facility operation failed', field, cause } = {}) {
    super(detail, cause ? { cause } : undefined);
    this.name = 'FacilityError';
    this.code = code;
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.type = DEFAULT_PROBLEM_TYPE;
    if (field) this.field = field;
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

export function facilityValidationError(code, detail, field) {
  return new FacilityError(code, detail, { field });
}

export function createFacilityProblem(error) {
  if (error instanceof FacilityError) return error.toProblem();
  return {
    schemaVersion: 'problem.v1',
    type: DEFAULT_PROBLEM_TYPE,
    title: 'Facility operation failed',
    status: 500,
    detail: 'The facility operation could not be completed.',
    code: 'FACILITY_OPERATION_ERROR'
  };
}
