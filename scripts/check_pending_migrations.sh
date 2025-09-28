#!/bin/sh
# Verify that all migrations on disk have been applied to the target database.
set -eu

DB="${1:-${DB:-dev.sqlite}}"
echo "Checking pending migrations against DB: $DB"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
MIG_DIR="$SCRIPT_DIR/../migrations"

if ls "$MIG_DIR"/*.down.sql >/dev/null 2>&1; then
  echo "ERROR: down migrations are not supported; remove *.down.sql files" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "ERROR: sqlite3 not found" >&2
  exit 1
fi

if [ ! -f "$DB" ]; then
  echo "ERROR: database not found: $DB" >&2
  exit 1
fi

set -- "$MIG_DIR"/[0-9]*.sql "$MIG_DIR"/[0-9]*.up.sql
if [ ! -e "$1" ]; then
  echo "OK: No migrations found"
  exit 0
fi

if ! applied=$(sqlite3 "$DB" "SELECT version FROM schema_migrations ORDER BY version;" 2>/dev/null); then
  echo "WARN: schema_migrations table not found; treating as none applied" >&2
  applied=""
fi

pending=""
for f in "$MIG_DIR"/[0-9]*.sql "$MIG_DIR"/[0-9]*.up.sql; do
  [ -f "$f" ] || continue
  token=""
  case "$f" in
    *.down.sql)
      continue
      ;;
    *)
      base=$(basename "$f")
      token="$base"
      ;;
  esac
  if [ -z "$token" ]; then
    continue
  fi
  if ! printf "%s\n" "$applied" | grep -Fxq "$token"; then
    pending="${pending}${pending:+ }$token"
  fi
done

if [ -n "$pending" ]; then
  echo "ERROR: pending migrations:" >&2
  for v in $pending; do
    echo "  $v" >&2
  done
  exit 1
fi

echo "OK: No pending migrations"
