#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p docs/samples
scripts/collect-diagnostics.sh --include-db --yes --out docs/samples

echo
printf 'Sample written to docs/samples/. Remember: .gitignore prevents committing zips.\n'
