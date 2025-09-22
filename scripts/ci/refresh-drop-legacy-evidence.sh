#!/usr/bin/env bash
set -euo pipefail

export TZ=UTC
export LC_ALL=C
export SOURCE_DATE_EPOCH=1704067200

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

OUT_DIR="$ROOT/docs/evidence/drop-legacy"
WORK_DIR="$ROOT/target/drop-legacy-evidence"
mkdir -p "$WORK_DIR"

FAIL_DB="$WORK_DIR/fail.sqlite"
PASS_DB="$WORK_DIR/pass.sqlite"
rm -f "$FAIL_DB" "$PASS_DB"

FAIL_LOG="$OUT_DIR/migration-fail.log"
PASS_LOG="$OUT_DIR/migration-pass.log"
GUARD_LOG="$OUT_DIR/guard-block.log"
SCHEMA_BEFORE="$OUT_DIR/schema-before.sql"
SCHEMA_AFTER="$OUT_DIR/schema-after.sql"
SCHEMA_DIFF="$OUT_DIR/schema-diff.txt"
SCHEMA_BEFORE_SHA="$OUT_DIR/schema-before.sha256"
SCHEMA_AFTER_SHA="$OUT_DIR/schema-after.sha256"

: >"$FAIL_LOG"
: >"$PASS_LOG"
: >"$GUARD_LOG"

relpath() {
  python - <<'PY' "$ROOT" "$1"
import os, sys
root = os.path.abspath(sys.argv[1])
path = os.path.abspath(sys.argv[2])
print(os.path.relpath(path, root))
PY
}

format_cmd() {
  local parts=()
  for arg in "$@"; do
    parts+=("$(printf '%q' "$arg")")
  done
  (IFS=' '; echo "${parts[*]}")
}

run_success() {
  local log=$1
  shift
  local cmd_str
  cmd_str=$(format_cmd "$@")
  echo "\$ $cmd_str" >>"$log"
  if "$@" >>"$log" 2>&1; then
    echo "exit status: 0" >>"$log"
  else
    local status=$?
    echo "exit status: $status" >>"$log"
    return $status
  fi
}

run_expect_fail() {
  local log=$1
  shift
  local cmd_str
  cmd_str=$(format_cmd "$@")
  echo "\$ $cmd_str" >>"$log"
  set +e
  "$@" >>"$log" 2>&1
  local status=$?
  set -e
  if [ $status -eq 0 ]; then
    echo "exit status: 0 (unexpected success)" >>"$log"
    return 1
  else
    echo "exit status: $status" >>"$log"
  fi
}

CARGO_BASE=(cargo run --locked --quiet --manifest-path "$ROOT/src-tauri/Cargo.toml" --bin migrate --)

# Pre-build the migrate binary to keep logs stable.
cargo build --locked --manifest-path "$ROOT/src-tauri/Cargo.toml" --bin migrate >/dev/null

FAIL_DB_REL=$(relpath "$FAIL_DB")
PASS_DB_REL=$(relpath "$PASS_DB")

# Fail scenario: apply through 0022, seed bad data, and confirm 0023 blocks.
run_success "$FAIL_LOG" "${CARGO_BASE[@]}" --db "$FAIL_DB" up --to 0022
run_success "$FAIL_LOG" sqlite3 "$FAIL_DB" "INSERT INTO household (id, name, created_at, updated_at) VALUES ('hh', 'Household', 0, 0);"
run_success "$FAIL_LOG" sqlite3 "$FAIL_DB" "INSERT INTO events (id, title, start_at, household_id, created_at, updated_at) VALUES ('evt-start', 'Missing start UTC', 0, 'hh', 0, 0);"
run_success "$FAIL_LOG" sqlite3 "$FAIL_DB" "INSERT INTO events (id, title, start_at, start_at_utc, end_at, household_id, created_at, updated_at) VALUES ('evt-end', 'Missing end UTC', 0, 0, 60000, 'hh', 0, 0);"
run_success "$FAIL_LOG" sqlite3 "$FAIL_DB" "UPDATE events SET start_at_utc = NULL WHERE id = 'evt-start';"
run_expect_fail "$FAIL_LOG" "${CARGO_BASE[@]}" --db "$FAIL_DB" up

# Guard output against the failing database.
run_expect_fail "$GUARD_LOG" "${CARGO_BASE[@]}" --db "$FAIL_DB" check

# Capture schema before dropping columns.
sqlite3 "$FAIL_DB" <<'SQL' >"$SCHEMA_BEFORE"
.headers off
.mode list
WITH ordered AS (
    SELECT 0 AS ord, name, sql FROM sqlite_master WHERE type = 'table' AND name = 'events' AND sql IS NOT NULL
    UNION ALL
    SELECT 1 AS ord, name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events' AND sql IS NOT NULL
)
SELECT sql || ';' FROM ordered ORDER BY ord, name;
SQL

# Simulate the backfill and rerun migration to succeed.
run_success "$PASS_LOG" sqlite3 "$FAIL_DB" "UPDATE events SET start_at_utc = start_at WHERE start_at_utc IS NULL;"
run_success "$PASS_LOG" sqlite3 "$FAIL_DB" "UPDATE events SET end_at_utc = end_at WHERE end_at IS NOT NULL AND end_at_utc IS NULL;"
run_success "$PASS_LOG" "${CARGO_BASE[@]}" --db "$FAIL_DB" up
run_success "$PASS_LOG" "${CARGO_BASE[@]}" --db "$FAIL_DB" check

# Dump the upgraded schema and compare.
sqlite3 "$FAIL_DB" <<'SQL' >"$SCHEMA_AFTER"
.headers off
.mode list
WITH ordered AS (
    SELECT 0 AS ord, name, sql FROM sqlite_master WHERE type = 'table' AND name = 'events' AND sql IS NOT NULL
    UNION ALL
    SELECT 1 AS ord, name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events' AND sql IS NOT NULL
)
SELECT sql || ';' FROM ordered ORDER BY ord, name;
SQL

sqlite_version=$(sqlite3 --version)
dump_command="sqlite3 <DB> \"WITH ordered AS (SELECT 0 AS ord, name, sql FROM sqlite_master WHERE type='table' AND name='events' AND sql IS NOT NULL UNION ALL SELECT 1 AS ord, name, sql FROM sqlite_master WHERE type='index' AND tbl_name='events' AND sql IS NOT NULL) SELECT sql || ';' FROM ordered ORDER BY ord, name;\""

diff -u --label schema-before.sql --label schema-after.sql "$SCHEMA_BEFORE" "$SCHEMA_AFTER" >"$SCHEMA_DIFF.tmp" || true
{
  echo "# Source DB: $(relpath "$FAIL_DB")"
  echo "# Dump command: $dump_command"
  echo "# SQLite version: $sqlite_version"
  cat "$SCHEMA_DIFF.tmp"
} >"$SCHEMA_DIFF"
rm -f "$SCHEMA_DIFF.tmp"

sha256sum "$SCHEMA_BEFORE" >"$SCHEMA_BEFORE_SHA"
sha256sum "$SCHEMA_AFTER" >"$SCHEMA_AFTER_SHA"

# Basic assertions so CI fails when output drifts.
grep -F "Migration 0023 blocked:" "$FAIL_LOG" >/dev/null
grep -F "Arklowdun needs to finish a database update" "$GUARD_LOG" >/dev/null
grep -F "sqlite_integrity_check" "$PASS_LOG" >/dev/null

echo "Evidence refreshed in $OUT_DIR"
