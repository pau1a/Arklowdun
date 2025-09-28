#!/usr/bin/env bash
set -euo pipefail

command -v sqlite3 >/dev/null 2>&1 || {
  echo "error: sqlite3 is required" >&2
  exit 1
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
MIG_DIR="$SCRIPT_DIR/../migrations"

if [ ! -d "$MIG_DIR" ]; then
  echo "error: migrations directory not found at $MIG_DIR" >&2
  exit 1
fi

DB_PATH="${DB:-}"
if [ -z "$DB_PATH" ]; then
  if [ -n "${ARK_FAKE_APPDATA:-}" ]; then
    DB_PATH="$ARK_FAKE_APPDATA/arklowdun.sqlite3"
  else
    DB_PATH="$SCRIPT_DIR/../dev.sqlite"
  fi
fi

DB_DIR=$(dirname "$DB_PATH")
mkdir -p "$DB_DIR"

escape_sql() {
  printf %s "$1" | sed "s/'/''/g"
}

ensure_database() {
  if [ ! -f "$DB_PATH" ]; then
    : > "$DB_PATH"
  fi

  sqlite3 "$DB_PATH" <<'SQL' >/dev/null
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
SQL
}

remove_database() {
  rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"
}

list_migrations() {
  find "$MIG_DIR" -type f \
    \( -name '*_*.sql' ! -name '*_*.down.sql' \) \
    -print | LC_ALL=C sort
}

has_migration_run() {
  version_token="$1"
  escaped=$(escape_sql "$version_token")
  sqlite3 "$DB_PATH" "SELECT 1 FROM schema_migrations WHERE version = '$escaped' LIMIT 1;" | grep -q 1
}

apply_migration() {
  file="$1"
  [ -n "$file" ] || return 0
  if [ ! -f "$file" ]; then
    echo "error: migration file not found: $file" >&2
    exit 1
  fi

  base=$(basename "$file")
  case "$base" in
    *_*.up.sql)
      version=${base%\.up.sql}
      ;;
    *_*.sql)
      version=${base%\.sql}
      ;;
    *)
      echo "error: unsupported migration filename: $base" >&2
      exit 1
      ;;
  esac

  if has_migration_run "$base"; then
    echo "Skipping migration $version (already applied)"
    return 0
  fi

  escaped_version=$(escape_sql "$base")
  if ! sqlite3 "$DB_PATH" <<SQL
BEGIN IMMEDIATE;
PRAGMA foreign_keys=ON;
$(cat "$file")
INSERT OR IGNORE INTO schema_migrations(version) VALUES('$escaped_version');
COMMIT;
SQL
  then
    sqlite3 "$DB_PATH" 'ROLLBACK;' >/dev/null 2>&1 || true
    echo "error: failed applying migration $version" >&2
    exit 1
  fi
  echo "Applied migration $version"
}

run_migrations() {
  list_migrations | while IFS= read -r migration; do
    [ -n "$migration" ] || continue
    apply_migration "$migration"
  done

  if [ "$(sqlite3 "$DB_PATH" 'PRAGMA integrity_check;')" != "ok" ]; then
    echo "error: integrity check failed" >&2
    exit 1
  fi
}

usage() {
  cat <<'USAGE' >&2
Usage: scripts/migrate.sh <command>

Commands:
  fresh   Remove the existing database and apply all migrations
  up      Apply pending migrations to the existing database
USAGE
}

if [ $# -eq 0 ]; then
  usage
  exit 1
fi

command=$1
shift

case "$command" in
  fresh)
    remove_database
    ensure_database
    run_migrations
    ;;
  up)
    ensure_database
    run_migrations
    ;;
  *)
    usage
    exit 1
    ;;
esac
