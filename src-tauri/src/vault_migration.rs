use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::str::FromStr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures::TryStreamExt;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::Emitter;
use tokio::fs as async_fs;
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;

use crate::attachment_category::AttachmentCategory;
use crate::security::fs_policy::{self, RootKey};
use crate::security::hash_path;
use crate::vault::Vault;
use crate::{AppError, AppResult};

const CHECKPOINT_FILE: &str = "checkpoint.json";
const MANIFEST_FILE: &str = "manifest.json";
const LAST_APPLY_SENTINEL: &str = "last-apply.ok";
const EVENT_PROGRESS: &str = "vault:migration_progress";
const EVENT_COMPLETE: &str = "vault:migration_complete";

const CATEGORY_CHECK: &str =
    "category IS NULL OR category NOT IN ('bills','policies','property_documents','inventory_items','pet_medical','vehicles','vehicle_maintenance','notes','misc')";

const LEGACY_ROOT_CONDITION: &str = "root_key IS NOT NULL AND TRIM(root_key) != ''";

const SKIP_REASON_SOURCE_MISSING: &str = "missing_source";
const SKIP_REASON_COPY_FAILED: &str = "copy_failed";
const SKIP_REASON_DELETE_VERIFY: &str = "delete_verification_failed";

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
    #[serde(default)]
    pub skipped_reasons: BTreeMap<String, u64>,
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

    fn record_skip(&mut self, reason: &str) {
        self.skipped += 1;
        *self.skipped_reasons.entry(reason.to_string()).or_insert(0) += 1;
    }

    fn record_unsupported(&mut self, reason: &str) {
        self.unsupported += 1;
        *self.skipped_reasons.entry(reason.to_string()).or_insert(0) += 1;
    }

    fn snapshot(
        &self,
        mode: MigrationMode,
        table: impl Into<String>,
        completed: bool,
        checkpoint_path: Option<String>,
        manifest_path: Option<String>,
    ) -> MigrationProgress {
        MigrationProgress {
            mode,
            table: table.into(),
            counts: self.clone(),
            completed,
            manifest_path,
            checkpoint_path,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManifestAction {
    Copy,
    Skip,
    ConflictRename,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestEntry {
    pub table: String,
    pub id: String,
    pub action: ManifestAction,
    pub source_hash: Option<String>,
    pub target_hash: Option<String>,
    pub reason: Option<String>,
    pub conflict_suffix: Option<String>,
    pub relative_path_hash: Option<String>,
    #[serde(default)]
    pub skipped_delete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationProgress {
    pub mode: MigrationMode,
    pub table: String,
    pub counts: MigrationCounts,
    pub completed: bool,
    pub manifest_path: Option<String>,
    pub checkpoint_path: Option<String>,
}

impl Default for MigrationProgress {
    fn default() -> Self {
        Self {
            mode: MigrationMode::DryRun,
            table: String::new(),
            counts: MigrationCounts::default(),
            completed: false,
            manifest_path: None,
            checkpoint_path: None,
        }
    }
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

trait LegacyRootProvider {
    fn base_for(&self, key: RootKey) -> AppResult<PathBuf>;
}

trait ProgressSink {
    fn emit(
        &mut self,
        counts: &MigrationCounts,
        mode: MigrationMode,
        table: &str,
        completed: bool,
        checkpoint_path: Option<&Path>,
        manifest_path: Option<String>,
    );
}

struct SilentProgressSink;

impl ProgressSink for SilentProgressSink {
    fn emit(
        &mut self,
        _counts: &MigrationCounts,
        _mode: MigrationMode,
        _table: &str,
        _completed: bool,
        _checkpoint_path: Option<&Path>,
        _manifest_path: Option<String>,
    ) {
    }
}

#[derive(Clone)]
pub struct HeadlessLegacyRoots {
    app_data: PathBuf,
    attachments: PathBuf,
}

impl HeadlessLegacyRoots {
    pub fn new(app_data: PathBuf, attachments: PathBuf) -> Self {
        Self {
            app_data,
            attachments,
        }
    }
}

impl LegacyRootProvider for HeadlessLegacyRoots {
    fn base_for(&self, key: RootKey) -> AppResult<PathBuf> {
        let path = match key {
            RootKey::AppData => self.app_data.clone(),
            RootKey::Attachments => self.attachments.clone(),
        };
        Ok(path)
    }
}

fn root_key_label(key: RootKey) -> &'static str {
    match key {
        RootKey::AppData => "appData",
        RootKey::Attachments => "attachments",
    }
}

impl<R: tauri::Runtime> LegacyRootProvider for tauri::AppHandle<R> {
    fn base_for(&self, key: RootKey) -> AppResult<PathBuf> {
        fs_policy::base_for(key, self).map_err(|err| {
            AppError::new(
                "VAULT/LEGACY_BASE",
                "Failed to resolve legacy attachment root.",
            )
            .with_context("operation", "vault_migration_legacy_base")
            .with_context("root_key", root_key_label(key).to_string())
            .with_context("error", err.name().to_string())
        })
    }
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

    pub fn last_apply_ok_path(&self) -> PathBuf {
        self.state_dir.join(LAST_APPLY_SENTINEL)
    }

    pub fn clear_last_apply_ok(&self) -> AppResult<()> {
        let sentinel = self.last_apply_ok_path();
        if sentinel.exists() {
            fs::remove_file(&sentinel).map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "vault_migration_clear_last_apply")
                    .with_context("path", sentinel.display().to_string())
            })?;
        }
        Ok(())
    }

    pub fn mark_last_apply_ok(&self) -> AppResult<()> {
        let sentinel = self.last_apply_ok_path();
        let tmp = sentinel.with_extension("tmp");
        fs::write(&tmp, b"ok").map_err(|err| {
            AppError::from(err)
                .with_context("operation", "vault_migration_write_last_apply_tmp")
                .with_context("path", tmp.display().to_string())
        })?;
        if let Ok(file) = fs::File::open(&tmp) {
            file.sync_all().map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "vault_migration_sync_last_apply_tmp")
                    .with_context("path", tmp.display().to_string())
            })?;
        }
        fs::rename(&tmp, &sentinel).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "vault_migration_rename_last_apply")
                .with_context("from", tmp.display().to_string())
                .with_context("to", sentinel.display().to_string())
        })?;
        Ok(())
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

        let mut progress = MigrationProgress::default();
        progress.completed = !guard.running;
        progress.manifest_path = manifest;
        progress.checkpoint_path = checkpoint;
        progress
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

    pub fn resume_mode(&self) -> Option<MigrationMode> {
        load_checkpoint(&self.checkpoint_path()).map(|checkpoint| checkpoint.mode)
    }
}

pub async fn run_vault_migration<R: tauri::Runtime + 'static>(
    app: tauri::AppHandle<R>,
    pool: SqlitePool,
    vault: std::sync::Arc<Vault>,
    manager: std::sync::Arc<VaultMigrationManager>,
    mode: MigrationMode,
) -> AppResult<MigrationProgress> {
    let mut emitter = EventProgressEmitter::new(app.clone());
    let app_roots = app.clone();
    let result =
        run_vault_migration_with(pool, vault, manager.clone(), mode, &mut emitter, &app_roots)
            .await;

    if let Ok(summary) = &result {
        if let Err(err) = app.emit(EVENT_COMPLETE, summary) {
            tracing::warn!(
                target: "arklowdun",
                event = "vault_migration_complete_emit_failed",
                error = %err,
                "Failed to emit vault migration completion",
            );
        }
    }

    result
}

pub async fn run_vault_migration_headless(
    pool: SqlitePool,
    vault: std::sync::Arc<Vault>,
    manager: std::sync::Arc<VaultMigrationManager>,
    mode: MigrationMode,
    roots: HeadlessLegacyRoots,
) -> AppResult<MigrationProgress> {
    let mut sink = SilentProgressSink;
    run_vault_migration_with(pool, vault, manager, mode, &mut sink, &roots).await
}

async fn run_vault_migration_with<Roots, Sink>(
    pool: SqlitePool,
    vault: std::sync::Arc<Vault>,
    manager: std::sync::Arc<VaultMigrationManager>,
    mode: MigrationMode,
    emitter: &mut Sink,
    roots: &Roots,
) -> AppResult<MigrationProgress>
where
    Roots: LegacyRootProvider + ?Sized,
    Sink: ProgressSink,
{
    manager.begin()?;
    let checkpoint_path = manager.checkpoint_path();
    let manifest_path = manager.manifest_path();

    if mode.is_apply() {
        manager.clear_last_apply_ok()?;
    }

    let result = execute_migration_inner(
        &pool,
        vault.clone(),
        manager.as_ref(),
        &checkpoint_path,
        &manifest_path,
        mode,
        emitter,
        roots,
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

async fn execute_migration_inner<Roots, Sink>(
    pool: &SqlitePool,
    vault: std::sync::Arc<Vault>,
    manager: &VaultMigrationManager,
    checkpoint_path: &Path,
    manifest_path: &Path,
    mode: MigrationMode,
    emitter: &mut Sink,
    roots: &Roots,
) -> AppResult<MigrationProgress>
where
    Roots: LegacyRootProvider + ?Sized,
    Sink: ProgressSink,
{
    let mut counts = MigrationCounts::default();
    let mut checkpoint = load_checkpoint(checkpoint_path).unwrap_or_else(|| Checkpoint {
        table_index: 0,
        last_id: None,
        mode,
    });

    checkpoint.mode = mode;
    save_checkpoint(checkpoint_path, &checkpoint).await?;

    let mut manifest_writer = ManifestWriter::new(manifest_path).await?;

    for (idx, table) in ATTACHMENT_TABLES
        .iter()
        .enumerate()
        .skip(checkpoint.table_index)
    {
        let category = AttachmentCategory::for_table(table).ok_or_else(|| {
            AppError::new("VAULT/UNKNOWN_CATEGORY", "Unsupported attachment table.")
                .with_context("table", table.to_string())
        })?;

        let select_sql = build_migration_query(table);
        let mut rows = sqlx::query(&select_sql).fetch(pool);

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

            let relative_hash = hash_path(Path::new(&relative_path));
            let target_result = vault.resolve(&household_id, category, &relative_path);
            let target_path = match target_result {
                Ok(path) => path,
                Err(err) => {
                    let code = err.code().to_string();
                    counts.record_unsupported(&code);
                    manifest_writer.push(ManifestEntry {
                        table: table.to_string(),
                        id: id.clone(),
                        action: ManifestAction::Skip,
                        source_hash: None,
                        target_hash: None,
                        reason: Some(code.clone()),
                        conflict_suffix: None,
                        relative_path_hash: Some(relative_hash.clone()),
                        skipped_delete: false,
                    });
                    checkpoint.last_id = Some(id.clone());
                    checkpoint.table_index = idx;
                    save_checkpoint(checkpoint_path, &checkpoint).await?;
                    emitter.emit(&counts, mode, table, false, Some(checkpoint_path), None);
                    manifest_writer.flush_if_needed().await?;
                    continue;
                }
            };

            let mut manifest_action = ManifestAction::Copy;
            let mut reason: Option<String> = None;
            let mut conflict_suffix: Option<String> = None;
            let mut skipped_delete = false;
            let mut source_hash = None;
            let mut target_hash = Some(hash_path(&target_path));

            let legacy_resolution =
                resolve_legacy_path(roots, legacy_root.as_deref(), &relative_path)?;
            let legacy_unsupported =
                matches!(&legacy_resolution, LegacyResolution::Unsupported { .. });

            if let LegacyResolution::Supported(ref source) = legacy_resolution {
                source_hash = Some(hash_path(&source.path));
            }

            if mode.is_apply() {
                match &legacy_resolution {
                    LegacyResolution::Unsupported {
                        reason: legacy_reason,
                    } => {
                        let legacy_reason = *legacy_reason;
                        counts.record_unsupported(legacy_reason);
                        reason = Some(legacy_reason.to_string());
                        manifest_action = ManifestAction::Skip;
                        log_delete_decision(
                            table,
                            &id,
                            &relative_hash,
                            "unsupported_root",
                            Some(legacy_reason.to_string()),
                        );
                    }
                    LegacyResolution::Supported(source) => {
                        let source_path = source.path.clone();
                        if !source_path.exists() {
                            counts.record_skip(SKIP_REASON_SOURCE_MISSING);
                            reason = Some(SKIP_REASON_SOURCE_MISSING.to_string());
                            manifest_action = ManifestAction::Skip;
                            log_delete_decision(
                                table,
                                &id,
                                &relative_hash,
                                SKIP_REASON_SOURCE_MISSING,
                                None,
                            );
                        } else {
                            let source_meta =
                                async_fs::metadata(&source_path).await.map_err(|err| {
                                    AppError::from(err)
                                        .with_context(
                                            "operation",
                                            "vault_migration_source_metadata",
                                        )
                                        .with_context("table", table.to_string())
                                        .with_context("id", id.clone())
                                })?;

                            let mut final_path = target_path.clone();
                            let mut conflict = false;
                            let original_stem = final_path
                                .file_stem()
                                .and_then(|s| s.to_str())
                                .map(|s| s.to_string());
                            if final_path.exists() {
                                let (new_path, renamed) = resolve_conflict(&final_path).await?;
                                conflict = renamed;
                                if conflict {
                                    if let (Some(orig), Some(new_stem)) = (
                                        original_stem.as_deref(),
                                        new_path.file_stem().and_then(|s| s.to_str()),
                                    ) {
                                        if let Some(suffix) = new_stem.strip_prefix(orig) {
                                            if !suffix.is_empty() {
                                                conflict_suffix = Some(suffix.to_string());
                                            }
                                        }
                                    }
                                    manifest_action = ManifestAction::ConflictRename;
                                }
                                final_path = new_path;
                            }

                            target_hash = Some(hash_path(&final_path));

                            if let Some(parent) = final_path.parent() {
                                async_fs::create_dir_all(parent).await.map_err(|err| {
                                    AppError::from(err)
                                        .with_context("operation", "vault_migration_create_dirs")
                                        .with_context("table", table.to_string())
                                        .with_context("id", id.clone())
                                })?;
                            }

                            if let Err(err) = async_fs::copy(&source_path, &final_path).await {
                                log_delete_decision(
                                    table,
                                    &id,
                                    &relative_hash,
                                    SKIP_REASON_COPY_FAILED,
                                    Some(err.kind().to_string()),
                                );
                                return Err(AppError::from(err)
                                    .with_context("operation", "vault_migration_copy")
                                    .with_context("table", table.to_string())
                                    .with_context("id", id.clone()));
                            }

                            let verified = verify_copy(&source_meta, &final_path).await?;
                            if verified {
                                async_fs::remove_file(&source_path).await.map_err(|err| {
                                    AppError::from(err)
                                        .with_context("operation", "vault_migration_cleanup")
                                        .with_context("table", table.to_string())
                                        .with_context("id", id.clone())
                                })?;
                                log_delete_decision(
                                    table,
                                    &id,
                                    &relative_hash,
                                    "copied_and_deleted",
                                    None,
                                );
                            } else {
                                skipped_delete = true;
                                reason = Some(SKIP_REASON_DELETE_VERIFY.to_string());
                                log_delete_decision(
                                    table,
                                    &id,
                                    &relative_hash,
                                    "copied_but_skipped_delete",
                                    None,
                                );
                            }

                            let update_sql = build_update_sql(table);
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
                        }
                    }
                }
            } else {
                if let LegacyResolution::Unsupported {
                    reason: legacy_reason,
                } = &legacy_resolution
                {
                    let legacy_reason = *legacy_reason;
                    counts.record_unsupported(legacy_reason);
                    reason = Some(legacy_reason.to_string());
                } else {
                    counts.record_copy(false);
                }
            }

            if !mode.is_apply() && legacy_unsupported {
                manifest_action = ManifestAction::Skip;
            }

            manifest_writer.push(ManifestEntry {
                table: table.to_string(),
                id: id.clone(),
                action: manifest_action,
                source_hash,
                target_hash: target_hash.clone(),
                reason: reason.clone(),
                conflict_suffix,
                relative_path_hash: Some(relative_hash.clone()),
                skipped_delete,
            });

            emitter.emit(&counts, mode, table, false, Some(checkpoint_path), None);

            manifest_writer.flush_if_needed().await?;

            checkpoint.last_id = Some(id.clone());
            checkpoint.table_index = idx;
            save_checkpoint(checkpoint_path, &checkpoint).await?;
        }

        checkpoint.table_index = idx + 1;
        checkpoint.last_id = None;
        save_checkpoint(checkpoint_path, &checkpoint).await?;
    }

    manifest_writer.finalize().await?;
    async_fs::remove_file(checkpoint_path).await.ok();

    if mode.is_apply() {
        ensure_housekeeping(pool, &vault).await?;
        manager.mark_last_apply_ok()?;
    }

    let manifest_path_str = manifest_path
        .exists()
        .then(|| manifest_path.to_string_lossy().to_string());

    let completion_table = "(complete)";
    let summary = counts.snapshot(
        mode,
        completion_table.to_string(),
        true,
        None,
        manifest_path_str.clone(),
    );

    emitter.emit(
        &counts,
        mode,
        completion_table,
        true,
        None,
        manifest_path_str.clone(),
    );

    Ok(summary)
}

struct EventProgressEmitter<R: tauri::Runtime + 'static> {
    app: tauri::AppHandle<R>,
    last_emit: Instant,
    interval: Duration,
}

impl<R: tauri::Runtime + 'static> EventProgressEmitter<R> {
    fn new(app: tauri::AppHandle<R>) -> Self {
        Self {
            app,
            last_emit: Instant::now() - Duration::from_millis(200),
            interval: Duration::from_millis(200),
        }
    }
}

impl<R: tauri::Runtime + 'static> ProgressSink for EventProgressEmitter<R> {
    fn emit(
        &mut self,
        counts: &MigrationCounts,
        mode: MigrationMode,
        table: &str,
        completed: bool,
        checkpoint_path: Option<&Path>,
        manifest_path: Option<String>,
    ) {
        let now = Instant::now();
        if !completed && now.duration_since(self.last_emit) < self.interval {
            return;
        }

        let checkpoint = checkpoint_path
            .filter(|_| !completed)
            .map(|p| p.to_string_lossy().to_string());

        let payload = counts.snapshot(
            mode,
            table.to_string(),
            completed,
            checkpoint,
            manifest_path,
        );
        if let Err(err) = self.app.emit(EVENT_PROGRESS, &payload) {
            tracing::warn!(
                target: "arklowdun",
                event = "vault_migration_emit_failed",
                error = %err,
                "Failed to emit vault migration progress"
            );
        }

        self.last_emit = now;
    }
}

struct ManifestWriter {
    path: PathBuf,
    tmp_path: PathBuf,
    buffer: Vec<ManifestEntry>,
    last_flush: Instant,
    flush_interval: Duration,
    max_buffer: usize,
    writer: async_fs::File,
}

impl ManifestWriter {
    async fn new(path: &Path) -> AppResult<Self> {
        let tmp_path = manifest_sidecar_path(path, "tmp");

        if !tmp_path.exists() {
            if path.exists() {
                let data = async_fs::read(path).await.map_err(|err| {
                    AppError::from(err)
                        .with_context("operation", "vault_migration_manifest_read")
                        .with_context("path", path.display().to_string())
                })?;
                let existing: Vec<ManifestEntry> =
                    serde_json::from_slice(&data).map_err(|err| {
                        AppError::from(err)
                            .with_context("operation", "vault_migration_manifest_decode")
                            .with_context("path", path.display().to_string())
                    })?;

                let mut tmp_file = async_fs::File::create(&tmp_path).await.map_err(|err| {
                    AppError::from(err)
                        .with_context("operation", "vault_migration_manifest_tmp_create")
                        .with_context("path", tmp_path.display().to_string())
                })?;

                for entry in &existing {
                    let line = serde_json::to_vec(entry).map_err(|err| {
                        AppError::from(err)
                            .with_context("operation", "vault_migration_manifest_encode")
                    })?;
                    tmp_file.write_all(&line).await.map_err(|err| {
                        AppError::from(err)
                            .with_context("operation", "vault_migration_manifest_tmp_write")
                            .with_context("path", tmp_path.display().to_string())
                    })?;
                    tmp_file.write_all(b"\n").await.map_err(|err| {
                        AppError::from(err)
                            .with_context("operation", "vault_migration_manifest_tmp_write")
                            .with_context("path", tmp_path.display().to_string())
                    })?;
                }

                tmp_file.sync_all().await.map_err(|err| {
                    AppError::from(err)
                        .with_context("operation", "vault_migration_manifest_tmp_sync")
                        .with_context("path", tmp_path.display().to_string())
                })?;
            } else {
                async_fs::File::create(&tmp_path).await.map_err(|err| {
                    AppError::from(err)
                        .with_context("operation", "vault_migration_manifest_tmp_create")
                        .with_context("path", tmp_path.display().to_string())
                })?;
            }
        }

        let writer = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&tmp_path)
            .await
            .map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "vault_migration_manifest_tmp_open")
                    .with_context("path", tmp_path.display().to_string())
            })?;

        Ok(Self {
            path: path.to_path_buf(),
            tmp_path,
            buffer: Vec::new(),
            last_flush: Instant::now(),
            flush_interval: Duration::from_secs(1),
            max_buffer: 100,
            writer,
        })
    }

    fn push(&mut self, entry: ManifestEntry) {
        self.buffer.push(entry);
    }

    async fn flush_if_needed(&mut self) -> AppResult<()> {
        if self.buffer.len() >= self.max_buffer || self.last_flush.elapsed() >= self.flush_interval
        {
            self.flush().await?;
        }
        Ok(())
    }

    async fn flush(&mut self) -> AppResult<()> {
        if self.buffer.is_empty() {
            return Ok(());
        }

        let entries = std::mem::take(&mut self.buffer);
        for entry in &entries {
            let line = serde_json::to_vec(entry).map_err(|err| {
                AppError::from(err).with_context("operation", "vault_migration_manifest_encode")
            })?;
            self.writer.write_all(&line).await.map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "vault_migration_manifest_tmp_write")
                    .with_context("path", self.tmp_path.display().to_string())
            })?;
            self.writer.write_all(b"\n").await.map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "vault_migration_manifest_tmp_write")
                    .with_context("path", self.tmp_path.display().to_string())
            })?;
        }

        self.writer.flush().await.map_err(|err| {
            AppError::from(err)
                .with_context("operation", "vault_migration_manifest_tmp_flush")
                .with_context("path", self.tmp_path.display().to_string())
        })?;
        self.writer.sync_data().await.map_err(|err| {
            AppError::from(err)
                .with_context("operation", "vault_migration_manifest_tmp_sync")
                .with_context("path", self.tmp_path.display().to_string())
        })?;

        self.last_flush = Instant::now();
        Ok(())
    }

    async fn finalize(mut self) -> AppResult<()> {
        self.flush().await?;
        self.writer.flush().await.map_err(|err| {
            AppError::from(err)
                .with_context("operation", "vault_migration_manifest_tmp_flush")
                .with_context("path", self.tmp_path.display().to_string())
        })?;
        self.writer.sync_all().await.map_err(|err| {
            AppError::from(err)
                .with_context("operation", "vault_migration_manifest_tmp_sync")
                .with_context("path", self.tmp_path.display().to_string())
        })?;

        drop(self.writer);

        let entries = read_manifest_journal(&self.tmp_path).await?;
        write_manifest_array(&self.path, &entries).await?;
        async_fs::remove_file(&self.tmp_path).await.ok();
        Ok(())
    }
}

fn manifest_sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    if let Some(name) = path.file_name() {
        path.with_file_name(format!("{}.{}", name.to_string_lossy(), suffix))
    } else {
        path.with_extension(suffix)
    }
}

async fn read_manifest_journal(path: &Path) -> AppResult<Vec<ManifestEntry>> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let data = async_fs::read(path).await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "vault_migration_manifest_journal_read")
            .with_context("path", path.display().to_string())
    })?;

    let mut entries = Vec::new();
    for (idx, line) in data.split(|byte| *byte == b'\n').enumerate() {
        if line.is_empty() {
            continue;
        }

        let entry: ManifestEntry = serde_json::from_slice(line).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "vault_migration_manifest_journal_decode")
                .with_context("line", (idx + 1).to_string())
                .with_context("path", path.display().to_string())
        })?;

        entries.push(entry);
    }

    Ok(entries)
}

async fn write_manifest_array(path: &Path, entries: &[ManifestEntry]) -> AppResult<()> {
    let serialized = serde_json::to_vec_pretty(entries).map_err(|err| {
        AppError::from(err).with_context("operation", "vault_migration_manifest_encode")
    })?;

    let tmp_path = manifest_sidecar_path(path, "write");
    let mut file = async_fs::File::create(&tmp_path).await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "vault_migration_manifest_create")
            .with_context("path", tmp_path.display().to_string())
    })?;

    file.write_all(&serialized).await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "vault_migration_manifest_write")
            .with_context("path", tmp_path.display().to_string())
    })?;

    file.sync_all().await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "vault_migration_manifest_sync")
            .with_context("path", tmp_path.display().to_string())
    })?;

    async_fs::rename(&tmp_path, path).await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "vault_migration_manifest_rename")
            .with_context("from", tmp_path.display().to_string())
            .with_context("to", path.display().to_string())
    })?;

    Ok(())
}

#[derive(Clone)]
enum LegacyResolution {
    Supported(LegacySource),
    Unsupported { reason: &'static str },
}

#[derive(Clone)]
struct LegacySource {
    #[allow(dead_code)]
    key: RootKey,
    path: PathBuf,
}

fn resolve_legacy_path(
    roots: &impl LegacyRootProvider,
    root: Option<&str>,
    relative: &str,
) -> AppResult<LegacyResolution> {
    let Some(root) = root else {
        return Ok(LegacyResolution::Unsupported {
            reason: "missing_root",
        });
    };

    let key = match root {
        "appData" | "appdata" | "APPDATA" => Some(RootKey::AppData),
        "attachments" => Some(RootKey::Attachments),
        _ => None,
    };

    let Some(key) = key else {
        return Ok(LegacyResolution::Unsupported {
            reason: "unsupported_root_key",
        });
    };

    let relative_path = Path::new(relative);
    if relative_path
        .components()
        .any(|c| matches!(c, Component::ParentDir | Component::RootDir))
    {
        return Ok(LegacyResolution::Unsupported {
            reason: "invalid_relative_path",
        });
    }

    let base = roots.base_for(key)?;

    let mut candidate = base.clone();
    candidate.push(relative_path);
    if !candidate.starts_with(&base) {
        return Ok(LegacyResolution::Unsupported {
            reason: "outside_whitelisted_root",
        });
    }

    Ok(LegacyResolution::Supported(LegacySource {
        key,
        path: candidate,
    }))
}

async fn resolve_conflict(path: &Path) -> AppResult<(PathBuf, bool)> {
    if !path.exists() {
        return Ok((path.to_path_buf(), false));
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

async fn verify_copy(source_meta: &std::fs::Metadata, target: &Path) -> AppResult<bool> {
    let target_meta = async_fs::metadata(target).await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "vault_migration_target_metadata")
            .with_context("path", target.display().to_string())
    })?;

    let size_match = source_meta.len() == target_meta.len();
    let mtime_match = match (source_meta.modified(), target_meta.modified()) {
        (Ok(a), Ok(b)) => {
            let diff = if a >= b {
                a.duration_since(b).ok()
            } else {
                b.duration_since(a).ok()
            };
            diff.map(|d| d <= Duration::from_secs(2)).unwrap_or(true)
        }
        _ => true,
    };

    Ok(size_match && mtime_match)
}

fn build_migration_query(table: &str) -> String {
    format!(
        "SELECT id, household_id, relative_path, root_key, category FROM {table} \
         WHERE deleted_at IS NULL AND relative_path IS NOT NULL AND relative_path != '' \
         AND ({LEGACY_ROOT_CONDITION} OR {CATEGORY_CHECK}) ORDER BY id"
    )
}

fn build_update_sql(table: &str) -> String {
    format!("UPDATE {table} SET category = ?1, root_key = NULL WHERE id = ?2")
}

fn build_housekeeping_rows_sql(table: &str) -> String {
    format!(
        "SELECT id, household_id, category, relative_path FROM {table} \
         WHERE deleted_at IS NULL AND relative_path IS NOT NULL AND TRIM(relative_path) != ''"
    )
}

fn build_housekeeping_legacy_sql(table: &str) -> String {
    format!(
        "SELECT COUNT(1) as legacy FROM {table} WHERE deleted_at IS NULL AND \
         (({LEGACY_ROOT_CONDITION}) OR category IS NULL OR TRIM(category) = '')"
    )
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
    tmp.sync_all().await.map_err(|err| {
        AppError::from(err)
            .with_context("operation", "vault_migration_checkpoint_sync")
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

fn log_delete_decision(
    table: &str,
    id: &str,
    relative_hash: &str,
    outcome: &str,
    reason: Option<String>,
) {
    tracing::info!(
        target: "arklowdun",
        event = "vault_migration_delete_decision",
        table,
        id,
        relative_path_hash = relative_hash,
        outcome,
        reason = reason.unwrap_or_default(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn resume_mode_reads_checkpoint() {
        let dir = tempdir().expect("tempdir");
        let manager = VaultMigrationManager::new(dir.path()).expect("manager");
        let checkpoint_path = manager.checkpoint_path();
        let checkpoint = Checkpoint {
            table_index: 3,
            last_id: Some("item-42".into()),
            mode: MigrationMode::Apply,
        };
        save_checkpoint(&checkpoint_path, &checkpoint)
            .await
            .expect("write checkpoint");

        assert_eq!(manager.resume_mode(), Some(MigrationMode::Apply));
    }
}

pub async fn ensure_housekeeping(pool: &SqlitePool, vault: &Vault) -> AppResult<()> {
    for table in ATTACHMENT_TABLES {
        let legacy_sql = build_housekeeping_legacy_sql(table);
        let row = sqlx::query(&legacy_sql)
            .fetch_one(pool)
            .await
            .map_err(|err| AppError::from(err).with_context("table", table.to_string()))?;
        let legacy: i64 = row.try_get("legacy").unwrap_or(0);
        if legacy > 0 {
            return Err(AppError::new(
                "VAULT/HOUSEKEEPING_LEGACY_REMAIN",
                "Legacy attachment references remain after migration.",
            )
            .with_context("table", table.to_string())
            .with_context("count", legacy.to_string()));
        }

        let rows_sql = build_housekeeping_rows_sql(table);
        let mut rows = sqlx::query(&rows_sql).fetch(pool);
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
                    "VAULT/HOUSEKEEPING_CATEGORY_INVALID",
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
                    "VAULT/HOUSEKEEPING_FILE_MISSING",
                    "Attachment file missing after migration.",
                )
                .with_context("table", table.to_string())
                .with_context("id", id)
                .with_context("household_id", household_id)
                .with_context("category", category.as_str().to_string())
                .with_context("relative_path_hash", hash_path(Path::new(&relative_path))));
            }
        }
    }
    Ok(())
}
