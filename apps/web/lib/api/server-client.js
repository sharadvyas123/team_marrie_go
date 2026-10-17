import { randomUUID } from 'node:crypto';
import { ApiError, apiErrorFromResponse } from './errors.js';

const DEFAULT_API_URL = 'http://127.0.0.1:3001';
const DEFAULT_TIMEOUT_MS = 8000;

function apiBaseUrl() {
  return (process.env.ACCESSMAP_API_URL || DEFAULT_API_URL).replace(/\/$/, '');
}

function buildUrl(pathname, searchParams) {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const url = new URL(`${apiBaseUrl()}${path}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, String(item)));
      else url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export async function apiFetch(pathname, {
  method = 'GET',
  searchParams,
  headers = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal
} = {}) {
  const traceId = headers['X-Trace-Id'] ?? headers['x-trace-id'] ?? randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(buildUrl(pathname, searchParams), {
      method,
      headers: {
        Accept: 'application/json',
        'X-Trace-Id': traceId,
        ...headers
      },
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!response.ok) throw await apiErrorFromResponse(response);
    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === 'AbortError') {
      throw new ApiError({
        status: 504,
        title: 'Request timed out',
        detail: 'The directory took too long to respond. Please try again.',
        code: 'UPSTREAM_TIMEOUT',
        traceId,
        cause: error
      });
    }
    throw new ApiError({
      status: 503,
      title: 'Service unavailable',
      detail: 'The directory could not be reached. Please try again.',
      code: 'UPSTREAM_UNAVAILABLE',
      traceId,
      cause: error
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function getApiJson(pathname, options = {}) {
  const response = await apiFetch(pathname, options);
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch (error) {
    throw new ApiError({
      status: 502,
      title: 'Invalid API response',
      detail: 'The directory returned an unreadable response. Please try again.',
      code: 'MALFORMED_RESPONSE',
      traceId: response.headers.get('x-trace-id'),
      cause: error
    });
  }
}

export const apiConfig = Object.freeze({
  defaultBaseUrl: DEFAULT_API_URL,
  timeoutMs: DEFAULT_TIMEOUT_MS
});
