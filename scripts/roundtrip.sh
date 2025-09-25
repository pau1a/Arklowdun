#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

usage() {
  cat <<'USAGE'
Usage: scripts/roundtrip.sh [options]

Orchestrate the deterministic round-trip workflow: build, seed, export, wipe, import.

Options:
  --seed <value>         PRNG seed forwarded to fixtures/large/seed.ts (default: 42)
  --tmp <path>           Working directory used for database + artifacts (default: <repo>/.tmp/roundtrip)
  --import-mode <mode>   Import mode passed to `arklowdun db import` (merge or replace, default: replace)
  --skip-build           Assume the CLI is already built and skip the cargo release build
  --help                 Show this help message

The temporary directory is cleared at the start of every run to ensure a clean slate.
USAGE
}

log_step() {
  local message="$1"
  printf '\n[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$message" | tee -a "$LOG_PATH"
}

ensure_not_empty_path() {
  local path="$1"
  if [[ -z "$path" ]]; then
    echo "error: temporary directory path resolved to empty string" >&2
    exit 1
  fi
  case "$path" in
    /|//) echo "error: refusing to operate on $path" >&2; exit 1 ;;
  esac
}

snapshot_attachments() {
  local stage="$1"
  local output_path="$2"
  log_step "Collecting attachment snapshot (${stage})"
  ATTACHMENTS_DIR="$ATTACHMENTS_DIR" \
  APPDATA_DIR="$APPDATA_DIR" \
  OUTPUT_PATH="$output_path" \
  SKIP_APPDATA_JSON="$SKIP_APPDATA_JSON" \
  STAGE_LABEL="$stage" \
    node --input-type=module <<'JS' 2>&1 | tee -a "$LOG_PATH"
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

const attachmentsDir = process.env.ATTACHMENTS_DIR;
const appDataDir = process.env.APPDATA_DIR;
const outputPath = process.env.OUTPUT_PATH;
const skipJson = process.env.SKIP_APPDATA_JSON ?? '[]';
const stageLabel = process.env.STAGE_LABEL ?? 'unknown';

if (!outputPath) {
  console.error('Attachment snapshot failed: OUTPUT_PATH is not set');
  process.exit(1);
}

const skipPatterns = JSON.parse(skipJson);

const shouldSkip = (relativePath, skip) =>
  skip.some((pattern) => relativePath === pattern || relativePath.startsWith(`${pattern}/`));

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function collect(rootDir, rootKey, skip = []) {
  if (!rootDir) return [];
  let stat;
  try {
    stat = await fs.stat(rootDir);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  if (!stat.isDirectory()) {
    return [];
  }

  const records = [];
  async function walk(currentDir, relative) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (shouldSkip(nextRelative, skip)) {
        continue;
      }
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, nextRelative);
      } else if (entry.isFile()) {
        const fileStat = await fs.stat(absolute);
        const digest = await hashFile(absolute);
        records.push({
          rootKey,
          relativePath: nextRelative,
          size: fileStat.size,
          sha256: digest,
        });
      }
    }
  }

  await walk(rootDir, '');
  return records;
}

const combined = [
  ...(await collect(attachmentsDir, 'attachments', [])),
  ...(await collect(appDataDir, 'appData', skipPatterns)),
];

combined.sort((a, b) => {
  if (a.rootKey !== b.rootKey) {
    return a.rootKey.localeCompare(b.rootKey);
  }
  return a.relativePath.localeCompare(b.relativePath);
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(combined, null, 2) + '\n');
console.log(`Attachment snapshot (${combined.length} files, stage=${stageLabel}) -> ${outputPath}`);
JS
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SEED=42
TMP_OVERRIDE=""
IMPORT_MODE="replace"
SKIP_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed)
      SEED="$2"
      shift 2
      ;;
    --tmp)
      TMP_OVERRIDE="$2"
      shift 2
      ;;
    --import-mode)
      case "$2" in
        merge|replace) IMPORT_MODE="$2" ;;
        *) echo "error: --import-mode must be 'merge' or 'replace'" >&2; exit 1 ;;
      esac
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option '$1'" >&2
      usage
      exit 1
      ;;
  esac
done

TMP_DIR="${TMP_OVERRIDE:-$REPO_ROOT/.tmp/roundtrip}"
TMP_DIR="$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "$TMP_DIR")"
ensure_not_empty_path "$TMP_DIR"

LOG_DIR="$TMP_DIR/logs"
ARTIFACT_DIR="$TMP_DIR/artifacts"
APPDATA_DIR="$TMP_DIR/appdata"
DB_PATH="$APPDATA_DIR/arklowdun.sqlite3"
ATTACHMENTS_DIR="$APPDATA_DIR/attachments"
EXPORT_PARENT="$TMP_DIR/export"
CONTEXT_PATH="$TMP_DIR/context.json"
LOG_PATH="$LOG_DIR/roundtrip.log"
PRE_EXPORT_SUMMARY="$ARTIFACT_DIR/pre-export-summary.json"
PRE_EXPORT_ATTACHMENTS="$ARTIFACT_DIR/pre-export-attachments.json"
POST_ATTACHMENTS="$ARTIFACT_DIR/post-attachments.json"
EXPORT_MANIFEST_COPY="$ARTIFACT_DIR/export-manifest.json"
IMPORT_REPORT_COPY="$ARTIFACT_DIR/import-report.json"
# skip appdata files that are rehydrated during import/export cycles
SKIP_APPDATA_JSON='["attachments","reports","arklowdun.sqlite3","arklowdun.sqlite3-wal","arklowdun.sqlite3-shm"]'

rm -rf "$TMP_DIR"
mkdir -p "$LOG_DIR" "$ARTIFACT_DIR" "$EXPORT_PARENT" "$APPDATA_DIR"
touch "$LOG_PATH"
trap 'echo; echo "--- tail(log) ---"; tail -n 200 "$LOG_PATH" 2>/dev/null || true' EXIT
log_step "Workspace prepared at $TMP_DIR"

ARKLOWDUN_BIN="$REPO_ROOT/src-tauri/target/release/arklowdun"
DEBUG_BIN="$REPO_ROOT/src-tauri/target/debug/arklowdun"
if [[ "$SKIP_BUILD" -eq 1 ]]; then
  log_step "Skipping CLI build (using existing binary)"
else
  log_step "Building arklowdun CLI (release)"
  (
    cd "$REPO_ROOT/src-tauri"
    cargo build --bin arklowdun --release
  ) 2>&1 | tee -a "$LOG_PATH"
fi

if [[ ! -x "$ARKLOWDUN_BIN" ]]; then
  if [[ -x "$DEBUG_BIN" ]]; then
    ARKLOWDUN_BIN="$DEBUG_BIN"
    log_step "Release binary missing; falling back to debug build at $ARKLOWDUN_BIN"
  else
    echo "error: arklowdun binary not found (looked for $ARKLOWDUN_BIN and $DEBUG_BIN)" >&2
    exit 1
  fi
fi

CLI_VERSION="$("$ARKLOWDUN_BIN" --version 2>/dev/null | head -n 1 || true)"
if [[ -z "$CLI_VERSION" ]]; then
  CLI_VERSION="unknown"
fi
log_step "Using arklowdun CLI at $ARKLOWDUN_BIN (${CLI_VERSION})"

log_step "Seeding canonical dataset (seed=$SEED)"
(
  cd "$REPO_ROOT"
  node --loader ts-node/esm fixtures/large/seed.ts \
    --db "$DB_PATH" \
    --attachments "$ATTACHMENTS_DIR" \
    --seed "$SEED" \
    --reset \
    --summary "$PRE_EXPORT_SUMMARY"
) 2>&1 | tee -a "$LOG_PATH"

[[ -s "$DB_PATH" ]] || { echo "error: DB not created by seeder" >&2; exit 1; }
[[ -s "$PRE_EXPORT_SUMMARY" ]] || { echo "error: summary not written" >&2; exit 1; }

snapshot_attachments "pre-export" "$PRE_EXPORT_ATTACHMENTS"

# The arklowdun CLI honors ARK_FAKE_APPDATA to override the application data root.
export ARK_FAKE_APPDATA="$APPDATA_DIR"

log_step "Running export CLI"
EXPORT_OUTPUT="$(
  "$ARKLOWDUN_BIN" db export --out "$EXPORT_PARENT" 2>&1 | tee -a "$LOG_PATH"
)"

EXPORT_DIR="$(printf '%s\n' "$EXPORT_OUTPUT" | sed -n 's/^Export created at //p' | tail -n 1)"
MANIFEST_PATH="$(printf '%s\n' "$EXPORT_OUTPUT" | sed -n 's/^Manifest: //p' | tail -n 1)"
VERIFY_SH_PATH="$(printf '%s\n' "$EXPORT_OUTPUT" | sed -n 's/^Verify (bash): //p' | tail -n 1)"
VERIFY_PS1_PATH="$(printf '%s\n' "$EXPORT_OUTPUT" | sed -n 's/^Verify (PowerShell): //p' | tail -n 1)"

if [[ -z "$EXPORT_DIR" || ! -d "$EXPORT_DIR" ]]; then
  echo "error: failed to determine export directory" >&2
  exit 1
fi

log_step "Export bundle located at $EXPORT_DIR"

if [[ -z "$MANIFEST_PATH" || ! -f "$MANIFEST_PATH" ]]; then
  echo "error: export manifest path missing or not found" >&2
  exit 1
fi

if [[ -z "$VERIFY_SH_PATH" || ! -f "$VERIFY_SH_PATH" ]]; then
  echo "error: export verify (bash) script missing or not found" >&2
  exit 1
fi

if [[ -z "$VERIFY_PS1_PATH" || ! -f "$VERIFY_PS1_PATH" ]]; then
  echo "error: export verify (PowerShell) script missing or not found" >&2
  exit 1
fi

cp "$MANIFEST_PATH" "$EXPORT_MANIFEST_COPY"
log_step "Copied manifest to $EXPORT_MANIFEST_COPY"

log_step "Wiping database and attachments before import"
rm -rf "$APPDATA_DIR"
mkdir -p "$APPDATA_DIR"

log_step "Importing export bundle using mode=$IMPORT_MODE"
IMPORT_OUTPUT="$(
  "$ARKLOWDUN_BIN" db import --in "$EXPORT_DIR" --mode "$IMPORT_MODE" 2>&1 | tee -a "$LOG_PATH"
)"

IMPORT_REPORT_PATH="$(printf '%s\n' "$IMPORT_OUTPUT" | sed -n 's/^Report saved to //p' | tail -n 1)"
if [[ -n "$IMPORT_REPORT_PATH" && -f "$IMPORT_REPORT_PATH" ]]; then
  cp "$IMPORT_REPORT_PATH" "$IMPORT_REPORT_COPY"
  log_step "Copied import report to $IMPORT_REPORT_COPY"
fi

snapshot_attachments "post-import" "$POST_ATTACHMENTS"

ROUNDTRIP_VERIFY_SCRIPT=""
for candidate in "$REPO_ROOT/scripts/roundtrip-verify.ts" "$REPO_ROOT/scripts/roundtrip-verify.mjs" "$REPO_ROOT/scripts/roundtrip-verify.js"; do
  if [[ -f "$candidate" ]]; then
    ROUNDTRIP_VERIFY_SCRIPT="$candidate"
    break
  fi
done

if [[ -n "$ROUNDTRIP_VERIFY_SCRIPT" ]]; then
  log_step "Verification script detected at $ROUNDTRIP_VERIFY_SCRIPT (not yet invoked; Phase 3 will integrate)"
else
  log_step "No verification script detected (expected until Phase 3)."
fi

log_step "Writing round-trip context metadata"
ROUNDTRIP_CONTEXT="$CONTEXT_PATH" \
SEED_VALUE="$SEED" \
TMP_VALUE="$TMP_DIR" \
APPDATA_VALUE="$APPDATA_DIR" \
DB_VALUE="$DB_PATH" \
ATTACHMENTS_VALUE="$ATTACHMENTS_DIR" \
SUMMARY_VALUE="$PRE_EXPORT_SUMMARY" \
PRE_ATTACH_VALUE="$PRE_EXPORT_ATTACHMENTS" \
POST_ATTACH_VALUE="$POST_ATTACHMENTS" \
EXPORT_DIR_VALUE="$EXPORT_DIR" \
MANIFEST_VALUE="$MANIFEST_PATH" \
VERIFY_SH_VALUE="$VERIFY_SH_PATH" \
VERIFY_PS1_VALUE="$VERIFY_PS1_PATH" \
IMPORT_REPORT_VALUE="$IMPORT_REPORT_PATH" \
CLI_VERSION_VALUE="$CLI_VERSION" \
  node --input-type=module <<'JS' 2>&1 | tee -a "$LOG_PATH"
import fs from 'node:fs';
import path from 'node:path';

const output = process.env.ROUNDTRIP_CONTEXT;
if (!output) {
  console.error('Missing ROUNDTRIP_CONTEXT env');
  process.exit(1);
}

const data = {
  seed: Number(process.env.SEED_VALUE ?? '0') || undefined,
  workspace: process.env.TMP_VALUE,
  appDataDir: process.env.APPDATA_VALUE,
  database: process.env.DB_VALUE,
  attachmentsDir: process.env.ATTACHMENTS_VALUE,
  preExportSummary: process.env.SUMMARY_VALUE,
  preExportAttachments: process.env.PRE_ATTACH_VALUE,
  postAttachments: process.env.POST_ATTACH_VALUE,
  exportDir: process.env.EXPORT_DIR_VALUE,
  manifestPath: process.env.MANIFEST_VALUE,
  verifyScript: process.env.VERIFY_SH_VALUE,
  verifyScriptPowerShell: process.env.VERIFY_PS1_VALUE,
  importReport: process.env.IMPORT_REPORT_VALUE,
  cliVersion: process.env.CLI_VERSION_VALUE,
};

const cleaned = Object.fromEntries(
  Object.entries(data).filter(([, value]) => value !== undefined && value !== ''),
);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(cleaned, null, 2) + '\n');
console.log(`Round-trip context written to ${output}`);
JS

log_step "Round-trip orchestration complete"

cat <<SUMMARY | tee -a "$LOG_PATH"
---
Round-trip artifacts:
  Workspace: $TMP_DIR
  Database: $DB_PATH
  Attachments: $ATTACHMENTS_DIR
  Export bundle: $EXPORT_DIR
  Manifest copy: $EXPORT_MANIFEST_COPY
  Import report copy: $IMPORT_REPORT_COPY
  Context: $CONTEXT_PATH
---
SUMMARY
