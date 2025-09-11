#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
APPLY="${1:-}"
MIG_DIR="$(cd "$(dirname "$0")/../migrations" && pwd)"

mapfile -t UPS < <(printf '%s\n' "$MIG_DIR"/[0-9]*.up.sql 2>/dev/null | sort -V)
if [[ ${#UPS[@]} -eq 0 ]]; then
  echo "no migrations found"
  exit 0
fi

count=0
for up in "${UPS[@]}"; do
  ((++count))
  stem="${up%.up.sql}"
  down="${stem}.down.sql"
  if [[ ! -f "$down" ]]; then
    echo "missing down for: $(basename "$up")"
    exit 1
  fi
  label="$(basename "$stem" | sed -E 's/^[0-9]+_//')"
  printf -v num "%04d" "$count"
  new_up="$MIG_DIR/${num}_${label}.up.sql"
  new_down="$MIG_DIR/${num}_${label}.down.sql"
  if [[ "$up" != "$new_up" && -e "$new_up" ]]; then
    echo "conflict: target exists: $(basename "$new_up")"
    exit 1
  fi
  if [[ "$down" != "$new_down" && -e "$new_down" ]]; then
    echo "conflict: target exists: $(basename "$new_down")"
    exit 1
  fi
  if [[ "$APPLY" == "--apply" ]]; then
    echo "MOVE: $(basename "$up") -> $(basename "$new_up")"
    git mv -f "$up" "$new_up"
    echo "MOVE: $(basename "$down") -> $(basename "$new_down")"
    git mv -f "$down" "$new_down"
  else
    echo "DRY: $(basename "$up") -> $(basename "$new_up")"
    echo "DRY: $(basename "$down") -> $(basename "$new_down")"
  fi
done

if [[ "$APPLY" == "--apply" ]]; then
  echo "Renumbered $count migrations."
else
  echo "Dry-run for $count migrations."
fi
