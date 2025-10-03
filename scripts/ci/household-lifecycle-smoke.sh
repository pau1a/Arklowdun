#!/usr/bin/env bash
set -euo pipefail

cargo test --manifest-path src-tauri/Cargo.toml --test household_crud -- --nocapture >/dev/null

echo "household lifecycle smoke OK"
