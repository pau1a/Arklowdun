#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
MIG_DIR="$(cd "$(dirname "$0")/../migrations" && pwd)"

mapfile -t UPS < <(printf '%s\n' "$MIG_DIR"/[0-9]*.up.sql 2>/dev/null | sort -V)
if [[ ${#UPS[@]} -eq 0 ]]; then
  echo "no migrations found"
  exit 0
fi

mapfile -t DOWNS < <(printf '%s\n' "$MIG_DIR"/[0-9]*.down.sql 2>/dev/null | sort -V)
for down in "${DOWNS[@]}"; do
  stem="${down%.down.sql}"
  up="${stem}.up.sql"
  if [[ ! -f "$up" ]]; then
    echo "unexpected down without up: $(basename "$down")"
    exit 1
  fi
done

nums=()
for up in "${UPS[@]}"; do
  base="$(basename "$up")"
  if [[ ! "$base" =~ ^([0-9]{4})_.+\.up\.sql$ ]]; then
    echo "bad prefix: $base"
    exit 1
  fi
  stem="${up%.up.sql}"
  down="${stem}.down.sql"
  if [[ ! -f "$down" ]]; then
    echo "missing down for: $base"
    exit 1
  fi
  echo "CHECK: up=$base pair=$(basename "$down") num=${BASH_REMATCH[1]}"
  nums+=("${BASH_REMATCH[1]}")

done

expected=1
for n in "${nums[@]}"; do
  printf -v want "%04d" "$expected"
  if [[ "$n" != "$want" ]]; then
    echo "gap/out-of-order: saw $n expected $want"
    exit 1
  fi
  ((expected++))
done

echo "OK"
