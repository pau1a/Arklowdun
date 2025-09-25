use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use fs2::available_space;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use tokio::task;

use crate::{
    db,
    db::manifest as db_manifest,
    repo,
    security::fs_policy::{self, RootKey},
    AppError, AppResult,
};

use self::manifest::{file_sha256, ExportManifest, TableInfo};
use serde::Serialize;
use ts_rs::TS;

pub mod manifest;

const PARTIAL_SUFFIX: &str = ".partial";

#[derive(Debug, Clone)]
pub struct ExportOptions {
    pub out_parent: PathBuf,
}

#[derive(Debug, Clone)]
pub struct ExportEntry {
    pub directory: PathBuf,
    pub manifest_path: PathBuf,
    pub verify_sh_path: PathBuf,
    pub verify_ps1_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ExportEntryDto {
    pub directory: String,
    pub manifest_path: String,
    pub verify_sh_path: String,
    pub verify_ps1_path: String,
}

impl From<ExportEntry> for ExportEntryDto {
    fn from(e: ExportEntry) -> Self {
        ExportEntryDto {
            directory: e.directory.to_string_lossy().into_owned(),
            manifest_path: e.manifest_path.to_string_lossy().into_owned(),
            verify_sh_path: e.verify_sh_path.to_string_lossy().into_owned(),
            verify_ps1_path: e.verify_ps1_path.to_string_lossy().into_owned(),
        }
    }
}

/// Create an export bundle under `<out_parent>/export-YYYYMMDD-HHMMSS[-NN]/...`.
pub async fn create_export<R: tauri::Runtime>(
    app: Option<&tauri::AppHandle<R>>,
    pool: &SqlitePool,
    opts: ExportOptions,
) -> AppResult<ExportEntry> {
    let out_parent = opts.out_parent;
    let schema_version = current_schema_version(pool)
        .await
        .map_err(|err| AppError::from(err).with_context("operation", "schema_version"))?;

    let (attachments_base, app_version) = (
        resolve_attachments_base(app).map_err(|e| AppError::from(e).with_context("operation", "resolve_attachments_base"))?,
        env!("CARGO_PKG_VERSION").to_string(),
    );

    // Preflight: ensure parent exists and enough space is available.
    fs::create_dir_all(&out_parent).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "create_out_parent")
            .with_context("path", out_parent.display().to_string())
    })?;

    let preflight = task::spawn_blocking({
        let attachments_base = attachments_base.clone();
        move || estimate_export_size(&attachments_base)
    })
    .await
    .map_err(|err| AppError::new("EXPORT/TASK", "Size estimate task panicked").with_context("error", err.to_string()))??;

    let avail = free_disk_space(&out_parent)
        .map_err(|err| AppError::from(err).with_context("operation", "available_space"))?;
    if avail < preflight.required_bytes {
        return Err(AppError::new(
            "EXPORT/LOW_DISK",
            format!("Not enough disk space (need ~{}).", format_bytes(preflight.required_bytes)),
        )
        .with_context("available_bytes", avail.to_string())
        .with_context("required_bytes", preflight.required_bytes.to_string()));
    }

    // Allocate unique directory
    let timestamp = Utc::now();
    let export_dir = unique_export_dir(&out_parent, &timestamp).map_err(|err| err.with_context("operation", "alloc_export_dir"))?;
    fs::create_dir_all(&export_dir).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "create_export_dir")
            .with_context("path", export_dir.display().to_string())
    })?;

    // Layout
    let data_dir = export_dir.join("data");
    let attachments_dir = export_dir.join("attachments");
    fs::create_dir_all(&data_dir).ok();
    fs::create_dir_all(&attachments_dir).ok();

    // Dump tables deterministically
    let mut manifest = ExportManifest::new(app_version, schema_version);

    let mut table_sha: BTreeMap<&'static str, (u64, String)> = BTreeMap::new();
    for (table, filename) in [
        ("household", "households.jsonl"),
        ("events", "events.jsonl"),
        ("notes", "notes.jsonl"),
        ("files_index", "files.jsonl"),
    ] {
        let path = data_dir.join(filename);
        let (count, sha) = dump_table_jsonl(pool, table, &path)
            .await
            .map_err(|err| AppError::from(err).with_context("operation", "dump_table").with_context("table", table))?;
        table_sha.insert(table, (count, sha));
    }
    // Fill manifest.tables with the exported subset
    for (logical, table) in [("households", "household"), ("events", "events"), ("notes", "notes"), ("files", "files_index")] {
        if let Some((count, sha)) = table_sha.get(table) {
            manifest.tables.insert(logical.to_string(), TableInfo { count: *count, sha256: sha.clone() });
        }
    }

    // Copy attachments with deterministic order and build attachment manifests
    let (attachments_total_count, attachments_total_bytes, attachments_manifest_sha) =
        copy_attachments_and_build_manifests(pool, &attachments_base, &attachments_dir, &export_dir)
            .await
            .map_err(|err| AppError::from(err).with_context("operation", "copy_attachments"))?;

    manifest.attachments.total_count = attachments_total_count as u64;
    manifest.attachments.total_bytes = attachments_total_bytes as u64;
    manifest.attachments.sha256_manifest = attachments_manifest_sha;

    // Write manifest.json
    let manifest_path = export_dir.join("manifest.json");
    let payload = serde_json::to_vec_pretty(&manifest)
        .map_err(|err| AppError::from(err).with_context("operation", "serialize_manifest"))?;
    db::write_atomic(&manifest_path, &payload)
        .map_err(|err| AppError::from(err).with_context("operation", "write_manifest"))?;

    // Write verification scripts (with embedded expected hashes)
    let verify_sh_path = export_dir.join("verify.sh");
    let verify_ps1_path = export_dir.join("verify.ps1");
    write_verify_scripts(
        &verify_sh_path,
        &verify_ps1_path,
        &manifest.tables,
        &manifest.attachments.sha256_manifest,
    )?;

    Ok(ExportEntry { directory: export_dir, manifest_path, verify_sh_path, verify_ps1_path })
}

struct SizeEstimate {
    required_bytes: u64,
}

fn estimate_export_size(attachments_base: &Path) -> AppResult<SizeEstimate> {
    let mut total: u64 = 20_000; // small overhead for metadata + scripts
    if attachments_base.exists() {
        total = total.saturating_add(dir_size(attachments_base).unwrap_or(0));
    }
    // Add a rough buffer for data files
    total = total.saturating_add(5_000_000);
    Ok(SizeEstimate { required_bytes: (total as f64 * 1.1).ceil() as u64 })
}

async fn current_schema_version(pool: &SqlitePool) -> Result<String> {
    if let Some(v) = sqlx::query_scalar::<_, String>(
        "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await? {
        return Ok(v);
    }
    // Fallback: hash of schema
    db_manifest::schema_hash(pool).await
}

async fn dump_table_jsonl(pool: &SqlitePool, table: &str, path: &Path) -> Result<(u64, String)> {
    // Dump SELECT * in stable order; only some tables have deleted_at
    let order = "id";
    let has_deleted = matches!(table, "household" | "events" | "notes" | "bills" | "policies" | "property_documents" | "inventory_items" | "vehicle_maintenance" | "pets" | "family_members" | "budget_categories" | "expenses" | "shopping_items");
    let sql = if has_deleted {
        format!("SELECT * FROM {table} WHERE deleted_at IS NULL ORDER BY {order}")
    } else {
        format!("SELECT * FROM {table} ORDER BY {order}")
    };
    let rows = sqlx::query(&sql).fetch_all(pool).await?;

    let tmp = tmp_path(path);
    let mut file = fs::File::create(&tmp)?;
    let mut count = 0_u64;
    for row in rows {
        let val = repo::row_to_json(row);
        serde_json::to_writer(&mut file, &val)?;
        file.write_all(b"\n")?;
        count += 1;
    }
    file.flush().ok();
    drop(file);
    fs::rename(&tmp, path)?;
    let sha = file_sha256(path)?;
    Ok((count, sha))
}

async fn copy_attachments_and_build_manifests(
    pool: &SqlitePool,
    attach_base: &Path,
    dest_root: &Path,
    export_root: &Path,
) -> Result<(usize, u64, String)> {
    let sources = load_attachment_rel_paths(pool).await?;

    // Manifests: one that reflects exported files (for verification), one from DB references (log missing)
    let attach_manifest_path = export_root.join("attachments_manifest.txt");
    let db_list_path = export_root.join("attachments_db_manifest.txt");
    let mut attach_manifest = fs::File::create(&attach_manifest_path)?;
    let mut db_manifest = fs::File::create(&db_list_path)?;

    let mut total_bytes: u64 = 0;
    let mut total_count: usize = 0;

    for rel in &sources {
        // DB manifest logging
        let src_path = attach_base.join(rel);
        if src_path.is_file() {
            // Copy and hash
            let dest_path = dest_root.join(rel);
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent).ok();
            }
            let hash = copy_and_hash(&src_path, &dest_path)?;
            let size = fs::metadata(&dest_path).map(|m| m.len()).unwrap_or(0);
            total_bytes = total_bytes.saturating_add(size);
            total_count += 1;
            writeln!(attach_manifest, "{}\t{}", rel, hash)?;
            writeln!(db_manifest, "{}\t{}", rel, hash)?;
        } else {
            // Missing file; log as MISSING in DB manifest
            writeln!(db_manifest, "{}\tMISSING", rel)?;
        }
    }
    attach_manifest.flush().ok();
    db_manifest.flush().ok();
    let sha = file_sha256(&attach_manifest_path)?;
    Ok((total_count, total_bytes, sha))
}

async fn load_attachment_rel_paths(pool: &SqlitePool) -> Result<Vec<String>> {
    // Collect distinct relative_path across all tables that may carry attachments, where root_key='attachments'
    let tables = [
        "bills",
        "policies",
        "property_documents",
        "inventory_items",
        "vehicle_maintenance",
        "pet_medical",
    ];
    let mut set: BTreeSet<String> = BTreeSet::new();
    for t in tables {
        let sql = format!(
            "SELECT DISTINCT relative_path FROM {t} WHERE deleted_at IS NULL AND root_key = 'attachments' AND relative_path IS NOT NULL"
        );
        let rows = sqlx::query(&sql).fetch_all(pool).await?;
        for row in rows {
            let rel: Option<String> = row.try_get("relative_path").ok();
            if let Some(rel) = rel {
                if !rel.trim().is_empty() {
                    set.insert(rel);
                }
            }
        }
    }
    Ok(set.into_iter().collect())
}

fn copy_and_hash(src: &Path, dest: &Path) -> Result<String> {
    let mut in_f = fs::File::open(src).with_context(|| format!("open attachment: {}", src.display()))?;
    let mut out_f = fs::File::create(dest).with_context(|| format!("create attachment: {}", dest.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0_u8; 131072];
    loop {
        let n = in_f.read(&mut buf)?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
        out_f.write_all(&buf[..n])?;
    }
    out_f.flush().ok();
    Ok(format!("{:x}", hasher.finalize()))
}

fn tmp_path(final_path: &Path) -> PathBuf {
    let mut s = OsString::from(final_path.as_os_str());
    s.push(PARTIAL_SUFFIX);
    PathBuf::from(s)
}

fn free_disk_space(path: &Path) -> Result<u64> {
    let target: Cow<'_, Path> = if path.exists() {
        Cow::Borrowed(path)
    } else if let Some(parent) = path.parent() {
        Cow::Owned(parent.to_path_buf())
    } else {
        Cow::Owned(std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")))
    };
    available_space(target.as_ref()).map_err(|e| anyhow::anyhow!(e))
}

fn dir_size(path: &Path) -> Result<u64> {
    let mut total = 0_u64;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if meta.is_dir() {
            total = total.saturating_add(dir_size(&entry.path())?);
        } else {
            total = total.saturating_add(meta.len());
        }
    }
    Ok(total)
}

fn unique_export_dir(root: &Path, timestamp: &DateTime<Utc>) -> AppResult<PathBuf> {
    let base = timestamp.format("%Y%m%d-%H%M%S").to_string();
    for suffix in 0..100 {
        let candidate = if suffix == 0 {
            root.join(&base)
        } else {
            root.join(format!("{base}-{suffix:02}"))
        };
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(AppError::new("EXPORT/NAME_COLLISION", "Unable to allocate export directory"))
}

fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "0 MB".to_string();
    }
    let mb = (bytes as f64) / 1_000_000.0;
    if mb < 1.0 { "1 MB".to_string() } else { format!("{:.0} MB", mb.ceil()) }
}

fn write_verify_scripts(
    sh_path: &Path,
    ps1_path: &Path,
    tables: &BTreeMap<String, TableInfo>,
    attachments_manifest_sha: &str,
) -> Result<()> {
    // Extract expected table hashes if available
    let expect = |key: &str| tables.get(key).map(|t| t.sha256.clone()).unwrap_or_default();
    let households_sha = expect("households");
    let events_sha = expect("events");
    let notes_sha = expect("notes");
    let files_sha = expect("files");

    let sh = format!(r#"#!/usr/bin/env bash
set -euo pipefail

if command -v sha256sum >/dev/null 2>&1; then
  SHACMD=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  SHACMD=(shasum -a 256)
else
  echo 'No sha256 tool found (need sha256sum or shasum)' >&2; exit 2;
fi

ck() {{ # file expected
  local f="$1"; local expected="$2";
  if [[ -n "$expected" && -f "$f" ]]; then
    local got; got=$("${{SHACMD[@]}}" "$f" | awk '{{{{print $1}}}}');
    if [[ "$got" != "$expected" ]]; then
      echo "Mismatch: $f"; echo " expected: $expected"; echo "      got: $got"; exit 1;
    fi
  fi
}}

ck data/households.jsonl {households_sha}
ck data/events.jsonl {events_sha}
ck data/notes.jsonl {notes_sha}
ck data/files.jsonl {files_sha}

AM=attachments_manifest.rebuilt.txt
rm -f "$AM"
if command -v find >/dev/null 2>&1; then
  find attachments -type f -print0 | sort -z | while IFS= read -r -d '' f; do
    h=$("${{SHACMD[@]}}" "$f" | awk '{{{{print $1}}}}');
    rp="${{f#attachments/}}";
    printf '%s\t%s\n' "$rp" "$h" >>"$AM";
  done
else
  echo 'find not available to enumerate attachments' >&2; exit 2;
fi

AM_SHA=$("${{SHACMD[@]}}" "$AM" | awk '{{{{print $1}}}}')
EXPECT_AM_SHA={attachments_sha}
if [[ "$AM_SHA" != "$EXPECT_AM_SHA" ]]; then
  echo 'Attachments manifest mismatch'
  echo " expected: $EXPECT_AM_SHA"
  echo "      got: $AM_SHA"
  exit 1
fi

echo 'OK'
"#,
        households_sha = households_sha,
        events_sha = events_sha,
        notes_sha = notes_sha,
        files_sha = files_sha,
        attachments_sha = attachments_manifest_sha,
    );

    let ps1 = format!(r#"#requires -version 5
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-Sha256([string]$Path) {{ (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLower() }}

function Check-File([string]$Path, [string]$Expected) {{
  if ($Expected -and (Test-Path $Path)) {{
    $got = Get-Sha256 $Path
    if ($got -ne $Expected) {{
      Write-Host "Mismatch: $Path`n expected: $Expected`n      got: $got"
      exit 1
    }}
  }}
}}

Check-File 'data/households.jsonl' '{households_sha}'
Check-File 'data/events.jsonl' '{events_sha}'
Check-File 'data/notes.jsonl' '{notes_sha}'
Check-File 'data/files.jsonl' '{files_sha}'

$am = 'attachments_manifest.rebuilt.txt'
if (Test-Path $am) {{ Remove-Item $am -Force }}
Get-ChildItem -Path 'attachments' -Recurse -File | Sort-Object FullName | ForEach-Object {{
  $h = Get-Sha256 $_.FullName
  $rp = ($_.FullName -replace '^.*attachments\\', '') -replace '\\', '/'
  "$rp`t$h" | Out-File -FilePath $am -Append -Encoding utf8
}}
$amSha = Get-Sha256 $am
$expect = '{attachments_sha}'
if ($amSha -ne $expect) {{
  Write-Host "Attachments manifest mismatch`n expected: $expect`n      got: $amSha"
  exit 1
}}
Write-Host 'OK'
"#,
        households_sha = households_sha,
        events_sha = events_sha,
        notes_sha = notes_sha,
        files_sha = files_sha,
        attachments_sha = attachments_manifest_sha,
    );

    fs::write(sh_path, sh)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut p = fs::metadata(sh_path)?.permissions();
        p.set_mode(0o755);
        fs::set_permissions(sh_path, p)?;
    }
    fs::write(ps1_path, ps1)?;
    Ok(())
}

fn resolve_attachments_base<R: tauri::Runtime>(
    app: Option<&tauri::AppHandle<R>>,
) -> Result<PathBuf> {
    if let Ok(fake) = std::env::var("ARK_FAKE_APPDATA") {
        return Ok(PathBuf::from(fake).join("attachments"));
    }
    if let Some(app) = app {
        return fs_policy::base_for(RootKey::Attachments, app).map_err(|e| anyhow::anyhow!(e.to_string()));
    }
    // Fallback for CLI when no app handle exists
    let base = dirs::data_dir()
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| anyhow::anyhow!("failed to resolve application data directory"))?;
    Ok(base.join("com.paula.arklowdun").join("attachments"))
}
