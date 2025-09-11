#!/bin/sh
set -eu

if [ "${1:-}" = "" ]; then
  echo "usage: $0 \"label for migration\"" >&2
  exit 1
fi

LABEL_RAW="$1"
# slug: lowercase, spaces/invalid -> underscores, collapse repeats
SLUG=$(printf '%s' "$LABEL_RAW" | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/_/g;s/^_+//;s/_+$//;s/_+/_/g')
[ -n "$SLUG" ] || { echo "empty slug from label: $LABEL_RAW" >&2; exit 1; }

MIG_DIR="$(cd "$(dirname "$0")/../migrations" && pwd)"
TEMPLATE="$MIG_DIR/template.sql"

if [ ! -f "$TEMPLATE" ]; then
  echo "missing template: $TEMPLATE" >&2
  exit 1
fi

# find next number (zero-padded 4-digit)
LAST=$(
  ls "$MIG_DIR"/[0-9][0-9][0-9][0-9]_*.up.sql 2>/dev/null \
    | LC_ALL=C sort \
    | awk -F/ '{print $NF}' | cut -c1-4 | tail -n1 || true
)
if [ -z "$LAST" ]; then
  NEXT=1
else
  LAST_NUM=$(echo "$LAST" | sed 's/^0*//')
  NEXT=$((LAST_NUM + 1))
fi
NUM=$(printf '%04d' "$NEXT")

UP="$MIG_DIR/${NUM}_${SLUG}.up.sql"
DOWN="$MIG_DIR/${NUM}_${SLUG}.down.sql"
[ -e "$UP" ] && { echo "target exists: $(basename "$UP")" >&2; exit 1; }
[ -e "$DOWN" ] && { echo "target exists: $(basename "$DOWN")" >&2; exit 1; }

# split template sections into the pair
awk '
  BEGIN{sec="";}
  /^--[[:space:]]*up[[:space:]]*$/   {sec="up";   next}
  /^--[[:space:]]*down[[:space:]]*$/ {sec="down"; next}
  { if(sec=="up") print > up; else if(sec=="down") print > down; }
' up="$UP" down="$DOWN" "$TEMPLATE"

# sanity: ensure files exist; prepend helpful header
for f in "$UP" "$DOWN"; do
  [ -s "$f" ] || { echo "failed to create $f" >&2; exit 1; }
  ed -s "$f" <<'EOF' >/dev/null 2>&1 || true
0a
-- Generated from migrations/template.sql
-- Do NOT add BEGIN/COMMIT/PRAGMA here; runner owns TX/FKs.
.
w
q
EOF
done

echo "Created:"
echo "  $(basename "$UP")"
echo "  $(basename "$DOWN")"
