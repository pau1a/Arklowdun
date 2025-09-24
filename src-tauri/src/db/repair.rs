use std::ffi::OsString;
use std::fs::{self, File};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Instant;

use chrono::{DateTime, Utc};
use fs2::available_space;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use sqlx::SqlitePool;
use tokio::task;
use ts_rs::TS;

use crate::{
    db::{backup, health::DbHealthReport},
    AppError, AppResult,
};

use super::swap;

const PRE_REPAIR_PREFIX: &str = "pre-repair";
const NEW_DB_PREFIX: &str = "repair-new";
const NEW_DB_SUFFIX: &str = ".sqlite3";
const ARCHIVE_FILE_NAME: &str = "pre-repair.sqlite3";
const BACKUP_DIR_NAME: &str = "backups";
/// Require at least 2× the combined database and WAL size (plus a 20MB floor).
const REQUIRED_FREE_MULTIPLIER: u64 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum DbRepairStep {
    Backup,
    Checkpoint,
    Rebuild,
    Validate,
    Swap,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum DbRepairStepState {
    Pending,
    Running,
    Success,
    Warning,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct DbRepairStepReport {
    pub step: DbRepairStep,
    pub status: DbRepairStepState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct DbRepairSummary {
    pub success: bool,
    pub steps: Vec<DbRepairStepReport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<AppError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub health_report: Option<DbHealthReport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub backup_directory: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub backup_sqlite_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub archived_db_path: Option<String>,
    #[ts(type = "number")]
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DbRepairEvent {
    Step {
        step: DbRepairStep,
        status: DbRepairStepState,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        message: Option<String>,
    },
}

type RepairEventHandler = Arc<dyn Fn(DbRepairEvent) + Send + Sync + 'static>;

type RepairAsyncCallback =
    Arc<dyn Fn() -> Pin<Box<dyn Future<Output = AppResult<()>> + Send>> + Send + Sync + 'static>;
type RepairHealthCallback = Arc<
    dyn Fn() -> Pin<Box<dyn Future<Output = AppResult<Option<DbHealthReport>>> + Send>>
        + Send
        + Sync
        + 'static,
>;

#[derive(Clone, Default)]
pub struct DbRepairOptions {
    pub before_swap: Option<RepairAsyncCallback>,
    pub after_swap: Option<RepairHealthCallback>,
}

const REPAIR_STEPS: [DbRepairStep; 5] = [
    DbRepairStep::Backup,
    DbRepairStep::Checkpoint,
    DbRepairStep::Rebuild,
    DbRepairStep::Validate,
    DbRepairStep::Swap,
];

impl DbRepairSummary {
    fn new() -> Self {
        let steps = REPAIR_STEPS
            .iter()
            .copied()
            .map(|step| DbRepairStepReport {
                step,
                status: DbRepairStepState::Pending,
                message: None,
            })
            .collect();
        Self {
            success: false,
            steps,
            error: None,
            health_report: None,
            backup_directory: None,
            backup_sqlite_path: None,
            archived_db_path: None,
            duration_ms: 0,
        }
    }

    fn update_step(
        &mut self,
        step: DbRepairStep,
        status: DbRepairStepState,
        message: Option<String>,
    ) {
        if let Some(report) = self.steps.iter_mut().find(|report| report.step == step) {
            report.status = status;
            report.message = message;
        }
    }
}

fn emit_step(
    summary: &mut DbRepairSummary,
    observer: &Option<RepairEventHandler>,
    step: DbRepairStep,
    status: DbRepairStepState,
    message: Option<String>,
) {
    summary.update_step(step, status, message.clone());
    if let Some(callback) = observer {
        callback(DbRepairEvent::Step {
            step,
            status,
            message,
        });
    }
}

pub async fn run_guided_repair(
    pool: &SqlitePool,
    db_path: &Path,
    observer: Option<RepairEventHandler>,
    options: DbRepairOptions,
) -> AppResult<DbRepairSummary> {
    let start = Instant::now();
    let mut summary = DbRepairSummary::new();
    let db_path = db_path.to_path_buf();
    let before_swap = options.before_swap.clone();
    let after_swap = options.after_swap.clone();

    let mut backup_dir: Option<PathBuf> = None;
    let mut backup_sqlite: Option<PathBuf> = None;
    let mut archived_db: Option<PathBuf> = None;

    // Step 1: create pre-repair backup snapshot.
    emit_step(
        &mut summary,
        &observer,
        DbRepairStep::Backup,
        DbRepairStepState::Running,
        Some("Creating verified snapshot…".into()),
    );

    match create_pre_repair_backup(pool, &db_path).await {
        Ok((dir, sqlite_path)) => {
            backup_dir = Some(dir.clone());
            backup_sqlite = Some(sqlite_path.clone());
            emit_step(
                &mut summary,
                &observer,
                DbRepairStep::Backup,
                DbRepairStepState::Success,
                Some(format!("Snapshot stored at {}", dir.display())),
            );
        }
        Err(err) => {
            let message = err.message().to_string();
            emit_step(
                &mut summary,
                &observer,
                DbRepairStep::Backup,
                DbRepairStepState::Failed,
                Some(message.clone()),
            );
            summary.error = Some(err.clone());
            summary.success = false;
            summary.duration_ms = start.elapsed().as_millis() as u64;
            summary.backup_directory = backup_dir.map(path_to_string);
            summary.backup_sqlite_path = backup_sqlite.map(path_to_string);
            summary.archived_db_path = archived_db.map(path_to_string);
            return Ok(summary);
        }
    }

    // Step 2: checkpoint WAL if present.
    emit_step(
        &mut summary,
        &observer,
        DbRepairStep::Checkpoint,
        DbRepairStepState::Running,
        Some("Running WAL checkpoint…".into()),
    );

    match run_wal_checkpoint(&db_path).await {
        Ok(None) => {
            emit_step(
                &mut summary,
                &observer,
                DbRepairStep::Checkpoint,
                DbRepairStepState::Skipped,
                Some("No WAL file present".into()),
            );
        }
        Ok(Some(stats)) => {
            if stats.busy > 0 {
                emit_step(
                    &mut summary,
                    &observer,
                    DbRepairStep::Checkpoint,
                    DbRepairStepState::Warning,
                    Some(format!(
                        "Checkpoint incomplete (busy: {}, log: {}, checkpointed: {})",
                        stats.busy, stats.log_frames, stats.checkpointed_frames
                    )),
                );
            } else {
                emit_step(
                    &mut summary,
                    &observer,
                    DbRepairStep::Checkpoint,
                    DbRepairStepState::Success,
                    Some(format!(
                        "Checkpointed {} of {} frames",
                        stats.checkpointed_frames, stats.log_frames
                    )),
                );
            }
        }
        Err(err) => {
            emit_step(
                &mut summary,
                &observer,
                DbRepairStep::Checkpoint,
                DbRepairStepState::Warning,
                Some(format!("Checkpoint failed (continuing): {}", err.message())),
            );
        }
    }

    // Step 3: rebuild database using VACUUM INTO.
    emit_step(
        &mut summary,
        &observer,
        DbRepairStep::Rebuild,
        DbRepairStepState::Running,
        Some("Rebuilding database…".into()),
    );

    let rebuild_path = match rebuild_database(&db_path).await {
        Ok(path) => {
            emit_step(
                &mut summary,
                &observer,
                DbRepairStep::Rebuild,
                DbRepairStepState::Success,
                Some("Rebuild complete".into()),
            );
            path
        }
        Err(err) => {
            let message = err.message().to_string();
            emit_step(
                &mut summary,
                &observer,
                DbRepairStep::Rebuild,
                DbRepairStepState::Failed,
                Some(message.clone()),
            );
            summary.error = Some(err.clone());
            summary.success = false;
            summary.duration_ms = start.elapsed().as_millis() as u64;
            summary.backup_directory = backup_dir.map(path_to_string);
            summary.backup_sqlite_path = backup_sqlite.map(path_to_string);
            summary.archived_db_path = archived_db.map(path_to_string);
            return Ok(summary);
        }
    };

    // Step 4: validate rebuilt database.
    emit_step(
        &mut summary,
        &observer,
        DbRepairStep::Validate,
        DbRepairStepState::Running,
        Some("Validating rebuilt database…".into()),
    );

    if let Err(err) = validate_database(&rebuild_path).await {
        let message = err.message().to_string();
        emit_step(
            &mut summary,
            &observer,
            DbRepairStep::Validate,
            DbRepairStepState::Failed,
            Some(message.clone()),
        );
        summary.error = Some(err.clone());
        summary.success = false;
        summary.duration_ms = start.elapsed().as_millis() as u64;
        summary.backup_directory = backup_dir.map(path_to_string);
        summary.backup_sqlite_path = backup_sqlite.map(path_to_string);
        summary.archived_db_path = archived_db.map(path_to_string);
        let _ = fs::remove_file(&rebuild_path);
        return Ok(summary);
    }

    emit_step(
        &mut summary,
        &observer,
        DbRepairStep::Validate,
        DbRepairStepState::Success,
        Some("Validation passed".into()),
    );

    // Step 5: atomic swap with validated database.
    emit_step(
        &mut summary,
        &observer,
        DbRepairStep::Swap,
        DbRepairStepState::Running,
        Some("Swapping databases…".into()),
    );

    let archive_path = db_path
        .parent()
        .map(|parent| parent.join(ARCHIVE_FILE_NAME))
        .ok_or_else(|| {
            AppError::new(
                "DB_REPAIR/NO_PARENT",
                "Database path does not have a parent directory",
            )
            .with_context("path", db_path.display().to_string())
        })?;

    if let Some(callback) = before_swap {
        if let Err(err) = callback().await {
            let message = err.message().to_string();
            emit_step(
                &mut summary,
                &observer,
                DbRepairStep::Swap,
                DbRepairStepState::Failed,
                Some(message.clone()),
            );
            summary.error = Some(err.clone());
            summary.success = false;
            summary.duration_ms = start.elapsed().as_millis() as u64;
            summary.backup_directory = backup_dir.map(path_to_string);
            summary.backup_sqlite_path = backup_sqlite.map(path_to_string);
            summary.archived_db_path = archived_db.map(path_to_string);
            let _ = fs::remove_file(&rebuild_path);
            return Ok(summary);
        }
    }

    if let Err(err) = task::spawn_blocking({
        let live = db_path.clone();
        let new_db = rebuild_path.clone();
        let archive = archive_path.clone();
        move || swap::swap_database(&live, &new_db, &archive)
    })
    .await
    .map_err(|join_err| {
        AppError::new("DB_REPAIR/TASK", "Swap task panicked")
            .with_context("error", join_err.to_string())
    })? {
        let message = err.message().to_string();
        emit_step(
            &mut summary,
            &observer,
            DbRepairStep::Swap,
            DbRepairStepState::Failed,
            Some(message.clone()),
        );
        summary.error = Some(err.clone());
        summary.success = false;
        summary.duration_ms = start.elapsed().as_millis() as u64;
        summary.backup_directory = backup_dir.map(path_to_string);
        summary.backup_sqlite_path = backup_sqlite.map(path_to_string);
        summary.archived_db_path = archived_db.map(path_to_string);
        let _ = fs::remove_file(&rebuild_path);
        return Ok(summary);
    }

    archived_db = Some(archive_path.clone());

    emit_step(
        &mut summary,
        &observer,
        DbRepairStep::Swap,
        DbRepairStepState::Success,
        Some(format!(
            "Previous database saved as {}",
            archive_path.display()
        )),
    );

    let health_report = if let Some(callback) = after_swap {
        match callback().await {
            Ok(report) => report,
            Err(err) => {
                let message = err.message().to_string();
                emit_step(
                    &mut summary,
                    &observer,
                    DbRepairStep::Swap,
                    DbRepairStepState::Warning,
                    Some(message.clone()),
                );
                summary.error = Some(err.clone());
                summary.success = false;
                summary.duration_ms = start.elapsed().as_millis() as u64;
                summary.backup_directory = backup_dir.map(path_to_string);
                summary.backup_sqlite_path = backup_sqlite.map(path_to_string);
                summary.archived_db_path = archived_db.map(path_to_string);
                return Ok(summary);
            }
        }
    } else {
        None
    };

    summary.success = summary.error.is_none();
    summary.health_report = health_report;
    summary.backup_directory = backup_dir.map(path_to_string);
    summary.backup_sqlite_path = backup_sqlite.map(path_to_string);
    summary.archived_db_path = archived_db.map(path_to_string);
    summary.duration_ms = start.elapsed().as_millis() as u64;

    Ok(summary)
}

fn path_to_string(path: PathBuf) -> String {
    path.display().to_string()
}

async fn create_pre_repair_backup(
    pool: &SqlitePool,
    db_path: &Path,
) -> AppResult<(PathBuf, PathBuf)> {
    let entry = backup::create_backup(pool, db_path)
        .await
        .map_err(|err| err.with_context("operation", "db_repair_backup"))?;
    let directory = PathBuf::from(entry.directory);
    let sqlite_path = PathBuf::from(entry.sqlite_path);

    let timestamp = parse_timestamp(&entry.manifest.created_at).unwrap_or_else(|| Utc::now());
    let root = backup_root(db_path)?;
    let target_dir = allocate_pre_repair_dir(&root, &timestamp)?;

    if let Some(parent) = target_dir.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "ensure_backup_parent")
                .with_context("path", parent.display().to_string())
        })?;
    }

    fs::rename(&directory, &target_dir).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "rename_pre_repair_backup")
            .with_context("from", directory.display().to_string())
            .with_context("to", target_dir.display().to_string())
    })?;

    if let Some(parent) = target_dir.parent() {
        sync_dir(parent).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "sync_backup_dir")
                .with_context("path", parent.display().to_string())
        })?;
    }

    let sqlite_name = sqlite_path
        .file_name()
        .map(|name| target_dir.join(name))
        .unwrap_or_else(|| target_dir.join("arklowdun.sqlite3"));

    Ok((target_dir, sqlite_name))
}

async fn run_wal_checkpoint(db_path: &Path) -> AppResult<Option<WalCheckpointStats>> {
    let wal_path = wal_path(db_path);
    if !wal_path.exists() {
        return Ok(None);
    }

    let path = db_path.to_path_buf();
    task::spawn_blocking(move || wal_checkpoint_sync(&path))
        .await
        .map_err(|err| {
            AppError::new("DB_REPAIR/TASK", "Checkpoint task panicked")
                .with_context("error", err.to_string())
        })?
}

struct WalCheckpointStats {
    busy: i64,
    log_frames: i64,
    checkpointed_frames: i64,
}

fn wal_checkpoint_sync(db_path: &Path) -> AppResult<Option<WalCheckpointStats>> {
    let conn = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|err| {
        AppError::from(err)
            .with_context("operation", "open_checkpoint_db")
            .with_context("path", db_path.display().to_string())
    })?;
    conn.busy_timeout(std::time::Duration::from_secs(5)).ok();

    let mut stmt = conn
        .prepare("PRAGMA wal_checkpoint(FULL);")
        .map_err(|err| AppError::from(err).with_context("operation", "prepare_wal_checkpoint"))?;
    let mut rows = stmt
        .query([])
        .map_err(|err| AppError::from(err).with_context("operation", "wal_checkpoint"))?;
    if let Some(row) = rows
        .next()
        .map_err(|err| AppError::from(err).with_context("operation", "wal_checkpoint_row"))?
    {
        let busy: i64 = row.get(0).unwrap_or(0);
        let log: i64 = row.get(1).unwrap_or(0);
        let checkpointed: i64 = row.get(2).unwrap_or(0);
        return Ok(Some(WalCheckpointStats {
            busy,
            log_frames: log,
            checkpointed_frames: checkpointed,
        }));
    }
    Ok(None)
}

async fn rebuild_database(db_path: &Path) -> AppResult<PathBuf> {
    let parent = db_path.parent().ok_or_else(|| {
        AppError::new(
            "DB_REPAIR/NO_PARENT",
            "Database path does not have a parent directory",
        )
        .with_context("path", db_path.display().to_string())
    })?;

    let new_path = allocate_new_db_path(parent)?;
    ensure_free_space(parent, db_path)?;

    let source = db_path.to_path_buf();
    let dest = new_path.clone();
    task::spawn_blocking(move || vacuum_into_sync(&source, &dest))
        .await
        .map_err(|err| {
            AppError::new("DB_REPAIR/TASK", "VACUUM task panicked")
                .with_context("error", err.to_string())
        })??;

    Ok(new_path)
}

async fn validate_database(db_path: &Path) -> AppResult<()> {
    let path = db_path.to_path_buf();
    let result = task::spawn_blocking(move || validate_database_sync(&path))
        .await
        .map_err(|err| {
            AppError::new("DB_REPAIR/TASK", "Validation task panicked")
                .with_context("error", err.to_string())
        })?;

    result
}

fn validate_database_sync(db_path: &Path) -> AppResult<()> {
    let conn =
        Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "open_validation_db")
                .with_context("path", db_path.display().to_string())
        })?;

    let quick: String = conn
        .query_row("PRAGMA quick_check;", [], |row| row.get(0))
        .map_err(|err| AppError::from(err).with_context("operation", "quick_check"))?;
    if !quick.eq_ignore_ascii_case("ok") {
        return Err(AppError::new(
            "DB_REPAIR/QUICK_CHECK_FAILED",
            format!("quick_check reported: {quick}"),
        ));
    }

    let integrity: String = conn
        .query_row("PRAGMA integrity_check(1);", [], |row| row.get(0))
        .map_err(|err| AppError::from(err).with_context("operation", "integrity_check"))?;
    if !integrity.eq_ignore_ascii_case("ok") {
        return Err(AppError::new(
            "DB_REPAIR/INTEGRITY_FAILED",
            format!("integrity_check reported: {integrity}"),
        ));
    }

    let mut stmt = conn
        .prepare("PRAGMA foreign_key_check;")
        .map_err(|err| AppError::from(err).with_context("operation", "prepare_fk_check"))?;
    let mut rows = stmt
        .query([])
        .map_err(|err| AppError::from(err).with_context("operation", "foreign_key_check"))?;
    if let Some(row) = rows
        .next()
        .map_err(|err| AppError::from(err).with_context("operation", "foreign_key_row"))?
    {
        let table: String = row.get(0).unwrap_or_else(|_| "<unknown>".into());
        let rowid: i64 = row.get(1).unwrap_or(0);
        let detail: String = row.get(2).unwrap_or_else(|_| "violation".into());
        return Err(AppError::new(
            "DB_REPAIR/FOREIGN_KEY_FAILED",
            format!("Foreign key violation in {table} at rowid {rowid}: {detail}"),
        ));
    }

    Ok(())
}

fn ensure_free_space(dir: &Path, db_path: &Path) -> AppResult<()> {
    let db_size = fs::metadata(db_path).map(|meta| meta.len()).unwrap_or(0);
    let wal_size = fs::metadata(wal_path(db_path))
        .map(|meta| meta.len())
        .unwrap_or(0);
    let required = (db_size + wal_size).saturating_mul(REQUIRED_FREE_MULTIPLIER);
    let required = required.max(20 * 1_000_000); // minimum 20MB safety margin.

    let target = if dir.exists() {
        dir.to_path_buf()
    } else if let Some(parent) = dir.parent() {
        parent.to_path_buf()
    } else {
        dir.to_path_buf()
    };

    let available = available_space(&target).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "available_space")
            .with_context("path", target.display().to_string())
    })?;

    if available < required {
        return Err(AppError::new(
            "DB_REPAIR/LOW_DISK",
            format!(
                "Not enough free space: need {} bytes, have {} bytes",
                required, available
            ),
        )
        .with_context("required_bytes", required.to_string())
        .with_context("available_bytes", available.to_string()));
    }

    Ok(())
}

fn vacuum_into_sync(source: &Path, dest: &Path) -> AppResult<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "create_vacuum_parent")
                .with_context("path", parent.display().to_string())
        })?;
    }
    if dest.exists() {
        fs::remove_file(dest).ok();
    }

    let conn = Connection::open_with_flags(
        source,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|err| {
        AppError::from(err)
            .with_context("operation", "open_vacuum_source")
            .with_context("path", source.display().to_string())
    })?;
    conn.busy_timeout(std::time::Duration::from_secs(30)).ok();

    let dest_str = dest.to_str().ok_or_else(|| {
        AppError::new(
            "DB_REPAIR/INVALID_PATH",
            "Destination path is not valid UTF-8",
        )
        .with_context("path", dest.display().to_string())
    })?;

    conn.execute("VACUUM INTO ?", [dest_str]).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "vacuum_into")
            .with_context("path", dest.display().to_string())
    })?;

    sync_file(dest).map_err(|err| {
        AppError::from(err)
            .with_context("operation", "sync_vacuum_dest")
            .with_context("path", dest.display().to_string())
    })?;
    if let Some(parent) = dest.parent() {
        sync_dir(parent).map_err(|err| {
            AppError::from(err)
                .with_context("operation", "sync_vacuum_parent")
                .with_context("path", parent.display().to_string())
        })?;
    }

    Ok(())
}

fn sync_file(path: &Path) -> AppResult<()> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", "sync_file")
                .with_context("path", path.display().to_string())
        })
}

fn sync_dir(path: &Path) -> AppResult<()> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", "sync_dir")
                .with_context("path", path.display().to_string())
        })
}

fn wal_path(db_path: &Path) -> PathBuf {
    let mut os = OsString::from(db_path.as_os_str());
    os.push("-wal");
    PathBuf::from(os)
}

fn allocate_pre_repair_dir(root: &Path, timestamp: &DateTime<Utc>) -> AppResult<PathBuf> {
    let base = format!(
        "{}-{}",
        PRE_REPAIR_PREFIX,
        timestamp.format("%Y%m%d-%H%M%S")
    );
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
        "DB_REPAIR/NAME_COLLISION",
        "Unable to allocate unique pre-repair directory",
    ))
}

fn allocate_new_db_path(parent: &Path) -> AppResult<PathBuf> {
    for attempt in 0..100 {
        let candidate = parent.join(format!("{}-{:02}{}", NEW_DB_PREFIX, attempt, NEW_DB_SUFFIX));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(AppError::new(
        "DB_REPAIR/TEMP_ALLOC",
        "Unable to allocate temporary database path",
    ))
}

fn backup_root(db_path: &Path) -> AppResult<PathBuf> {
    let parent = db_path.parent().ok_or_else(|| {
        AppError::new(
            "DB_REPAIR/NO_PARENT",
            "Database path does not have a parent directory",
        )
        .with_context("path", db_path.display().to_string())
    })?;
    Ok(parent.join(BACKUP_DIR_NAME))
}

fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn wal_checkpoint_skipped_when_no_wal() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.sqlite3");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute("CREATE TABLE t(id INTEGER PRIMARY KEY);", [])
            .unwrap();
        drop(conn);

        let result = run_wal_checkpoint(&db_path).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn validation_detects_foreign_key_violation() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("validate.sqlite3");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
            CREATE TABLE parent(id INTEGER PRIMARY KEY);
            CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));
            INSERT INTO child(id, parent_id) VALUES (1, 2);",
        )
        .unwrap();
        drop(conn);

        let err = validate_database(&db_path)
            .await
            .expect_err("fk violation detected");
        assert_eq!(err.code(), "DB_REPAIR/FOREIGN_KEY_FAILED");
    }
}
