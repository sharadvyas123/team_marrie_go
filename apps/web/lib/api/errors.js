export class ApiError extends Error {
  constructor({
    status = 500,
    title = 'Request failed',
    detail = 'The request could not be completed.',
    code = null,
    traceId = null,
    cause = undefined
  } = {}) {
    super(detail, { cause });
    this.name = 'ApiError';
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.code = code;
    this.traceId = traceId;
  }

  get isNotFound() {
    return this.status === 404;
  }

  get isUnavailable() {
    return this.status === 408 || this.status === 502 || this.status === 503 || this.status === 504;
  }

  get userMessage() {
    if (this.status === 404) return 'That place could not be found.';
    if (this.isUnavailable) return 'The directory is temporarily unavailable. Please try again.';
    if (this.status === 429) return 'Too many requests. Please wait a moment and try again.';
    if (this.status === 401 || this.status === 403) return 'You do not have permission to view this information.';
    return this.detail || 'The request could not be completed.';
  }

  toJSON() {
    return {
      status: this.status,
      title: this.title,
      detail: this.detail,
      code: this.code,
      traceId: this.traceId,
      userMessage: this.userMessage
    };
  }
}

export function apiErrorFromUnknown(error) {
  if (error instanceof ApiError) return error;
  return new ApiError({
    status: 503,
    title: 'Service unavailable',
    detail: 'The directory could not be reached. Please try again.',
    code: 'UPSTREAM_UNAVAILABLE',
    cause: error
  });
}

export async function apiErrorFromResponse(response) {
  const traceId = response.headers.get('x-trace-id');
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Preserve a useful typed error when an upstream returns invalid JSON.
  }

  return new ApiError({
    status: response.status,
    title: typeof body?.title === 'string' ? body.title : `Request failed (${response.status})`,
    detail: typeof body?.detail === 'string' ? body.detail : response.statusText || 'The request could not be completed.',
    code: typeof body?.code === 'string' ? body.code : null,
    traceId: body?.traceId ?? traceId
  });
}

export function serializeApiError(error) {
  return apiErrorFromUnknown(error).toJSON();
}

export function deserializeApiError(value) {
  if (!value) return null;
  return new ApiError(value);
}
