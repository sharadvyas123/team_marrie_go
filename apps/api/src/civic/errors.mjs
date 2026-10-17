const DEFAULT_PROBLEM_TYPE = 'https://accessmap.example/problems/civic';

export class CivicError extends Error {
  constructor(code, detail, { status = 400, title = 'Civic API request failed', field, retryAfter, cause } = {}) {
    super(detail, cause ? { cause } : undefined);
    this.name = 'CivicError';
    this.code = code;
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.type = DEFAULT_PROBLEM_TYPE;
    if (field) this.field = field;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
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

export function civicValidationError(code, detail, field) {
  return new CivicError(code, detail, { field });
}

export function createCivicProblem(error) {
  if (error instanceof CivicError) return error.toProblem();
  return {
    schemaVersion: 'problem.v1',
    type: DEFAULT_PROBLEM_TYPE,
    title: 'Civic API request failed',
    status: 500,
    detail: 'The civic API request could not be completed.',
    code: 'CIVIC_API_ERROR'
  };
}
