use std::borrow::Cow;
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use fs2::available_space;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use tokio::task;

use crate::{
    attachment_category::AttachmentCategory, db, db::manifest as db_manifest, repo,
    security::hash_path, vault::Vault, AppError, AppResult,
};

use self::manifest::{file_sha256, ExportManifest, TableInfo};
use serde::Serialize;
use tracing::warn;
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
pub async fn create_export(
    pool: &SqlitePool,
    vault: Arc<Vault>,
    opts: ExportOptions,
) -> AppResult<ExportEntry> {
    let out_parent = opts.out_parent;
    let schema_version = current_schema_version(pool)
        .await
        .map_err(|err| AppError::from(err).with_context("operation", "schema_version"))?;

    let app_version = env!("CARGO_PKG_VERSION").to_string();

    // Preflight: ensure parent exists and enough space is available.
    fs::create_dir_all(&out_parent).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "create_out_parent")
            .with_context("path", out_parent.display().to_string())
    })?;

    let preflight = task::spawn_blocking({
        let vault = vault.clone();
        move || estimate_export_size(&vault)
    })
    .await
    .map_err(|err| {
        AppError::new("EXPORT/TASK", "Size estimate task panicked")
            .with_context("error", err.to_string())
    })??;

    let avail = free_disk_space(&out_parent)
        .map_err(|err| AppError::from(err).with_context("operation", "available_space"))?;
    if avail < preflight.required_bytes {
        return Err(AppError::new(
            "EXPORT/LOW_DISK",
            format!(
                "Not enough disk space (need ~{}).",
                format_bytes(preflight.required_bytes)
            ),
        )
        .with_context("available_bytes", avail.to_string())
        .with_context("required_bytes", preflight.required_bytes.to_string()));
    }

    // Allocate unique directory
    let timestamp = Utc::now();
    let export_dir = unique_export_dir(&out_parent, &timestamp)
        .map_err(|err| err.with_context("operation", "alloc_export_dir"))?;
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
        let (count, sha) = dump_table_jsonl(pool, table, &path).await.map_err(|err| {
            AppError::from(err)
                .with_context("operation", "dump_table")
                .with_context("table", table)
        })?;
        table_sha.insert(table, (count, sha));
    }
    // Fill manifest.tables with the exported subset
    for (logical, table) in [
        ("households", "household"),
        ("events", "events"),
        ("notes", "notes"),
        ("files", "files_index"),
    ] {
        if let Some((count, sha)) = table_sha.get(table) {
            manifest.tables.insert(
                logical.to_string(),
                TableInfo {
                    count: *count,
                    sha256: sha.clone(),
                },
            );
        }
    }

    // Copy attachments with deterministic order and build attachment manifests
    let (attachments_total_count, attachments_total_bytes, attachments_manifest_sha) =
        copy_attachments_and_build_manifests(pool, vault.as_ref(), &attachments_dir, &export_dir)
            .await
            .map_err(|err| err.with_context("operation", "copy_attachments"))?;

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

    Ok(ExportEntry {
        directory: export_dir,
        manifest_path,
        verify_sh_path,
        verify_ps1_path,
    })
}

struct SizeEstimate {
    required_bytes: u64,
}

fn estimate_export_size(vault: &Vault) -> AppResult<SizeEstimate> {
    let mut total: u64 = 20_000; // small overhead for metadata + scripts
    let attachments_base = vault.base();
    if attachments_base.exists() {
        total = total.saturating_add(dir_size(attachments_base).unwrap_or(0));
    }
    // Add a rough buffer for data files
    total = total.saturating_add(5_000_000);
    Ok(SizeEstimate {
        required_bytes: (total as f64 * 1.1).ceil() as u64,
    })
}

async fn current_schema_version(pool: &SqlitePool) -> anyhow::Result<String> {
    if let Some(v) = sqlx::query_scalar::<_, String>(
        "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await?
    {
        return Ok(db_manifest::normalize_schema_version_owned(v));
    }
    // Fallback: hash of schema
    db_manifest::schema_hash(pool).await
}

async fn dump_table_jsonl(
    pool: &SqlitePool,
    table: &str,
    path: &Path,
) -> anyhow::Result<(u64, String)> {
    // Dump SELECT * in stable order; only some tables have deleted_at
    let order = "id";
    let has_deleted = matches!(
        table,
        "household"
            | "events"
            | "notes"
            | "bills"
            | "policies"
            | "property_documents"
            | "inventory_items"
            | "vehicle_maintenance"
            | "pets"
            | "family_members"
            | "budget_categories"
            | "expenses"
            | "shopping_items"
    );
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
    vault: &Vault,
    dest_root: &Path,
    export_root: &Path,
) -> AppResult<(usize, u64, String)> {
    let mut sources = load_attachment_sources(pool)
        .await
        .map_err(|err| err.with_context("operation", "load_attachment_sources"))?;
    sources.sort_by(|a, b| {
        a.household_id
            .cmp(&b.household_id)
            .then(a.category.as_str().cmp(b.category.as_str()))
            .then(a.relative_path.cmp(&b.relative_path))
            .then(a.table.cmp(&b.table))
    });
    sources.dedup_by(|a, b| {
        a.household_id == b.household_id
            && a.category == b.category
            && a.relative_path == b.relative_path
    });

    // Manifests: one that reflects exported files (for verification), one from DB references (log missing)
    let attach_manifest_path = export_root.join("attachments_manifest.txt");
    let db_list_path = export_root.join("attachments_db_manifest.txt");
    let mut attach_manifest = fs::File::create(&attach_manifest_path).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "create_attachments_manifest")
            .with_context("path", attach_manifest_path.display().to_string())
    })?;
    let mut db_manifest = fs::File::create(&db_list_path).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "create_db_manifest")
            .with_context("path", db_list_path.display().to_string())
    })?;

    let mut total_bytes: u64 = 0;
    let mut total_count: usize = 0;

    for source in &sources {
        let resolved = vault
            .resolve(&source.household_id, source.category, &source.relative_path)
            .map_err(|err| {
                err.with_context("table", source.table.to_string())
                    .with_context("household_id", source.household_id.clone())
                    .with_context("operation", "export_resolve_attachment")
            })?;

        let manifest_key = format!(
            "{}/{}/{}",
            source.household_id,
            source.category.as_str(),
            source.relative_path
        );

        if resolved.is_file() {
            let dest_path = dest_root.join(&manifest_key);
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent).map_err(|err| {
                    AppError::from(err)
                        .with_context("operation", "ensure_export_directory")
                        .with_context("path", parent.display().to_string())
                })?;
            }
            let hash = copy_and_hash(&resolved, &dest_path).map_err(|err| {
                err.with_context("operation", "copy_export_attachment")
                    .with_context("table", source.table.to_string())
                    .with_context("household_id", source.household_id.clone())
            })?;
            let size = fs::metadata(&dest_path).map(|m| m.len()).unwrap_or(0);
            total_bytes = total_bytes.saturating_add(size);
            total_count += 1;
            writeln!(attach_manifest, "{}\t{}", manifest_key, hash)?;
            writeln!(db_manifest, "{}\t{}", manifest_key, hash)?;
        } else {
            warn!(
                target: "arklowdun",
                event = "export_attachment_missing",
                household_id = source.household_id.as_str(),
                category = source.category.as_str(),
                table = source.table,
                relative_hash = %hash_path(Path::new(&manifest_key)),
                path_hash = %hash_path(&resolved),
                "Attachment missing during export"
            );
            writeln!(db_manifest, "{}\tMISSING", manifest_key)?;
        }
    }
    attach_manifest.flush().ok();
    db_manifest.flush().ok();
    let sha = file_sha256(&attach_manifest_path).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "hash_attachments_manifest")
            .with_context("path", attach_manifest_path.display().to_string())
    })?;
    Ok((total_count, total_bytes, sha))
}

#[derive(Debug, Clone)]
struct ExportAttachmentSource {
    table: &'static str,
    household_id: String,
    category: AttachmentCategory,
    relative_path: String,
}

async fn load_attachment_sources(pool: &SqlitePool) -> AppResult<Vec<ExportAttachmentSource>> {
    use std::str::FromStr;

    // Collect attachment coordinates across all tables that reference the vault.
    let tables: [(&str, AttachmentCategory); 6] = [
        ("bills", AttachmentCategory::Bills),
        ("policies", AttachmentCategory::Policies),
        ("property_documents", AttachmentCategory::PropertyDocuments),
        ("inventory_items", AttachmentCategory::InventoryItems),
        (
            "vehicle_maintenance",
            AttachmentCategory::VehicleMaintenance,
        ),
        ("pet_medical", AttachmentCategory::PetMedical),
    ];

    let mut entries = Vec::new();

    for (table, default_category) in tables {
        let sql = format!(
            "SELECT household_id, category, relative_path FROM {table} \
             WHERE deleted_at IS NULL AND root_key = 'attachments' \
             AND relative_path IS NOT NULL"
        );
        let rows = sqlx::query(&sql).fetch_all(pool).await.map_err(|err| {
            AppError::from(err)
                .with_context("operation", "load_attachment_sources")
                .with_context("table", table.to_string())
        })?;
        for row in rows {
            let household_id: String = row.try_get("household_id").unwrap_or_default();
            if household_id.trim().is_empty() {
                continue;
            }

            let rel: Option<String> = row.try_get("relative_path").ok();
            let Some(rel) = rel.filter(|value| !value.trim().is_empty()) else {
                continue;
            };

            let category_raw: Option<String> = row.try_get("category").ok();
            let category = match category_raw.as_deref() {
                Some(raw) => match AttachmentCategory::from_str(raw) {
                    Ok(value) => value,
                    Err(_) => {
                        warn!(
                            target: "arklowdun",
                            event = "export_attachment_category_fallback",
                            table,
                            household_id = household_id.as_str(),
                            raw_category = raw,
                            "Falling back to table default for attachment category"
                        );
                        default_category
                    }
                },
                None => default_category,
            };

            entries.push(ExportAttachmentSource {
                table,
                household_id,
                category,
                relative_path: rel,
            });
        }
    }

    Ok(entries)
}

fn copy_and_hash(src: &Path, dest: &Path) -> AppResult<String> {
    let mut in_f = fs::File::open(src).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "open_export_attachment")
            .with_context("path", src.display().to_string())
    })?;
    let mut out_f = fs::File::create(dest).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "create_export_attachment")
            .with_context("path", dest.display().to_string())
    })?;
    let mut hasher = Sha256::new();
    let mut buf = [0_u8; 131072];
    loop {
        let n = in_f.read(&mut buf)?;
        if n == 0 {
            break;
        }
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

fn free_disk_space(path: &Path) -> anyhow::Result<u64> {
    let target: Cow<'_, Path> = if path.exists() {
        Cow::Borrowed(path)
    } else if let Some(parent) = path.parent() {
        Cow::Owned(parent.to_path_buf())
    } else {
        Cow::Owned(std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")))
    };
    available_space(target.as_ref()).map_err(|e| anyhow::anyhow!(e))
}

fn dir_size(path: &Path) -> anyhow::Result<u64> {
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
    Err(AppError::new(
        "EXPORT/NAME_COLLISION",
        "Unable to allocate export directory",
    ))
}

fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "0 MB".to_string();
    }
    let mb = (bytes as f64) / 1_000_000.0;
    if mb < 1.0 {
        "1 MB".to_string()
    } else {
        format!("{:.0} MB", mb.ceil())
    }
}

fn write_verify_scripts(
    sh_path: &Path,
    ps1_path: &Path,
    tables: &BTreeMap<String, TableInfo>,
    attachments_manifest_sha: &str,
) -> anyhow::Result<()> {
    // Extract expected table hashes if available
    let expect = |key: &str| {
        tables
            .get(key)
            .map(|t| t.sha256.clone())
            .unwrap_or_default()
    };
    let households_sha = expect("households");
    let events_sha = expect("events");
    let notes_sha = expect("notes");
    let files_sha = expect("files");

    let sh = format!(
        r#"#!/usr/bin/env bash
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

    let ps1 = format!(
        r#"#requires -version 5
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use anyhow::Result;
    use sqlx::SqlitePool;
    use std::sync::Arc;
    use tempfile::TempDir;

    async fn setup_pool(dir: &TempDir, version: &str) -> Result<SqlitePool> {
        let db_path = dir.path().join("arklowdun.sqlite3");
        let pool = db::connect_sqlite_pool(&db_path).await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
            )",
        )
        .execute(&pool)
        .await?;
        sqlx::query("DELETE FROM schema_migrations")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)")
            .bind(version)
            .execute(&pool)
            .await?;

        for (table, schema) in [
            (
                "household",
                "CREATE TABLE household (id TEXT PRIMARY KEY, deleted_at INTEGER)",
            ),
            (
                "events",
                "CREATE TABLE events (id TEXT PRIMARY KEY, deleted_at INTEGER)",
            ),
            (
                "notes",
                "CREATE TABLE notes (id TEXT PRIMARY KEY, deleted_at INTEGER)",
            ),
            (
                "files_index",
                "CREATE TABLE files_index (
                    id TEXT PRIMARY KEY,
                    root_key TEXT,
                    relative_path TEXT,
                    deleted_at INTEGER
                )",
            ),
            (
                "bills",
                "CREATE TABLE bills (
                    id TEXT PRIMARY KEY,
                    household_id TEXT,
                    category TEXT,
                    relative_path TEXT,
                    root_key TEXT,
                    deleted_at INTEGER
                )",
            ),
            (
                "policies",
                "CREATE TABLE policies (
                    id TEXT PRIMARY KEY,
                    household_id TEXT,
                    category TEXT,
                    relative_path TEXT,
                    root_key TEXT,
                    deleted_at INTEGER
                )",
            ),
            (
                "property_documents",
                "CREATE TABLE property_documents (
                    id TEXT PRIMARY KEY,
                    household_id TEXT,
                    category TEXT,
                    relative_path TEXT,
                    root_key TEXT,
                    deleted_at INTEGER
                )",
            ),
            (
                "inventory_items",
                "CREATE TABLE inventory_items (
                    id TEXT PRIMARY KEY,
                    household_id TEXT,
                    category TEXT,
                    relative_path TEXT,
                    root_key TEXT,
                    deleted_at INTEGER
                )",
            ),
            (
                "vehicle_maintenance",
                "CREATE TABLE vehicle_maintenance (
                    id TEXT PRIMARY KEY,
                    household_id TEXT,
                    category TEXT,
                    relative_path TEXT,
                    root_key TEXT,
                    deleted_at INTEGER
                )",
            ),
            (
                "pet_medical",
                "CREATE TABLE pet_medical (
                    id TEXT PRIMARY KEY,
                    household_id TEXT,
                    category TEXT,
                    relative_path TEXT,
                    root_key TEXT,
                    deleted_at INTEGER
                )",
            ),
        ] {
            sqlx::query(schema).execute(&pool).await?;
            sqlx::query(&format!("DELETE FROM {table}"))
                .execute(&pool)
                .await?;
        }

        Ok(pool)
    }

    #[tokio::test]
    async fn manifest_records_canonical_schema_version() {
        let version = "0001_baseline.sql";
        let db_dir = TempDir::new().expect("create db dir");
        let pool = setup_pool(&db_dir, version)
            .await
            .expect("setup sqlite pool");
        let export_dir = TempDir::new().expect("create export dir");
        let fake_appdata = TempDir::new().expect("fake appdata");
        let attachments_dir = fake_appdata.path().join("attachments");
        std::fs::create_dir_all(&attachments_dir).expect("create attachments dir");

        let vault = Arc::new(Vault::new(&attachments_dir));

        let entry = create_export(
            &pool,
            vault,
            ExportOptions {
                out_parent: export_dir.path().to_path_buf(),
            },
        )
        .await
        .expect("export succeeds");

        let manifest_bytes = std::fs::read(&entry.manifest_path).expect("read manifest");
        let manifest: ExportManifest =
            serde_json::from_slice(&manifest_bytes).expect("parse manifest json");

        let db_version: String = sqlx::query_scalar(
            "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .expect("fetch schema version");

        assert_eq!(
            manifest.schema_version,
            db_manifest::normalize_schema_version_owned(db_version)
        );
        assert!(!manifest
            .schema_version
            .to_ascii_lowercase()
            .ends_with(".up.sql"));
    }

    #[tokio::test]
    async fn export_rejects_paths_outside_vault() {
        let version = "0001_baseline.sql";
        let db_dir = TempDir::new().expect("create db dir");
        let pool = setup_pool(&db_dir, version)
            .await
            .expect("setup sqlite pool");

        sqlx::query(
            "INSERT INTO bills (id, household_id, category, relative_path, root_key, deleted_at)
             VALUES ('bill1', 'household_1', 'bills', '../escape.pdf', 'attachments', NULL)",
        )
        .execute(&pool)
        .await
        .expect("insert attachment row");

        let export_dir = TempDir::new().expect("create export dir");
        let attachments_dir = TempDir::new().expect("attachments dir");
        let vault = Arc::new(Vault::new(attachments_dir.path()));

        let err = create_export(
            &pool,
            vault,
            ExportOptions {
                out_parent: export_dir.path().to_path_buf(),
            },
        )
        .await
        .expect_err("export should fail for traversal path");

        assert_eq!(err.code(), crate::vault::ERR_PATH_OUT_OF_VAULT);
    }
}
