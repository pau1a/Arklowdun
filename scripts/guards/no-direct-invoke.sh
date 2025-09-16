#!/usr/bin/env bash
set -euo pipefail
hits=$(git grep -n -F "invoke(" -- src | grep -v "src/api/call.ts" || true)
if [[ -n "$hits" ]]; then
  echo "❌ Direct invoke() calls found:"
  echo "$hits"
  exit 1
fi
echo "✅ No direct invoke() calls."
