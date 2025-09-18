#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

if hits=$(rg --iglob 'src/ui/**/*' -n --hidden \
  -e '#[0-9A-Fa-f]{3,8}\b' \
  -e '\brgba?\s*\(' \
  -e '\bhsla?\s*\(' \
  -e '\b(?:red|blue|green|black|white|gray|grey|orange|purple|pink|yellow|cyan|magenta)\b'); then
  echo "❌ Hard-coded colour literals found in src/ui/:"
  echo "$hits"
  exit 1
fi

echo "✅ No colour literals found in src/ui/."
