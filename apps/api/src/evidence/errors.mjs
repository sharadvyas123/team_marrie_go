const DEFAULT_PROBLEM_TYPE = 'https://accessmap.example/problems/evidence';

/**
 * Error exposed by the evidence boundary. The detail is safe for an HTTP
 * adapter; storage, upload, and scanner details belong in the cause only.
 */
export class EvidenceError extends Error {
  constructor({
    code,
    status = 422,
    title = 'Evidence request failed',
    detail = 'The evidence request could not be completed.',
    type = DEFAULT_PROBLEM_TYPE,
    cause
  }) {
    super(detail, cause ? { cause } : undefined);
    this.name = 'EvidenceError';
    this.code = code;
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.type = type;
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

export function evidenceValidationError(code, detail, options = {}) {
  return new EvidenceError({
    code,
    status: options.status ?? 422,
    title: options.title ?? 'Invalid evidence request',
    detail,
    cause: options.cause
  });
}

export function createEvidenceProblem(error) {
  if (error instanceof EvidenceError) return error.toProblem();

  return {
    schemaVersion: 'problem.v1',
    type: DEFAULT_PROBLEM_TYPE,
    title: 'Evidence request failed',
    status: 500,
    detail: 'The evidence operation could not be completed.',
    code: 'EVIDENCE_OPERATION_FAILED'
  };
}
