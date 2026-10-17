#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

for script in "${ROOT_DIR}"/infra/*.sh "${ROOT_DIR}"/scripts/*.sh; do
  [[ -f "${script}" ]] || continue
  bash -n "${script}"
done

for script in \
  "${ROOT_DIR}/scripts/http-healthcheck.mjs" \
  "${ROOT_DIR}/scripts/process-healthcheck.mjs" \
  "${ROOT_DIR}/scripts/scheduler.mjs" \
  "${ROOT_DIR}/scripts/worker-healthcheck.mjs"; do
  node --check "${script}"
done

if SCHEDULER_COMMAND='not-json' node "${ROOT_DIR}/scripts/scheduler.mjs" >/dev/null 2>&1; then
  printf 'Error: scheduler accepted a non-JSON command.\n' >&2
  exit 1
fi

if DATABASE_URL='' bash "${ROOT_DIR}/scripts/backup-postgres.sh" --output /tmp/accessmap-test.dump >/dev/null 2>&1; then
  printf 'Error: backup accepted a missing DATABASE_URL.\n' >&2
  exit 1
fi

temporary_input="$(mktemp)"
trap 'rm -f -- "${temporary_input}"' EXIT
if DATABASE_URL='postgresql://invalid' bash "${ROOT_DIR}/scripts/restore-postgres.sh" --input "${temporary_input}" >/dev/null 2>&1; then
  printf 'Error: restore accepted a missing --confirm flag.\n' >&2
  exit 1
fi

printf 'Operational shell syntax and destructive-argument checks passed.\n'
