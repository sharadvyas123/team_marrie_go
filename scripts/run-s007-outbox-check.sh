#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="accessmap-local"
HOST_PORT="5433"
DATABASE_URL="postgresql://accessmap:local-only-not-secret@127.0.0.1:${HOST_PORT}/accessmap"
REDIS_URL="redis://127.0.0.1:6380"

cd "${ROOT_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  printf 'Error: Docker is required.\n' >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  printf 'Error: psql is required because the integration test connects through the host port.\n' >&2
  exit 1
fi

compose() {
  docker compose \
    -p "${PROJECT_NAME}" \
    -f <(sed "s/127.0.0.1:\${POSTGRES_HOST_PORT:-5432}:5432/127.0.0.1:${HOST_PORT}:5432/" "${ROOT_DIR}/infra/docker-compose.yml") \
    -f <(sed "s/127.0.0.1:\${VALKEY_HOST_PORT:-6379}:6379/127.0.0.1:6380:6379/" "${ROOT_DIR}/infra/docker-compose.yml") \
    "$@"
}

cleanup() {
  compose down --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT

if [[ "${1:-}" != "--yes" ]]; then
  printf 'This will delete the local Docker database and Valkey volumes for project %s.\n' "${PROJECT_NAME}"
  printf 'It will recreate both services and run the S-007 outbox and stream recovery tests.\n'
  read -r -p 'Continue? [y/N] ' answer
  if [[ "${answer,,}" != "y" ]]; then
    printf 'Cancelled.\n'
    exit 0
  fi
fi

printf 'Resetting the disposable local database...\n'
compose down --remove-orphans
docker volume rm "${PROJECT_NAME}_postgres-data" "${PROJECT_NAME}_valkey-data" 2>/dev/null || true
compose up -d postgres valkey

printf 'Waiting for PostgreSQL/PostGIS to accept TCP connections...\n'
ready=0
for _ in {1..60}; do
  if PGCONNECT_TIMEOUT=2 \
    psql -X -v ON_ERROR_STOP=1 "${DATABASE_URL}" -c 'SELECT 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "${ready}" != "1" ]]; then
  compose ps
  compose logs --no-color postgres || true
  printf 'Error: PostgreSQL did not become ready.\n' >&2
  exit 1
fi

printf 'Waiting for Valkey to accept connections...\n'
valkey_ready=0
for _ in {1..60}; do
  if [[ "$(compose exec -T valkey valkey-cli ping 2>/dev/null || true)" == "PONG" ]]; then
    valkey_ready=1
    break
  fi
  sleep 2
done

if [[ "${valkey_ready}" != "1" ]]; then
  compose ps
  compose logs --no-color valkey || true
  printf 'Error: Valkey did not become ready.\n' >&2
  exit 1
fi

printf 'Running the migration, repeatable seed, and schema boundary checks...\n'
TEST_DATABASE_URL="${DATABASE_URL}" \
  node --test supabase/test/schema-seed.integration.test.mjs

printf 'Running the concurrent S-007 PostgreSQL outbox lease test...\n'
TEST_DATABASE_URL="${DATABASE_URL}" \
  node --test workers/test/postgres-outbox.integration.test.mjs

printf 'Running the S-007 PostgreSQL idempotency and dead-letter test...\n'
TEST_DATABASE_URL="${DATABASE_URL}" \
  node --test workers/test/worker-durability.integration.test.mjs

printf 'Running the S-007 Valkey pending-message recovery test...\n'
TEST_REDIS_URL="${REDIS_URL}" \
  node --test workers/test/stream-adapter.integration.test.mjs

printf 'S-007 PostgreSQL outbox lease and Valkey stream recovery checks completed successfully.\n'
