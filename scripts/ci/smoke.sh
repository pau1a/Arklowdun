#!/usr/bin/env bash
# Consolidated smoke helpers for CI. See docs/support/household-db-remediation.md.
set -euo pipefail

run_household_tests() {
  local repo_root
  repo_root="$(git rev-parse --show-toplevel)"
  pushd "$repo_root/src-tauri" >/dev/null
  cargo test --locked --package arklowdun --test household_* -- --nocapture
  popd >/dev/null
}

run_ui_households() {
  local repo_root
  repo_root="$(git rev-parse --show-toplevel)"
  pushd "$repo_root" >/dev/null
  npm ci
  npx playwright install --with-deps
  mkdir -p test-results/ui
  npx playwright test tests/ui/settings-households.spec.ts --reporter=list --output=test-results/ui
  popd >/dev/null
}

show_usage() {
  cat <<'USAGE'
Usage: scripts/ci/smoke.sh [options]

Options:
  --household-tests  Run Rust integration tests for household cascades.
  --ui-households    Run the Playwright households settings spec.
  --no-ui            Skip UI tests even if selected by default.
  --skip-nightly     Reserved for compatibility; no effect in this script.
  --help             Show this help message.
USAGE
}

do_household=0
do_ui=0
skip_ui=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --household-tests)
      do_household=1
      shift
      ;;
    --ui-households)
      do_ui=1
      shift
      ;;
    --no-ui)
      skip_ui=1
      shift
      ;;
    --skip-nightly)
      shift
      ;;
    --help|-h)
      show_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      show_usage >&2
      exit 2
      ;;
  esac
done

if [[ $do_household -eq 0 && $do_ui -eq 0 ]]; then
  do_household=1
  do_ui=1
fi

if [[ $skip_ui -eq 1 ]]; then
  do_ui=0
fi

if [[ $do_household -eq 1 ]]; then
  run_household_tests
fi

if [[ $do_ui -eq 1 ]]; then
  run_ui_households
fi
