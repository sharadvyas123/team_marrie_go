const target = process.argv[2];
const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS ?? 4_000);

if (!target || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
  throw new Error('Usage: node scripts/http-healthcheck.mjs <url> with HEALTHCHECK_TIMEOUT_MS between 100 and 60000.');
}

const response = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) });
const body = await response.text();
let payload;

try {
  payload = JSON.parse(body);
} catch {
  throw new Error(`Health endpoint returned non-JSON content with status ${response.status}.`);
}

if (!response.ok || payload.status !== 'ok') {
  throw new Error(`Health endpoint is not ready: HTTP ${response.status}, status ${payload.status ?? 'missing'}.`);
}

process.stdout.write(`Health endpoint ready: ${target}\n`);
