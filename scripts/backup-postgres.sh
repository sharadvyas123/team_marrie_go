#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  printf 'Usage: DATABASE_URL=... %s --output PATH [--force]\n' "$(basename -- "$0")" >&2
}

output=''
force=0

while (($# > 0)); do
  case "$1" in
    --output)
      if (($# < 2)); then
        printf 'Error: --output needs a path.\n' >&2
        usage
        exit 2
      fi
      output=$2
      shift 2
      ;;
    --force)
      force=1
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

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf 'Error: DATABASE_URL must be supplied through the environment.\n' >&2
  exit 2
fi
if [[ -z "${output}" || "${output}" == -* ]]; then
  printf 'Error: --output must be a non-option path.\n' >&2
  usage
  exit 2
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  printf 'Error: pg_dump is required.\n' >&2
  exit 1
fi

parent=${output%/*}
if [[ "${parent}" == "${output}" ]]; then parent='.'; fi
if [[ ! -d "${parent}" ]]; then
  printf 'Error: output directory does not exist: %s\n' "${parent}" >&2
  exit 2
fi
if [[ -L "${output}" || ( -e "${output}" && ! -f "${output}" ) ]]; then
  printf 'Error: refusing to write through a symlink or non-regular path: %s\n' "${output}" >&2
  exit 2
fi
if [[ -e "${output}" && "${force}" != '1' ]]; then
  printf 'Error: backup already exists; pass --force to replace it: %s\n' "${output}" >&2
  exit 2
fi

umask 077
temporary="${output}.partial.$$"
cleanup() { rm -f -- "${temporary}"; }
trap cleanup EXIT

printf 'Creating PostgreSQL backup at %s...\n' "${output}"
pg_dump \
  --dbname="${DATABASE_URL}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="${temporary}"
mv -- "${temporary}" "${output}"
trap - EXIT
printf 'PostgreSQL backup completed: %s\n' "${output}"
