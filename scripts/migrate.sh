#!/usr/bin/env bash
set -euo pipefail

DB="${DB:-dev.db}"
MIG_DIR="$(dirname "$0")/../migrations"
export LC_ALL=C
shopt -s nullglob

reset_db() {
  rm -f "$DB"
}

integrity_check(){ sqlite3 "$DB" 'PRAGMA integrity_check;' | grep -qx ok; }

ensure_pairs() {
  local missing=0
  for f in "$MIG_DIR"/[0-9]*.up.sql; do
    local base="$(basename "$f" .up.sql)"
    if [[ ! -f "$MIG_DIR/${base}.down.sql" ]]; then
      echo "missing down migration for $base" >&2
      missing=1
    fi
  done
  [[ $missing -eq 0 ]]
}

run_file() {
  local file="$1"
  echo "$file"
  sqlite3 "$DB" <<SQL
BEGIN IMMEDIATE;
PRAGMA foreign_keys=ON;
$(cat "$file")
COMMIT;
SQL
}

migrate_up_all() {
  ensure_pairs || return 1
  mapfile -t ups < <(printf '%s\n' "$MIG_DIR"/[0-9]*.up.sql | sort)
  for f in "${ups[@]}"; do
    run_file "$f"
  done
  integrity_check
}

migrate_down_one() {
  local version="$1"
  version="${version%.up.sql}"
  run_file "$MIG_DIR/${version}.down.sql"
}

migrate_down_all() {
  mapfile -t downs < <(printf '%s\n' "$MIG_DIR"/[0-9]*.down.sql | sort -r)
  for f in "${downs[@]}"; do
    run_file "$f"
  done
  integrity_check
}

roundtrip() {
  migrate_up_all
  migrate_down_all
  migrate_up_all
  integrity_check
}

case "${1:-}" in
  fresh) reset_db; migrate_up_all ;;
  up-all) migrate_up_all ;;
  down-one) migrate_down_one "$2" ;;
  down-all) migrate_down_all ;;
  roundtrip) roundtrip ;;
  *) echo "usage: $0 {fresh|up-all|down-one <version>|down-all|roundtrip}" ;;
esac
