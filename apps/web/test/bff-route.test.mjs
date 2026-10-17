import assert from 'node:assert/strict';
import test from 'node:test';
import { GET, POST } from '../app/api/accessmap/[...path]/route.js';

test('BFF forwards approved GET paths to the server-only API origin', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ schemaVersion: 'place-search.v1', items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-trace-id': 'trace-upstream' }
    });
  };

  try {
    const request = new Request('http://localhost:3000/api/accessmap/places?query=library', {
      headers: {
        Accept: 'application/json',
        Cookie: 'session=private',
        Authorization: 'Bearer test-token',
        'X-Trace-Id': 'trace-client'
      }
    });
    const response = await GET(request, { params: Promise.resolve({ path: ['places'] }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-trace-id'), 'trace-upstream');
    assert.match(calls[0].url, /127\.0\.0\.1:3001\/api\/places\?query=library/);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
    assert.equal(calls[0].options.headers.Cookie, undefined);
    assert.equal(calls[0].options.headers['X-Trace-Id'], 'trace-client');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('BFF rejects unapproved paths and mutation methods', async () => {
  const pathResponse = await GET(new Request('http://localhost:3000/api/accessmap/admin/secrets'), { params: Promise.resolve({ path: ['admin', 'secrets'] }) });
  assert.equal(pathResponse.status, 404);

  const methodResponse = await POST(new Request('http://localhost:3000/api/accessmap/places', { method: 'POST' }), { params: Promise.resolve({ path: ['places'] }) });
  assert.equal(methodResponse.status, 405);
});

test('BFF returns a typed unavailable problem when upstream is unreachable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const response = await GET(new Request('http://localhost:3000/api/accessmap/features'), { params: Promise.resolve({ path: ['features'] }) });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.schemaVersion, 'problem.v1');
    assert.equal(body.status, 503);
    assert.ok(body.traceId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
