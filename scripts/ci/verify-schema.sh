#!/usr/bin/env bash
set -euo pipefail

DB="$(mktemp)"
trap 'rm -f "$DB"' EXIT

DB="$DB" scripts/migrate.sh fresh >/dev/null

scripts/verify_schema.sh --db "$DB" --schema schema.sql --verbose
