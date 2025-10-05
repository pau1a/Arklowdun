#!/usr/bin/env bash
# Helper for support engineers. See docs/support/household-db-remediation.md.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
node_script="${repo_root}/scripts/dev/household_stats.mjs"

if [[ ! -f "$node_script" ]]; then
  echo "Missing helper script: $node_script" >&2
  exit 1
fi

exec node "$node_script" "$@"
