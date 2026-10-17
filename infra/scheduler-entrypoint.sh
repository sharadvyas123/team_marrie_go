#!/usr/bin/env bash

set -Eeuo pipefail

exec node /app/scripts/scheduler.mjs
