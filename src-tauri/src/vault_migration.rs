use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures::TryStreamExt;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::Emitter;
use tokio::fs as async_fs;
use tokio::io::AsyncWriteExt;

use crate::attachment_category::AttachmentCategory;
use crate::security::hash_path;
use crate::vault::Vault;
use crate::{AppError, AppResult};

const CHECKPOINT_FILE: &str = "checkpoint.json";
const MANIFEST_FILE: &str = "manifest.json";
const EVENT_PROGRESS: &str = "vault:migration_progress";

const CATEGORY_CHECK: &str =
    "category IS NULL OR category NOT IN ('bills','policies','property_documents','inventory_items','pet_medical','vehicles','vehicle_maintenance','notes','misc')";

const LEGACY_ROOT_CONDITION: &str = "root_key IS NOT NULL AND TRIM(root_key) != ''";

/// Tables that may carry attachments.
pub const ATTACHMENT_TABLES: &[&str] = &[
    "bills",
    "policies",
    "property_documents",
    "inventory_items",
    "pet_medical",
    "vehicle_maintenance",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MigrationMode {
    DryRun,
    Apply,
}

impl MigrationMode {
    pub const fn is_apply(self) -> bool {
        matches!(self, MigrationMode::Apply)
    }
}

impl Default for MigrationMode {
    fn default() -> Self {
        MigrationMode::DryRun
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MigrationCounts {
    pub processed: u64,
    pub copied: u64,
    pub skipped: u64,
    pub conflicts: u64,
    pub unsupported: u64,
}

impl MigrationCounts {
    fn increment_processed(&mut self) {
        self.processed += 1;
    }

    fn record_copy(&mut self, conflict: bool) {
        self.copied += 1;
        if conflict {
            self.conflicts += 1;
        }
    }

    fn record_skip(&mut self) {
        self.skipped += 1;
    }

    fn record_unsupported(&mut self) {
        self.unsupported += 1;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestEntry {
    pub table: String,
    pub id: String,
    pub household_id: String,
    pub category: String,
    pub source_hash: Option<String>,
    pub target_hash: Option<String>,
    pub action: String,
    pub status: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationProgress {
    pub mode: MigrationMode,
    pub table: Option<String>,
    pub counts: MigrationCounts,
    pub completed: bool,
    pub manifest_path: Option<String>,
    pub checkpoint_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Checkpoint {
    table_index: usize,
    last_id: Option<String>,
    mode: MigrationMode,
}

#[derive(Default)]
struct ManagerState {
    running: bool,
    last_summary: Option<MigrationProgress>,
}

pub struct VaultMigrationManager {
    state_dir: PathBuf,
    state: Mutex<ManagerState>,
}

impl VaultMigrationManager {
    pub fn new(base: impl AsRef<Path>) -> AppResult<Self> {
        let mut state_dir = base.as_ref().to_path_buf();
        state_dir.push(".vault-migration");
        fs::create_dir_all(&state_dir).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "vault_migration_manager_create")
                .with_context("path", state_dir.display().to_string())
        })?;
        Ok(Self {
            state_dir,
            state: Mutex::new(ManagerState::default()),
        })
    }

    pub fn checkpoint_path(&self) -> PathBuf {
        self.state_dir.join(CHECKPOINT_FILE)
    }

    pub fn manifest_path(&self) -> PathBuf {
        self.state_dir.join(MANIFEST_FILE)
    }

    pub fn status(&self) -> MigrationProgress {
        let guard = self.state.lock().expect("manager state poisoned");
        let manifest = self
            .manifest_path()
            .exists()
            .then(|| self.manifest_path().to_string_lossy().to_string());
        let checkpoint = self
            .checkpoint_path()
            .exists()
            .then(|| self.checkpoint_path().to_string_lossy().to_string());

        if let Some(summary) = &guard.last_summary {
            let mut summary = summary.clone();
            summary.manifest_path = manifest.clone();
            summary.checkpoint_path = checkpoint.clone();
            return summary;
        }

        MigrationProgress {
            mode: MigrationMode::DryRun,
            table: None,
            counts: MigrationCounts::default(),
            completed: !guard.running,
            manifest_path: manifest,
            checkpoint_path: checkpoint,
        }
    }

    pub fn begin(&self) -> AppResult<()> {
        let mut guard = self.state.lock().expect("manager state poisoned");
        if guard.running {
            return Err(AppError::new(
                "VAULT_MIGRATION_ACTIVE",
                "Vault migration is already running.",
            ));
        }
        guard.running = true;
        guard.last_summary = None;
        Ok(())
    }

    pub fn finish(&self, summary: MigrationProgress) {
        let mut guard = self.state.lock().expect("manager state poisoned");
        guard.running = false;
        guard.last_summary = Some(summary);
    }

    pub fn abort(&self) {
        let mut guard = self.state.lock().expect("manager state poisoned");
        guard.running = false;
    }
}

pub async fn run_vault_migration<R: tauri::Runtime + 'static>(
    app: tauri::AppHandle<R>,
    pool: SqlitePool,
    vault: std::sync::Arc<Vault>,
    manager: std::sync::Arc<VaultMigrationManager>,
    mode: MigrationMode,
) -> AppResult<MigrationProgress> {
    manager.begin()?;
    let checkpoint_path = manager.checkpoint_path();
    let manifest_path = manager.manifest_path();
    let result = execute_migration(
        app.clone(),
        &pool,
        vault,
        &checkpoint_path,
        &manifest_path,
        mode,
    )
    .await;

    match result {
        Ok(summary) => {
            manager.finish(summary.clone());
            Ok(summary)
        }
        Err(err) => {
            manager.abort();
            Err(err)
        }
    }
}

async fn execute_migration<R: tauri::Runtime + 'static>(
    app: tauri::AppHandle<R>,
    pool: &SqlitePool,
    vault: std::sync::Arc<Vault>,
    checkpoint_path: &Path,
    manifest_path: &Path,
    mode: MigrationMode,
) -> AppResult<MigrationProgress> {
    let mut counts = MigrationCounts::default();
    let mut manifest: Vec<ManifestEntry> = Vec::new();
    let mut checkpoint = load_checkpoint(checkpoint_path).unwrap_or_else(|| Checkpoint {
        table_index: 0,
        last_id: None,
        mode,
    });

    checkpoint.mode = mode;
    save_checkpoint(checkpoint_path, &checkpoint).await?;

    let mut last_emit = Instant::now();

    for (idx, table) in ATTACHMENT_TABLES
        .iter()
        .enumerate()
        .skip(checkpoint.table_index)
    {
        let category = AttachmentCategory::for_table(table).ok_or_else(|| {
            AppError::new("VAULT/UNKNOWN_CATEGORY", "Unsupported attachment table.")
                .with_context("table", table.to_string())
        })?;

        let query = format!(
            "SELECT id, household_id, relative_path, root_key, category FROM {table} \
             WHERE deleted_at IS NULL AND relative_path IS NOT NULL AND relative_path != '' AND \
             ({LEGACY_ROOT_CONDITION} OR {CATEGORY_CHECK}) ORDER BY id"
        );
        let mut rows = sqlx::query(&query).fetch(pool);

        while let Some(row) = rows.try_next().await.map_err(|err| {
            AppError::from(err)
                .with_context("operation", "vault_migration_query")
                .with_context("table", table.to_string())
        })? {
            let id: String = row.try_get("id").unwrap_or_default();

            if checkpoint.table_index == idx {
                if let Some(last_id) = &checkpoint.last_id {
                    if last_id >= &id {
                        continue;
                    }
                }
            }

            let household_id: String = row.try_get("household_id").unwrap_or_default();
            let relative_path: String = row.try_get("relative_path").unwrap_or_default();
            let legacy_root: Option<String> = row.try_get("root_key").ok();

            counts.increment_processed();

            let mut action = "skip".to_string();
            let mut status = "ok".to_string();
            let mut note = None;
            let mut source_hash = None;
            let mut target_hash = None;

            let source = resolve_legacy_path(&app, legacy_root.as_deref(), &relative_path)?;
            if let Some(source) = source {
                if source.exists() {
                    source_hash = Some(hash_path(&source));
                }
            }

            let resolved = match vault.resolve(&household_id, category, &relative_path) {
                Ok(path) => path,
                Err(err) => {
                    counts.record_unsupported();
                    status = "error".to_string();
                    note = Some(err.message().to_string());
                    manifest.push(ManifestEntry {
                        table: table.to_string(),
                        id: id.clone(),
                        household_id: household_id.clone(),
                        category: category.as_str().to_string(),
                        source_hash,
                        target_hash: None,
                        action: "validate".into(),
                        status: status.clone(),
                        note: note.clone(),
                    });
                    checkpoint.last_id = Some(id);
                    checkpoint.table_index = idx;
                    save_checkpoint(checkpoint_path, &checkpoint).await?;
                    continue;
                }
            };

            if mode.is_apply() {
                if let Some(source) =
                    resolve_legacy_path(&app, legacy_root.as_deref(), &relative_path)?
                {
                    if !source.exists() {
                        counts.record_skip();
                        status = "missing".into();
                        note = Some("Source file missing".into());
                        manifest.push(ManifestEntry {
                            table: table.to_string(),
                            id: id.clone(),
                            household_id: household_id.clone(),
                            category: category.as_str().to_string(),
                            source_hash: source_hash.clone(),
                            target_hash: None,
                            action: "skip".into(),
                            status: status.clone(),
                            note: note.clone(),
                        });
                        continue;
                    }

                    let mut final_path = resolved.clone();
                    let mut conflict = false;
                    if final_path.exists() {
                        let (new_path, renamed) = resolve_conflict(&final_path).await?;
                        final_path = new_path;
                        conflict = renamed;
                    }

                    if let Some(parent) = final_path.parent() {
                        async_fs::create_dir_all(parent).await.map_err(|err| {
                            AppError::from(err)
                                .with_context("operation", "vault_migration_create_dirs")
                                .with_context("table", table.to_string())
                                .with_context("id", id.clone())
                        })?;
                    }

                    async_fs::copy(&source, &final_path).await.map_err(|err| {
                        AppError::from(err)
                            .with_context("operation", "vault_migration_copy")
                            .with_context("table", table.to_string())
                            .with_context("id", id.clone())
                    })?;

                    async_fs::remove_file(&source).await.map_err(|err| {
                        AppError::from(err)
                            .with_context("operation", "vault_migration_cleanup")
                            .with_context("table", table.to_string())
                            .with_context("id", id.clone())
                    })?;

                    let update_sql =
                        format!("UPDATE {table} SET category = ?1, root_key = NULL WHERE id = ?2");
                    sqlx::query(&update_sql)
                        .bind(category.as_str())
                        .bind(&id)
                        .execute(pool)
                        .await
                        .map_err(|err| {
                            AppError::from(err)
                                .with_context("operation", "vault_migration_update")
                                .with_context("table", table.to_string())
                                .with_context("id", id.clone())
                        })?;

                    counts.record_copy(conflict);
                    action = if conflict { "copy_renamed" } else { "copy" }.into();
                    status = "migrated".into();
                    target_hash = Some(hash_path(&final_path));
                    if conflict {
                        note = Some("Renamed to avoid conflict".into());
                    }

                    manifest.push(ManifestEntry {
                        table: table.to_string(),
                        id: id.clone(),
                        household_id: household_id.clone(),
                        category: category.as_str().to_string(),
                        source_hash: source_hash.clone(),
                        target_hash: target_hash.clone(),
                        action: action.clone(),
                        status: status.clone(),
                        note: note.clone(),
                    });
                } else {
                    counts.record_unsupported();
                    status = "unsupported".into();
                    note = Some("Legacy root path unavailable".into());
                    manifest.push(ManifestEntry {
                        table: table.to_string(),
                        id: id.clone(),
                        household_id: household_id.clone(),
                        category: category.as_str().to_string(),
                        source_hash: None,
                        target_hash: None,
                        action: "skip".into(),
                        status: status.clone(),
                        note: note.clone(),
                    });
                }
            } else {
                counts.record_copy(false);
                action = "plan".into();
                target_hash = Some(hash_path(&resolved));
                manifest.push(ManifestEntry {
                    table: table.to_string(),
                    id: id.clone(),
                    household_id: household_id.clone(),
                    category: category.as_str().to_string(),
                    source_hash,
                    target_hash,
                    action,
                    status: status.clone(),
                    note: note.clone(),
                });
            }

            if last_emit.elapsed() >= Duration::from_millis(200) {
                emit_progress(
                    &app,
                    MigrationProgress {
                        mode,
                        table: Some(table.to_string()),
                        counts: counts.clone(),
                        completed: false,
                        manifest_path: None,
                        checkpoint_path: Some(checkpoint_path.to_string_lossy().to_string()),
                    },
                );
                last_emit = Instant::now();
            }

            checkpoint.last_id = Some(id.clone());
            checkpoint.table_index = idx;
            save_checkpoint(checkpoint_path, &checkpoint).await?;
        }

        checkpoint.table_index = idx + 1;
        checkpoint.last_id = None;
        save_checkpoint(checkpoint_path, &checkpoint).await?;
    }

    let summary = MigrationProgress {
        mode,
        table: None,
        counts: counts.clone(),
        completed: true,
        manifest_path: Some(manifest_path.to_string_lossy().to_string()),
        checkpoint_path: None,
    };

    emit_progress(&app, summary.clone());

    persist_manifest(manifest_path, &manifest).await?;
    async_fs::remove_file(checkpoint_path).await.ok();

    if mode.is_apply() {
        ensure_housekeeping(pool, vault.as_ref()).await?;
    }

    Ok(summary)
}

fn resolve_legacy_path<R: tauri::Runtime + 'static>(
    app: &tauri::AppHandle<R>,
    root: Option<&str>,
    relative: &str,
) -> AppResult<Option<PathBuf>> {
    let Some(root) = root else {
        return Ok(None);
    };
    let key = match root {
        "appData" | "appdata" | "APPDATA" => Some(crate::security::fs_policy::RootKey::AppData),
        "attachments" => Some(crate::security::fs_policy::RootKey::Attachments),
        _ => None,
    };
    let Some(key) = key else {
        return Ok(None);
    };
    let base = crate::security::fs_policy::base_for(key, app).map_err(|err| {
        AppError::new(
            "VAULT/LEGACY_BASE", 
            "Failed to resolve legacy attachment root.",
        )
        .with_context("operation", "vault_migration_legacy_base")
        .with_context("root_key", root.to_string())
        .with_context("error", err.to_string())
    })?;
    let mut p = base;
    p.push(relative);
    Ok(Some(p))
}

async fn resolve_conflict(path: &Path) -> AppResult<(PathBuf, bool)> {
    let mut candidate = path.to_path_buf();
    if !candidate.exists() {
        return Ok((candidate, false));
    }
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "attachment".to_string());
    let ext = path
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();
    for idx in 1..=1000 {
        let mut new_name = format!("{stem} ({idx})");
        new_name.push_str(&ext);
        let mut new_path = path.to_path_buf();
        new_path.set_file_name(&new_name);
        if !new_path.exists() {
            return Ok((new_path, true));
        }
    }
    Err(AppError::new(
        "VAULT/CONFLICT_LIMIT",
        "Exceeded conflict resolution attempts for attachment migration.",
    ))
}

async fn persist_manifest(path: &Path, manifest: &[ManifestEntry]) -> AppResult<()> {
    let serialized = serde_json::to_vec_pretty(manifest).map_err(|err| {
        AppError::from(err).with_context("operation", "vault_migration_manifest_encode")
    })?;
    let mut file = async_fs::File::create(path).await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "vault_migration_manifest_create")
            .with_context("path", path.display().to_string())
    })?;
    file.write_all(&serialized).await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "vault_migration_manifest_write")
            .with_context("path", path.display().to_string())
    })?;
    file.flush().await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "vault_migration_manifest_flush")
            .with_context("path", path.display().to_string())
    })?;
    Ok(())
}

fn load_checkpoint(path: &Path) -> Option<Checkpoint> {
    let data = fs::read(path).ok()?;
    serde_json::from_slice(&data).ok()
}

async fn save_checkpoint(path: &Path, checkpoint: &Checkpoint) -> AppResult<()> {
    let tmp_path = path.with_extension("tmp");
    let serialized = serde_json::to_vec(checkpoint).map_err(|err| {
        AppError::from(err).with_context("operation", "vault_migration_checkpoint_encode")
    })?;
    let mut tmp = async_fs::File::create(&tmp_path).await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "vault_migration_checkpoint_create")
            .with_context("path", tmp_path.display().to_string())
    })?;
    tmp.write_all(&serialized).await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "vault_migration_checkpoint_write")
            .with_context("path", tmp_path.display().to_string())
    })?;
    tmp.flush().await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "vault_migration_checkpoint_flush")
            .with_context("path", tmp_path.display().to_string())
    })?;
    async_fs::rename(&tmp_path, path).await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "vault_migration_checkpoint_rename")
            .with_context("from", tmp_path.display().to_string())
            .with_context("to", path.display().to_string())
    })?;
    Ok(())
}

fn emit_progress<R: tauri::Runtime + 'static>(
    app: &tauri::AppHandle<R>,
    progress: MigrationProgress,
) {
    if let Err(err) = app.emit(EVENT_PROGRESS, &progress) {
        tracing::warn!(
            target: "arklowdun",
            event = "vault_migration_emit_failed",
            error = %err,
            "Failed to emit vault migration progress"
        );
    }
}

pub async fn ensure_housekeeping(
    pool: &SqlitePool,
    vault: Option<&Vault>,
) -> AppResult<()> {
    let vault = vault.ok_or_else(|| {
        AppError::new(
            "VAULT/HOUSEKEEPING_VAULT_MISSING",
            "Vault unavailable while verifying migration results.",
        )
    })?;

    for table in ATTACHMENT_TABLES {
        let sql = format!(
                "SELECT COUNT(1) as missing FROM {table} WHERE deleted_at IS NULL AND (category IS NULL OR category = '')"
            );
            let row = sqlx::query(&sql)
                .fetch_one(pool)
                .await
                .map_err(|err| AppError::from(err).with_context("table", table.to_string()))?;
            let missing: i64 = row.try_get("missing").unwrap_or(0);
            if missing > 0 {
                return Err(AppError::new(
                    "VAULT/CATEGORY_MISSING",
                    "Attachments without category remain after migration.",
                )
                .with_context("table", table.to_string())
                .with_context("count", missing.to_string()));
            }

            let legacy_sql = format!(
                "SELECT COUNT(1) as legacy FROM {table} WHERE deleted_at IS NULL AND root_key IS NOT NULL AND TRIM(root_key) != ''"
            );
            let legacy_row = sqlx::query(&legacy_sql)
                .fetch_one(pool)
                .await
                .map_err(|err| AppError::from(err).with_context("table", table.to_string()))?;
            let legacy: i64 = legacy_row.try_get("legacy").unwrap_or(0);
            if legacy > 0 {
                return Err(AppError::new(
                    "VAULT/LEGACY_ROOT_REMAINS",
                    "Legacy attachment roots remain after migration.",
                )
                .with_context("table", table.to_string())
                .with_context("count", legacy.to_string()));
            }

            let sql = format!(
                "SELECT id, household_id, category, relative_path FROM {table} WHERE deleted_at IS NULL AND relative_path IS NOT NULL AND TRIM(relative_path) != ''"
            );
            let mut rows = sqlx::query(&sql).fetch(pool);
            while let Some(row) = rows.try_next().await.map_err(|err| {
                AppError::from(err)
                    .with_context("table", table.to_string())
                    .with_context("operation", "housekeeping_stream")
            })? {
                let id: String = row.try_get("id").unwrap_or_default();
                let household_id: String = row.try_get("household_id").unwrap_or_default();
                let category_raw: String = row.try_get("category").unwrap_or_default();
                let relative_path: String = row.try_get("relative_path").unwrap_or_default();
                let category = AttachmentCategory::from_str(&category_raw).map_err(|_| {
                    AppError::new(
                        "VAULT/CATEGORY_INVALID",
                        "Attachment category could not be parsed during housekeeping.",
                    )
                    .with_context("table", table.to_string())
                    .with_context("id", id.clone())
                    .with_context("category", category_raw.clone())
                })?;

                let resolved = vault
                    .resolve(&household_id, category, &relative_path)
                    .map_err(|err| err.with_context("operation", "housekeeping_resolve"))?;

                if !resolved.exists() {
                    return Err(AppError::new(
                        "VAULT/FILE_MISSING",
                        "Attachment file missing after migration.",
                    )
                    .with_context("table", table.to_string())
                    .with_context("id", id)
                    .with_context("household_id", household_id)
                    .with_context("category", category.as_str().to_string())
                    .with_context("path_hash", hash_path(&resolved).to_string()));
                }
            }
    }
    Ok(())
}
