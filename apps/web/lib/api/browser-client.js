import { ApiError, apiErrorFromResponse } from './errors.js';

const BFF_PREFIX = '/api/accessmap';

function buildUrl(pathname, searchParams) {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const url = new URL(`${BFF_PREFIX}${path}`, window.location.origin);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, String(item)));
      else url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export async function getBrowserJson(pathname, { searchParams, signal } = {}) {
  const response = await fetch(buildUrl(pathname, searchParams), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
    cache: 'no-store'
  });

  if (!response.ok) throw await apiErrorFromResponse(response);
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
