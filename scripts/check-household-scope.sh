#!/usr/bin/env bash
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
# Tables that must always be scoped by household_id
pattern='events|bills|policies|property_documents|inventory_items|vehicles|vehicle_maintenance|pets|pet_medical|family_members|categories|budget_categories|expenses|notes|shopping_items'
# Find files with SQL touching domain tables (excluding migrations)
files=$(rg -i "(from|update|into)\s+(${pattern})" -l --glob '!migrations/*' || true)
failed=0
for f in $files; do
  if ! rg -i "household_id" "$f" >/dev/null; then
    echo "Missing household_id in $f"
    failed=1
  fi
done
exit $failed
