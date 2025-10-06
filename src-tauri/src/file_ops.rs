use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use chrono::Utc;
use futures::TryStreamExt;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sqlx::{Executor, Row, Sqlite, SqlitePool, Transaction};
use tauri::Emitter;
use tokio::fs::{self, File};
use tokio::sync::mpsc;
use tokio::task::yield_now;
use tokio::time::{sleep, Duration};

use crate::attachment_category::AttachmentCategory;
use crate::files_indexer::{IndexProgress, IndexerState, RebuildMode};
use crate::security::hash_path;
use crate::vault::normalize_relative;
use crate::vault::Vault;
use crate::vault_migration::ATTACHMENT_TABLES;
use crate::{AppError, AppResult};
use uuid::Uuid;

const EVENT_FILE_MOVE_PROGRESS: &str = "file_move_progress";
const EVENT_ATTACHMENTS_REPAIR_PROGRESS: &str = "attachments_repair_progress";

static REPAIR_CANCEL_FLAG: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictStrategy {
    Rename,
    Fail,
}

impl ConflictStrategy {
    fn apply(&self, target: &Path) -> AppResult<(PathBuf, bool)> {
        match self {
            ConflictStrategy::Fail => {
                if target.exists() {
                    Err(AppError::new(
                        "FILE_EXISTS",
                        "Destination file already exists.",
                    ))
                } else {
                    Ok((target.to_path_buf(), false))
                }
            }
            ConflictStrategy::Rename => {
                if !target.exists() {
                    return Ok((target.to_path_buf(), false));
                }
                let resolved = resolve_conflict_name(target)?;
                Ok((resolved, true))
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct FileMoveRequest {
    pub household_id: String,
    pub from_category: AttachmentCategory,
    pub from_rel: String,
    pub to_category: AttachmentCategory,
    pub to_rel: String,
    pub conflict: ConflictStrategy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMoveResponse {
    pub moved: u32,
    pub renamed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepairActionKind {
    Detach,
    Mark,
    Relink,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepairAction {
    pub table_name: String,
    pub row_id: i64,
    pub action: RepairActionKind,
    pub new_category: Option<AttachmentCategory>,
    pub new_relative_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentsRepairMode {
    Scan,
    Apply,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AttachmentsRepairRequest {
    pub household_id: String,
    pub mode: AttachmentsRepairMode,
    #[serde(default)]
    pub actions: Vec<RepairAction>,
    #[serde(default)]
    pub cancel: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AttachmentsRepairResponse {
    pub scanned: u64,
    pub missing: u64,
    pub repaired: u64,
}

pub async fn move_file<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    pool: SqlitePool,
    vault: Arc<Vault>,
    request: FileMoveRequest,
) -> AppResult<FileMoveResponse> {
    let from_hash = hash_path(Path::new(&request.from_rel));
    let to_hash = hash_path(Path::new(&request.to_rel));
    tracing::info!(
        target = "arklowdun",
        event = "file_move_started",
        household_id = %request.household_id,
        from_category = %request.from_category.as_str(),
        from_relative_hash = %from_hash,
        to_category = %request.to_category.as_str(),
        to_relative_hash = %to_hash,
        conflict = ?request.conflict,
    );

    let source_path = vault.resolve(
        &request.household_id,
        request.from_category,
        &request.from_rel,
    )?;

    if !source_path.exists() {
        return Err(AppError::new(
            "FILE_MISSING",
            "Source file could not be found in the vault.",
        ));
    }

    let metadata = fs::metadata(&source_path)
        .await
        .map_err(|err| AppError::from(err).with_context("operation", "move_metadata"))?;
    if metadata.is_dir() {
        return Err(AppError::new(
            "DIRECTORY_MOVE_UNSUPPORTED",
            "Moving directories is not supported.",
        ));
    }

    let normalized_from = normalize_relative(&request.from_rel).map_err(|err| {
        AppError::from(err).with_context("operation", "normalize_source_relative")
    })?;
    let from_relative = normalized_from.to_string_lossy().replace('\\', "/");

    let mut target_path =
        vault.resolve(&request.household_id, request.to_category, &request.to_rel)?;

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|err| AppError::from(err).with_context("operation", "create_target_parent"))?;
    }

    let (final_path, renamed_due_to_conflict) = request.conflict.apply(&target_path)?;
    target_path = final_path;

    let staging_path = staging_path_for(&target_path);
    emit_move_progress(&app, "moving", &request.to_rel, 0, 1);

    let prepared_move = match stage_move(&source_path, &staging_path).await {
        Ok(prepared) => prepared,
        Err(err) => {
            tracing::error!(
                target = "arklowdun",
                event = "file_move_stage_failed",
                household_id = %request.household_id,
                error = %err,
            );
            return Err(err);
        }
    };

    let new_relative = vault
        .relative_from_resolved(&target_path, &request.household_id, request.to_category)
        .ok_or_else(|| {
            AppError::new(
                "RELATIVE_RESOLVE_FAILED",
                "Unable to compute vault relative path for moved file.",
            )
        })?;

    let normalized_new = normalize_relative(&new_relative).map_err(|err| {
        AppError::from(err).with_context("operation", "normalize_target_relative")
    })?;
    let new_relative = normalized_new.to_string_lossy().replace('\\', "/");

    let db_outcome = {
        let pool = pool.clone();
        async {
            let mut tx = pool
                .begin()
                .await
                .map_err(|err| AppError::from(err).with_context("operation", "file_move_begin_tx"))?;

            let mut updated_rows = 0_u32;
            for table in ATTACHMENT_TABLES {
                let sql = if cfg!(target_os = "windows") {
                    format!("UPDATE {table} SET category = ?1, relative_path = ?2 WHERE household_id = ?3 AND category = ?4 AND LOWER(relative_path) = LOWER(?5)")
                } else {
                    format!("UPDATE {table} SET category = ?1, relative_path = ?2 WHERE household_id = ?3 AND category = ?4 AND relative_path = ?5")
                };
                let result = sqlx::query(&sql)
                    .bind(request.to_category.as_str())
                    .bind(&new_relative)
                    .bind(&request.household_id)
                    .bind(request.from_category.as_str())
                    .bind(&from_relative)
                    .execute(&mut *tx)
                    .await
                    .map_err(|err| {
                        AppError::from(err)
                            .with_context("operation", format!("file_move_update_{table}"))
                    })?;
                updated_rows += result.rows_affected() as u32;
            }

            let new_index_name = index_basename(&new_relative);
            let from_index_name = index_basename(&from_relative);
            let files_index_sql = if cfg!(target_os = "windows") {
                "UPDATE files_index SET category = ?1, filename = ?2 WHERE household_id = ?3 AND category = ?4 AND LOWER(filename) = LOWER(?5)"
            } else {
                "UPDATE files_index SET category = ?1, filename = ?2 WHERE household_id = ?3 AND category = ?4 AND filename = ?5"
            };
            let files_index_result = sqlx::query(files_index_sql)
                .bind(request.to_category.as_str())
                .bind(&new_index_name)
                .bind(&request.household_id)
                .bind(request.from_category.as_str())
                .bind(&from_index_name)
                .execute(&mut *tx)
                .await
                .map_err(|err| {
                    AppError::from(err).with_context("operation", "file_move_update_files_index")
                })?;

            updated_rows += files_index_result.rows_affected() as u32;

            tx.commit()
                .await
                .map_err(|err| AppError::from(err).with_context("operation", "file_move_commit"))?;

            Ok::<u32, AppError>(updated_rows)
        }
        .await
    };

    let updated_rows = match db_outcome {
        Ok(rows) => rows,
        Err(err) => {
            if let Err(rollback_err) = prepared_move.rollback(&source_path).await {
                tracing::error!(
                    target = "arklowdun",
                    event = "file_move_rollback_failed",
                    household_id = %request.household_id,
                    error = %rollback_err,
                );
            }
            return Err(err);
        }
    };

    prepared_move
        .finalize(&source_path, &target_path)
        .await
        .map_err(|err| AppError::from(err).with_context("operation", "file_move_finalize"))?;

    emit_move_progress(&app, "completed", &new_relative, 1, 1);

    tracing::info!(
        target = "arklowdun",
        event = "file_move_completed",
        household_id = %request.household_id,
        from_category = %request.from_category.as_str(),
        from_relative_hash = %from_hash,
        to_category = %request.to_category.as_str(),
        to_relative_hash = %hash_path(Path::new(&new_relative)),
        rows_updated = updated_rows,
        renamed = renamed_due_to_conflict,
    );

    schedule_index_rebuild(&app, &request.household_id);

    Ok(FileMoveResponse {
        moved: updated_rows,
        renamed: renamed_due_to_conflict,
    })
}

pub async fn attachments_repair<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    pool: SqlitePool,
    vault: Arc<Vault>,
    request: AttachmentsRepairRequest,
) -> AppResult<AttachmentsRepairResponse> {
    if request.cancel {
        REPAIR_CANCEL_FLAG.store(true, Ordering::SeqCst);
        tracing::info!(
            target = "arklowdun",
            event = "attachments_repair_cancel_requested",
            household_id = %request.household_id,
        );
        return Ok(AttachmentsRepairResponse::default());
    }

    REPAIR_CANCEL_FLAG.store(false, Ordering::SeqCst);

    tracing::info!(
        target = "arklowdun",
        event = "attachments_repair_started",
        household_id = %request.household_id,
        mode = ?request.mode,
    );

    let response = match request.mode {
        AttachmentsRepairMode::Scan => {
            run_repair_scan(&app, &pool, &vault, &request.household_id).await?
        }
        AttachmentsRepairMode::Apply => run_repair_apply(&app, &pool, &vault, &request).await?,
    };

    tracing::info!(
        target = "arklowdun",
        event = "attachments_repair_completed",
        household_id = %request.household_id,
        mode = ?request.mode,
        scanned = response.scanned,
        missing = response.missing,
        repaired = response.repaired,
    );

    Ok(response)
}

async fn run_repair_scan<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    pool: &SqlitePool,
    vault: &Arc<Vault>,
    household_id: &str,
) -> AppResult<AttachmentsRepairResponse> {
    let mut scanned = 0_u64;
    let mut missing = 0_u64;

    let mut conn = pool.acquire().await.map_err(|err| {
        AppError::from(err).with_context("operation", "attachments_repair_acquire")
    })?;

    'tables: for table in ATTACHMENT_TABLES {
        let sql = format!(
            "SELECT rowid AS row_id, category, relative_path FROM {table} WHERE household_id = ?1 AND deleted_at IS NULL AND relative_path IS NOT NULL",
        );
        let mut rows = sqlx::query(&sql).bind(household_id).fetch(&mut *conn);

        while let Some(row) = rows.try_next().await.map_err(|err| {
            AppError::from(err)
                .with_context("operation", format!("attachments_repair_scan_{table}"))
        })? {
            if REPAIR_CANCEL_FLAG.load(Ordering::SeqCst) {
                break 'tables;
            }
            scanned += 1;
            let category: String = row.try_get("category").unwrap_or_default();
            let relative_path: String = row.try_get("relative_path").unwrap_or_default();
            if relative_path.trim().is_empty() {
                continue;
            }
            let parsed_category =
                AttachmentCategory::from_str(&category).unwrap_or(AttachmentCategory::Misc);
            let resolved = match vault.resolve(household_id, parsed_category, &relative_path) {
                Ok(path) => path,
                Err(_) => continue,
            };
            if !resolved.exists() {
                missing += 1;
                record_missing(
                    pool,
                    household_id,
                    table,
                    row.try_get::<i64, _>("row_id").unwrap_or_default(),
                    &category,
                    &relative_path,
                )
                .await?;
                emit_repair_progress(app, table, scanned, missing);
            }

            if scanned % 100 == 0 {
                sleep(Duration::from_millis(10)).await;
            } else {
                yield_now().await;
            }
        }
    }

    if REPAIR_CANCEL_FLAG.load(Ordering::SeqCst) {
        REPAIR_CANCEL_FLAG.store(false, Ordering::SeqCst);
    }

    Ok(AttachmentsRepairResponse {
        scanned,
        missing,
        repaired: 0,
    })
}

async fn run_repair_apply<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    pool: &SqlitePool,
    vault: &Arc<Vault>,
    request: &AttachmentsRepairRequest,
) -> AppResult<AttachmentsRepairResponse> {
    if request.actions.is_empty() {
        return Err(AppError::new(
            "REPAIR_ACTIONS_REQUIRED",
            "No repair actions were provided.",
        ));
    }

    let mut tx = pool.begin().await.map_err(|err| {
        AppError::from(err).with_context("operation", "attachments_repair_apply_begin")
    })?;

    let mut repaired = 0_u64;
    let mut processed = 0_u64;
    let now = Utc::now().timestamp();

    for action in &request.actions {
        processed += 1;
        if !ATTACHMENT_TABLES
            .iter()
            .any(|candidate| candidate == &action.table_name.as_str())
        {
            return Err(AppError::new(
                "REPAIR_TABLE_UNSUPPORTED",
                "Repair action references an unsupported attachment table.",
            ));
        }

        match action.action {
            RepairActionKind::Detach => {
                let sql = format!(
                    "UPDATE {table} SET category = NULL, relative_path = NULL WHERE household_id = ?1 AND rowid = ?2",
                    table = action.table_name,
                );
                let result = sqlx::query(&sql)
                    .bind(&request.household_id)
                    .bind(action.row_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(|err| {
                        AppError::from(err).with_context(
                            "operation",
                            format!("attachments_repair_detach_{}", action.table_name),
                        )
                    })?;
                if result.rows_affected() == 0 {
                    return Err(AppError::new(
                        "REPAIR_ROW_MISSING",
                        "Attachment row could not be updated for detach action.",
                    ));
                }
                repaired += result.rows_affected() as u64;
                update_missing_manifest(
                    &mut tx,
                    &request.household_id,
                    &action.table_name,
                    action.row_id,
                    "detach",
                    None,
                    None,
                    now,
                )
                .await?;
            }
            RepairActionKind::Mark => {
                update_missing_manifest(
                    &mut tx,
                    &request.household_id,
                    &action.table_name,
                    action.row_id,
                    "mark",
                    None,
                    None,
                    now,
                )
                .await?;
                repaired += 1;
            }
            RepairActionKind::Relink => {
                let new_category = action.new_category.ok_or_else(|| {
                    AppError::new(
                        "REPAIR_RELINK_CATEGORY_REQUIRED",
                        "Relink action requires a new category.",
                    )
                })?;
                let new_relative_raw = action.new_relative_path.clone().ok_or_else(|| {
                    AppError::new(
                        "REPAIR_RELINK_RELATIVE_REQUIRED",
                        "Relink action requires a new relative path.",
                    )
                })?;
                let normalized = normalize_relative(&new_relative_raw).map_err(|err| {
                    AppError::from(err).with_context("operation", "normalize_repair_relink")
                })?;
                let new_relative = normalized.to_string_lossy().replace('\\', "/");
                let resolved = vault.resolve(&request.household_id, new_category, &new_relative)?;
                if !resolved.exists() {
                    return Err(AppError::new(
                        "REPAIR_RELINK_TARGET_MISSING",
                        "Relink target file does not exist in the vault.",
                    ));
                }
                let metadata = fs::metadata(&resolved).await.map_err(|err| {
                    AppError::from(err).with_context("operation", "relink_metadata")
                })?;
                if metadata.is_dir() {
                    return Err(AppError::new(
                        "REPAIR_RELINK_TARGET_INVALID",
                        "Relink target must be a file.",
                    ));
                }
                let sql = format!(
                    "UPDATE {table} SET category = ?1, relative_path = ?2 WHERE household_id = ?3 AND rowid = ?4",
                    table = action.table_name,
                );
                let result = sqlx::query(&sql)
                    .bind(new_category.as_str())
                    .bind(&new_relative)
                    .bind(&request.household_id)
                    .bind(action.row_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(|err| {
                        AppError::from(err).with_context(
                            "operation",
                            format!("attachments_repair_relink_{}", action.table_name),
                        )
                    })?;
                if result.rows_affected() == 0 {
                    return Err(AppError::new(
                        "REPAIR_ROW_MISSING",
                        "Attachment row could not be updated for relink action.",
                    ));
                }
                repaired += result.rows_affected() as u64;
                update_missing_manifest(
                    &mut tx,
                    &request.household_id,
                    &action.table_name,
                    action.row_id,
                    "relink",
                    Some(new_category.as_str()),
                    Some(&new_relative),
                    now,
                )
                .await?;
            }
        }

        if processed % 25 == 0 {
            yield_now().await;
        }
    }

    tx.commit().await.map_err(|err| {
        AppError::from(err).with_context("operation", "attachments_repair_apply_commit")
    })?;

    let remaining_missing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM missing_attachments WHERE household_id = ?1 AND repaired_at_utc IS NULL",
    )
    .bind(&request.household_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    schedule_index_rebuild(app, &request.household_id);

    Ok(AttachmentsRepairResponse {
        scanned: processed,
        missing: remaining_missing as u64,
        repaired,
    })
}

async fn update_missing_manifest(
    tx: &mut Transaction<'_, Sqlite>,
    household_id: &str,
    table_name: &str,
    row_id: i64,
    action: &str,
    new_category: Option<&str>,
    new_relative_path: Option<&str>,
    timestamp: i64,
) -> AppResult<()> {
    let result = sqlx::query(
        "UPDATE missing_attachments SET action = ?1, new_category = ?2, new_relative_path = ?3, repaired_at_utc = ?4 WHERE household_id = ?5 AND table_name = ?6 AND row_id = ?7",
    )
    .bind(action)
    .bind(new_category)
    .bind(new_relative_path)
    .bind(timestamp)
    .bind(household_id)
    .bind(table_name)
    .bind(row_id)
    .execute(&mut **tx)
    .await
    .map_err(|err| {
        AppError::from(err).with_context("operation", "attachments_repair_update_manifest")
    })?;

    if result.rows_affected() == 0 {
        return Err(AppError::new(
            "REPAIR_MANIFEST_MISSING",
            "Missing attachment record was not found in manifest.",
        ));
    }

    Ok(())
}

fn staging_path_for(target: &Path) -> PathBuf {
    let parent = target
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    parent.join(format!(".arkmove-{}", Uuid::new_v4()))
}

enum PreparedMove {
    Rename { staging: PathBuf },
    Copy { staging: PathBuf },
}

impl PreparedMove {
    async fn rollback(&self, source: &Path) -> AppResult<()> {
        match self {
            PreparedMove::Rename { staging } => {
                if staging.exists() {
                    fs::rename(staging, source).await.map_err(|err| {
                        AppError::from(err).with_context("operation", "file_move_rollback_rename")
                    })?;
                }
            }
            PreparedMove::Copy { staging } => {
                if staging.exists() {
                    fs::remove_file(staging).await.map_err(|err| {
                        AppError::from(err).with_context("operation", "file_move_rollback_copy")
                    })?;
                }
            }
        }
        Ok(())
    }

    async fn finalize(self, source: &Path, target: &Path) -> std::io::Result<()> {
        match self {
            PreparedMove::Rename { staging } => fs::rename(&staging, target).await,
            PreparedMove::Copy { staging } => {
                fs::rename(&staging, target).await?;
                fs::remove_file(source).await
            }
        }
    }
}

async fn stage_move(source: &Path, staging: &Path) -> AppResult<PreparedMove> {
    match fs::rename(source, staging).await {
        Ok(_) => Ok(PreparedMove::Rename {
            staging: staging.to_path_buf(),
        }),
        Err(err) if err.kind() == std::io::ErrorKind::CrossDeviceLink => {
            fs::copy(source, staging).await.map_err(|copy_err| {
                AppError::from(copy_err).with_context("operation", "copy_cross_volume")
            })?;
            verify_same_content(source, staging).await?;
            let mut handle = File::open(staging).await.map_err(|io_err| {
                AppError::from(io_err).with_context("operation", "open_stage_file")
            })?;
            handle.sync_all().await.map_err(|io_err| {
                AppError::from(io_err).with_context("operation", "sync_stage_file")
            })?;
            Ok(PreparedMove::Copy {
                staging: staging.to_path_buf(),
            })
        }
        Err(err) => Err(AppError::from(err).with_context("operation", "rename_attachment")),
    }
}

async fn verify_same_content(source: &Path, staged: &Path) -> AppResult<()> {
    let source_meta = fs::metadata(source)
        .await
        .map_err(|err| AppError::from(err).with_context("operation", "metadata_source"))?;
    let staged_meta = fs::metadata(staged)
        .await
        .map_err(|err| AppError::from(err).with_context("operation", "metadata_stage"))?;

    if source_meta.len() != staged_meta.len() {
        return Err(AppError::new(
            "COPY_VERIFICATION_FAILED",
            "Cross-volume copy verification failed due to size mismatch.",
        ));
    }

    if let (Ok(src_mtime), Ok(dst_mtime)) = (source_meta.modified(), staged_meta.modified()) {
        if src_mtime != dst_mtime {
            return Err(AppError::new(
                "COPY_VERIFICATION_FAILED",
                "Cross-volume copy verification failed due to timestamp mismatch.",
            ));
        }
    }

    Ok(())
}

fn index_basename(relative: &str) -> String {
    Path::new(relative)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| relative.to_string())
}

fn schedule_index_rebuild<R: tauri::Runtime>(app: &tauri::AppHandle<R>, household_id: &str) {
    let state_guard = app.state::<crate::state::AppState>();
    let indexer = state_guard.files_indexer();
    if indexer.current_state(household_id) != IndexerState::Idle {
        return;
    }
    let hh = household_id.to_string();
    let app_handle = app.clone();
    let indexer_clone = indexer.clone();

    tauri::async_runtime::spawn(async move {
        let (tx, mut rx) = mpsc::channel::<IndexProgress>(16);
        let progress_app = app_handle.clone();
        let progress_household = hh.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(progress) = rx.recv().await {
                let payload = serde_json::json!({
                    "household_id": progress_household,
                    "scanned": progress.scanned,
                    "updated": progress.updated,
                    "skipped": progress.skipped,
                });
                if let Err(err) = progress_app.emit("files_index_progress", payload) {
                    tracing::warn!(
                        target = "arklowdun",
                        event = "files_index_progress_emit_failed",
                        error = %err,
                    );
                    break;
                }
            }
        });

        if let Err(err) = indexer_clone
            .rebuild(&hh, RebuildMode::Incremental, tx)
            .await
        {
            tracing::warn!(
                target = "arklowdun",
                event = "files_index_rebuild_failed",
                household_id = %hh,
                error = %err,
            );
        }
    });
}

fn emit_move_progress<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    stage: &str,
    file: &str,
    done: u64,
    total: u64,
) {
    let payload = serde_json::json!({
        "stage": stage,
        "file": file,
        "done": done,
        "total": total,
    });
    if let Err(err) = app.emit(EVENT_FILE_MOVE_PROGRESS, payload) {
        tracing::warn!(
            target = "arklowdun",
            event = "file_move_emit_failed",
            error = %err,
        );
    }
}

fn emit_repair_progress<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    table: &str,
    scanned: u64,
    missing: u64,
) {
    let payload = serde_json::json!({
        "table": table,
        "scanned": scanned,
        "missing": missing,
    });
    if let Err(err) = app.emit(EVENT_ATTACHMENTS_REPAIR_PROGRESS, payload) {
        tracing::warn!(
            target = "arklowdun",
            event = "attachments_repair_emit_failed",
            error = %err,
        );
    }
}

fn resolve_conflict_name(target: &Path) -> AppResult<PathBuf> {
    let parent = target.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = target
        .file_stem()
        .and_then(OsStr::to_str)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| "file".to_string());
    let extension = target.extension().and_then(OsStr::to_str);

    for suffix in 1..=9999 {
        let candidate = if let Some(ext) = extension {
            parent.join(format!("{stem} ({suffix}).{ext}"))
        } else {
            parent.join(format!("{stem} ({suffix})"))
        };
        match std::fs::metadata(&candidate) {
            Ok(_) => continue,
            Err(err) => {
                if err.kind() == std::io::ErrorKind::NotFound {
                    return Ok(candidate);
                }
                return Err(AppError::from(err).with_context("operation", "resolve_conflict_name"));
            }
        }
    }

    Err(AppError::new(
        "CONFLICT_RESOLUTION_FAILED",
        "Unable to resolve a unique filename for the destination.",
    ))
}

async fn record_missing(
    pool: &SqlitePool,
    household_id: &str,
    table: &str,
    row_id: i64,
    category: &str,
    relative_path: &str,
) -> AppResult<()> {
    let now = Utc::now().timestamp();
    sqlx::query(
        "INSERT OR REPLACE INTO missing_attachments (household_id, table_name, row_id, category, relative_path, detected_at_utc) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(household_id)
    .bind(table)
    .bind(row_id)
    .bind(category)
    .bind(relative_path)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|err| AppError::from(err).with_context("operation", "attachments_repair_record_missing"))?;
    Ok(())
}
