#!/usr/bin/env bash
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"

on_disk="$(git -C "$repo_root" ls-files migrations/*.sql | xargs -n1 basename | sort)"

in_code="$(
  grep -o "include_str!(\"[^\"]*migrations/[^\"]*\.sql\")" "$repo_root/src-tauri/src/migrate.rs" \
  | sed -E 's/.*migrations\/([^\"]+\.sql).*/\1/' \
  | sort -u
)"

diff_out="$(diff <(echo "$on_disk") <(echo "$in_code") || true)"
if [[ -n "$diff_out" ]]; then
  echo "ERROR: Migrations on disk differ from migrations registered in code:" >&2
  echo "$diff_out" >&2
  exit 1
fi

# Lint: ensure every REFERENCES includes explicit ON DELETE and ON UPDATE for new migrations
failed=false
for f in $on_disk; do
  version=${f%%_*}
  if [[ $version -lt 202509021300 ]]; then
    continue
  fi
  path="$repo_root/migrations/$f"
  refs=$(grep -n 'REFERENCES' "$path" || true)
  if [[ -n "$refs" ]]; then
    missing_delete=$(echo "$refs" | grep -v 'ON DELETE' || true)
    missing_update=$(echo "$refs" | grep -v 'ON UPDATE' || true)
    if [[ -n "$missing_delete" || -n "$missing_update" ]]; then
      echo "ERROR: $f has REFERENCES without explicit ON DELETE/ON UPDATE:" >&2
      [[ -n "$missing_delete" ]] && echo "$missing_delete" >&2
      [[ -n "$missing_update" ]] && echo "$missing_update" >&2
      failed=true
    fi
  fi

done
if [[ "$failed" == true ]]; then
  exit 1
fi
