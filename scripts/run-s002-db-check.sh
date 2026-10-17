#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="accessmap-local"
HOST_PORT="5433"
DATABASE_URL="postgresql://accessmap:local-only-not-secret@127.0.0.1:${HOST_PORT}/accessmap"

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
    "$@"
}

cleanup() {
  compose down --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT

if [[ "${1:-}" != "--yes" ]]; then
  printf 'This will delete only the local Docker database volume for project %s.\n' "${PROJECT_NAME}"
  printf 'It will recreate the database and run the S-002 migration/seed test.\n'
  read -r -p 'Continue? [y/N] ' answer
  if [[ "${answer,,}" != "y" ]]; then
    printf 'Cancelled.\n'
    exit 0
  fi
fi

printf 'Resetting the disposable local database...\n'
compose down -v --remove-orphans
compose up -d postgres

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

printf 'Running the migration, repeatable seed, and S-002/S-007 boundary checks...\n'
TEST_DATABASE_URL="${DATABASE_URL}" \
  node --test supabase/test/schema-seed.integration.test.mjs

printf 'S-002/S-007 database check completed successfully.\n'
