# AccessMap operations runbook

This runbook is the S-011 operational foundation for the services currently in
the repository. It describes the repeatable container, health, scheduling, and
PostgreSQL backup operations. S-008, S-009, and S-010 application modules are
now present, but production certification still requires the real storage,
routing-provider, webhook transport, and disposable database/Valkey checks.

## Service topology

`infra/docker-compose.yml` defines these local, production-shaped service
boundaries:

| Service | Container entrypoint | Readiness signal |
| --- | --- | --- |
| `api` | `apps/api/src/server.mjs` | `GET /health`; `GET /readyz` for dependency readiness |
| `worker` | `workers/src/main.mjs` | Worker PID plus PostgreSQL and Redis/Valkey connectivity |
| `scheduler` | `infra/scheduler-entrypoint.sh` | Scheduler PID liveness |
| `postgres` | PostGIS 16 | `pg_isready` |
| `valkey` | Valkey 8 | `valkey-cli ping` |
| `storage` | LocalStack S3-compatible storage | LocalStack health endpoint |
| `mailpit` | Mailpit | Local SMTP/UI dependency; no production mail claim |

The API and worker images are stateless. PostgreSQL is the durable source of
truth. Valkey is a coordination and stream dependency; its loss must not be
treated as a database restore event. The scheduler is intended to run as one
replica unless the configured task provides its own distributed lock.

## Secret handling

- Do not commit `.env`, production URLs, passwords, API keys, certificates, or
  object-storage credentials.
- Supply production values through the deployment platform's secret manager.
- `infra/docker-compose.yml` has explicitly local-only development defaults so
  that a new checkout can render its configuration. Replace them for any
  shared environment.
- `DATABASE_URL` is read from the environment by the backup and restore
  scripts. The scripts do not print it.
- Keep backup files outside the repository with restrictive permissions.
- Never put private profiles, evidence, access tokens, or database connection
  URLs in scheduled command arguments or ordinary service logs.

## Local start and stop

From the repository root:

```sh
docker compose -f infra/docker-compose.yml up -d --build
docker compose -f infra/docker-compose.yml ps
curl --fail --silent http://127.0.0.1:3001/health
```

The API healthcheck includes the database check when `DATABASE_URL` is set.
The worker healthcheck checks its PID and its PostgreSQL and Valkey
connections. The scheduler starts in heartbeat mode when no task is
configured; this keeps the service boundary observable without inventing a
missing application job.

Stop the local stack without deleting data:

```sh
docker compose -f infra/docker-compose.yml down
```

To delete disposable local volumes, use the existing S-002/S-007 reset
procedures after reviewing their confirmation prompt. Those scripts remain
unchanged by this S-011 work.

## Deployment procedure

Use the same three Dockerfiles for API, worker, and scheduler image builds.
For staging or production, use managed PostgreSQL/PostGIS, managed
Redis/Valkey with TLS and ACLs, and an object-storage provider rather than the
local Compose dependencies.

1. Build and scan `Dockerfile.api`, `Dockerfile.worker`, and
   `Dockerfile.scheduler` from the same immutable source revision.
2. Push the three images to the environment's private registry.
3. Inject the environment-specific values from secret/config management:
   `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, storage settings, and
   `APP_VERSION`.
4. Apply reviewed database migrations using the environment's migration
   process. Do this before enabling traffic when the migration is not
   backward-compatible.
5. Start PostgreSQL/Redis/storage dependencies or verify their managed health.
6. Start the API deployment and wait for the API healthcheck to report ready.
7. Start workers independently and wait for their dependency readiness.
8. Start one scheduler replica with an idempotent scheduled task command.
9. Run the deployment smoke checks available for the environment, including
   API health, worker readiness, queue processing, and the relevant product
   flow tests.
10. Confirm error logs, backup freshness, queue/dead-letter state, and uptime
    monitoring before declaring the release available.

There is intentionally no migration command hidden in an image entrypoint.
That keeps deployment ordering and destructive database decisions visible to
the operator.

## Scheduler operation

The scheduler accepts a JSON array in `SCHEDULER_COMMAND`; it is not evaluated
as a shell command. This prevents shell metacharacters in an environment value
from changing the executed program or arguments. Example configuration:

```sh
SCHEDULER_COMMAND='["node","scripts/your-operational-task.mjs"]'
SCHEDULER_INTERVAL_SECONDS=3600
SCHEDULER_RUN_ON_START=false
SCHEDULER_MAX_RUNTIME_SECONDS=900
```

The configured task must be safe to retry, must not write secrets to stdout or
stderr, and must acquire a distributed lock before changing shared state if
more than one scheduler can run. A failed task is logged as failed and the
scheduler continues to the next interval. A malformed command or invalid
interval stops startup so configuration errors are visible.

The repository does not yet contain the application-specific freshness,
notification, cleanup, route, or integration scheduler handlers. Until those
are added, an empty command produces only an operational heartbeat.

## Health and operational checks

The image healthcheck helpers are intentionally outside application modules:

```sh
node scripts/http-healthcheck.mjs http://127.0.0.1:3001/health
node scripts/worker-healthcheck.mjs
node scripts/process-healthcheck.mjs scheduler
```

The API's `/health` response is the liveness/version contract. `/readyz`
returns HTTP 503 when a configured durable dependency is degraded. `/metrics`
exposes current process/cache counters in OpenMetrics text format. The worker
helper verifies process and dependency readiness, but it cannot inspect the
internal worker runtime without an application-owned health adapter.

For an environment with a load balancer, route traffic only to API containers
whose healthcheck succeeds. Alert on:

- API health failures or degraded database checks.
- Worker restart loops or PostgreSQL/Valkey readiness failures.
- Scheduler exits or repeated task failures.
- PostgreSQL backup age and failed backup jobs.
- Queue lag, retries, and dead-letter counts once the worker metrics adapter is
  connected.

## PostgreSQL backup

Create a custom-format dump outside the repository. The script refuses to
overwrite an existing path unless `--force` is explicit, rejects symlinks, and
writes through a private temporary file before the final rename:

```sh
umask 077
export DATABASE_URL
bash scripts/backup-postgres.sh \
  --output /secure/backups/accessmap-$(date -u +%Y%m%dT%H%M%SZ).dump
```

The backup job should use a platform-managed secret, retain multiple restore
points, encrypt files at rest, and record success/failure in the platform
monitoring system. This script covers PostgreSQL data and schema only; object
storage retention/versioning must be configured with the chosen storage
provider.

## PostgreSQL restore

Restore only into a deliberately selected target, preferably an isolated
database or staging clone. The script requires `--confirm`, validates the
archive before changing the target, uses `--clean --if-exists`, and runs in a
single transaction:

```sh
export DATABASE_URL
bash scripts/restore-postgres.sh \
  --input /secure/backups/accessmap-20261017T000000Z.dump \
  --confirm
```

Before a production restore:

1. Stop or drain API and worker writes to the target.
2. Confirm the target `DATABASE_URL` independently from the source backup.
3. Take a fresh backup of the current target if it is reachable.
4. Restore into an isolated target first and run schema/application checks.
5. Verify counts, migration state, and representative reads without exposing
   private records in logs.
6. Point the deployment at the restored target only after the checks pass.
7. Restart workers so their database connections and pending work are cleanly
   re-established.

The restore command is not a substitute for an object-storage restore or a
replay strategy for uncommitted external queue state. PostgreSQL remains the
recovery source for committed outbox records.

## Resilience drills

Run drills in disposable local or staging environments, record the result, and
avoid using production data in test output.

### Redis/Valkey interruption

```sh
docker compose -f infra/docker-compose.yml stop valkey
docker compose -f infra/docker-compose.yml ps
docker compose -f infra/docker-compose.yml start valkey
```

Verify that durable database reads/writes have the expected application-level
behavior, that the worker reconnect or restart policy is understood, and that
unacknowledged stream work remains recoverable. The operational foundation
does not claim the full S-007/S-008/S-009 failure matrix is complete.

### Worker restart with pending work

```sh
docker compose -f infra/docker-compose.yml restart worker
docker compose -f infra/docker-compose.yml logs --since=5m worker
```

Confirm the application worker's idempotency and retry behavior with a known
test event. Do not infer queue success from the process being alive alone.

### Backup restore rehearsal

Create a backup, restore it into a disposable target, and run the repository's
database checks against that target. Record the dump timestamp, target,
migration revision, validation result, and operator without recording the
connection string.

### External dependency failures

Use staging fault injection to test routing and storage timeouts once those
application adapters are deployed. The container and scheduler foundation
provides restart and health boundaries but cannot validate handlers that are
not present in this repository slice.

## Rollback and incident handling

- Roll back API/worker/scheduler images to the last known-good immutable tag
  when the database contract remains compatible.
- Prefer a forward fix for an already-applied backward-compatible migration.
- Do not run the restore script as a first response to an application error;
  preserve evidence and determine whether committed data is actually missing.
- For suspected data loss, stop affected writers, preserve logs/backup metadata,
  take a target backup if possible, and use the isolated restore procedure.
- Record start/end time, affected services, user impact, containment, fix, and
  the regression check in the incident record.

## Remaining application integration

The following work is deliberately left visible rather than represented as
completed by this infrastructure change:

- Expose worker runtime health/metrics from `runtime.health()` through an
  application-owned adapter.
- Add Prometheus/OpenTelemetry instrumentation for API latency/errors, queue
  lag/retries/dead letters, route work, evidence processing, and SSE/webhook
  delivery.
- Add the actual scheduled freshness, cleanup, notification, route, and
  integration tasks and configure their safe command/locking behavior.
- Complete production migration orchestration and object-storage backup/
  retention for the selected providers.
- Run the full auth, search, match, report, incident, route, queue, end-to-end,
  accessibility, and migration release checks once their application flows
  are integrated.
- Execute the real S-008 storage/worker, S-009 routing-provider, and S-010
  webhook-delivery acceptance checks before production approval.
