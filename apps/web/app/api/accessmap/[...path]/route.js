import { randomUUID } from 'node:crypto';

const DEFAULT_API_URL = 'http://127.0.0.1:3001';
const ALLOWED_PATHS = [
  /^categories$/,
  /^features$/,
  /^places$/,
  /^places\/[^/]+$/,
  /^places\/[^/]+\/(claims|incidents|access-graph)$/,
  /^session$/
];

function problem(status, title, detail, traceId) {
  return Response.json({
    schemaVersion: 'problem.v1',
    type: 'https://accessmap.example/problems/bff',
    title,
    status,
    detail,
    traceId
  }, {
    status,
    headers: { 'X-Trace-Id': traceId, 'Cache-Control': 'no-store' }
  });
}

function upstreamUrl(path, requestUrl) {
  const base = (process.env.ACCESSMAP_API_URL || DEFAULT_API_URL).replace(/\/$/, '');
  const url = new URL(`${base}/api/${path}`);
  requestUrl.searchParams.forEach((value, key) => url.searchParams.append(key, value));
  return url;
}

async function forward(request, context) {
  const traceId = request.headers.get('x-trace-id') || randomUUID();
  if (request.method !== 'GET') {
    return problem(405, 'Method not allowed', 'This browser API route currently supports GET requests only.', traceId);
  }

  const params = await context.params;
  const pathSegments = Array.isArray(params?.path) ? params.path : [];
  const path = pathSegments.map((segment) => encodeURIComponent(segment)).join('/');
  if (!ALLOWED_PATHS.some((pattern) => pattern.test(path))) {
    return problem(404, 'Resource not found', 'This API path is not available through the web boundary.', traceId);
  }

  try {
    const upstream = await fetch(upstreamUrl(path, new URL(request.url)), {
      method: 'GET',
      headers: {
        Accept: request.headers.get('accept') || 'application/json',
        'X-Trace-Id': traceId,
        ...(request.headers.get('authorization') ? { Authorization: request.headers.get('authorization') } : {})
      },
      cache: 'no-store'
    });
    const body = await upstream.arrayBuffer();
    const headers = new Headers();
    for (const name of ['content-type', 'cache-control', 'x-trace-id']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
    if (!headers.has('x-trace-id')) headers.set('x-trace-id', traceId);
    return new Response(body, { status: upstream.status, headers });
  } catch {
    return problem(503, 'Service unavailable', 'The directory API could not be reached. Please try again.', traceId);
  }
}

export async function GET(request, context) {
  return forward(request, context);
}

export async function POST(request, context) {
  return forward(request, context);
}
