#!/usr/bin/env bash
set -euo pipefail

DB="$(mktemp)"
trap 'rm -f "$DB" "$DB-wal" "$DB-shm"' EXIT

DB="$DB" scripts/migrate.sh fresh >/dev/null

count=$(sqlite3 "$DB" "SELECT COUNT(*) FROM household WHERE is_default = 1;")
if [[ "$count" != "1" ]]; then
  echo "error: expected exactly one default household, found $count" >&2
  exit 1
fi

delete_error=$(sqlite3 "$DB" "UPDATE household SET deleted_at = 1 WHERE is_default = 1;" 2>&1 || true)
if [[ "$delete_error" != *"default_household_undeletable"* ]]; then
  echo "error: soft delete of default household did not raise expected guard" >&2
  echo "$delete_error" >&2
  exit 1
fi

echo "household default smoke OK"
