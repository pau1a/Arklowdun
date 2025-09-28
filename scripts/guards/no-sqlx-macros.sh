#!/usr/bin/env bash
set -euo pipefail
rg 'sqlx::query[_a-zA-Z]*!\(' -n src-tauri && { echo 'Do not use sqlx compile-time macros'; exit 1; } || true
