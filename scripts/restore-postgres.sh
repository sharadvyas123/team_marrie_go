#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  printf 'Usage: DATABASE_URL=... %s --input PATH --confirm\n' "$(basename -- "$0")" >&2
}

input=''
confirmed=0

while (($# > 0)); do
  case "$1" in
    --input)
      if (($# < 2)); then
        printf 'Error: --input needs a path.\n' >&2
        usage
        exit 2
      fi
      input=$2
      shift 2
      ;;
    --confirm)
      confirmed=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Error: unknown argument: %s\n' "$1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ "${confirmed}" != '1' ]]; then
  printf 'Error: restore is destructive; pass the explicit --confirm flag.\n' >&2
  exit 2
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  printf 'Error: DATABASE_URL must be supplied through the environment.\n' >&2
  exit 2
fi
if [[ -z "${input}" || "${input}" == -* ]]; then
  printf 'Error: --input must be a non-option path.\n' >&2
  usage
  exit 2
fi
if [[ -L "${input}" || ! -f "${input}" ]]; then
  printf 'Error: input must be an existing regular file and may not be a symlink: %s\n' "${input}" >&2
  exit 2
fi
if ! command -v pg_restore >/dev/null 2>&1; then
  printf 'Error: pg_restore is required.\n' >&2
  exit 1
fi

printf 'Validating PostgreSQL backup archive...\n'
pg_restore --list "${input}" >/dev/null
printf 'Restoring PostgreSQL backup into the DATABASE_URL target...\n'
pg_restore \
  --dbname="${DATABASE_URL}" \
  --clean \
  --if-exists \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  "${input}"
printf 'PostgreSQL restore completed.\n'
