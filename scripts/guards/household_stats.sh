#!/usr/bin/env bash
set -euo pipefail

show_usage() {
  cat <<'USAGE'
Usage: scripts/guards/household_stats.sh [--json]

Options:
  --json    Emit JSON instead of the formatted table.
  --help    Show this help message.
USAGE
}

want_json=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      want_json=1
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

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to run the Tauri CLI." >&2
  exit 2
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

args=(tauri -- diagnostics household-stats)
if [[ $want_json -eq 1 ]]; then
  args+=(--json)
fi

if ! output=$(npm run --silent "${args[@]}"); then
  echo "Failed to execute household stats command." >&2
  exit 1
fi

if [[ -z "${output//[[:space:]]/}" ]]; then
  echo "No household stats were returned." >&2
  exit 1
fi

printf '%s\n' "$output"
