# AccessMap release status

Updated 2026-10-17 after the S-008 through S-011 implementation pass.

## Delivered

- **S-008 EvidenceGuard:** upload metadata validation, private-original/public-derivative separation, processing states, signature/malware/privacy ports, sensitive-content holds, alt-text states, retry/idempotency behavior, cleanup, public/private serializers, database state migration, and worker handler wiring.
- **S-009 Routing:** bounded route requests, deterministic local seeded-graph routing, hard and soft accessibility constraints, unknown/stale/barrier explanations, route cache versioning, selective invalidation, incident lifecycle services, access-graph geometry, API routes, and public SSE payload filtering.
- **S-010 Facility/civic/webhooks:** facility scope enforcement, official responses separated from community history, incident acknowledgement/resolution, signed QR contexts, public civic serializers and pagination, optional civic API-key validation, HTTPS/SSRF-safe webhook validation, encrypted secret storage boundary, HMAC signing, replay protection, retry/idempotency state, and webhook worker/HTTP delivery adapters.
- **S-011 Operations:** API/worker/scheduler Compose services, container definitions, health/readiness/metrics endpoints, scheduler and process probes, guarded PostgreSQL backup/restore scripts, CI operations workflow, and runbook.

## Checks run

These checks passed in the current workspace:

```text
npm test                 # 94 passed, 4 skipped, 0 failed
npm run lint             # passed
npm run build            # 17 contract fixtures and Next.js production build passed
npm run check:health     # passed
bash scripts/check-operational-scripts.sh  # passed
git diff --check -- ':!opencode.json'     # passed
```

The four skipped tests are PostgreSQL/Valkey integration tests that require
external disposable services.

## Required environment verification before production use

The current sandbox does not provide Docker, so these checks remain unrun here:

```text
./scripts/run-s002-db-check.sh --yes
./scripts/run-s007-outbox-check.sh --yes
docker compose -f infra/docker-compose.yml config
docker compose -f infra/docker-compose.yml up -d --build
```

Before deployment, configure real values for `DATABASE_URL`, `AUTH_SECRET`,
`QR_SIGNING_SECRET`, `WEBHOOK_SECRET_ENCRYPTION_KEY`, object storage, and any
external routing provider. Evidence storage, public derivative URLs, external
routing, and outbound webhook delivery are intentionally dependency-injected;
the API returns a typed unavailable response rather than pretending those
providers are configured.

The local routing engine supports seeded access graphs. City-wide routing still
requires an injected OSRM, Valhalla, GraphHopper, or equivalent adapter.
