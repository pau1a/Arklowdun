#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

MIG_DIR="$(cd "$(dirname "$0")/../migrations" && pwd)"

# Collect files without using 'mapfile' (Bash 3 compatible)
BASELINES=()
UPS=()
DOWNS=()

# baselines: "*_*.sql" excluding ".up.sql" and ".down.sql"
while IFS= read -r p; do
  [ -n "${p:-}" ] && BASELINES+=("$p")
done < <(find "$MIG_DIR" -maxdepth 1 -type f -name '*_*.sql' ! -name '*_*.up.sql' ! -name '*_*.down.sql' | sort)

# ups: "*_*.up.sql"
while IFS= read -r p; do
  [ -n "${p:-}" ] && UPS+=("$p")
done < <(find "$MIG_DIR" -maxdepth 1 -type f -name '*_*.up.sql' | sort)

# downs: "*_*.down.sql"
while IFS= read -r p; do
  [ -n "${p:-}" ] && DOWNS+=("$p")
done < <(find "$MIG_DIR" -maxdepth 1 -type f -name '*_*.down.sql' | sort)

if [[ ${#BASELINES[@]} -eq 0 && ${#UPS[@]} -eq 0 ]]; then
  echo "no migrations found"
  exit 0
fi

if [[ ${#BASELINES[@]} -ne 1 ]]; then
  echo "expected exactly one baseline file, found ${#BASELINES[@]}:" >&2
  for b in "${BASELINES[@]}"; do echo "  $b" >&2; done
  exit 1
fi

if [[ ${#DOWNS[@]} -ne 0 ]]; then
  echo "down migrations are no longer supported; remove these files:" >&2
  for d in "${DOWNS[@]}"; do echo "  $d" >&2; done
  exit 1
fi

base_name="$(basename "${BASELINES[0]}")"
if [[ ! "$base_name" =~ ^([0-9]{4})_.+\.sql$ ]]; then
  echo "bad baseline filename: $base_name" >&2
  exit 1
fi

printf -v baseline_expected "%04d" 1
if [[ "${BASH_REMATCH[1]}" != "$baseline_expected" ]]; then
  echo "baseline numbering mismatch: saw ${BASH_REMATCH[1]} expected $baseline_expected" >&2
  exit 1
fi
echo "CHECK: baseline=$base_name"

# subsequent .up.sql must be 0002_, 0003_, …
expected=$((10#$baseline_expected + 1))
if [[ ${#UPS[@]} -gt 0 ]]; then
for up in "${UPS[@]}"; do
  base="$(basename "$up")"
  if [[ ! "$base" =~ ^([0-9]{4})_.+\.up\.sql$ ]]; then
    echo "bad prefix: $base" >&2
    exit 1
  fi
  printf -v want "%04d" "$expected"
  if [[ "${BASH_REMATCH[1]}" != "$want" ]]; then
    echo "gap/out-of-order: saw ${BASH_REMATCH[1]} expected $want" >&2
    exit 1
  fi
  echo "CHECK: up=$base num=${BASH_REMATCH[1]}"
  expected=$((expected + 1))
done
fi

echo "OK"
