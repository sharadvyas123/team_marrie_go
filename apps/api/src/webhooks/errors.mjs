const DEFAULT_PROBLEM_TYPE = 'https://accessmap.example/problems/webhook';

export class WebhookError extends Error {
  constructor(code, detail, { status = 400, title = 'Webhook operation failed', field, retryAfter, cause } = {}) {
    super(detail, cause ? { cause } : undefined);
    this.name = 'WebhookError';
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

export function webhookValidationError(code, detail, field) {
  return new WebhookError(code, detail, { field });
}

export function createWebhookProblem(error) {
  if (error instanceof WebhookError) return error.toProblem();
  return {
    schemaVersion: 'problem.v1',
    type: DEFAULT_PROBLEM_TYPE,
    title: 'Webhook operation failed',
    status: 500,
    detail: 'The webhook operation could not be completed.',
    code: 'WEBHOOK_OPERATION_ERROR'
  };
}
