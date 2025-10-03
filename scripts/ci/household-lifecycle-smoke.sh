#!/usr/bin/env bash
set -euo pipefail

cargo test --manifest-path src-tauri/Cargo.toml --test household_crud -- --nocapture >/dev/null

npx playwright install --with-deps >/dev/null

npm run test:e2e -- tests/ui/settings-households.spec.ts >/dev/null

echo "household lifecycle smoke OK"
