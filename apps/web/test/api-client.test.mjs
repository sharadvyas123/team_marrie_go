import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, apiErrorFromResponse } from '../lib/api/errors.js';
import { getApiJson } from '../lib/api/server-client.js';
import { formatDistance, normalizePlaceDetail, normalizePlaceSummary } from '../lib/api/normalizers.js';

test('API client returns JSON and attaches an accept and trace header', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ schemaVersion: 'place-search.v1', items: [], pagination: { page: 1, pageSize: 20, total: 0, hasNext: false } }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-trace-id': 'trace-search' }
    });
  };

  try {
    const payload = await getApiJson('/api/places', { searchParams: { query: 'library', page: 2 } });
    assert.equal(payload.pagination.page, 1);
    assert.match(requests[0].url, /127\.0\.0\.1:3001\/api\/places\?query=library&page=2/);
    assert.equal(requests[0].options.headers.Accept, 'application/json');
    assert.equal(typeof requests[0].options.headers['X-Trace-Id'], 'string');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API client preserves problem.v1 fields and trace ID', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    schemaVersion: 'problem.v1',
    title: 'Service unavailable',
    status: 503,
    detail: 'Database is offline.',
    code: 'DATABASE_UNAVAILABLE',
    traceId: 'trace-db'
  }), { status: 503, headers: { 'x-trace-id': 'trace-header' } });

  try {
    await assert.rejects(
      getApiJson('/api/places'),
      (error) => error instanceof ApiError
        && error.status === 503
        && error.code === 'DATABASE_UNAVAILABLE'
        && error.traceId === 'trace-db'
        && error.isUnavailable
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('normalizers preserve unknown claims instead of inventing a match', () => {
  const summary = normalizePlaceSummary({ id: 'place-1', name: 'A', category: 'library', claimSummary: [], activeIncidents: [] });
  const detail = normalizePlaceDetail({ id: 'place-1', name: 'A', category: 'library', claims: [], incidents: [] });
  assert.deepEqual(summary.claimSummary, []);
  assert.deepEqual(detail.accessGraph, { graphVersion: 0, nodes: [], edges: [] });
  assert.equal(formatDistance(null), 'Distance unavailable');
});

test('malformed API JSON produces a typed error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{not-json', { status: 200, headers: { 'x-trace-id': 'trace-bad' } });
  try {
    await assert.rejects(getApiJson('/api/places'), (error) => error instanceof ApiError && error.status === 502 && error.code === 'MALFORMED_RESPONSE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('problem parser uses response trace when the body omits it', async () => {
  const response = new Response(JSON.stringify({ title: 'Not found', status: 404, detail: 'Missing' }), { status: 404, headers: { 'x-trace-id': 'trace-404' } });
  const error = await apiErrorFromResponse(response);
  assert.equal(error.status, 404);
  assert.equal(error.traceId, 'trace-404');
  assert.equal(error.isNotFound, true);
});
