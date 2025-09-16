#!/usr/bin/env bash
set -euo pipefail

SCRIPT_VERSION="1.0.0"
DEFAULT_BUNDLE_ID="com.paula.arklowdun"
MAX_FILE_MB_DEFAULT=10
PYTHON_AVAILABLE=1
RAW_NO_REDACTION_FALLBACK=0

log_info() {
  printf '[INFO] %s\n' "$1" >&2
}

log_warn() {
  printf '[WARN] %s\n' "$1" >&2
}

log_error() {
  printf '[ERROR] %s\n' "$1" >&2
}

usage() {
  cat <<'USAGE'
Usage: scripts/collect-diagnostics.sh [options]

Options:
  --out DIR          Output directory for the diagnostics zip (default: ~/Desktop)
  --raw              Include raw, unredacted copies (requires confirmation)
  --include-db       Include hash metadata for the SQLite database
  --data-dir DIR     Override app data directory
  --logs-dir DIR     Override logs directory
  --bundle-id ID     Override bundle identifier
  --yes              Non-interactive mode; assume consent for --raw
  --help             Show this help message
USAGE
}

# ====== 🚨 TEMPORARY PYTHON DEPENDENCY — MUST BE REMOVED BEFORE PRIMETIME ======
if [[ "${ARK_SILENCE_TODO:-0}" != "1" ]]; then
  cat >&2 <<'BANNER'
================================================================================
 ⚠️  DIAGNOSTICS TODO: This collector depends on python3 for redaction.
     Replace with a bundled helper (ark-diag) before any paid/public release.
     Tracking: PR-Diag-01..04. --raw --yes skips redaction (unsafe).
================================================================================
BANNER
fi
# ==============================================================================

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "Required command '$1' is not available"
    exit 2
  fi
}

if ! command -v python3 >/dev/null 2>&1; then
  PYTHON_AVAILABLE=0
  log_error "python3 is required for redaction (temporary dependency)."
  if [[ " $* " == *" --raw "* ]] && [[ " $* " == *" --yes "* ]]; then
    log_warn "Proceeding WITHOUT redaction due to --raw --yes; bundle will include RAW files only."
    # allow run to continue; ensure README in bundle reiterates this
    RAW_NO_REDACTION_FALLBACK=1
  else
    log_error "Install python3 or re-run with --raw --yes to proceed without redaction."
    exit 2
  fi
fi

require_command zip

if command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  SHA_CMD=(shasum -a 256)
else
  log_error "Neither sha256sum nor shasum is available"
  exit 2
fi

manifest_entries=()
warnings=()

json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  s=${s//$'\f'/\\f}
  s=${s//$'\b'/\\b}
  printf '%s' "$s"
}

add_manifest_entry() {
  local path="$1" category="$2" included="$3" reason="$4" size="$5" mtime="$6" redacted="$7" sha="$8" sha_raw="$9" limit_mb
  limit_mb="${10:-}"
  local json="{\"path\":\"$(json_escape "$path")\",\"category\":\"$(json_escape "$category")\",\"included\":$included"
  if [ -n "$reason" ]; then
    json="$json,\"reason\":\"$(json_escape "$reason")\""
  fi
  if [ -n "$size" ]; then
    json="$json,\"size_bytes\":$size"
  else
    json="$json,\"size_bytes\":null"
  fi
  if [ -n "$mtime" ]; then
    json="$json,\"mtime_iso\":\"$(json_escape "$mtime")\""
  else
    json="$json,\"mtime_iso\":null"
  fi
  if [ -n "$redacted" ]; then
    json="$json,\"redacted\":$redacted"
  fi
  if [ -n "$sha" ]; then
    json="$json,\"sha256\":\"$sha\""
  fi
  if [ -n "$sha_raw" ]; then
    json="$json,\"sha256_raw\":\"$sha_raw\""
  fi
  if [ -n "$limit_mb" ]; then
    json="$json,\"limit_mb\":$limit_mb"
  fi
  json="$json}"
  manifest_entries+=("$json")
}

iso_from_epoch() {
  local epoch="$1"
  if date -u -d "@$epoch" '+%Y-%m-%dT%H:%M:%SZ' >/dev/null 2>&1; then
    date -u -d "@$epoch" '+%Y-%m-%dT%H:%M:%SZ'
  else
    date -u -r "$epoch" '+%Y-%m-%dT%H:%M:%SZ'
  fi
}

get_file_size() {
  local path="$1"
  if stat --version >/dev/null 2>&1; then
    stat -c '%s' "$path"
  else
    stat -f '%z' "$path"
  fi
}

get_file_mtime_epoch() {
  local path="$1"
  if stat --version >/dev/null 2>&1; then
    stat -c '%Y' "$path"
  else
    stat -f '%m' "$path"
  fi
}

get_file_mtime_iso() {
  local path="$1"
  local epoch
  epoch=$(get_file_mtime_epoch "$path")
  iso_from_epoch "$epoch"
}

compute_sha256() {
  "${SHA_CMD[@]}" "$1" | awk '{print $1}'
}

abs_path() {
  local input="$1"
  if [ "${PYTHON_AVAILABLE:-1}" = "1" ]; then
    python3 - "$input" <<'PY'
import os
import sys

path = os.path.expanduser(sys.argv[1])
print(os.path.abspath(path))
PY
  else
    local expanded="$input"
    if [[ "$expanded" == ~* ]]; then
      if [[ "$expanded" == "~" ]]; then
        expanded="$HOME"
      elif [[ "$expanded" == ~/* ]]; then
        expanded="$HOME/${expanded#~/}"
      fi
    fi
    if [ -d "$expanded" ]; then
      (cd "$expanded" 2>/dev/null && pwd) || printf '%s\n' "$expanded"
    else
      local dir
      local base
      dir=$(dirname "$expanded")
      base=$(basename "$expanded")
      (cd "$dir" 2>/dev/null && printf '%s/%s\n' "$(pwd)" "$base") || printf '%s\n' "$expanded"
    fi
  fi
}

redact_file() {
  local src="$1" dest="$2" data_root="$3" logs_root="$4"
  if [ "${PYTHON_AVAILABLE:-1}" != "1" ]; then
    return 1
  fi
  ARK_DATA_ROOT="$data_root" ARK_LOGS_ROOT="$logs_root" python3 - "$src" "$dest" <<'PY'
import os
import re
import sys

src = sys.argv[1]
dest = sys.argv[2]
home = os.path.expanduser('~')
data_root = os.environ.get('ARK_DATA_ROOT', '')
logs_root = os.environ.get('ARK_LOGS_ROOT', '')

try:
    with open(src, 'r', encoding='utf-8', errors='replace') as handle:
        text = handle.read()
except Exception as exc:
    raise SystemExit(f"failed to read {src}: {exc}")

def replace_home(value: str) -> str:
    if not home:
        return value
    replaced = value.replace(home, '<home>')
    if os.name == 'nt':
        pattern = re.compile(re.escape(home), re.IGNORECASE)
        replaced = pattern.sub('<home>', replaced)
    if home.startswith('/Users/'):
        replaced = replaced.replace(home, '<home>')
    win_home = re.compile(r'(?i)[A-Z]:\\Users\\[^\\/:]+')
    replaced = win_home.sub('<home>', replaced)
    return replaced

text = replace_home(text)

patterns = [
    (re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'), '<redacted:email>'),
    (re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b'), '<redacted:ip>'),
    (re.compile(r'\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b'), '<redacted:mac>'),
    (re.compile(r'\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b'), '<redacted:ip>'),
]
for pattern, repl in patterns:
    text = pattern.sub(repl, text)

secret_json = re.compile(r'(?i)("(?:api_key|token|password|secret)"\s*:\s*)"[^"]*"')
secret_json_single = re.compile(r"(?i)('(api_key|token|password|secret)'\s*:\s*)'[^']*'")
secret_assign = re.compile(r'(?i)(\b(?:api_key|token|password|secret)\b\s*[=:]\s*)([^\s"\']+)')

text = secret_json.sub(lambda m: m.group(1) + '"<redacted:secret>"', text)
text = secret_json_single.sub(lambda m: m.group(1) + "'<redacted:secret>'", text)
text = secret_assign.sub(lambda m: m.group(1) + '<redacted:secret>', text)

hex_pattern = re.compile(r'\b[0-9A-Fa-f]{16,}\b')

def redact_hex(match: re.Match) -> str:
    start = match.start()
    prefix = match.string[max(0, start - 10):start]
    if 'CrashID' in prefix:
        return match.group(0)
    return '<redacted:uuid>'

text = hex_pattern.sub(redact_hex, text)

def redact_path_token(token: str) -> str:
    if data_root and token.startswith(data_root):
        return '<app-data>' + token[len(data_root):]
    if logs_root and token.startswith(logs_root):
        return '<app-logs>' + token[len(logs_root):]
    if token.startswith('<home>/'):
        return token
    return '<path>'

abs_path_pattern = re.compile(r'/(?!home/)(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+')

def replace_abs_path(match: re.Match) -> str:
    token = match.group(0)
    if '://' in token:
        return token
    start = match.start()
    context = match.string[max(0, start - 10):start]
    if '://' in context:
        return token
    prefix = match.string[:start]
    scheme_index = prefix.rfind('://')
    if scheme_index != -1:
        tail = prefix[scheme_index:start]
        if not any(ch.isspace() for ch in tail):
            return token
    return redact_path_token(token)

text = abs_path_pattern.sub(replace_abs_path, text)

if os.name == 'nt':
    win_abs = re.compile(r'(?i)[A-Z]:\\[^\s"\']+')

    def redact_win_path(match: re.Match) -> str:
        token = match.group(0)
        if '://' in token:
            return token
        start = match.start()
        context = match.string[max(0, start - 10):start]
        if '://' in context:
            return token
        prefix = match.string[:start]
        scheme_index = prefix.rfind('://')
        if scheme_index != -1:
            tail = prefix[scheme_index:start]
            if not any(ch.isspace() for ch in tail):
                return token
        norm = token.replace('\\', '/').lower()
        data_norm = data_root.replace('\\', '/').lower() if data_root else ''
        logs_norm = logs_root.replace('\\', '/').lower() if logs_root else ''
        if data_norm and norm.startswith(data_norm):
            return '<app-data>' + token[len(data_root):]
        if logs_norm and norm.startswith(logs_norm):
            return '<app-logs>' + token[len(logs_root):]
        if token.lower().startswith('<home>'):
            return token
        return '<path>'

    text = win_abs.sub(redact_win_path, text)

with open(dest, 'w', encoding='utf-8') as handle:
    handle.write(text)
PY
}

add_warning() {
  warnings+=("$1")
}

write_manifest() {
  local file="$1"
  {
    printf '[\n'
    local total=${#manifest_entries[@]}
    local idx=0
    for entry in "${manifest_entries[@]}"; do
      printf '  %s' "$entry"
      idx=$((idx + 1))
      if [ "$idx" -lt "$total" ]; then
        printf ',\n'
      else
        printf '\n'
      fi
    done
    printf ']\n'
  } > "$file"
}

get_app_version() {
  local file
  if [ -f "src-tauri/tauri.conf.json" ]; then
    file="src-tauri/tauri.conf.json"
  elif [ -f "src-tauri/tauri.conf.json5" ]; then
    file="src-tauri/tauri.conf.json5"
  else
    printf 'unknown'
    return
  fi
  local version
  version=$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file" | head -n 1)
  if [ -n "$version" ]; then
    printf '%s' "$version"
  else
    printf 'unknown'
  fi
}

get_os_version() {
  if command -v sw_vers >/dev/null 2>&1; then
    sw_vers -productVersion
  elif [ -f /etc/os-release ]; then
    awk -F= '$1=="PRETTY_NAME" {gsub(/"/, "", $2); print $2}' /etc/os-release
  else
    printf 'unknown'
  fi
}

MAX_FILE_MB=${ARK_MAX_FILE_MB:-$MAX_FILE_MB_DEFAULT}
if ! [[ "$MAX_FILE_MB" =~ ^[0-9]+$ ]]; then
  log_error "ARK_MAX_FILE_MB must be an integer"
  exit 2
fi
MAX_FILE_BYTES=$((MAX_FILE_MB * 1024 * 1024))

out_dir=""
out_dir_provided=false
raw_requested=false
include_db=false
data_dir=""
logs_dir=""
bundle_id="$DEFAULT_BUNDLE_ID"
yes_mode=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --out)
      shift || { log_error "--out requires a value"; exit 2; }
      out_dir="$1"
      out_dir_provided=true
      ;;
    --raw)
      raw_requested=true
      ;;
    --include-db)
      include_db=true
      ;;
    --data-dir)
      shift || { log_error "--data-dir requires a value"; exit 2; }
      data_dir="$1"
      ;;
    --logs-dir)
      shift || { log_error "--logs-dir requires a value"; exit 2; }
      logs_dir="$1"
      ;;
    --bundle-id)
      shift || { log_error "--bundle-id requires a value"; exit 2; }
      bundle_id="$1"
      ;;
    --yes)
      yes_mode=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      log_error "Unknown option: $1"
      usage
      exit 2
      ;;
    *)
      log_error "Unexpected argument: $1"
      usage
      exit 2
      ;;
  esac
  shift || break
done

platform=$(uname -s)
case "$platform" in
  Darwin)
    default_out="$HOME/Desktop"
    default_data_dir="$HOME/Library/Application Support/$bundle_id"
    default_logs_dir="$HOME/Library/Logs/Arklowdun"
    crash_root="$HOME/Library/Logs/DiagnosticReports"
    ;;
  Linux)
    default_out="$HOME/Desktop"
    default_data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/Arklowdun"
    default_logs_dir="${XDG_STATE_HOME:-$HOME/.local/state}/Arklowdun/logs"
    crash_root=""
    ;;
  *)
    default_out="$HOME/Desktop"
    default_data_dir="$HOME/Library/Application Support/$bundle_id"
    default_logs_dir="$HOME/Library/Logs/Arklowdun"
    crash_root="$HOME/Library/Logs/DiagnosticReports"
    ;;
esac

used_default_out=false
if [ -z "$out_dir" ]; then
  out_dir="$default_out"
  used_default_out=true
fi
if [ -z "$data_dir" ]; then
  data_dir="$default_data_dir"
fi
if [ -z "$logs_dir" ]; then
  logs_dir="$default_logs_dir"
fi

out_dir=$(abs_path "$out_dir")
if [ ! -d "$out_dir" ]; then
  if $used_default_out; then
    out_dir="$(pwd)"
    out_dir=$(abs_path "$out_dir")
    log_warn "Desktop not found; using $out_dir"
  else
    if ! mkdir -p "$out_dir"; then
      log_error "Failed to create output directory $out_dir"
      exit 2
    fi
  fi
fi
data_dir=$(abs_path "$data_dir")
logs_dir=$(abs_path "$logs_dir")

mkdir -p "$out_dir"

if [ -n "${crash_root:-}" ]; then
  crash_root=$(abs_path "$crash_root")
fi

data_root_env="$data_dir"
logs_root_env="$logs_dir"

raw_mode=false
if $raw_requested; then
  if ! $yes_mode; then
    printf 'WARNING: --raw will include unredacted files that may contain sensitive information. Continue? [y/N] ' >&2
    read -r answer || answer=""
    case "$answer" in
      y|Y|yes|YES)
        raw_mode=true
        ;;
      *)
        add_warning "Raw data collection was cancelled by user confirmation prompt."
        raw_mode=false
        ;;
    esac
  else
    raw_mode=true
  fi
fi

if [ "${RAW_NO_REDACTION_FALLBACK:-0}" = "1" ]; then
  raw_mode=true
fi

work_dir=$(mktemp -d 2>/dev/null || mktemp -d -t arklowdun)
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT INT TERM

bundle_root="$work_dir/diagnostics"
collected_root="$bundle_root/collected"
raw_root="$bundle_root/raw"
db_root="$bundle_root/db"
mkdir -p "$collected_root" "$bundle_root"

process_source_file() {
  local category="$1" src="$2" base="$3" subdir="$4" dest_name="$5"
  local reason="" sha="" sha_raw="" redacted=false
  if [ ! -f "$src" ]; then
    add_manifest_entry "$src" "$category" false "not_found" "" "" "false" "" "" ""
    return
  fi
  local size
  size=$(get_file_size "$src")
  local mtime
  mtime=$(get_file_mtime_iso "$src")
  if [ "$size" -gt "$MAX_FILE_BYTES" ]; then
    reason="exceeds ${MAX_FILE_MB}MB limit"
    add_manifest_entry "$src" "$category" false "$reason" "$size" "$mtime" "false" "" "" "$MAX_FILE_MB"
    return
  fi
  local relative
  local base_trim=${base%/}
  case "$src" in
    "$base_trim"/*)
      relative=${src#"$base_trim/"}
      ;;
    *)
      relative=$(basename "$src")
      ;;
  esac
  if [ -n "$dest_name" ]; then
    relative="$dest_name"
  fi
  local dest="$collected_root/$subdir/$relative"
  mkdir -p "$(dirname "$dest")"
  if [ "${RAW_NO_REDACTION_FALLBACK:-0}" = "1" ]; then
    printf 'Raw-only fallback: see raw/%s\n' "$relative" > "$dest"
    sha=$(compute_sha256 "$dest")
    local raw_dest="$raw_root/$subdir/$relative"
    mkdir -p "$(dirname "$raw_dest")"
    if cp "$src" "$raw_dest"; then
      sha_raw=$(compute_sha256 "$raw_dest")
    else
      add_warning "Failed to copy raw file $src"
    fi
    add_manifest_entry "$src" "$category" true "raw_fallback" "$size" "$mtime" "false" "$sha" "$sha_raw" ""
    return
  fi
  if ! redact_file "$src" "$dest" "$data_root_env" "$logs_root_env"; then
    add_warning "Failed to redact $src"
    add_manifest_entry "$src" "$category" false "redaction_failed" "$size" "$mtime" "false" "" "" ""
    rm -f "$dest"
    return
  fi
  redacted=true
  sha=$(compute_sha256 "$dest")
  if $raw_mode; then
    local raw_dest="$raw_root/$subdir/$relative"
    mkdir -p "$(dirname "$raw_dest")"
    if cp "$src" "$raw_dest"; then
      sha_raw=$(compute_sha256 "$raw_dest")
    else
      add_warning "Failed to copy raw file $src"
    fi
  fi
  add_manifest_entry "$src" "$category" true "" "$size" "$mtime" "$redacted" "$sha" "$sha_raw" ""
}

collect_logs() {
  if [ ! -d "$logs_dir" ]; then
    return
  fi
  while IFS= read -r -d '' file; do
    local name
    name=$(basename "$file")
    case "$name" in
      *.log|*.jsonl|*.ndjson|*.log.*|*.jsonl.*|*.ndjson.*)
        process_source_file "log" "$file" "$logs_dir" "logs" ""
        ;;
    esac
  done < <(find "$logs_dir" -type f -print0 2>/dev/null)
}

collect_config() {
  if [ ! -d "$data_dir" ]; then
    return
  fi
  while IFS= read -r -d '' file; do
    local name
    name=$(basename "$file")
    case "$name" in
      *.json|*.toml|*.ini)
        process_source_file "config" "$file" "$data_dir" "config" ""
        ;;
    esac
  done < <(find "$data_dir" -type f -print0 2>/dev/null)
}

collect_crash() {
  local crash_file=""
  if [ -n "$crash_root" ] && [ -d "$crash_root" ]; then
    local latest_epoch=0
    while IFS= read -r -d '' file; do
      local epoch
      epoch=$(get_file_mtime_epoch "$file")
      if [ "$epoch" -gt "$latest_epoch" ]; then
        latest_epoch="$epoch"
        crash_file="$file"
      fi
    done < <(find "$crash_root" -type f \( -name "*${bundle_id}*.crash" -o -name "*${bundle_id}*.ips" -o -name "*Arklowdun*.crash" -o -name "*Arklowdun*.ips" \) -print0 2>/dev/null)
  fi
  if [ -n "$crash_file" ]; then
    process_source_file "crash" "$crash_file" "$(dirname "$crash_file")" "crash" "latest.crash.txt"
  else
    mkdir -p "$collected_root/crash"
    local stub="$collected_root/crash/latest.crash.txt"
    cat <<STUB > "$stub"
No crash reports matching "$bundle_id" were found on this system.
Checked directory: ${crash_root:-N/A}
STUB
    add_manifest_entry "${crash_root:-N/A}" "crash" false "not_found" "" "" "false" "" "" ""
  fi
}

collect_logs
collect_config
collect_crash

if $include_db; then
  mkdir -p "$db_root"
  db_path="${ARK_DB_PATH:-$data_dir/app.db}"
  if [ -f "$db_path" ]; then
    db_size=$(get_file_size "$db_path")
    db_mtime=$(get_file_mtime_iso "$db_path")
    db_sha=$(compute_sha256 "$db_path")
    cat <<META > "$db_root/db.meta.json"
{
  "path": "$(json_escape "$db_path")",
  "size_bytes": $db_size,
  "mtime_iso": "$(json_escape "$db_mtime")"
}
META
    printf '%s  %s\n' "$db_sha" "$db_path" > "$db_root/db.sha256"
    add_manifest_entry "$db_path" "db" false "hash_only" "$db_size" "$db_mtime" "false" "" "$db_sha" ""
  else
    add_warning "Database file not found at $db_path"
    add_manifest_entry "$db_path" "db" false "not_found" "" "" "false" "" "" ""
  fi
fi

if $raw_mode; then
  mkdir -p "$raw_root"
fi

write_manifest "$bundle_root/manifest.json"

system_os_version=$(get_os_version)
app_version=$(get_app_version)
platform_id=$(uname -s | tr '[:upper:]' '[:lower:]')
arch_id=$(uname -m)
timestamp_iso=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

cat <<SYS > "$bundle_root/system.json"
{
  "bundle_id": "$(json_escape "$bundle_id")",
  "app_version": "$(json_escape "$app_version")",
  "platform": "$(json_escape "$platform_id")",
  "os_version": "$(json_escape "$system_os_version")",
  "arch": "$(json_escape "$arch_id")",
  "timestamp_iso": "$(json_escape "$timestamp_iso")",
  "data_dir": "$(json_escape "$data_dir")",
  "logs_dir": "$(json_escape "$logs_dir")",
  "script_version": "$(json_escape "$SCRIPT_VERSION")"
}
SYS

readme_file="$bundle_root/README.txt"
{
  if [ "${RAW_NO_REDACTION_FALLBACK:-0}" = "1" ]; then
    printf '*** WARNING: NO REDACTION APPLIED ***\n'
    printf 'python3 not found; you used --raw --yes. This bundle contains unredacted files.\n'
    printf 'Review carefully before sharing.\n\n'
  fi
  if $raw_mode; then
    printf '*** WARNING: RAW FILES INCLUDED ***\n'
    printf 'These diagnostics include raw, unredacted copies of application files.\n'
    printf 'Please review before sharing.\n\n'
  fi
  printf 'Arklowdun Diagnostics Bundle\n'
  printf '============================\n\n'
  printf 'This archive was generated by scripts/collect-diagnostics.sh (version %s).\n' "$SCRIPT_VERSION"
  printf 'Contents include redacted copies of logs, configuration, and crash reports (if present).\n'
  printf 'A manifest (manifest.json) lists every file considered along with metadata and checksums.\n'
  printf 'Checksums for collected files are recorded in checksums.txt.\n\n'
  printf 'Flags:\n'
  printf '  --raw        Include unredacted copies (prompted unless --yes)\n'
  printf '  --include-db Include database hash metadata only\n'
  printf '  --out DIR    Choose destination directory\n\n'
  printf 'Review manifest.json to understand which files were included or skipped.\n'
  printf 'Redaction replaces emails, IP addresses, MAC addresses, home directory paths,\n'
  printf 'absolute paths outside app scopes, long hex tokens, and secret-like keys.\n'
  printf 'Relative paths within the app data and logs directories are preserved.\n\n'
  if $include_db; then
    printf 'Database metadata is available under db/. The SQLite file itself is not included.\n\n'
  fi
  if [ -z "$crash_root" ]; then
    printf 'Crash report stubs are included because automatic discovery is not configured on this platform.\n\n'
  fi
  printf 'To inspect raw files (when included), see the raw/ directory.\n'
  printf 'Share this archive with support by attaching the resulting zip file to your email.\n'
} > "$readme_file"

generate_checksums() {
  local target_dir="$1"
  if [ -d "$target_dir" ]; then
    while IFS= read -r -d '' file; do
      local rel=${file#"$bundle_root/"}
      local sha
      sha=$(compute_sha256 "$file")
      printf '%s  %s\n' "$sha" "$rel" >> "$bundle_root/checksums.txt"
    done < <(find "$target_dir" -type f -print0 2>/dev/null)
  fi
}

> "$bundle_root/checksums.txt"
generate_checksums "$collected_root"
generate_checksums "$raw_root"
generate_checksums "$db_root"

manifest_hash=$(compute_sha256 "$bundle_root/manifest.json")
printf '%s  %s\n' "$manifest_hash" "manifest.json" >> "$bundle_root/checksums.txt"
short_hash=${manifest_hash:0:8}
timestamp=$(date '+%Y%m%d-%H%M%S')
zip_name="diagnostics-${timestamp}-${short_hash}.zip"
zip_path="$out_dir/$zip_name"

(cd "$work_dir" && zip -rq "$zip_path" diagnostics)

exit_code=0
if [ ${#warnings[@]} -gt 0 ]; then
  for warn_msg in "${warnings[@]}"; do
    log_warn "$warn_msg"
  done
  exit_code=1
fi

printf '%s\n' "$zip_path"
exit "$exit_code"
