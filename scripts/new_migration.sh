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
# determine latest applied number from baseline + existing ups
BASELINE_FILE=$(ls "$MIG_DIR"/[0-9][0-9][0-9][0-9]_*.sql 2>/dev/null \
  | LC_ALL=C sort \
  | grep -v '\.up\.sql$' \
  | tail -n1 || true)
BASELINE_NUM=0
if [ -n "$BASELINE_FILE" ]; then
  BASELINE_NUM=$(basename "$BASELINE_FILE" | cut -c1-4 | sed 's/^0*//')
  [ -n "$BASELINE_NUM" ] || BASELINE_NUM=0
fi

LAST_UP=$(ls "$MIG_DIR"/[0-9][0-9][0-9][0-9]_*.up.sql 2>/dev/null \
  | LC_ALL=C sort \
  | tail -n1 || true)
UP_NUM=0
if [ -n "$LAST_UP" ]; then
  UP_NUM=$(basename "$LAST_UP" | cut -c1-4 | sed 's/^0*//')
  [ -n "$UP_NUM" ] || UP_NUM=0
fi

LAST_NUM=$BASELINE_NUM
if [ "$UP_NUM" -gt "$LAST_NUM" ]; then
  LAST_NUM=$UP_NUM
fi

NEXT=$((LAST_NUM + 1))
NUM=$(printf '%04d' "$NEXT")

UP="$MIG_DIR/${NUM}_${SLUG}.up.sql"
[ -e "$UP" ] && { echo "target exists: $(basename "$UP")" >&2; exit 1; }

# extract only the up section from the template
awk '
  BEGIN{sec="";}
  /^--[[:space:]]*up[[:space:]]*$/   {sec="up";   next}
  /^--[[:space:]]*down[[:space:]]*$/ {sec="down"; next}
  { if (sec == "up") print > up; }
' up="$UP" "$TEMPLATE"

# sanity: ensure file exists; prepend helpful header
[ -s "$UP" ] || { echo "failed to create $UP" >&2; exit 1; }
ed -s "$UP" <<'EOF' >/dev/null 2>&1 || true
0a
-- Generated from migrations/template.sql
-- Do NOT add BEGIN/COMMIT/PRAGMA here; runner owns TX/FKs.
.
w
q
EOF

echo "Created:"
echo "  $(basename "$UP")"
