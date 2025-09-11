#!/bin/sh
set -eu

KEEP=0
LOOSE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --loose-schema) LOOSE=1 ;;
    *) echo "usage: $0 [--keep] [--loose-schema]" >&2; exit 1 ;;
  esac
  shift
done

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT"

if [ ! -f scripts/migrate.sh ] || [ ! -d migrations ]; then
  echo "ERROR: expected scripts/migrate.sh and migrations/" >&2
  exit 1
fi

for cmd in sqlite3 diff sed; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: missing dependency: $cmd" >&2
    exit 1
  fi
done

MIG_DIR="$REPO_ROOT/migrations"
set -- "$MIG_DIR"/[0-9]*.up.sql
if [ ! -e "$1" ]; then
  echo "no migrations found; nothing to test"
  exit 0
fi
UP_COUNT=$(printf '%s\n' "$@" | wc -l | tr -d ' ')

export LC_ALL=C

TMPDIR=$(mktemp -d 2>/dev/null || mktemp -d -t arklowdun)
TMPDB="$TMPDIR/idempotency.sqlite"
SCHEMA1="$TMPDIR/schema.1.sql"
SCHEMA2="$TMPDIR/schema.2.sql"
MIGS1="$TMPDIR/migs.1.txt"
MIGS2="$TMPDIR/migs.2.txt"

cleanup() {
  if [ "$KEEP" -ne 1 ]; then
    rm -rf "$TMPDIR"
  fi
}
trap cleanup EXIT INT TERM

echo "[1/6] First run on fresh DB..."
DB="$TMPDB" scripts/migrate.sh fresh >/dev/null

echo "[2/6] Snapshot after first run..."
if [ "$LOOSE" -eq 1 ]; then
  sqlite3 "$TMPDB" ".schema" | sed '/^--/d;/^$/d;s/[ \t]*$//' | tr -s ' \t' ' ' > "$SCHEMA1"
else
  sqlite3 "$TMPDB" ".schema" | sed '/^--/d;/^$/d;s/[ \t]*$//' > "$SCHEMA1"
fi
sqlite3 "$TMPDB" "SELECT version FROM schema_migrations ORDER BY version;" > "$MIGS1"
MIG_ROW_COUNT=$(wc -l < "$MIGS1" | tr -d ' ')
if [ "$MIG_ROW_COUNT" -ne "$UP_COUNT" ]; then
  echo "ERROR: expected $UP_COUNT rows in schema_migrations, found $MIG_ROW_COUNT" >&2
  exit 1
fi

echo "[3/6] Second run (should no-op)..."
DB="$TMPDB" scripts/migrate.sh up-all >/dev/null

echo "[4/6] Snapshot after second run..."
if [ "$LOOSE" -eq 1 ]; then
  sqlite3 "$TMPDB" ".schema" | sed '/^--/d;/^$/d;s/[ \t]*$//' | tr -s ' \t' ' ' > "$SCHEMA2"
else
  sqlite3 "$TMPDB" ".schema" | sed '/^--/d;/^$/d;s/[ \t]*$//' > "$SCHEMA2"
fi
sqlite3 "$TMPDB" "SELECT version FROM schema_migrations ORDER BY version;" > "$MIGS2"

echo "[5/6] Comparing schema and migration versions..."
if ! diff -u "$SCHEMA1" "$SCHEMA2" >/dev/null; then
  echo "ERROR: schema changed on second run" >&2
  diff -u "$SCHEMA1" "$SCHEMA2" >&2 || true
  exit 1
fi
if ! diff -u "$MIGS1" "$MIGS2" >/dev/null; then
  echo "ERROR: schema_migrations changed on second run" >&2
  diff -u "$MIGS1" "$MIGS2" >&2 || true
  exit 1
fi

echo "[6/6] PRAGMA integrity_check..."
INTEGRITY=$(sqlite3 "$TMPDB" 'PRAGMA integrity_check;')
if [ "$INTEGRITY" != "ok" ]; then
  echo "ERROR: integrity_check failed: $INTEGRITY" >&2
  exit 1
fi

echo "OK: idempotency verified"
if [ "$KEEP" -eq 1 ]; then
  echo "(kept artifacts in $TMPDIR)"
fi
