// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use anyhow::{Context, Result as AnyResult};
use once_cell::sync::OnceCell;
use paste::paste;
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::sync::atomic::{AtomicBool, Ordering};
use std::{
    io::{self, Write},
    path::{Path, PathBuf},
    str::FromStr,
    sync::{Arc, Mutex, RwLock},
};
use tauri::{Emitter, Manager, State};
use thiserror::Error;
use tracing_appender::non_blocking::NonBlockingBuilder;
use tracing_appender::non_blocking::{NonBlocking, WorkerGuard};
use tracing_subscriber::{
    fmt::{self, time::UtcTime, MakeWriter},
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter,
};
use ts_rs::TS;

use crate::{
    attachment_category::AttachmentCategory,
    commands::AttachmentMutationGuard,
    db::{
        backup,
        hard_repair::{self, HardRepairOutcome},
        health::{DbHealthCheck, DbHealthReport, DbHealthStatus, STORAGE_SANITY_HEAL_NOTE},
        repair::{self, DbRepairEvent, DbRepairSummary},
    },
    household_active::ActiveSetError,
    ipc::guard,
    state::AppState,
    vault_migration::ATTACHMENT_TABLES,
};

const FILES_INDEX_VERSION: i64 = 1;

const DEFAULT_LOG_MAX_SIZE_BYTES: u64 = 5_000_000;
const DEFAULT_LOG_MAX_FILES: usize = 5;
const LOG_DIR_NAME: &str = "logs";
pub(crate) const LOG_FILE_NAME: &str = "arklowdun.log";

static FILE_LOG_WRITER: OnceCell<NonBlocking> = OnceCell::new();
static FILE_LOG_GUARD: OnceCell<WorkerGuard> = OnceCell::new();

#[derive(Clone, Default)]
struct RotatingFileWriter;

// Ensure each JSON event is written as a whole line to the rotating
// file writer to avoid partial lines across rotation boundaries.
struct LineBuffered<W: Write + Send> {
    inner: W,
    buf: Vec<u8>,
}

impl<W: Write + Send> LineBuffered<W> {
    fn new(inner: W) -> Self {
        Self {
            inner,
            buf: Vec::with_capacity(1024),
        }
    }
}

impl<W: Write + Send> Write for LineBuffered<W> {
    fn write(&mut self, mut data: &[u8]) -> io::Result<usize> {
        // Append all bytes, flushing complete lines to the inner writer.
        let total = data.len();
        while !data.is_empty() {
            if let Some(pos) = data.iter().position(|&b| b == b'\n') {
                // up to and including newline
                self.buf.extend_from_slice(&data[..=pos]);
                self.inner.write_all(&self.buf)?;
                self.buf.clear();
                data = &data[pos + 1..];
            } else {
                self.buf.extend_from_slice(data);
                break;
            }
        }
        Ok(total)
    }

    fn flush(&mut self) -> io::Result<()> {
        if !self.buf.is_empty() {
            self.inner.write_all(&self.buf)?;
            self.buf.clear();
        }
        self.inner.flush()
    }
}

impl<'a> MakeWriter<'a> for RotatingFileWriter {
    type Writer = Box<dyn Write + Send>;

    fn make_writer(&'a self) -> Self::Writer {
        if let Some(writer) = FILE_LOG_WRITER.get() {
            Box::new(LineBuffered::new(writer.clone()))
        } else {
            Box::new(io::sink())
        }
    }
}

pub mod attachment_category;
mod attachments;
mod categories;
pub mod commands;
pub mod db;
pub mod diagnostics;
pub mod error;
pub mod events_tz_backfill;
pub mod exdate;
pub mod export;
mod household; // declare module; avoid `use` to prevent name collision
pub mod household_active;
pub use household::{
    acknowledge_vacuum, assert_household_active, cascade_phase_tables, create_household,
    default_household_id, delete_household, ensure_household_invariants, get_household,
    list_households, pending_cascades, restore_household, resume_household_delete,
    update_household, vacuum_queue, CascadeDeleteOptions, CascadeProgress, CascadeProgressObserver,
    DeleteOutcome, HouseholdCrudError, HouseholdGuardError, HouseholdRecord, HouseholdUpdateInput,
};
mod id;
pub mod import;
mod importer;
pub mod ipc;
pub mod logging;
pub mod migrate;
pub mod migration_guard;
pub mod note_links;
mod notes;
pub mod ops;
mod repo;
pub mod security;
mod state;
mod time;
pub mod time_errors;
pub mod time_invariants;
pub mod time_shadow;
pub mod util;
pub mod vault;
pub use self::vault::Vault;
pub mod vault_migration;

use categories::{
    categories_create, categories_delete, categories_get, categories_list, categories_restore,
    categories_update,
};
pub use error::{AppError, AppResult, ErrorDto};
use events_tz_backfill::{
    events_backfill_timezone, events_backfill_timezone_cancel, events_backfill_timezone_status,
};
use note_links::{
    note_links_create, note_links_delete, note_links_get_for_note, note_links_list_by_entity,
    note_links_unlink_entity, notes_list_for_entity, notes_quick_create_for_entity,
};
use notes::{
    notes_create, notes_delete, notes_get, notes_list_by_deadline_range, notes_list_cursor,
    notes_restore, notes_update,
};

#[cfg(test)]
mod cascade_health_tests {
    use super::*;
    use crate::{
        db::health::{DbHealthReport, DbHealthStatus},
        events_tz_backfill::BackfillCoordinator,
        household_active::StoreHandle,
        ipc::guard,
    };
    use anyhow::Result;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::{
        path::PathBuf,
        sync::{atomic::AtomicBool, Arc, Mutex, RwLock},
    };

    #[tokio::test]
    async fn pending_cascade_blocks_writes_via_health_cache() -> Result<()> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await?;
        sqlx::query("PRAGMA foreign_keys=ON;")
            .execute(&pool)
            .await?;
        crate::migrate::apply_migrations(&pool).await?;

        let report = DbHealthReport {
            status: DbHealthStatus::Ok,
            checks: Vec::new(),
            offenders: Vec::new(),
            schema_hash: "test".into(),
            app_version: "test".into(),
            generated_at: "2024-01-01T00:00:00Z".into(),
        };

        let attachments = PathBuf::from("test.attachments");
        let state = AppState {
            pool: Arc::new(RwLock::new(pool.clone())),
            active_household_id: Arc::new(Mutex::new(String::new())),
            store: StoreHandle::in_memory(),
            backfill: Arc::new(Mutex::new(BackfillCoordinator::new())),
            db_health: Arc::new(Mutex::new(report)),
            db_path: Arc::new(PathBuf::from("test.sqlite")),
            vault: Arc::new(crate::vault::Vault::new(attachments.clone())),
            vault_migration: Arc::new(
                crate::vault_migration::VaultMigrationManager::new(&attachments).unwrap(),
            ),
            maintenance: Arc::new(AtomicBool::new(false)),
        };

        let household = crate::household::create_household(&pool, "Health", None).await?;
        let _ = crate::household::pending_cascades(&pool).await?;
        sqlx::query(
            "INSERT INTO cascade_checkpoints (household_id, phase_index, deleted_count, total, phase, updated_at, vacuum_pending)\n             VALUES (?1, 0, 0, 1, 'note_links', 1, 0)",
        )
        .bind(&household.id)
        .execute(&pool)
        .await?;

        sync_cascade_health(&state, &pool).await?;
        let err = guard::ensure_db_writable(&state).expect_err("writes should be blocked");
        assert_eq!(err.code(), guard::DB_UNHEALTHY_CODE);
        Ok(())
    }
}
use security::{error_map::UiError, fs_policy, fs_policy::RootKey, hash_path};
use util::dispatch_async_app_result;
use vault_migration::{MigrationMode, MigrationProgress, VaultMigrationManager};

// Simple count-based rotating writer that rotates before writing
// when the next write would exceed the size limit, ensuring whole-line writes
// go fully into either the old or the new file.
struct CountRotator {
    path: PathBuf,
    max_bytes: usize,
    max_files: usize,
    file: std::fs::File,
    len: u64,
}

impl CountRotator {
    fn new(path: PathBuf, max_bytes: usize, max_files: usize) -> io::Result<Self> {
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        let len = file.metadata().map(|m| m.len()).unwrap_or(0);
        Ok(Self {
            path,
            max_bytes,
            max_files,
            file,
            len,
        })
    }

    fn rotate(&mut self) -> io::Result<()> {
        // Flush current file before rotating
        let _ = self.file.flush();

        // Remove oldest if exists
        let oldest = self.suffixed(self.max_files);
        if oldest.exists() {
            let _ = std::fs::remove_file(&oldest);
        }

        // Shift files: .(n-1) -> .n, current -> .1
        for i in (1..=self.max_files).rev() {
            let src = if i == 1 {
                self.path.clone()
            } else {
                self.suffixed(i - 1)
            };
            if src.exists() {
                let dst = self.suffixed(i);
                let _ = std::fs::rename(&src, &dst);
            }
        }

        // Create a new current file
        self.file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&self.path)?;
        self.len = 0;
        Ok(())
    }

    fn suffixed(&self, idx: usize) -> PathBuf {
        let mut p = self.path.clone();
        let file_name = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        p.set_file_name(format!("{}.{}", file_name, idx));
        p
    }
}

impl Write for CountRotator {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        // Rotate first if needed, so the whole buffer goes into one file.
        if (self.len as usize) + buf.len() > self.max_bytes.max(1) {
            self.rotate()?;
        }
        self.file.write_all(buf)?;
        self.len += buf.len() as u64;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

pub fn init_logging() {
    let filter = std::env::var("TAURI_ARKLOWDUN_LOG")
        .unwrap_or_else(|_| "arklowdun=info,sqlx=warn".to_string());

    // Forward `log` crate macros to the `tracing` subscriber so that
    // `log::info!`/`log::error!` statements are captured alongside
    // existing `tracing` instrumentation and end up in the persistent
    // log directory.
    let _ = tracing_log::LogTracer::init();

    let stdout_layer = fmt::layer()
        .with_writer(io::stdout)
        .json()
        .with_target(true)
        .with_timer(UtcTime::rfc_3339())
        .with_current_span(false)
        .with_span_list(false);

    let file_layer = fmt::layer()
        .with_writer(RotatingFileWriter)
        .json()
        .with_target(true)
        .with_timer(UtcTime::rfc_3339())
        .with_current_span(false)
        .with_span_list(false);

    let subscriber = tracing_subscriber::registry()
        .with(EnvFilter::new(filter))
        .with(stdout_layer)
        .with(file_layer);

    let _ = subscriber.try_init();
    crate::error::install_panic_hook();
}

pub(crate) fn git_commit_hash() -> &'static str {
    option_env!("ARK_GIT_HASH").unwrap_or("unknown")
}

#[derive(Debug, Error)]
pub enum FileLoggingError {
    #[error("app data directory unavailable")]
    MissingAppDataDir,
    #[error("failed to create log directory at {dir:?}: {source}")]
    CreateDir {
        dir: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("failed to create log file at {path:?}: {source}")]
    CreateFile {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
}

pub fn init_file_logging<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), FileLoggingError> {
    if FILE_LOG_WRITER.get().is_some() {
        return Ok(());
    }

    let logs_dir = resolve_logs_dir(&app)?;
    std::fs::create_dir_all(&logs_dir).map_err(|source| FileLoggingError::CreateDir {
        dir: logs_dir.clone(),
        source,
    })?;

    let log_path = logs_dir.join(LOG_FILE_NAME);
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|source| FileLoggingError::CreateFile {
            path: log_path.clone(),
            source,
        })?;

    let (max_bytes, max_files) = file_logging_limits();
    let byte_limit = usize::try_from(max_bytes).unwrap_or(usize::MAX);
    let rotator = CountRotator::new(log_path.clone(), byte_limit, max_files).map_err(|source| {
        FileLoggingError::CreateFile {
            path: log_path.clone(),
            source,
        }
    })?;

    // Use a lossless, larger-buffer non-blocking writer so heavy bursts
    // (like stress tests) don't drop lines before rotation can trigger.
    let (writer, guard) = NonBlockingBuilder::default()
        .lossy(false)
        .buffered_lines_limit(50_000)
        .finish(rotator);
    match FILE_LOG_WRITER.set(writer) {
        Ok(()) => {
            let _ = FILE_LOG_GUARD.set(guard);
            // Emit a bootstrap line so the log file has content immediately
            tracing::info!(target: "arklowdun", event = "log_sink_initialized");
            flush_file_logs();
            Ok(())
        }
        Err(writer) => {
            drop(writer);
            drop(guard);
            Ok(())
        }
    }
}

pub fn flush_file_logs() {
    if let Some(writer) = FILE_LOG_WRITER.get() {
        let mut writer = writer.clone();
        let _ = writer.flush();
    }
}

pub fn init_file_logging_standalone(bundle_id: &str) -> Result<PathBuf, FileLoggingError> {
    // Prefer a test/appdata override if present to keep behavior consistent
    // with resolve_logs_dir() used by the Tauri app path resolver.
    let base = if let Ok(fake) = std::env::var("ARK_FAKE_APPDATA") {
        let mut p = PathBuf::from(fake);
        p.push(LOG_DIR_NAME);
        p
    } else {
        // dirs::data_dir() already points to the platform-specific application data directory:
        //   macOS:   ~/Library/Application Support
        //   Windows: %APPDATA%
        //   Linux:   $XDG_DATA_HOME (or fallback)
        let mut p = dirs::data_dir().ok_or(FileLoggingError::MissingAppDataDir)?;
        p.push(bundle_id);
        p.push(LOG_DIR_NAME);
        p
    };

    if FILE_LOG_WRITER.get().is_some() {
        return Ok(base.join(LOG_FILE_NAME));
    }

    std::fs::create_dir_all(&base).map_err(|source| FileLoggingError::CreateDir {
        dir: base.clone(),
        source,
    })?;

    let log_path = base.join(LOG_FILE_NAME);
    let (max_bytes, max_files) = file_logging_limits();
    let byte_limit = usize::try_from(max_bytes).unwrap_or(usize::MAX);
    let rotator = CountRotator::new(log_path.clone(), byte_limit, max_files).map_err(|source| {
        FileLoggingError::CreateFile {
            path: log_path.clone(),
            source,
        }
    })?;

    let (writer, guard) = NonBlockingBuilder::default()
        .lossy(false)
        .buffered_lines_limit(50_000)
        .finish(rotator);

    FILE_LOG_WRITER.set(writer).ok();
    FILE_LOG_GUARD.set(guard).ok();

    tracing::info!(target: "arklowdun", event = "log_sink_initialized");
    flush_file_logs();

    Ok(log_path)
}

pub(crate) fn resolve_logs_dir<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PathBuf, FileLoggingError> {
    if let Ok(fake) = std::env::var("ARK_FAKE_APPDATA") {
        return Ok(PathBuf::from(fake).join(LOG_DIR_NAME));
    }

    let base = app
        .path()
        .app_data_dir()
        .map_err(|_| FileLoggingError::MissingAppDataDir)?;
    Ok(base.join(LOG_DIR_NAME))
}

fn file_logging_limits() -> (u64, usize) {
    let max_bytes = std::env::var("TAURI_ARKLOWDUN_LOG_MAX_SIZE_BYTES")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map(|bytes| bytes.max(1))
        .unwrap_or(DEFAULT_LOG_MAX_SIZE_BYTES);

    let max_files = std::env::var("TAURI_ARKLOWDUN_LOG_MAX_FILES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .map(|count| count.max(1))
        .unwrap_or(DEFAULT_LOG_MAX_FILES);

    (max_bytes, max_files)
}

pub fn log_fs_ok(root: RootKey, real: &std::path::Path) {
    tracing::info!(
        target: "arklowdun",
        event = "fs_guard_check",
        ok = true,
        root = ?root,
        path_hash = %hash_path(real),
    );
}

pub fn log_fs_deny(root: RootKey, e: &UiError, reason: &'static str) {
    tracing::warn!(
        target: "arklowdun",
        event = "fs_guard_check",
        ok = false,
        root = ?root,
        code = %e.code,
        reason = reason,
    );
}

pub fn log_vault_error(
    household_id: &str,
    category: AttachmentCategory,
    relative_path: &str,
    code: &str,
    stage: &'static str,
) {
    tracing::warn!(
        target: "arklowdun",
        event = "vault_guard_denied",
        stage,
        household_id,
        category = category.as_str(),
        relative_hash = %hash_path(Path::new(relative_path)),
        code,
    );
}

macro_rules! gen_domain_cmds {
    ( $( $table:ident ),+ $(,)? ) => {
        paste! {
            $(
                #[tauri::command]
                async fn [<$table _list>](
                    state: State<'_, AppState>,
                    household_id: String,
                    order_by: Option<String>,
                    limit: Option<i64>,
                    offset: Option<i64>,
                ) -> AppResult<Vec<serde_json::Value>> {
                    let pool = state.pool_clone();
                    dispatch_async_app_result(move || {
                        let order_by = order_by;
                        let household_id = household_id;
                        async move {
                            commands::list_command(
                                &pool,
                                stringify!($table),
                                &household_id,
                                order_by.as_deref(),
                                limit,
                                offset,
                            )
                            .await
                        }
                    })
                    .await
                }

                #[tauri::command]
                async fn [<$table _get>](
                    state: State<'_, AppState>,
                    household_id: Option<String>,
                    id: String,
                ) -> AppResult<Option<serde_json::Value>> {
                    let pool = state.pool_clone();
                    dispatch_async_app_result(move || {
                        let household_id = household_id;
                        let id = id;
                        async move {
                            let hh = household_id.as_deref();
                            commands::get_command(
                                &pool,
                                stringify!($table),
                                hh,
                                &id,
                            )
                            .await
                        }
                    })
                    .await
                }

                #[tauri::command]
                async fn [<$table _create>](
                    state: State<'_, AppState>,
                    data: serde_json::Map<String, serde_json::Value>,
                ) -> AppResult<serde_json::Value> {
                    let _permit = guard::ensure_db_writable(&state)?;
                    let pool = state.pool_clone();
                    let vault = state.vault();
                    let active_household = state.active_household_id.clone();
                    dispatch_async_app_result(move || {
                        let data = data;
                        let vault = vault.clone();
                        let pool = pool.clone();
                        let active_household = active_household.clone();
                        async move {
                            let guard = resolve_attachment_for_ipc_create(
                                &vault,
                                &active_household,
                                stringify!($table),
                                &data,
                                concat!(stringify!($table), "_create"),
                            )?;
                            commands::create_command(
                                &pool,
                                stringify!($table),
                                data,
                                guard,
                            )
                            .await
                        }
                    })
                    .await
                }

                #[tauri::command]
                async fn [<$table _update>](
                    state: State<'_, AppState>,
                    id: String,
                    data: serde_json::Map<String, serde_json::Value>,
                    household_id: Option<String>,
                ) -> AppResult<()> {
                    let _permit = guard::ensure_db_writable(&state)?;
                    let pool = state.pool_clone();
                    let vault = state.vault();
                    let active_household = state.active_household_id.clone();
                    dispatch_async_app_result(move || {
                        let household_id = household_id;
                        let id = id;
                        let data = data;
                        let vault = vault.clone();
                        let pool = pool.clone();
                        let active_household = active_household.clone();
                        async move {
                            let hh = household_id.as_deref();
                            let guard = resolve_attachment_for_ipc_update(
                                &pool,
                                &vault,
                                &active_household,
                                stringify!($table),
                                &id,
                                hh,
                                &data,
                                concat!(stringify!($table), "_update"),
                            )
                            .await?;
                            commands::update_command(
                                &pool,
                                stringify!($table),
                                &id,
                                data,
                                hh,
                                guard,
                            )
                            .await
                        }
                    })
                    .await
                }

                #[tauri::command]
                async fn [<$table _delete>](
                    state: State<'_, AppState>,
                    household_id: String,
                    id: String,
                ) -> AppResult<()> {
                    let _permit = guard::ensure_db_writable(&state)?;
                    let pool = state.pool_clone();
                    let vault = state.vault();
                    let active_household = state.active_household_id.clone();
                    dispatch_async_app_result(move || {
                        let household_id = household_id;
                        let id = id;
                        let pool = pool.clone();
                        let vault = vault.clone();
                        let active_household = active_household.clone();
                        async move {
                            let guard = resolve_attachment_for_ipc_delete(
                                &pool,
                                &vault,
                                &active_household,
                                stringify!($table),
                                &household_id,
                                &id,
                                concat!(stringify!($table), "_delete"),
                            )
                            .await?;
                            commands::delete_command(
                                &pool,
                                stringify!($table),
                                &household_id,
                                &id,
                                guard,
                            )
                            .await
                        }
                    })
                    .await
                }

                #[tauri::command]
                async fn [<$table _restore>](
                    state: State<'_, AppState>,
                    household_id: String,
                    id: String,
                ) -> AppResult<()> {
                    let _permit = guard::ensure_db_writable(&state)?;
                    let pool = state.pool_clone();
                    dispatch_async_app_result(move || {
                        let household_id = household_id;
                        let id = id;
                        async move {
                            commands::restore_command(
                                &pool,
                                stringify!($table),
                                &household_id,
                                &id,
                            )
                            .await
                        }
                    })
                    .await
                }
            )+
        }
    };
}

gen_domain_cmds!(
    bills,
    policies,
    property_documents,
    inventory_items,
    // vehicles is handled below (typed list + explicit CRUD wrappers)
    vehicle_maintenance,
    pets,
    pet_medical,
    family_members,
    budget_categories,
    expenses,
    shopping_items,
);

#[derive(Serialize, Deserialize, Clone, TS, sqlx::FromRow)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Vehicle {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub household_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub make: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reg: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub vin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub next_mot_due: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub next_service_due: Option<i64>,
    #[serde(default)]
    #[ts(type = "number")]
    pub created_at: i64,
    #[serde(default)]
    #[ts(type = "number")]
    pub updated_at: i64,
    #[serde(alias = "deletedAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub deleted_at: Option<i64>,
    #[serde(default)]
    #[ts(type = "number")]
    pub position: i64,
}

#[derive(Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct HouseholdSummary {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tz: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

// Typed list for Dashboard (rich fields)
#[tauri::command]
async fn vehicles_list(
    state: State<'_, AppState>,
    household_id: String,
) -> AppResult<Vec<Vehicle>> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id;
        async move {
            sqlx::query_as::<_, Vehicle>(
                "SELECT id, household_id, name, make, model, reg, vin,\n         COALESCE(next_mot_due, mot_date)         AS next_mot_due,\n         COALESCE(next_service_due, service_date) AS next_service_due,\n         created_at, updated_at, deleted_at, position\n    FROM vehicles\n   WHERE household_id = ? AND deleted_at IS NULL\n   ORDER BY position, created_at, id",
            )
            .bind(household_id.clone())
            .fetch_all(&pool)
            .await
            .map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "vehicles_list")
                    .with_context("household_id", household_id)
            })
        }
    })
    .await
}

// Generic CRUD wrappers so legacy UI continues to work
#[tauri::command]
async fn vehicles_get(
    state: State<'_, AppState>,
    household_id: Option<String>,
    id: String,
) -> AppResult<Option<serde_json::Value>> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id;
        let id = id;
        async move { commands::get_command(&pool, "vehicles", household_id.as_deref(), &id).await }
    })
    .await
}

#[tauri::command]
async fn vehicles_create(
    state: State<'_, AppState>,
    data: serde_json::Map<String, serde_json::Value>,
) -> AppResult<serde_json::Value> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let data = data;
        async move { commands::create_command(&pool, "vehicles", data, None).await }
    })
    .await
}

#[tauri::command]
async fn vehicles_update(
    state: State<'_, AppState>,
    id: String,
    data: serde_json::Map<String, serde_json::Value>,
    household_id: Option<String>,
) -> AppResult<()> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let id = id;
        let data = data;
        let household_id = household_id;
        async move {
            commands::update_command(&pool, "vehicles", &id, data, household_id.as_deref(), None)
                .await
        }
    })
    .await
}

#[tauri::command]
async fn vehicles_delete(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> AppResult<()> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id;
        let id = id;
        async move { commands::delete_command(&pool, "vehicles", &household_id, &id, None).await }
    })
    .await
}

#[tauri::command]
async fn vehicles_restore(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> AppResult<()> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id;
        let id = id;
        async move { commands::restore_command(&pool, "vehicles", &household_id, &id).await }
    })
    .await
}

#[derive(Serialize, Deserialize, Clone, TS, Debug)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Event {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub household_id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tz: Option<String>,
    #[serde(default)]
    #[ts(type = "number")]
    pub start_at_utc: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub end_at_utc: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rrule: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub exdates: Option<String>,
    #[ts(optional, type = "number")]
    pub reminder: Option<i64>,
    #[serde(default)]
    #[ts(type = "number")]
    pub created_at: i64,
    #[serde(default)]
    #[ts(type = "number")]
    pub updated_at: i64,
    #[serde(alias = "deletedAt")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub deleted_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub series_parent_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, TS, Debug)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct EventsListRangeResponse {
    #[serde(default)]
    pub items: Vec<Event>,
    #[serde(default)]
    pub truncated: bool,
    pub limit: usize,
}

#[tauri::command]
async fn events_list_range(
    state: State<'_, AppState>,
    household_id: String,
    start: i64,
    end: i64,
) -> AppResult<EventsListRangeResponse> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id;
        async move { commands::events_list_range_command(&pool, &household_id, start, end).await }
    })
    .await
}

#[tauri::command]
async fn event_create(
    state: State<'_, AppState>,
    data: serde_json::Map<String, serde_json::Value>,
) -> AppResult<serde_json::Value> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let data = data;
        async move { commands::create_command(&pool, "events", data, None).await }
    })
    .await
}

#[tauri::command]
async fn event_update(
    state: State<'_, AppState>,
    id: String,
    data: serde_json::Map<String, serde_json::Value>,
    household_id: String,
) -> AppResult<()> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let id = id;
        let data = data;
        let household_id = household_id;
        async move {
            commands::update_command(&pool, "events", &id, data, Some(&household_id), None).await
        }
    })
    .await
}

#[tauri::command]
async fn event_delete(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> AppResult<()> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id;
        let id = id;
        async move { commands::delete_command(&pool, "events", &household_id, &id, None).await }
    })
    .await
}

#[tauri::command]
async fn event_restore(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> AppResult<()> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id;
        let id = id;
        async move { commands::restore_command(&pool, "events", &household_id, &id).await }
    })
    .await
}

#[tauri::command]
async fn bills_list_due_between(
    state: State<'_, AppState>,
    household_id: String,
    from_ms: i64,
    to_ms: i64,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AppResult<Vec<serde_json::Value>> {
    use sqlx::query;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id;
        async move {
            let base_sql = r#"
        SELECT * FROM bills
        WHERE household_id = ?1
          AND deleted_at IS NULL
          AND due_date >= ?2
          AND due_date <= ?3
        ORDER BY due_date ASC, created_at ASC, id ASC
    "#;

            let mut sql = base_sql.to_string();
            let limit_value = limit.filter(|value| *value > 0);
            let offset_value = offset.filter(|value| *value > 0);
            if limit_value.is_some() {
                sql.push_str(" LIMIT ?4");
            }
            if offset_value.is_some() {
                sql.push_str(" OFFSET ?5");
            }

            let mut q = query(&sql).bind(&household_id).bind(from_ms).bind(to_ms);

            if let Some(value) = limit_value {
                q = q.bind(value);
            }
            if let Some(value) = offset_value {
                q = q.bind(value);
            }

            let rows = q.fetch_all(&pool).await.map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "bills_list_due_between")
                    .with_context("household_id", household_id.clone())
            })?;

            Ok(rows.into_iter().map(crate::repo::row_to_json).collect())
        }
    })
    .await
}

#[tauri::command]
async fn household_get_active(state: tauri::State<'_, state::AppState>) -> Result<String, String> {
    let pool = state.pool_clone();
    let store = state.store.clone();
    let id = crate::household_active::get_active_household_id(&pool, &store)
        .await
        .map_err(|err| err.to_string())?;
    let mut guard = state
        .active_household_id
        .lock()
        .map_err(|_| "STATE_LOCK_POISONED".to_string())?;
    *guard = id.clone();
    Ok(id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HouseholdCreateArgs {
    name: String,
    #[serde(default)]
    color: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HouseholdUpdateArgs {
    id: String,
    name: Option<String>,
    #[serde(default)]
    color: Option<Option<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HouseholdDeleteResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    fallback_id: Option<String>,
    #[serde(default)]
    total_deleted: u64,
    #[serde(default)]
    total_expected: u64,
    #[serde(default)]
    vacuum_recommended: bool,
    #[serde(default)]
    completed: bool,
}

fn map_household_crud_error(err: crate::household::HouseholdCrudError) -> AppError {
    match err {
        crate::household::HouseholdCrudError::DefaultUndeletable => AppError::new(
            "DEFAULT_UNDELETABLE",
            "The default household cannot be deleted.",
        ),
        crate::household::HouseholdCrudError::NotFound => {
            AppError::new("HOUSEHOLD_NOT_FOUND", "Household not found.")
        }
        crate::household::HouseholdCrudError::Deleted => {
            AppError::new("HOUSEHOLD_DELETED", "Household is deleted.")
        }
        crate::household::HouseholdCrudError::InvalidColor => {
            AppError::new("INVALID_COLOR", "Please use a hex colour like #2563EB.")
        }
        crate::household::HouseholdCrudError::Unexpected(err) => AppError::from(err),
    }
}

fn snapshot_active_id(state: &state::AppState) -> Option<String> {
    match state.active_household_id.lock() {
        Ok(guard) => {
            let value = guard.clone();
            if value.is_empty() {
                None
            } else {
                Some(value)
            }
        }
        Err(poisoned) => {
            let guard = poisoned.into_inner();
            let value = guard.clone();
            if value.is_empty() {
                None
            } else {
                Some(value)
            }
        }
    }
}

fn update_active_snapshot(state: &state::AppState, id: &str) {
    match state.active_household_id.lock() {
        Ok(mut guard) => {
            *guard = id.to_string();
        }
        Err(poisoned) => {
            let mut guard = poisoned.into_inner();
            *guard = id.to_string();
        }
    }
}

const CASCADE_HEALTH_CHECK: &str = "cascade_state";

fn cascade_health_message(offenders: &[String]) -> String {
    if offenders.len() == 1 {
        format!("Unfinished cascade for {}", offenders[0])
    } else {
        format!(
            "Unfinished cascades for households: {}",
            offenders.join(", ")
        )
    }
}

fn update_cascade_health_cache(state: &state::AppState, offenders: &[String]) -> AppResult<()> {
    let mut guard = state.db_health.lock().map_err(|_| {
        AppError::new(
            "STATE/LOCK_POISONED",
            "Failed to update database health cache",
        )
    })?;
    guard
        .checks
        .retain(|check| check.name != CASCADE_HEALTH_CHECK);
    if offenders.is_empty() {
        let any_failed = guard.checks.iter().any(|check| !check.passed);
        guard.status = if any_failed {
            DbHealthStatus::Error
        } else {
            DbHealthStatus::Ok
        };
    } else {
        let detail = cascade_health_message(offenders);
        guard.checks.push(DbHealthCheck {
            name: CASCADE_HEALTH_CHECK.to_string(),
            passed: false,
            duration_ms: 0,
            details: Some(detail),
        });
        guard.status = DbHealthStatus::Error;
    }
    Ok(())
}

async fn sync_cascade_health(state: &state::AppState, pool: &SqlitePool) -> AppResult<()> {
    let pending = crate::household::pending_cascades(pool)
        .await
        .map_err(map_household_crud_error)?;
    if pending.is_empty() {
        let db_path = (*state.db_path).clone();
        let report = crate::db::health::run_health_checks(pool, &db_path)
            .await
            .map_err(|err| {
                AppError::from(err).with_context("operation", "cascade_health_refresh")
            })?;
        let mut guard = state.db_health.lock().map_err(|_| {
            AppError::new(
                "STATE/LOCK_POISONED",
                "Failed to update database health cache",
            )
        })?;
        *guard = report;
    } else {
        let offenders: Vec<String> = pending.into_iter().map(|c| c.household_id).collect();
        update_cascade_health_cache(state, &offenders)?;
    }
    Ok(())
}

fn make_delete_progress_handler<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    household_id: &str,
) -> CascadeProgressObserver {
    let emitter = app.clone();
    let household_id = household_id.to_string();
    Arc::new(move |progress: CascadeProgress| {
        let payload = json!({
            "householdId": progress.household_id,
            "deleted": progress.deleted,
            "total": progress.total,
            "phase": progress.phase,
            "phaseIndex": progress.phase_index,
            "phaseTotal": progress.phase_total,
        });
        if let Err(err) = emitter.emit("household:delete_progress", payload) {
            tracing::warn!(
                target: "arklowdun",
                event = "household_delete_progress_emit_failed",
                error = %err,
                household_id = %household_id
            );
        }
    })
}

#[tauri::command]
async fn household_list(
    state: State<'_, AppState>,
    include_deleted: Option<bool>,
) -> AppResult<Vec<crate::household::HouseholdRecord>> {
    let pool = state.pool_clone();
    let include_deleted = include_deleted.unwrap_or(false);
    dispatch_async_app_result(move || {
        let pool = pool.clone();
        async move {
            crate::household::list_households(&pool, include_deleted)
                .await
                .map_err(map_household_crud_error)
        }
    })
    .await
}

#[tauri::command]
async fn household_get(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Option<crate::household::HouseholdRecord>> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let pool = pool.clone();
        let id = id.clone();
        async move {
            crate::household::get_household(&pool, &id)
                .await
                .map_err(map_household_crud_error)
        }
    })
    .await
}

#[tauri::command]
async fn household_create(
    state: State<'_, AppState>,
    args: HouseholdCreateArgs,
) -> AppResult<crate::household::HouseholdRecord> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    let name = args.name;
    let color = args.color;
    let result = dispatch_async_app_result(move || {
        let pool = pool.clone();
        async move {
            crate::household::create_household(&pool, &name, color.as_deref())
                .await
                .map_err(map_household_crud_error)
        }
    })
    .await;

    match result {
        Ok(record) => {
            tracing::info!(
                target: "arklowdun",
                event = "household_create",
                household_id = %record.id,
                result = "ok",
                name = %record.name,
                color = record.color.as_deref().unwrap_or("")
            );
            Ok(record)
        }
        Err(err) => {
            tracing::warn!(
                target: "arklowdun",
                event = "household_create",
                household_id = "",
                result = "error",
                error_code = %err.code()
            );
            Err(err)
        }
    }
}

#[tauri::command]
async fn household_update(
    state: State<'_, AppState>,
    args: HouseholdUpdateArgs,
) -> AppResult<crate::household::HouseholdRecord> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    let HouseholdUpdateArgs { id, name, color } = args;
    let id_for_log = id.clone();
    let mut changed_fields: Vec<&'static str> = Vec::new();
    if name.is_some() {
        changed_fields.push("name");
    }
    if color.is_some() {
        changed_fields.push("color");
    }
    let result = dispatch_async_app_result(move || {
        let pool = pool.clone();
        let name = name;
        let color = color;
        async move {
            crate::household::update_household(
                &pool,
                &id,
                crate::household::HouseholdUpdateInput {
                    name: name.as_deref(),
                    color: color.as_ref().map(|value| value.as_deref()),
                },
            )
            .await
            .map_err(map_household_crud_error)
        }
    })
    .await;

    match result {
        Ok(record) => {
            tracing::info!(
                target: "arklowdun",
                event = "household_update",
                household_id = %record.id,
                result = "ok",
                changed_fields = ?changed_fields,
                name = %record.name,
                color = record.color.as_deref().unwrap_or("")
            );
            Ok(record)
        }
        Err(err) => {
            tracing::warn!(
                target: "arklowdun",
                event = "household_update",
                household_id = %id_for_log,
                result = "error",
                changed_fields = ?changed_fields,
                error_code = %err.code()
            );
            Err(err)
        }
    }
}

#[tauri::command]
async fn household_delete<R: tauri::Runtime>(
    id: String,
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
) -> AppResult<HouseholdDeleteResponse> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    update_cascade_health_cache(&state, &[id.clone()])?;
    let active = snapshot_active_id(&state);
    let progress_handler = make_delete_progress_handler(&app, &id);
    let mut options = CascadeDeleteOptions::default();
    options.progress = Some(progress_handler);
    options.max_duration_ms = Some(2_000);
    let outcome =
        match crate::household::delete_household(&pool, &id, active.as_deref(), options).await {
            Ok(outcome) => outcome,
            Err(err) => {
                let reason = match &err {
                    crate::household::HouseholdCrudError::DefaultUndeletable => "default",
                    crate::household::HouseholdCrudError::NotFound => "not_found",
                    crate::household::HouseholdCrudError::Deleted => "already_deleted",
                    crate::household::HouseholdCrudError::InvalidColor => "invalid_color",
                    crate::household::HouseholdCrudError::Unexpected(_) => "unexpected",
                };
                let app_error = map_household_crud_error(err);
                tracing::warn!(
                    target: "arklowdun",
                    event = "household_delete",
                    household_id = %id,
                    result = "error",
                    reason,
                    error_code = %app_error.code()
                );
                return Err(app_error);
            }
        };

    sync_cascade_health(&state, &pool).await?;

    if let Some(ref fallback) = outcome.fallback_id {
        match crate::household_active::set_active_household_id(&pool, &state.store, fallback).await
        {
            Ok(()) => {
                update_active_snapshot(&state, fallback);
                tracing::info!(
                    target: "arklowdun",
                    event = "household_active_switched",
                    household_id = %fallback,
                    result = "ok",
                    reason = "delete_active_fallback"
                );
                if let Err(err) = app.emit("household:changed", json!({ "id": fallback.clone() })) {
                    tracing::warn!(
                        target: "arklowdun",
                        event = "household_event_emit_failed",
                        household_id = %fallback,
                        result = "error",
                        error = %err
                    );
                }
            }
            Err(err) => {
                tracing::warn!(
                    target: "arklowdun",
                    event = "household_active_switch_failed",
                    reason = "delete_active_fallback",
                    household_id = %fallback,
                    result = "error",
                    error = ?err
                );
            }
        }
    }

    if let Ok(Some(record)) = crate::household::get_household(&pool, &id).await {
        tracing::info!(
            target: "arklowdun",
            event = "household_delete",
            household_id = %record.id,
            result = "ok",
            name = %record.name,
            color = record.color.as_deref().unwrap_or(""),
            was_active = outcome.was_active,
            fallback_id = outcome.fallback_id.as_deref()
        );
    }

    Ok(HouseholdDeleteResponse {
        fallback_id: outcome.fallback_id,
        total_deleted: outcome.total_deleted,
        total_expected: outcome.total_expected,
        vacuum_recommended: outcome.vacuum_recommended,
        completed: outcome.completed,
    })
}

#[tauri::command]
async fn household_resume_delete<R: tauri::Runtime>(
    id: String,
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
) -> AppResult<HouseholdDeleteResponse> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    update_cascade_health_cache(&state, &[id.clone()])?;
    let active = snapshot_active_id(&state);
    let progress_handler = make_delete_progress_handler(&app, &id);
    let mut options = CascadeDeleteOptions::default();
    options.progress = Some(progress_handler);
    options.resume = true;
    options.max_duration_ms = Some(2_000);
    let outcome =
        match crate::household::resume_household_delete(&pool, &id, active.as_deref(), options)
            .await
        {
            Ok(outcome) => outcome,
            Err(err) => {
                let reason = match &err {
                    crate::household::HouseholdCrudError::DefaultUndeletable => "default",
                    crate::household::HouseholdCrudError::NotFound => "not_found",
                    crate::household::HouseholdCrudError::Deleted => "already_deleted",
                    crate::household::HouseholdCrudError::InvalidColor => "invalid_color",
                    crate::household::HouseholdCrudError::Unexpected(_) => "unexpected",
                };
                tracing::warn!(
                    target: "arklowdun",
                    event = "household_resume_failed",
                    household_id = %id,
                    result = "error",
                    reason
                );
                return Err(map_household_crud_error(err));
            }
        };

    sync_cascade_health(&state, &pool).await?;

    if let Some(ref fallback) = outcome.fallback_id {
        match crate::household_active::set_active_household_id(&pool, &state.store, fallback).await
        {
            Ok(()) => {
                update_active_snapshot(&state, fallback);
                tracing::info!(
                    target: "arklowdun",
                    event = "household_active_switched",
                    household_id = %fallback,
                    result = "ok",
                    reason = "resume_delete_active_fallback"
                );
                if let Err(err) = app.emit("household:changed", json!({ "id": fallback.clone() })) {
                    tracing::warn!(
                        target: "arklowdun",
                        event = "household_event_emit_failed",
                        household_id = %fallback,
                        result = "error",
                        error = %err
                    );
                }
            }
            Err(err) => {
                tracing::warn!(
                    target: "arklowdun",
                    event = "household_active_switch_failed",
                    reason = "resume_delete_active_fallback",
                    household_id = %fallback,
                    result = "error",
                    error = ?err
                );
            }
        }
    }

    if let Ok(Some(record)) = crate::household::get_household(&pool, &id).await {
        tracing::info!(
            target: "arklowdun",
            event = "household_delete_resume",
            household_id = %record.id,
            result = "ok",
            name = %record.name,
            color = record.color.as_deref().unwrap_or(""),
            was_active = outcome.was_active,
            fallback_id = outcome.fallback_id.as_deref()
        );
    }

    Ok(HouseholdDeleteResponse {
        fallback_id: outcome.fallback_id,
        total_deleted: outcome.total_deleted,
        total_expected: outcome.total_expected,
        vacuum_recommended: outcome.vacuum_recommended,
        completed: outcome.completed,
    })
}

#[tauri::command]
async fn household_repair<R: tauri::Runtime>(
    id: String,
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
) -> AppResult<HouseholdDeleteResponse> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    let fk_rows = sqlx::query("PRAGMA foreign_key_check;")
        .fetch_all(&pool)
        .await
        .map_err(|err| AppError::from(err).with_context("operation", "household_repair_fk"))?;
    if !fk_rows.is_empty() {
        tracing::warn!(
            target: "arklowdun",
            event = "household_repair_fk_failed",
            household_id = %id,
            result = "error",
            offenders = fk_rows.len()
        );
        return Err(AppError::new(
            "DB_FOREIGN_KEY_VIOLATION",
            "Foreign key violations detected during repair.",
        ));
    }

    update_cascade_health_cache(&state, &[id.clone()])?;
    let active = snapshot_active_id(&state);
    let progress_handler = make_delete_progress_handler(&app, &id);
    let mut options = CascadeDeleteOptions::default();
    options.progress = Some(progress_handler);
    options.max_duration_ms = Some(2_000);
    options.resume = true;
    let outcome =
        match crate::household::resume_household_delete(&pool, &id, active.as_deref(), options)
            .await
        {
            Ok(outcome) => outcome,
            Err(err) => {
                let reason = match &err {
                    crate::household::HouseholdCrudError::DefaultUndeletable => "default",
                    crate::household::HouseholdCrudError::NotFound => "not_found",
                    crate::household::HouseholdCrudError::Deleted => "already_deleted",
                    crate::household::HouseholdCrudError::InvalidColor => "invalid_color",
                    crate::household::HouseholdCrudError::Unexpected(_) => "unexpected",
                };
                tracing::warn!(
                    target: "arklowdun",
                    event = "household_repair_failed",
                    household_id = %id,
                    result = "error",
                    reason
                );
                return Err(map_household_crud_error(err));
            }
        };

    sync_cascade_health(&state, &pool).await?;

    if let Some(ref fallback) = outcome.fallback_id {
        match crate::household_active::set_active_household_id(&pool, &state.store, fallback).await
        {
            Ok(()) => {
                update_active_snapshot(&state, fallback);
                tracing::info!(
                    target: "arklowdun",
                    event = "household_active_switched",
                    household_id = %fallback,
                    result = "ok",
                    reason = "repair_delete_active_fallback"
                );
                if let Err(err) = app.emit("household:changed", json!({ "id": fallback.clone() })) {
                    tracing::warn!(
                        target: "arklowdun",
                        event = "household_event_emit_failed",
                        household_id = %fallback,
                        result = "error",
                        error = %err
                    );
                }
            }
            Err(err) => {
                tracing::warn!(
                    target: "arklowdun",
                    event = "household_active_switch_failed",
                    reason = "repair_delete_active_fallback",
                    household_id = %fallback,
                    result = "error",
                    error = ?err
                );
            }
        }
    }

    if let Ok(Some(record)) = crate::household::get_household(&pool, &id).await {
        tracing::info!(
            target: "arklowdun",
            event = "household_delete_repair",
            household_id = %record.id,
            result = "ok",
            name = %record.name,
            color = record.color.as_deref().unwrap_or(""),
            was_active = outcome.was_active,
            fallback_id = outcome.fallback_id.as_deref()
        );
    }

    Ok(HouseholdDeleteResponse {
        fallback_id: outcome.fallback_id,
        total_deleted: outcome.total_deleted,
        total_expected: outcome.total_expected,
        vacuum_recommended: outcome.vacuum_recommended,
        completed: outcome.completed,
    })
}

#[tauri::command]
async fn household_vacuum_execute(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    let queue = crate::household::vacuum_queue(&pool)
        .await
        .map_err(map_household_crud_error)?;
    if !queue.iter().any(|entry| entry.household_id == id) {
        return Err(AppError::new(
            "VACUUM_NOT_QUEUED",
            "No vacuum task is queued for this household.",
        ));
    }

    sqlx::query("VACUUM;")
        .execute(&pool)
        .await
        .map_err(|err| AppError::from(err).with_context("operation", "household_vacuum"))?;
    crate::household::acknowledge_vacuum(&pool, &id)
        .await
        .map_err(map_household_crud_error)?;
    sync_cascade_health(&state, &pool).await?;
    tracing::info!(
        target: "arklowdun",
        event = "household_delete_vacuum",
        household_id = %id
    );
    Ok(())
}

#[tauri::command]
async fn household_restore(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<crate::household::HouseholdRecord> {
    let _permit = guard::ensure_db_writable(&state)?;
    let pool = state.pool_clone();
    let record = dispatch_async_app_result(move || {
        let pool = pool.clone();
        let id = id.clone();
        async move {
            crate::household::restore_household(&pool, &id)
                .await
                .map_err(map_household_crud_error)
        }
    })
    .await?;

    tracing::info!(
        target: "arklowdun",
        event = "household_restore",
        household_id = %record.id,
        result = "ok",
        name = %record.name,
        color = record.color.as_deref().unwrap_or("")
    );

    Ok(record)
}

#[tauri::command]
async fn household_set_active<R: tauri::Runtime>(
    id: String,
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, state::AppState>,
) -> AppResult<()> {
    let pool = state.pool_clone();
    let store = state.store.clone();
    if snapshot_active_id(&state).as_deref() == Some(id.as_str()) {
        tracing::warn!(
            target: "arklowdun",
            event = "household_set_active",
            household_id = %id,
            result = "error",
            reason = "already_active",
            error_code = "HOUSEHOLD_ALREADY_ACTIVE"
        );
        return Err(AppError::new(
            "HOUSEHOLD_ALREADY_ACTIVE",
            "Household is already active.",
        ));
    }

    match crate::household_active::set_active_household_id(&pool, &store, &id).await {
        Ok(()) => {
            update_active_snapshot(&state, &id);
            if let Some(record) = crate::household::get_household(&pool, &id)
                .await
                .map_err(map_household_crud_error)?
            {
                tracing::info!(
                    target: "arklowdun",
                    event = "household_set_active",
                    household_id = %record.id,
                    result = "ok",
                    name = %record.name,
                    color = record.color.as_deref().unwrap_or("")
                );
            }
            if let Err(err) = app.emit("household:changed", json!({ "id": id.clone() })) {
                tracing::warn!(
                    target = "arklowdun",
                    event = "household_event_emit_failed",
                    household_id = %id,
                    result = "error",
                    error = %err
                );
            }
            Ok(())
        }
        Err(ActiveSetError::NotFound) => {
            tracing::warn!(
                target: "arklowdun",
                event = "household_set_active",
                household_id = %id,
                result = "error",
                reason = "not_found",
                error_code = "HOUSEHOLD_NOT_FOUND"
            );
            Err(AppError::new("HOUSEHOLD_NOT_FOUND", "Household not found."))
        }
        Err(ActiveSetError::Deleted) => {
            tracing::warn!(
                target: "arklowdun",
                event = "household_set_active",
                household_id = %id,
                result = "error",
                reason = "deleted",
                error_code = "HOUSEHOLD_DELETED"
            );
            Err(AppError::new("HOUSEHOLD_DELETED", "Household is deleted."))
        }
    }
}

#[tauri::command]
async fn household_list_all(state: State<'_, AppState>) -> AppResult<Vec<HouseholdSummary>> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let pool = pool.clone();
        async move {
            sqlx::query_as::<_, HouseholdSummary>(
                r#"
        SELECT id,
               name,
               CASE WHEN is_default = 1 THEN 1 ELSE 0 END AS is_default,
               tz,
               color
          FROM household
         WHERE deleted_at IS NULL
         ORDER BY is_default DESC, name COLLATE NOCASE, id
        "#,
            )
            .fetch_all(&pool)
            .await
            .map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "household_list_all")
                    .with_context("table", "household")
            })
        }
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportArgs {
    #[serde(alias = "household_id")]
    household_id: String,
    #[serde(alias = "dry_run")]
    dry_run: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportPreviewArgs {
    bundle_path: String,
    mode: import::plan::ImportMode,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportExecuteArgs {
    bundle_path: String,
    mode: import::plan::ImportMode,
    expected_plan_digest: String,
}

#[tauri::command]
async fn import_run_legacy<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    args: ImportArgs,
) -> AppResult<()> {
    let _permit = guard::ensure_db_writable(&state)?;
    let app = app.clone();
    dispatch_async_app_result(move || async move {
        let household_id = args.household_id;
        let dry_run = args.dry_run;
        importer::run_import(&app, household_id.clone(), dry_run)
            .await
            .map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "import_run_legacy")
                    .with_context("household_id", household_id)
                    .with_context("dry_run", dry_run.to_string())
            })
    })
    .await
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewDto {
    pub bundle_path: String,
    pub mode: import::plan::ImportMode,
    pub validation: import::validator::ValidationReport,
    pub plan: import::plan::ImportPlan,
    pub plan_digest: String,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ImportExecuteDto {
    pub bundle_path: String,
    pub mode: import::plan::ImportMode,
    pub validation: import::validator::ValidationReport,
    pub plan: import::plan::ImportPlan,
    pub plan_digest: String,
    pub execution: import::execute::ExecutionReport,
    pub report_path: String,
}

#[tauri::command]
async fn db_import_preview(
    state: State<'_, AppState>,
    args: ImportPreviewArgs,
) -> AppResult<ImportPreviewDto> {
    let ImportPreviewArgs { bundle_path, mode } = args;
    let pool = state.pool_clone();
    let db_path = (*state.db_path).clone();
    let (target_root, _) = resolve_import_paths(&db_path);
    let vault = state.vault();
    dispatch_async_app_result(move || {
        let pool = pool.clone();
        let target_root = target_root.clone();
        let vault = vault.clone();
        let bundle_path_buf = PathBuf::from(bundle_path.clone());
        async move {
            let result: AnyResult<ImportPreviewDto> = async {
                let bundle = import::bundle::ImportBundle::load(&bundle_path_buf)
                    .map_err(anyhow::Error::new)
                    .context("load import bundle")?;
                let minimum_version = Version::parse(import::MIN_SUPPORTED_APP_VERSION)
                    .context("parse minimum supported app version")?;
                let validation_ctx = import::validator::ValidationContext {
                    pool: &pool,
                    target_root: target_root.as_path(),
                    minimum_app_version: &minimum_version,
                    available_space_override: None,
                };
                let validation = import::validate_bundle(&bundle, &validation_ctx)
                    .await
                    .map_err(anyhow::Error::new)
                    .context("validate import bundle")?;
                let plan_ctx = import::plan::PlanContext {
                    pool: &pool,
                    vault: vault.clone(),
                };
                let plan = import::build_plan(&bundle, &plan_ctx, mode)
                    .await
                    .map_err(anyhow::Error::new)
                    .context("build import plan")?;
                let plan_digest = compute_plan_digest(&plan)?;
                Ok(ImportPreviewDto {
                    bundle_path: bundle_path_buf.display().to_string(),
                    mode,
                    validation,
                    plan,
                    plan_digest,
                })
            }
            .await;
            result.map_err(AppError::from)
        }
    })
    .await
}

#[tauri::command]
async fn db_import_execute(
    state: State<'_, AppState>,
    args: ImportExecuteArgs,
) -> AppResult<ImportExecuteDto> {
    let _permit = guard::ensure_db_writable(&state)?;
    let ImportExecuteArgs {
        bundle_path,
        mode,
        expected_plan_digest,
    } = args;
    let pool = state.pool_clone();
    let db_path = (*state.db_path).clone();
    let (target_root, reports_dir) = resolve_import_paths(&db_path);
    let vault = state.vault();
    dispatch_async_app_result(move || {
        let pool = pool.clone();
        let target_root = target_root.clone();
        let vault = vault.clone();
        let reports_dir = reports_dir.clone();
        let expected_digest = expected_plan_digest.clone();
        let bundle_path_buf = PathBuf::from(bundle_path.clone());
        async move {
            let result: AnyResult<ImportExecuteDto> = async {
                let bundle = import::bundle::ImportBundle::load(&bundle_path_buf)
                    .map_err(anyhow::Error::new)
                    .context("load import bundle")?;
                let minimum_version = Version::parse(import::MIN_SUPPORTED_APP_VERSION)
                    .context("parse minimum supported app version")?;
                let validation_ctx = import::validator::ValidationContext {
                    pool: &pool,
                    target_root: target_root.as_path(),
                    minimum_app_version: &minimum_version,
                    available_space_override: None,
                };
                let validation = import::validate_bundle(&bundle, &validation_ctx)
                    .await
                    .map_err(anyhow::Error::new)
                    .context("validate import bundle")?;
                let plan_ctx = import::plan::PlanContext {
                    pool: &pool,
                    vault: vault.clone(),
                };
                let plan = import::build_plan(&bundle, &plan_ctx, mode)
                    .await
                    .map_err(anyhow::Error::new)
                    .context("build import plan")?;
                let plan_digest = compute_plan_digest(&plan)?;
                if plan_digest != expected_digest {
                    anyhow::bail!(
                        "Import plan changed after preview. Run a new dry-run before importing."
                    );
                }
                std::fs::create_dir_all(vault.base()).with_context(|| {
                    format!("create attachments directory {}", vault.base().display())
                })?;
                let exec_ctx = import::execute::ExecutionContext::new(&pool, vault.clone());
                let execution = import::execute::execute_plan(&bundle, &plan, &exec_ctx)
                    .await
                    .map_err(anyhow::Error::new)
                    .context("execute import plan")?;
                let report_path = import::write_import_report(
                    &reports_dir,
                    &bundle_path_buf,
                    &validation,
                    &plan,
                    &execution,
                )
                .context("write import report")?;
                Ok(ImportExecuteDto {
                    bundle_path: bundle_path_buf.display().to_string(),
                    mode,
                    validation,
                    plan,
                    plan_digest,
                    execution,
                    report_path: report_path.display().to_string(),
                })
            }
            .await;
            result.map_err(AppError::from)
        }
    })
    .await
}

fn resolve_import_paths(db_path: &Path) -> (PathBuf, PathBuf) {
    let target_root = db_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let reports_dir = target_root.join("reports");
    (target_root, reports_dir)
}

fn compute_plan_digest(plan: &import::plan::ImportPlan) -> AnyResult<String> {
    let json = serde_json::to_vec(plan).context("serialize import plan for digest")?;
    let mut hasher = Sha256::new();
    hasher.update(&json);
    Ok(format!("{:x}", hasher.finalize()))
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(tag = "kind")]
pub enum SearchResult {
    File {
        id: String,
        filename: String,
        #[ts(type = "number")]
        updated_at: i64,
    },
    Event {
        id: String,
        title: String,
        #[ts(type = "number")]
        start_at_utc: i64,
        tz: String,
    },
    Note {
        id: String,
        snippet: String,
        #[ts(type = "number")]
        updated_at: i64,
        color: String,
    },
    Vehicle {
        id: String,
        make: String,
        model: String,
        reg: String,
        #[ts(type = "number")]
        updated_at: i64,
        nickname: String,
    },
    Pet {
        id: String,
        name: String,
        species: String,
        #[ts(type = "number")]
        updated_at: i64,
    },
}

#[derive(Serialize, Deserialize)]
pub struct SearchErrorPayload {
    pub code: String,
    pub message: String,
    pub details: serde_json::Value,
}

async fn table_exists(pool: &sqlx::SqlitePool, name: &str) -> bool {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name=?1",
    )
    .bind(name)
    .fetch_one(pool)
    .await
    .unwrap_or(0)
        > 0
}

async fn files_index_ready(pool: &sqlx::SqlitePool, household_id: &str) -> bool {
    if !table_exists(pool, "files_index").await
        || !table_exists(pool, "files_index_meta").await
        || !table_exists(pool, "files").await
    {
        return false;
    }

    let meta = match sqlx::query(
        "SELECT source_row_count, source_max_updated_utc, version FROM files_index_meta WHERE household_id=?1",
    )
    .bind(household_id)
    .fetch_optional(pool)
    .await
    {
        Ok(Some(row)) => {
            let source_row_count: i64 = row.try_get("source_row_count").unwrap_or_default();
            let source_max_updated_utc: String =
                row.try_get("source_max_updated_utc").unwrap_or_default();
            let version: i64 = row.try_get("version").unwrap_or(0);
            Some((source_row_count, source_max_updated_utc, version))
        }
        Ok(None) => None,
        Err(_) => return false,
    };

    let meta = match meta {
        Some((count_m, max_updated_m, ver)) if ver == FILES_INDEX_VERSION => {
            (count_m, max_updated_m)
        }
        _ => return false,
    };

    let count: i64 =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM files WHERE household_id=?1")
            .bind(household_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

    let max_updated: String = sqlx::query_scalar::<_, String>(
        "SELECT COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', MAX(updated_at), 'unixepoch'), '1970-01-01T00:00:00Z') FROM files WHERE household_id=?1",
    )
    .bind(household_id)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into());

    // Rebuild tooling must persist `source_max_updated_utc` using the same strftime format
    meta.0 == count && meta.1 == max_updated
}

#[tauri::command]
async fn db_table_exists(state: State<'_, AppState>, name: String) -> AppResult<bool> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || async move { Ok(table_exists(&pool, &name).await) }).await
}

#[tauri::command]
async fn db_has_files_index(state: State<'_, AppState>) -> AppResult<bool> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || async move { Ok(table_exists(&pool, "files_index").await) })
        .await
}

#[tauri::command]
async fn db_files_index_ready(state: State<'_, AppState>, household_id: String) -> AppResult<bool> {
    let pool = state.pool_clone();
    dispatch_async_app_result(
        move || async move { Ok(files_index_ready(&pool, &household_id).await) },
    )
    .await
}

#[tauri::command]
async fn db_has_vehicle_columns(state: State<'_, AppState>) -> AppResult<bool> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || async move {
        if !table_exists(&pool, "vehicles").await {
            return Ok(false);
        }
        let cols = table_columns(&pool, "vehicles").await;
        Ok(cols.contains("reg")
            || cols.contains("registration")
            || cols.contains("plate")
            || cols.contains("nickname")
            || cols.contains("name"))
    })
    .await
}

#[tauri::command]
async fn db_has_pet_columns(state: State<'_, AppState>) -> AppResult<bool> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || async move {
        if !table_exists(&pool, "pets").await {
            return Ok(false);
        }
        let cols = table_columns(&pool, "pets").await;
        Ok(cols.contains("name") || cols.contains("species") || cols.contains("type"))
    })
    .await
}

/// Surface the cached database health report over IPC using the
/// `db_get_health_report` command string consumed by the frontend.
#[tauri::command]
async fn db_get_health_report(state: State<'_, AppState>) -> AppResult<DbHealthReport> {
    let report = state
        .db_health
        .lock()
        .map_err(|_| {
            AppError::new(
                "STATE/LOCK_POISONED",
                "Failed to access database health cache",
            )
        })?
        .clone();
    Ok(report)
}

/// Re-run the database health checks and return the fresh report via the
/// `db_recheck` IPC command used by the UI.
#[tauri::command]
async fn db_recheck(state: State<'_, AppState>) -> AppResult<DbHealthReport> {
    let pool = state.pool_clone();
    let db_path = state.db_path.clone();
    let cache = state.db_health.clone();
    dispatch_async_app_result(move || {
        let db_path = db_path.clone();
        let cache = cache.clone();
        async move {
            let report = crate::db::health::run_health_checks(&pool, &db_path)
                .await
                .map_err(|err| AppError::from(err).with_context("operation", "db_recheck"))?;
            log_db_health(&report);
            let mut guard = cache.lock().map_err(|_| {
                AppError::new(
                    "STATE/LOCK_POISONED",
                    "Failed to update database health cache",
                )
            })?;
            *guard = report.clone();
            Ok(report)
        }
    })
    .await
}

fn log_db_health(report: &DbHealthReport) {
    if matches!(report.status, DbHealthStatus::Ok) {
        if storage_sanity_was_healed(report) {
            tracing::info!(
                target: "arklowdun",
                "[DB_HEALTH_OK] storage_sanity healed after checkpoint"
            );
        } else {
            tracing::info!(target: "arklowdun", "[DB_HEALTH_OK]");
        }
    } else {
        tracing::warn!(
            target: "arklowdun",
            event = "db_health_failed",
            status = ?report.status
        );
    }
}

fn storage_sanity_was_healed(report: &DbHealthReport) -> bool {
    report
        .checks
        .iter()
        .find(|check| check.name == "storage_sanity")
        .and_then(|check| check.details.as_deref())
        .map(|details| details.contains(STORAGE_SANITY_HEAL_NOTE))
        .unwrap_or(false)
}

/// Return the set of column names for a given table.
async fn table_columns(pool: &sqlx::SqlitePool, table: &str) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    // NOTE: using a literal table name; NOT user-provided.
    // PRAGMA returns an error when the table is missing or the DB is malformed; that's expected.
    // In those cases we swallow the error and return an empty set silently.
    let sql = format!("PRAGMA table_info({})", table);
    if let Ok(rows) = sqlx::query(&sql).fetch_all(pool).await {
        for r in rows {
            if let Ok(name) = r.try_get::<String, _>("name") {
                out.insert(name);
            }
        }
    }
    out
}

/// Build a COALESCE(expr...) using only the columns that actually exist.
/// If none of the candidates exist, returns the provided default literal.
/// `default_literal` should already be a valid SQL literal (e.g. '' or 0).
fn coalesce_expr(
    existing: &std::collections::HashSet<String>,
    candidates: &[&str],
    default_literal: &str,
) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for c in candidates {
        if existing.contains(*c) {
            parts.push(c);
        }
    }
    if parts.is_empty() {
        default_literal.to_string()
    } else if parts.len() == 1 {
        parts[0].to_string()
    } else {
        format!("COALESCE({})", parts.join(", "))
    }
}

fn like_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[tauri::command]
async fn search_entities(
    state: State<'_, AppState>,
    household_id: String,
    query: String,
    limit: i64,
    offset: i64,
) -> AppResult<Vec<SearchResult>> {
    use sqlx::Row;
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let household_id = household_id;
        let query = query;
        let pool = pool.clone();
        async move {
            let pool = &pool;

            if household_id.trim().is_empty() {
                return Err(AppError::new("BAD_REQUEST", "household_id is required"));
            }
            if !(1..=100).contains(&limit) || offset < 0 {
                return Err(AppError::new("BAD_REQUEST", "invalid limit/offset")
                    .with_context("limit", limit.to_string())
                    .with_context("offset", offset.to_string()));
            }

            let q = query.trim().to_string();
            tracing::debug!(target: "arklowdun", household_id = %household_id, q = %q, limit, offset, "search_invoke");
            if q.is_empty() {
                return Ok(vec![]);
            }
            let esc = like_escape(&q);
            let prefix = format!("{esc}%");
            let sub = format!("%{esc}%");
            let branch_limit = (limit + offset).min(200);

            let index_ready = files_index_ready(pool, &household_id).await;
            let has_files_table = table_exists(pool, "files").await;

            let has_events = table_exists(pool, "events").await;
            if !has_events {
                tracing::debug!(target: "arklowdun", name = "events", "missing_table");
            }
            let has_notes = table_exists(pool, "notes").await;
            if !has_notes {
                tracing::debug!(target: "arklowdun", name = "notes", "missing_table");
            }
            let has_vehicles = table_exists(pool, "vehicles").await;
            if !has_vehicles {
                tracing::debug!(target: "arklowdun", name = "vehicles", "missing_table");
            }
            let has_pets = table_exists(pool, "pets").await;
            if !has_pets {
                tracing::debug!(target: "arklowdun", name = "pets", "missing_table");
            }

            let short = q.len() < 2;
            if short && !(index_ready || has_files_table) {
                tracing::debug!(target: "arklowdun", q = %q, len = q.len(), "short_query_bypass");
                return Ok(vec![]);
            }

            let mapq = |branch: &str, e: sqlx::Error| {
                AppError::from(e)
                    .with_context("operation", "search_query")
                    .with_context("branch", branch.to_string())
            };

            let mut out: Vec<(i32, i64, usize, SearchResult)> = Vec::new();
            let mut ord: usize = 0;

            if index_ready || has_files_table {
                let (sql, branch_name) = if index_ready {
                    (
                        "SELECT file_id AS id, filename, strftime('%s', updated_at_utc) AS ts, ordinal AS ord FROM files_index\n     WHERE household_id=?1 AND filename LIKE ?2 ESCAPE '\\' COLLATE NOCASE LIMIT ?3 OFFSET ?4",
                        "files_index",
                    )
                } else {
                    (
                        "SELECT id, filename, updated_at AS ts, rowid AS ord FROM files\n             WHERE household_id=?1 AND filename LIKE ?2 ESCAPE '\\' COLLATE NOCASE ORDER BY rowid ASC LIMIT ?3 OFFSET ?4",
                        "files",
                    )
                };
                let start = std::time::Instant::now();
                let rows = sqlx::query(sql)
                    .bind(&household_id)
                    .bind(&prefix)
                    .bind(branch_limit)
                    .bind(0)
                    .fetch_all(pool)
                    .await
                    .map_err(|e| mapq(branch_name, e))?;
                let elapsed = start.elapsed().as_millis() as i64;
                tracing::debug!(target: "arklowdun", name = branch_name, rows = rows.len(), elapsed_ms = elapsed, "branch");
                for r in rows {
                    let filename: String = r.try_get("filename").unwrap_or_default();
                    let ts: i64 = r.try_get("ts").unwrap_or_default();
                    let ord_val: i64 = r.try_get("ord").unwrap_or_default();
                    let score = if filename.eq_ignore_ascii_case(&q) { 2 } else { 1 };
                    let id: String = r.try_get("id").unwrap_or_default();
                    out.push((
                        score,
                        ts,
                        ord_val as usize,
                        SearchResult::File {
                            id,
                            filename,
                            updated_at: ts,
                        },
                    ));
                }
            }

            if !short {
                if has_events {
                    let start = std::time::Instant::now();
                    let events = sqlx::query(
                        "SELECT id, title, start_at_utc AS ts, COALESCE(tz,'Europe/London') AS tz\n         FROM events\n         WHERE household_id=?1 AND title LIKE ?2 ESCAPE '\\' COLLATE NOCASE\n         ORDER BY title ASC LIMIT ?3 OFFSET ?4",
                    )
                    .bind(&household_id)
                    .bind(&sub)
                    .bind(branch_limit)
                    .bind(0)
                    .fetch_all(pool)
                    .await
                    .map_err(|e| mapq("events", e))?;
                    let elapsed = start.elapsed().as_millis() as i64;
                    tracing::debug!(target: "arklowdun", name = "events", rows = events.len(), elapsed_ms = elapsed, "branch");
                    for r in events {
                        let title: String = r.try_get("title").unwrap_or_default();
                        let ts: i64 = r.try_get("ts").unwrap_or_default();
                        let tz: String = r.try_get("tz").unwrap_or_else(|_| "Europe/London".to_string());
                        let score = if title.eq_ignore_ascii_case(&q) { 2 } else { 1 };
                        let id: String = r.try_get("id").unwrap_or_default();
                        out.push((
                            score,
                            ts,
                            ord,
                            SearchResult::Event {
                                id,
                                title,
                                start_at_utc: ts,
                                tz,
                            },
                        ));
                        ord += 1;
                    }
                }

                if has_notes {
                    let start = std::time::Instant::now();
                    let notes = sqlx::query(
                        "SELECT id, text, updated_at AS ts, COALESCE(color,'') AS color\n         FROM notes\n         WHERE household_id=?1 AND text LIKE ?2 ESCAPE '\\' COLLATE NOCASE\n         ORDER BY ts DESC LIMIT ?3 OFFSET ?4",
                    )
                    .bind(&household_id)
                    .bind(&sub)
                    .bind(branch_limit)
                    .bind(0)
                    .fetch_all(pool)
                    .await
                    .map_err(|e| mapq("notes", e))?;
                    let elapsed = start.elapsed().as_millis() as i64;
                    tracing::debug!(target: "arklowdun", name = "notes", rows = notes.len(), elapsed_ms = elapsed, "branch");
                    for r in notes {
                        let text: String = r.try_get("text").unwrap_or_default();
                        let ts: i64 = r.try_get("ts").unwrap_or_default();
                        let color: String = r.try_get("color").unwrap_or_default();
                        let score = if text.eq_ignore_ascii_case(&q) { 2 } else { 1 };
                        let snippet: String = text.chars().take(80).collect();
                        let id: String = r.try_get("id").unwrap_or_default();
                        out.push((
                            score,
                            ts,
                            ord,
                            SearchResult::Note {
                                id,
                                snippet,
                                updated_at: ts,
                                color,
                            },
                        ));
                        ord += 1;
                    }
                }

                if has_vehicles {
                    let start = std::time::Instant::now();
                    let vcols = table_columns(pool, "vehicles").await;
                    let reg_expr = coalesce_expr(&vcols, &["reg", "registration", "plate"], "''");
                    let nick_expr = coalesce_expr(&vcols, &["nickname", "name"], "''");
                    let ts_expr = coalesce_expr(&vcols, &["updated_at", "created_at"], "0");

                    let make_expr = if vcols.contains("make") {
                        "COALESCE(make,'')"
                    } else {
                        "''"
                    };
                    let model_expr = if vcols.contains("model") {
                        "COALESCE(model,'')"
                    } else {
                        "''"
                    };

                    let sql = format!(
                        "SELECT id, {make_expr} AS make, {model_expr} AS model, {reg_expr} AS reg, {nick_expr} AS nickname, {ts_expr} AS ts \
                 FROM vehicles \
                 WHERE household_id=?1 AND ( \
                     {make_expr} LIKE ?2 ESCAPE '\\' COLLATE NOCASE OR \
                     {model_expr} LIKE ?2 ESCAPE '\\' COLLATE NOCASE OR \
                     {reg_expr}   LIKE ?2 ESCAPE '\\' COLLATE NOCASE OR \
                     {nick_expr}  LIKE ?2 ESCAPE '\\' COLLATE NOCASE \
                 ) \
                 ORDER BY ts DESC LIMIT ?3 OFFSET ?4",
                        make_expr = make_expr,
                        model_expr = model_expr,
                        reg_expr = reg_expr,
                        nick_expr = nick_expr,
                        ts_expr = ts_expr,
                    );

                    let rows = sqlx::query(&sql)
                        .bind(&household_id)
                        .bind(&sub)
                        .bind(branch_limit)
                        .bind(0)
                        .fetch_all(pool)
                        .await
                        .map_err(|e| mapq("vehicles", e))?;
                    let elapsed = start.elapsed().as_millis() as i64;
                    tracing::debug!(target: "arklowdun", name = "vehicles", rows = rows.len(), elapsed_ms = elapsed, "branch");
                    for r in rows {
                        let make: String = r.try_get("make").unwrap_or_default();
                        let model: String = r.try_get("model").unwrap_or_default();
                        let reg: String = r.try_get("reg").unwrap_or_default();
                        let nickname: String = r.try_get("nickname").unwrap_or_default();
                        let ts: i64 = r.try_get("ts").unwrap_or_default();
                        let exact = |s: &str| !s.is_empty() && s.eq_ignore_ascii_case(&q);
                        let score = if exact(&make) || exact(&model) || exact(&reg) || exact(&nickname) {
                            2
                        } else {
                            1
                        };
                        let id: String = r.try_get("id").unwrap_or_default();
                        out.push((
                            score,
                            ts,
                            ord,
                            SearchResult::Vehicle {
                                id,
                                make,
                                model,
                                reg,
                                updated_at: ts,
                                nickname,
                            },
                        ));
                        ord += 1;
                    }
                }

                if has_pets {
                    let start = std::time::Instant::now();
                    let pcols = table_columns(pool, "pets").await;
                    let name_expr = if pcols.contains("name") {
                        "COALESCE(name,'')"
                    } else {
                        "''"
                    };
                    let species_expr = coalesce_expr(&pcols, &["species", "type"], "''");
                    let ts_expr = coalesce_expr(&pcols, &["updated_at", "created_at"], "0");

                    let sql = format!(
                        "SELECT id, {name_expr} AS name, {species_expr} AS species, {ts_expr} AS ts \
                 FROM pets \
                 WHERE household_id=?1 AND ( \
                     {name_expr}   LIKE ?2 ESCAPE '\\' COLLATE NOCASE OR \
                     {species_expr} LIKE ?2 ESCAPE '\\' COLLATE NOCASE \
                 ) \
                 ORDER BY ts DESC LIMIT ?3 OFFSET ?4",
                        name_expr = name_expr,
                        species_expr = species_expr,
                        ts_expr = ts_expr,
                    );

                    let rows = sqlx::query(&sql)
                        .bind(&household_id)
                        .bind(&sub)
                        .bind(branch_limit)
                        .bind(0)
                        .fetch_all(pool)
                        .await
                        .map_err(|e| mapq("pets", e))?;
                    let elapsed = start.elapsed().as_millis() as i64;
                    tracing::debug!(target: "arklowdun", name = "pets", rows = rows.len(), elapsed_ms = elapsed, "branch");
                    for r in rows {
                        let name: String = r.try_get("name").unwrap_or_default();
                        let species: String = r.try_get("species").unwrap_or_default();
                        let ts: i64 = r.try_get("ts").unwrap_or_default();
                        let score = if name.eq_ignore_ascii_case(&q) || species.eq_ignore_ascii_case(&q) {
                            2
                        } else {
                            1
                        };
                        let id: String = r.try_get("id").unwrap_or_default();
                        out.push((
                            score,
                            ts,
                            ord,
                            SearchResult::Pet {
                                id,
                                name,
                                species,
                                updated_at: ts,
                            },
                        ));
                        ord += 1;
                    }
                }
            }

            out.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)).then(a.2.cmp(&b.2)));
            let total_before = out.len();
            let out = out
                .into_iter()
                .skip(offset as usize)
                .take(limit as usize)
                .collect::<Vec<_>>();
            tracing::debug!(target: "arklowdun", total_before, returned = out.len(), "result_summary");

            Ok(out.into_iter().map(|(_, _, _, v)| v).collect())
        }
    })
    .await
}

async fn resolve_attachment_for_ipc_read(
    pool: &SqlitePool,
    active_household: &Arc<Mutex<String>>,
    vault: &Arc<Vault>,
    table: &str,
    id: &str,
    operation: &'static str,
) -> AppResult<PathBuf> {
    let descriptor = crate::attachments::load_attachment_descriptor(pool, table, id).await?;
    let table_value = table.to_string();
    let id_value = id.to_string();

    let crate::attachments::AttachmentDescriptor {
        household_id,
        category,
        relative_path,
    } = descriptor;

    ensure_active_household_for_ipc(
        active_household,
        &household_id,
        category,
        &relative_path,
        operation,
        table,
        Some(id),
    )?;

    let household_for_context = household_id.clone();
    vault
        .resolve(&household_id, category, &relative_path)
        .map_err(|err| {
            err.with_context("operation", operation)
                .with_context("table", table_value)
                .with_context("id", id_value)
                .with_context("household_id", household_for_context)
        })
}

fn ensure_active_household_for_ipc(
    active_household: &Arc<Mutex<String>>,
    expected: &str,
    category: AttachmentCategory,
    relative_for_log: &str,
    operation: &'static str,
    table: &str,
    id: Option<&str>,
) -> AppResult<()> {
    let current = active_household
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    if !current.is_empty() && current != expected {
        log_vault_error(
            expected,
            category,
            relative_for_log,
            crate::vault::ERR_INVALID_HOUSEHOLD,
            "ensure_active_household",
        );
        let relative_hash = hash_path(Path::new(relative_for_log));
        let mut err = AppError::new(
            crate::vault::ERR_INVALID_HOUSEHOLD,
            "Attachments belong to a different household.",
        )
        .with_context("operation", operation)
        .with_context("table", table.to_string())
        .with_context("household_id", expected.to_string())
        .with_context("category", category.as_str().to_string())
        .with_context("relative_path_hash", relative_hash)
        .with_context("guard_stage", "ensure_active_household".to_string());
        if let Some(id) = id {
            err = err.with_context("id", id.to_string());
        }
        return Err(err);
    }
    Ok(())
}

fn resolve_attachment_for_ipc_create(
    vault: &Arc<Vault>,
    active_household: &Arc<Mutex<String>>,
    table: &str,
    data: &Map<String, Value>,
    operation: &'static str,
) -> AppResult<Option<AttachmentMutationGuard>> {
    if !ATTACHMENT_TABLES.contains(&table) {
        return Ok(None);
    }

    let table_value = table.to_string();
    let household_raw = data
        .get("household_id")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                crate::vault::ERR_INVALID_HOUSEHOLD,
                "Attachments require a household id.",
            )
            .with_context("operation", operation)
            .with_context("table", table_value.clone())
        })?;
    let household_id = household_raw.to_string();

    let category_value = data
        .get("category")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                crate::vault::ERR_INVALID_CATEGORY,
                "Attachment category is required.",
            )
            .with_context("operation", operation)
            .with_context("table", table_value.clone())
            .with_context("household_id", household_id.clone())
        })?;
    let category = AttachmentCategory::from_str(category_value).map_err(|_| {
        AppError::new(
            crate::vault::ERR_INVALID_CATEGORY,
            "Attachment category is not supported.",
        )
        .with_context("operation", operation)
        .with_context("table", table_value.clone())
        .with_context("household_id", household_id.clone())
        .with_context("category", category_value.to_string())
    })?;

    let relative_for_log = data
        .get("relative_path")
        .and_then(Value::as_str)
        .unwrap_or_default();

    ensure_active_household_for_ipc(
        active_household,
        &household_id,
        category,
        relative_for_log,
        operation,
        &table_value,
        None,
    )?;

    let (normalized, resolved_path) = match data.get("relative_path") {
        Some(Value::Null) | None => (None, None),
        Some(Value::String(raw)) => {
            if raw.trim().is_empty() {
                (None, None)
            } else {
                let resolved = vault.resolve(&household_id, category, raw).map_err(|err| {
                    err.with_context("operation", operation)
                        .with_context("table", table_value.clone())
                        .with_context("household_id", household_id.clone())
                })?;
                let normalized = vault
                    .relative_from_resolved(&resolved, &household_id, category)
                    .ok_or_else(|| {
                        AppError::new(
                            crate::vault::ERR_PATH_OUT_OF_VAULT,
                            "Attachment path must stay inside the vault.",
                        )
                        .with_context("operation", operation)
                        .with_context("table", table_value.clone())
                        .with_context("household_id", household_id.clone())
                    })?;
                (Some(normalized), Some(resolved))
            }
        }
        Some(_) => {
            return Err(AppError::new(
                crate::vault::ERR_FILENAME_INVALID,
                "Attachment path must be a string.",
            )
            .with_context("operation", operation)
            .with_context("table", table_value)
            .with_context("household_id", household_id));
        }
    };

    Ok(Some(AttachmentMutationGuard::new(
        household_id,
        category,
        normalized,
        resolved_path,
    )))
}

async fn resolve_attachment_for_ipc_update(
    pool: &SqlitePool,
    vault: &Arc<Vault>,
    active_household: &Arc<Mutex<String>>,
    table: &str,
    id: &str,
    household_id: Option<&str>,
    data: &Map<String, Value>,
    operation: &'static str,
) -> AppResult<Option<AttachmentMutationGuard>> {
    if !ATTACHMENT_TABLES.contains(&table) {
        return Ok(None);
    }

    let table_value = table.to_string();
    let id_value = id.to_string();

    let descriptor = crate::attachments::load_attachment_descriptor(pool, table, id)
        .await
        .map_err(|err| {
            err.with_context("operation", operation)
                .with_context("table", table_value.clone())
                .with_context("id", id_value.clone())
        })?;

    if let Some(expected) = household_id {
        if expected != descriptor.household_id {
            log_vault_error(
                &descriptor.household_id,
                descriptor.category,
                &descriptor.relative_path,
                crate::vault::ERR_INVALID_HOUSEHOLD,
                "ensure_update_household",
            );
            let relative_hash = hash_path(Path::new(&descriptor.relative_path));
            return Err(AppError::new(
                crate::vault::ERR_INVALID_HOUSEHOLD,
                "Attachments require a matching household id.",
            )
            .with_context("operation", operation)
            .with_context("table", table_value.clone())
            .with_context("id", id_value.clone())
            .with_context("household_id", expected.to_string())
            .with_context("category", descriptor.category.as_str().to_string())
            .with_context("relative_path_hash", relative_hash)
            .with_context("guard_stage", "ensure_update_household".to_string()));
        }
    }

    let mut category = descriptor.category;
    if let Some(value) = data.get("category") {
        match value {
            Value::String(raw) => {
                category = AttachmentCategory::from_str(raw).map_err(|_| {
                    AppError::new(
                        crate::vault::ERR_INVALID_CATEGORY,
                        "Attachment category is not supported.",
                    )
                    .with_context("operation", operation)
                    .with_context("table", table_value.clone())
                    .with_context("id", id_value.clone())
                    .with_context("household_id", descriptor.household_id.clone())
                    .with_context("category", raw.to_string())
                })?;
            }
            Value::Null => {
                return Err(AppError::new(
                    crate::vault::ERR_INVALID_CATEGORY,
                    "Attachment category is required.",
                )
                .with_context("operation", operation)
                .with_context("table", table_value.clone())
                .with_context("id", id_value.clone())
                .with_context("household_id", descriptor.household_id.clone()));
            }
            _ => {
                return Err(AppError::new(
                    crate::vault::ERR_INVALID_CATEGORY,
                    "Attachment category must be a string.",
                )
                .with_context("operation", operation)
                .with_context("table", table_value.clone())
                .with_context("id", id_value.clone())
                .with_context("household_id", descriptor.household_id.clone()));
            }
        }
    }

    let relative_for_log = data
        .get("relative_path")
        .and_then(Value::as_str)
        .unwrap_or(&descriptor.relative_path);

    ensure_active_household_for_ipc(
        active_household,
        &descriptor.household_id,
        category,
        relative_for_log,
        operation,
        &table_value,
        Some(&id_value),
    )?;

    let (normalized, resolved_path) = match data.get("relative_path") {
        Some(Value::Null) | None => (None, None),
        Some(Value::String(raw)) => {
            if raw.trim().is_empty() {
                (None, None)
            } else {
                let resolved = vault
                    .resolve(&descriptor.household_id, category, raw)
                    .map_err(|err| {
                        err.with_context("operation", operation)
                            .with_context("table", table_value.clone())
                            .with_context("id", id_value.clone())
                            .with_context("household_id", descriptor.household_id.clone())
                    })?;
                let normalized = vault
                    .relative_from_resolved(&resolved, &descriptor.household_id, category)
                    .ok_or_else(|| {
                        AppError::new(
                            crate::vault::ERR_PATH_OUT_OF_VAULT,
                            "Attachment path must stay inside the vault.",
                        )
                        .with_context("operation", operation)
                        .with_context("table", table_value.clone())
                        .with_context("id", id_value.clone())
                        .with_context("household_id", descriptor.household_id.clone())
                    })?;
                (Some(normalized), Some(resolved))
            }
        }
        Some(_) => {
            return Err(AppError::new(
                crate::vault::ERR_FILENAME_INVALID,
                "Attachment path must be a string.",
            )
            .with_context("operation", operation)
            .with_context("table", table_value.clone())
            .with_context("id", id_value.clone())
            .with_context("household_id", descriptor.household_id.clone()));
        }
    };

    Ok(Some(AttachmentMutationGuard::new(
        descriptor.household_id,
        category,
        normalized,
        resolved_path,
    )))
}

async fn resolve_attachment_for_ipc_delete(
    pool: &SqlitePool,
    vault: &Arc<Vault>,
    active_household: &Arc<Mutex<String>>,
    table: &str,
    household_id: &str,
    id: &str,
    operation: &'static str,
) -> AppResult<Option<AttachmentMutationGuard>> {
    if !ATTACHMENT_TABLES.contains(&table) {
        return Ok(None);
    }

    let table_value = table.to_string();
    let id_value = id.to_string();

    let descriptor = match crate::attachments::load_attachment_descriptor(pool, table, id).await {
        Ok(descriptor) => descriptor,
        Err(err) => {
            if err.code() == "IO/ENOENT" {
                return Ok(None);
            }
            return Err(err
                .with_context("operation", operation)
                .with_context("table", table_value)
                .with_context("id", id_value));
        }
    };

    if descriptor.household_id != household_id {
        log_vault_error(
            &descriptor.household_id,
            descriptor.category,
            &descriptor.relative_path,
            crate::vault::ERR_INVALID_HOUSEHOLD,
            "ensure_delete_household",
        );
        let relative_hash = hash_path(Path::new(&descriptor.relative_path));
        return Err(AppError::new(
            crate::vault::ERR_INVALID_HOUSEHOLD,
            "Attachments require a matching household id.",
        )
        .with_context("operation", operation)
        .with_context("table", table.to_string())
        .with_context("id", id.to_string())
        .with_context("household_id", household_id.to_string())
        .with_context("category", descriptor.category.as_str().to_string())
        .with_context("relative_path_hash", relative_hash)
        .with_context("guard_stage", "ensure_delete_household".to_string()));
    }

    ensure_active_household_for_ipc(
        active_household,
        &descriptor.household_id,
        descriptor.category,
        &descriptor.relative_path,
        operation,
        table,
        Some(id),
    )?;

    let resolved = vault
        .resolve(
            &descriptor.household_id,
            descriptor.category,
            &descriptor.relative_path,
        )
        .map_err(|err| {
            err.with_context("operation", operation)
                .with_context("table", table.to_string())
                .with_context("id", id.to_string())
                .with_context("household_id", descriptor.household_id.clone())
        })?;

    Ok(Some(AttachmentMutationGuard::new(
        descriptor.household_id,
        descriptor.category,
        Some(descriptor.relative_path),
        Some(resolved),
    )))
}

#[tauri::command]
async fn attachment_open<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    state: tauri::State<'_, crate::state::AppState>,
    table: String,
    id: String,
) -> AppResult<()> {
    let pool = state.pool_clone();
    let vault = state.vault();
    let active_household = state.active_household_id.clone();
    dispatch_async_app_result(move || {
        let table = table;
        let id = id;
        let vault = vault;
        let active_household = active_household.clone();
        async move {
            let resolved = resolve_attachment_for_ipc_read(
                &pool,
                &active_household,
                &vault,
                &table,
                &id,
                "attachment_open",
            )
            .await?;
            crate::attachments::open_with_os(&resolved)
        }
    })
    .await
}

#[tauri::command]
async fn attachment_reveal<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    state: tauri::State<'_, crate::state::AppState>,
    table: String,
    id: String,
) -> AppResult<()> {
    let pool = state.pool_clone();
    let vault = state.vault();
    let active_household = state.active_household_id.clone();
    dispatch_async_app_result(move || {
        let table = table;
        let id = id;
        let vault = vault;
        let active_household = active_household.clone();
        async move {
            let resolved = resolve_attachment_for_ipc_read(
                &pool,
                &active_household,
                &vault,
                &table,
                &id,
                "attachment_reveal",
            )
            .await?;
            crate::attachments::reveal_with_os(&resolved)
        }
    })
    .await
}

#[tauri::command]
async fn attachments_migration_status(
    state: tauri::State<'_, crate::state::AppState>,
) -> AppResult<MigrationProgress> {
    Ok(state.vault_migration().status())
}

#[tauri::command]
async fn attachments_migrate<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, crate::state::AppState>,
    mode: MigrationMode,
) -> AppResult<MigrationProgress> {
    let pool = state.pool_clone();
    let vault = state.vault();
    let manager = state.vault_migration();
    dispatch_async_app_result(move || {
        let app = app.clone();
        let manager = manager.clone();
        async move { vault_migration::run_vault_migration(app, pool, vault, manager, mode).await }
    })
    .await
}

#[tauri::command]
async fn open_path<R: tauri::Runtime>(app: tauri::AppHandle<R>, path: String) -> AppResult<()> {
    let app = app.clone();
    dispatch_async_app_result(move || {
        let path = path;
        async move {
            let root = RootKey::AppData;
            let res = match fs_policy::canonicalize_and_verify(&path, root, &app) {
                Ok(r) => r,
                Err(e) => {
                    let reason = e.name();
                    let ui: UiError = e.into();
                    log_fs_deny(root, &ui, reason);
                    return Err(AppError::from(ui)
                        .with_context("operation", "open_path")
                        .with_context("path", path.clone()));
                }
            };
            if let Err(e) = fs_policy::reject_symlinks(&res.real_path) {
                let reason = e.name();
                let ui: UiError = e.into();
                log_fs_deny(root, &ui, reason);
                return Err(AppError::from(ui)
                    .with_context("operation", "open_path")
                    .with_context("path", path.clone()));
            }
            log_fs_ok(root, &res.real_path);
            crate::attachments::open_with_os(&res.real_path)
        }
    })
    .await
}

#[tauri::command]
async fn diagnostics_summary<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> AppResult<diagnostics::Summary> {
    let app = app.clone();
    dispatch_async_app_result(move || {
        let app = app;
        async move {
            crate::flush_file_logs();
            diagnostics::gather_summary(&app)
        }
    })
    .await
}

#[tauri::command]
async fn diagnostics_household_stats(
    state: State<'_, AppState>,
) -> AppResult<Vec<diagnostics::HouseholdStatsEntry>> {
    let pool = state.pool_clone();
    let result = dispatch_async_app_result(move || {
        let pool = pool.clone();
        async move { diagnostics::household_stats(&pool).await }
    })
    .await;

    match result {
        Ok(stats) => {
            tracing::info!(
                target: "arklowdun",
                event = "household_stats",
                household_id = "",
                result = "ok",
                households = stats.len()
            );
            Ok(stats)
        }
        Err(err) => {
            tracing::warn!(
                target: "arklowdun",
                event = "household_stats",
                household_id = "",
                result = "error",
                error_code = %err.code()
            );
            Err(err)
        }
    }
}

#[tauri::command]
#[allow(clippy::result_large_err)]
fn about_metadata<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> AppResult<diagnostics::AboutInfo> {
    Ok(diagnostics::about_info(&app))
}

#[tauri::command]
async fn diagnostics_doc_path<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> AppResult<String> {
    let app = app.clone();
    dispatch_async_app_result(move || {
        let app = app;
        async move { diagnostics::resolve_doc_path(&app) }
    })
    .await
}

#[tauri::command]
async fn open_diagnostics_doc<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> AppResult<()> {
    let app = app.clone();
    dispatch_async_app_result(move || {
        let app = app;
        async move {
            let p = crate::diagnostics::resolve_doc_path(&app)?;
            let pb = std::path::PathBuf::from(p);
            crate::attachments::open_with_os(&pb)
        }
    })
    .await
}

#[tauri::command]
async fn db_backup_overview(state: State<'_, AppState>) -> AppResult<backup::BackupOverview> {
    let pool = state.pool_clone();
    let db_path = (*state.db_path).clone();
    dispatch_async_app_result(move || {
        let pool = pool.clone();
        async move { backup::overview(&pool, &db_path).await }
    })
    .await
}

#[tauri::command]
async fn db_backup_create(state: State<'_, AppState>) -> AppResult<backup::BackupEntry> {
    let pool = state.pool_clone();
    let db_path = (*state.db_path).clone();
    dispatch_async_app_result(move || {
        let pool = pool.clone();
        async move { backup::create_backup(&pool, &db_path).await }
    })
    .await
}

#[tauri::command]
async fn db_backup_reveal_root(state: State<'_, AppState>) -> AppResult<()> {
    let db_path = (*state.db_path).clone();
    dispatch_async_app_result(move || {
        let db_path = db_path.clone();
        async move { backup::reveal_backup_root(&db_path) }
    })
    .await
}

#[tauri::command]
async fn db_backup_reveal(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let db_path = (*state.db_path).clone();
    dispatch_async_app_result(move || {
        let target = PathBuf::from(path);
        async move { backup::reveal_backup(&db_path, &target) }
    })
    .await
}

#[tauri::command]
async fn db_export_run<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    out_parent: String,
) -> AppResult<export::ExportEntryDto> {
    let pool = state.pool_clone();
    let out = std::path::PathBuf::from(out_parent);
    let vault = state.vault();
    let result = dispatch_async_app_result(move || {
        let pool = pool.clone();
        let vault = vault.clone();
        async move {
            let entry =
                export::create_export(&pool, vault, export::ExportOptions { out_parent: out })
                    .await
                    .map_err(|err| err.with_context("operation", "export_run"))?;
            Ok::<_, crate::AppError>(export::ExportEntryDto::from(entry))
        }
    })
    .await?;
    Ok(result)
}

#[tauri::command]
async fn db_repair_run<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
) -> AppResult<DbRepairSummary> {
    let maintenance_guard = state.begin_maintenance()?;
    let pool = state.pool_clone();
    let pool_handle = state.pool.clone();
    let db_path = (*state.db_path).clone();
    let db_path_for_reopen = db_path.clone();
    let cache = state.db_health.clone();
    let emitter = app.clone();
    let pool_closed = Arc::new(AtomicBool::new(false));
    let pool_closed_after = pool_closed.clone();

    let result = dispatch_async_app_result(move || {
        let pool = pool.clone();
        let db_path = db_path.clone();
        let cache = cache.clone();
        let emitter = emitter.clone();
        let pool_handle = pool_handle.clone();
        let pool_closed = pool_closed.clone();
        async move {
            let handler = Arc::new(move |event: DbRepairEvent| {
                let _ = emitter.emit("db_repair_progress", event.clone());
            });

            let before_swap = {
                let pool = pool.clone();
                let flag = pool_closed.clone();
                Arc::new(move || -> std::pin::Pin<
                    Box<dyn std::future::Future<Output = AppResult<()>> + Send>,
                > {
                    let pool = pool.clone();
                    let flag = flag.clone();
                    Box::pin(async move {
                        pool.close().await;
                        flag.store(true, Ordering::SeqCst);
                        Ok(())
                    })
                })
            };

            let db_path_for_after_swap = db_path.clone();
            let after_swap = {
                let pool_handle = pool_handle.clone();
                let cache = cache.clone();
                let flag = pool_closed.clone();
                let db_path = db_path_for_after_swap;
                Arc::new(move || -> std::pin::Pin<
                    Box<
                        dyn std::future::Future<
                                Output = AppResult<Option<DbHealthReport>>
                            > + Send,
                    >,
                > {
                    let db_path = db_path.clone();
                    let pool_handle = pool_handle.clone();
                    let cache = cache.clone();
                    let flag = flag.clone();
                    Box::pin(async move {
                        let new_pool = crate::db::connect_sqlite_pool(&db_path)
                            .await
                            .map_err(|err| {
                                AppError::from(err)
                                    .with_context("operation", "reopen_pool_after_swap")
                            })?;
                        {
                            let mut guard = pool_handle
                                .write()
                                .unwrap_or_else(|e| e.into_inner());
                            *guard = new_pool.clone();
                        }
                        let report = crate::db::health::run_health_checks(&new_pool, &db_path)
                            .await
                            .map_err(|err| {
                                AppError::from(err)
                                    .with_context("operation", "repair_post_swap_health")
                            })?;
                        {
                            let mut guard = cache
                                .lock()
                                .map_err(|_| AppError::new("STATE/LOCK_POISONED", "Failed to update database health cache"))?;
                            *guard = report.clone();
                        }
                        flag.store(false, Ordering::SeqCst);
                        Ok(Some(report))
                    })
                })
            };

            let db_path_for_repair = db_path.clone();
            let options = repair::DbRepairOptions {
                before_swap: Some(before_swap),
                after_swap: Some(after_swap),
            };

            repair::run_guided_repair(&pool, &db_path_for_repair, Some(handler), options).await
        }
    })
    .await;

    drop(maintenance_guard);

    if pool_closed_after.load(Ordering::SeqCst) {
        let reopened = crate::db::connect_sqlite_pool(&db_path_for_reopen)
            .await
            .map_err(|err| {
                AppError::from(err).with_context("operation", "reopen_pool_after_failure")
            })?;
        state.replace_pool(reopened);
        pool_closed_after.store(false, Ordering::SeqCst);
    }

    result
}

#[tauri::command]
async fn db_hard_repair_run(state: State<'_, AppState>) -> AppResult<HardRepairOutcome> {
    let maintenance_guard = state.begin_maintenance()?;
    let pool = state.pool_clone();
    let pool_handle = state.pool.clone();
    let db_path_for_task = (*state.db_path).clone();
    let db_path_for_reopen = (*state.db_path).clone();
    let cache = state.db_health.clone();
    let pool_closed = Arc::new(AtomicBool::new(false));
    let pool_closed_after = pool_closed.clone();

    let result = dispatch_async_app_result(move || {
        let pool = pool.clone();
        let db_path = db_path_for_task.clone();
        let pool_handle = pool_handle.clone();
        let cache = cache.clone();
        let pool_closed = pool_closed.clone();
        async move {
            let db_path = db_path.clone();
            pool.close().await;
            pool_closed.store(true, Ordering::SeqCst);
            let outcome = hard_repair::run_hard_repair(&db_path).await?;
            let new_pool = crate::db::connect_sqlite_pool(&db_path)
                .await
                .map_err(|err| {
                    AppError::from(err).with_context("operation", "reopen_pool_after_hard_repair")
                })?;
            {
                let mut guard = pool_handle.write().unwrap_or_else(|e| e.into_inner());
                *guard = new_pool.clone();
            }
            let health = crate::db::health::run_health_checks(&new_pool, &db_path)
                .await
                .map_err(|err| {
                    AppError::from(err).with_context("operation", "hard_repair_post_health")
                })?;
            {
                let mut guard = cache.lock().map_err(|_| {
                    AppError::new(
                        "STATE/LOCK_POISONED",
                        "Failed to update database health cache",
                    )
                })?;
                *guard = health;
            }
            pool_closed.store(false, Ordering::SeqCst);
            Ok(outcome)
        }
    })
    .await;

    drop(maintenance_guard);

    if pool_closed_after.load(Ordering::SeqCst) {
        let reopened = crate::db::connect_sqlite_pool(&db_path_for_reopen)
            .await
            .map_err(|err| {
                AppError::from(err)
                    .with_context("operation", "reopen_pool_after_hard_repair_failure")
            })?;
        state.replace_pool(reopened);
        pool_closed_after.store(false, Ordering::SeqCst);
    }

    result
}

#[tauri::command]
#[allow(clippy::result_large_err)]
async fn time_invariants_check(
    state: State<'_, AppState>,
    household_id: Option<String>,
) -> AppResult<time_invariants::DriftReport> {
    let pool = state.pool_clone();
    dispatch_async_app_result(move || {
        let pool = pool.clone();
        let household_id = household_id.clone();
        async move {
            let report = time_invariants::run_drift_check(
                &pool,
                time_invariants::DriftCheckOptions {
                    household_id: household_id.clone(),
                },
            )
            .await?;
            if let Some(mut err) =
                time_invariants::drift_report_to_error(&report, household_id.as_deref())
            {
                err = err.with_context("operation", "time_invariants_check");
                return Err(err);
            }
            Ok(report)
        }
    })
    .await
}

#[macro_export]
macro_rules! app_commands {
    ($($extra:ident),* $(,)?) => {
        tauri::generate_handler![
            events_backfill_timezone,
            events_backfill_timezone_cancel,
            events_backfill_timezone_status,
            events_list_range,
            event_create,
            event_update,
            event_delete,
            event_restore,
            household_get_active,
            household_list_all,
            household_list,
            household_get,
            household_create,
            household_update,
            household_delete,
            household_resume_delete,
            household_repair,
            household_vacuum_execute,
            household_restore,
            bills_list,
            bills_get,
            bills_create,
            bills_update,
            bills_delete,
            bills_restore,
            bills_list_due_between,
            policies_list,
            policies_get,
            policies_create,
            policies_update,
            policies_delete,
            policies_restore,
            property_documents_list,
            property_documents_get,
            property_documents_create,
            property_documents_update,
            property_documents_delete,
            property_documents_restore,
            inventory_items_list,
            inventory_items_get,
            inventory_items_create,
            inventory_items_update,
            inventory_items_delete,
            inventory_items_restore,
            vehicles_list,
            vehicles_get,
            vehicles_create,
            vehicles_update,
            vehicles_delete,
            vehicles_restore,
            vehicle_maintenance_list,
            vehicle_maintenance_get,
            vehicle_maintenance_create,
            vehicle_maintenance_update,
            vehicle_maintenance_delete,
            vehicle_maintenance_restore,
            pets_list,
            pets_get,
            pets_create,
            pets_update,
            pets_delete,
            pets_restore,
            pet_medical_list,
            pet_medical_get,
            pet_medical_create,
            pet_medical_update,
            pet_medical_delete,
            pet_medical_restore,
            family_members_list,
            family_members_get,
            family_members_create,
            family_members_update,
            family_members_delete,
            family_members_restore,
            categories_list,
            categories_get,
            categories_create,
            categories_update,
            categories_delete,
            categories_restore,
            budget_categories_list,
            budget_categories_get,
            budget_categories_create,
            budget_categories_update,
            budget_categories_delete,
            budget_categories_restore,
            expenses_list,
            expenses_get,
            expenses_create,
            expenses_update,
            expenses_delete,
            expenses_restore,
            notes_list_cursor,
            notes_list_by_deadline_range,
            notes_get,
            notes_create,
            notes_update,
            notes_delete,
            notes_restore,
            note_links_create,
            note_links_delete,
            note_links_get_for_note,
            note_links_list_by_entity,
            note_links_unlink_entity,
            notes_list_for_entity,
            notes_quick_create_for_entity,
            shopping_items_list,
            shopping_items_get,
            shopping_items_create,
            shopping_items_update,
            shopping_items_delete,
            shopping_items_restore,
            attachment_open,
            attachment_reveal,
            attachments_migration_status,
            attachments_migrate,
            diagnostics_summary,
            diagnostics_household_stats,
            diagnostics_doc_path,
            open_diagnostics_doc,
            db_backup_overview,
            db_backup_create,
            db_backup_reveal_root,
            db_backup_reveal,
            db_export_run,
            db_import_preview,
            db_import_execute,
            db_repair_run,
            db_hard_repair_run,
            time_invariants_check,
            about_metadata,
            $($extra),*
        ]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let store_handle = crate::household_active::StoreHandle::tauri(
                tauri_plugin_store::StoreBuilder::new(app, "arklowdun.json").build()?,
            );
            let handle = app.handle();
            if let Err(err) = crate::init_file_logging(handle.clone()) {
                tracing::warn!(
                    target: "arklowdun",
                    event = "file_logging_disabled",
                    error = %err
                );
            }
            #[allow(clippy::needless_borrow)]
            let (pool, db_path) =
                tauri::async_runtime::block_on(crate::db::open_sqlite_pool(&handle))?;
            // ORDER MATTERS: 1) apply schema; 2) ensure idx; 3) refuse missing UTC; 4) refuse legacy cols.
            tauri::async_runtime::block_on(crate::db::apply_migrations(&pool))?;
            tauri::async_runtime::block_on(crate::migration_guard::ensure_events_indexes(&pool))
                .map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;
            tauri::async_runtime::block_on(crate::migration_guard::enforce_events_backfill_guard(
                &pool,
            ))
            .map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;
            tauri::async_runtime::block_on(
                crate::migration_guard::enforce_events_legacy_columns_removed(&pool),
            )
            .map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;
            let mut health_report = tauri::async_runtime::block_on(
                crate::db::health::run_health_checks(&pool, &db_path),
            )?;
            let pending_cascades =
                tauri::async_runtime::block_on(crate::household::pending_cascades(&pool))?;
            if !pending_cascades.is_empty() {
                let offenders: Vec<String> = pending_cascades
                    .into_iter()
                    .map(|c| c.household_id)
                    .collect();
                let detail = cascade_health_message(&offenders);
                health_report.checks.push(DbHealthCheck {
                    name: CASCADE_HEALTH_CHECK.to_string(),
                    passed: false,
                    duration_ms: 0,
                    details: Some(detail),
                });
                health_report.status = DbHealthStatus::Error;
            }
            log_db_health(&health_report);
            // Avoid creating new rows when the database is unhealthy. This preserves
            // write-block semantics during startup and aligns with the IPC write guard.
            let active_id = if matches!(health_report.status, DbHealthStatus::Ok) {
                tauri::async_runtime::block_on(crate::household_active::get_active_household_id(
                    &pool,
                    &store_handle,
                ))?
            } else {
                // Attempt to use the first existing household id (if any). If none
                // exist, leave empty and let the UI handle the unhealthy state.
                if let Some(row) = tauri::async_runtime::block_on(
                    crate::repo::admin::first_active_for_all_households(&pool, "household", None),
                )? {
                    // `Row` is in scope; fall back to empty string on decode error.
                    row.try_get::<String, _>("id").unwrap_or_default()
                } else {
                    String::new()
                }
            };
            let db_health = Arc::new(Mutex::new(health_report));
            let attachments_root = db_path
                .parent()
                .map(|p| p.join("attachments"))
                .unwrap_or_else(|| PathBuf::from("attachments"));
            std::fs::create_dir_all(&attachments_root)
                .map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;
            let db_path = Arc::new(db_path);
            let pool_handle = Arc::new(RwLock::new(pool.clone()));
            let vault = Arc::new(Vault::new(attachments_root.clone()));
            let vault_migration = Arc::new(
                VaultMigrationManager::new(&attachments_root)
                    .map_err(|err| -> Box<dyn std::error::Error> { err.into() })?,
            );

            if !vault_migration.last_apply_ok_path().exists() {
                tracing::info!(
                    target: "arklowdun",
                    event = "vault_migration_startup_housekeeping",
                    "Running vault housekeeping checks on startup"
                );
                tauri::async_runtime::block_on(crate::vault_migration::ensure_housekeeping(
                    &pool, &vault,
                ))
                .map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;
                vault_migration
                    .mark_last_apply_ok()
                    .map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;
            }
            app.manage(crate::state::AppState {
                pool: pool_handle,
                active_household_id: Arc::new(Mutex::new(active_id.clone())),
                store: store_handle.clone(),
                backfill: Arc::new(Mutex::new(
                    crate::events_tz_backfill::BackfillCoordinator::new(),
                )),
                db_health,
                db_path,
                vault,
                vault_migration,
                maintenance: Arc::new(AtomicBool::new(false)),
            });
            Ok(())
        })
        .invoke_handler(app_commands![
            search_entities,
            import_run_legacy,
            open_path,
            household_get_active,
            household_set_active,
            db_table_exists,
            db_has_files_index,
            db_files_index_ready,
            db_has_vehicle_columns,
            db_has_pet_columns,
            // Database health IPC commands consumed by the frontend shell.
            db_get_health_report,
            db_recheck
        ])
        .run(tauri::generate_context!("tauri.conf.json5"))
        .unwrap_or_else(|e| {
            tracing::error!(
                target: "arklowdun",
                event = "tauri_run_failed",
                error = %e
            );
            std::process::exit(1);
        });
}

#[cfg(all(test, feature = "legacy_deleted_at"))]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn event_accepts_legacy_deleted_at() {
        let payload = json!({
            "id": "e1",
            "household_id": "h1",
            "title": "T",
            "start_at": 1,
            "end_at": 2,
            "deletedAt": 999
        });
        let ev: Event = serde_json::from_value(payload).unwrap();
        assert_eq!(ev.deleted_at, Some(999));
    }
}

#[cfg(test)]
mod search_tests {
    use super::*;
    use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

    #[tokio::test]
    async fn files_index_ready_checks_meta() {
        let pool: SqlitePool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE files (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, filename TEXT NOT NULL, updated_at INTEGER NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        // make the index table exist so readiness can ever be true
        sqlx::query("CREATE TABLE files_index (dummy INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO files (id, household_id, filename, updated_at) VALUES ('f1','hh','a',0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE files_index_meta (household_id TEXT PRIMARY KEY, last_built_at_utc TEXT NOT NULL, source_row_count INTEGER NOT NULL, source_max_updated_utc TEXT NOT NULL, version INTEGER NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO files_index_meta (household_id, last_built_at_utc, source_row_count, source_max_updated_utc, version) VALUES ('hh','2024-01-01T00:00:00Z',1,'1970-01-01T00:00:00Z',0)")
            .execute(&pool)
            .await
            .unwrap();
        assert!(!files_index_ready(&pool, "hh").await);
        sqlx::query("UPDATE files_index_meta SET version=?1")
            .bind(FILES_INDEX_VERSION)
            .execute(&pool)
            .await
            .unwrap();
        assert!(files_index_ready(&pool, "hh").await);
        sqlx::query("UPDATE files SET updated_at=1")
            .execute(&pool)
            .await
            .unwrap();
        assert!(!files_index_ready(&pool, "hh").await);
    }

    #[test]
    fn like_escape_escapes_wildcards() {
        assert_eq!(like_escape("50%_\\test"), "50\\%\\_\\\\test");
    }
}

#[cfg(test)]
mod db_health_command_tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    use log::LevelFilter;
    use sqlx::sqlite::{
        SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous,
    };
    use sqlx::ConnectOptions;
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    use tempfile::tempdir;
    use tokio::runtime::Runtime;

    fn invoke_request(cmd: &str) -> InvokeRequest {
        InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().expect("valid url"),
            body: tauri::ipc::InvokeBody::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        }
    }

    #[test]
    fn db_health_commands_are_exposed_over_ipc() {
        let dir = tempdir().expect("temp dir");
        let db_path = dir.path().join("health.sqlite3");

        let runtime = Runtime::new().expect("create runtime");
        let (pool, cached_report) = runtime.block_on(async {
            let options = SqliteConnectOptions::new()
                .filename(&db_path)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal)
                .synchronous(SqliteSynchronous::Full)
                .foreign_keys(true)
                .log_statements(LevelFilter::Off);
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await
                .expect("connect sqlite");
            sqlx::query("PRAGMA busy_timeout = 5000;")
                .execute(&pool)
                .await
                .expect("set busy timeout");
            sqlx::query("PRAGMA wal_autocheckpoint = 1000;")
                .execute(&pool)
                .await
                .expect("set wal autocheckpoint");
            crate::db::apply_migrations(&pool)
                .await
                .expect("apply migrations");
            let report = crate::db::health::run_health_checks(&pool, &db_path)
                .await
                .expect("initial health report");
            (pool, report)
        });
        drop(runtime);

        let attachments_root = dir.path().join("attachments");
        std::fs::create_dir_all(&attachments_root).expect("create attachments dir");
        let app_state = crate::state::AppState {
            pool: Arc::new(RwLock::new(pool.clone())),
            active_household_id: Arc::new(Mutex::new(String::from("test-household"))),
            store: crate::household_active::StoreHandle::in_memory(),
            backfill: Arc::new(Mutex::new(
                crate::events_tz_backfill::BackfillCoordinator::new(),
            )),
            db_health: Arc::new(Mutex::new(cached_report.clone())),
            db_path: Arc::new(db_path.clone()),
            vault: Arc::new(Vault::new(attachments_root.clone())),
            vault_migration: Arc::new(
                crate::vault_migration::VaultMigrationManager::new(&attachments_root).unwrap(),
            ),
            maintenance: Arc::new(AtomicBool::new(false)),
        };

        let app = mock_builder()
            .manage(app_state)
            .invoke_handler(tauri::generate_handler![
                super::db_get_health_report,
                super::db_recheck
            ])
            .build(mock_context(noop_assets()))
            .expect("build tauri app");

        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("create window");

        let response = get_ipc_response(&window, invoke_request("db_get_health_report"))
            .expect("db_get_health_report returns");
        let initial: DbHealthReport = response.deserialize().expect("deserialize initial report");
        assert_eq!(initial.status, cached_report.status);
        assert_eq!(initial.schema_hash, cached_report.schema_hash);

        let response =
            get_ipc_response(&window, invoke_request("db_recheck")).expect("db_recheck succeeds");
        let refreshed: DbHealthReport = response
            .deserialize()
            .expect("deserialize refreshed report");
        assert_eq!(refreshed.status, DbHealthStatus::Ok);
        assert!(!refreshed.generated_at.is_empty());

        let response = get_ipc_response(&window, invoke_request("db_get_health_report"))
            .expect("db_get_health_report after recheck");
        let cached_after: DbHealthReport =
            response.deserialize().expect("deserialize cached report");
        assert_eq!(cached_after.generated_at, refreshed.generated_at);
    }
}

#[cfg(test)]
mod attachment_ipc_read_tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite memory");
        sqlx::query(
            "CREATE TABLE files (
                id TEXT PRIMARY KEY,
                household_id TEXT NOT NULL,
                category TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                deleted_at INTEGER
            )",
        )
        .execute(&pool)
        .await
        .expect("create files table");
        pool
    }

    async fn insert_descriptor(pool: &SqlitePool, id: &str, relative: &str) {
        sqlx::query(
            "INSERT INTO files (id, household_id, category, relative_path, deleted_at)
             VALUES (?1, ?2, ?3, ?4, NULL)",
        )
        .bind(id)
        .bind("hh1")
        .bind("notes")
        .bind(relative)
        .execute(pool)
        .await
        .expect("insert attachment row");
    }

    #[tokio::test]
    async fn rejects_traversal_paths() {
        let pool = setup_pool().await;
        insert_descriptor(&pool, "a1", "../escape.txt").await;
        let active = Arc::new(Mutex::new(String::new()));
        let vault_dir = tempdir().expect("tempdir");
        let vault = Arc::new(Vault::new(vault_dir.path()));

        let err = resolve_attachment_for_ipc_read(
            &pool,
            &active,
            &vault,
            "files",
            "a1",
            "attachment_open",
        )
        .await
        .expect_err("expected traversal guard to reject");
        assert_eq!(err.code(), crate::vault::ERR_PATH_OUT_OF_VAULT);
    }

    #[tokio::test]
    async fn rejects_absolute_paths() {
        let pool = setup_pool().await;
        insert_descriptor(&pool, "a2", "/etc/passwd").await;
        let active = Arc::new(Mutex::new(String::new()));
        let vault_dir = tempdir().expect("tempdir");
        let vault = Arc::new(Vault::new(vault_dir.path()));

        let err = resolve_attachment_for_ipc_read(
            &pool,
            &active,
            &vault,
            "files",
            "a2",
            "attachment_reveal",
        )
        .await
        .expect_err("expected absolute guard to reject");
        assert_eq!(err.code(), crate::vault::ERR_PATH_OUT_OF_VAULT);
    }
}

#[cfg(test)]
mod attachment_ipc_mutation_tests {
    use super::*;
    use crate::security::hash_path;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    #[tokio::test]
    async fn create_guard_rejects_invalid_category() {
        let vault_dir = tempdir().expect("tempdir");
        let vault = Arc::new(Vault::new(vault_dir.path()));
        let active = Arc::new(Mutex::new(String::new()));

        let mut data = Map::new();
        data.insert("household_id".into(), Value::String("hh1".into()));
        data.insert("category".into(), Value::String("invalid".into()));
        data.insert("relative_path".into(), Value::String("docs/a.txt".into()));

        let err =
            resolve_attachment_for_ipc_create(&vault, &active, "bills", &data, "bills_create")
                .expect_err("expected invalid category");
        assert_eq!(err.code(), crate::vault::ERR_INVALID_CATEGORY);
        assert_eq!(
            err.context.get("category").map(String::as_str),
            Some("invalid")
        );
        assert_eq!(
            err.context.get("guard_stage").map(String::as_str),
            Some("ensure_category")
        );
    }

    #[tokio::test]
    async fn create_guard_rejects_traversal_path() {
        let vault_dir = tempdir().expect("tempdir");
        let vault = Arc::new(Vault::new(vault_dir.path()));
        let active = Arc::new(Mutex::new(String::new()));

        let mut data = Map::new();
        data.insert("household_id".into(), Value::String("hh1".into()));
        data.insert("category".into(), Value::String("bills".into()));
        data.insert(
            "relative_path".into(),
            Value::String("../escape.txt".into()),
        );

        let err =
            resolve_attachment_for_ipc_create(&vault, &active, "bills", &data, "bills_create")
                .expect_err("expected traversal rejection");
        assert_eq!(err.code(), crate::vault::ERR_PATH_OUT_OF_VAULT);
        let expected_hash = hash_path(Path::new("../escape.txt"));
        assert_eq!(
            err.context.get("relative_path_hash").map(String::as_str),
            Some(expected_hash.as_str())
        );
        assert_eq!(
            err.context.get("guard_stage").map(String::as_str),
            Some("normalize_relative")
        );
    }

    #[tokio::test]
    async fn update_guard_rejects_active_household_mismatch() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite memory");
        sqlx::query(
            "CREATE TABLE bills (
                id TEXT PRIMARY KEY,
                household_id TEXT NOT NULL,
                category TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                deleted_at INTEGER
            )",
        )
        .execute(&pool)
        .await
        .expect("create bills table");
        sqlx::query(
            "INSERT INTO bills (id, household_id, category, relative_path, deleted_at) VALUES (?1, 'hh1', 'bills', 'docs/file.txt', NULL)",
        )
        .bind("bill1")
        .execute(&pool)
        .await
        .expect("insert attachment row");

        let vault_dir = tempdir().expect("tempdir");
        let vault = Arc::new(Vault::new(vault_dir.path()));
        let active = Arc::new(Mutex::new(String::from("hh2")));
        let data = Map::new();

        let err = resolve_attachment_for_ipc_update(
            &pool,
            &vault,
            &active,
            "bills",
            "bill1",
            Some("hh1"),
            &data,
            "bills_update",
        )
        .await
        .expect_err("expected household mismatch");
        assert_eq!(err.code(), crate::vault::ERR_INVALID_HOUSEHOLD);
        assert_eq!(
            err.context.get("guard_stage").map(String::as_str),
            Some("ensure_active_household")
        );
        let expected_hash = hash_path(Path::new("docs/file.txt"));
        assert_eq!(
            err.context.get("relative_path_hash").map(String::as_str),
            Some(expected_hash.as_str())
        );
    }

    #[tokio::test]
    async fn mutation_guards_cover_supported_tables() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite memory");

        let mut descriptors = Vec::new();
        for &table in ATTACHMENT_TABLES {
            let create_sql = format!(
                "CREATE TABLE {table} (\n                    id TEXT PRIMARY KEY,\n                    household_id TEXT NOT NULL,\n                    category TEXT NOT NULL,\n                    relative_path TEXT NOT NULL,\n                    deleted_at INTEGER\n                )"
            );
            sqlx::query(&create_sql)
                .execute(&pool)
                .await
                .unwrap_or_else(|_| panic!("create table {table}"));

            let id = format!("{table}_existing");
            let initial_relative = format!("{table}/existing.pdf");
            sqlx::query(&format!(
                "INSERT INTO {table} (id, household_id, category, relative_path, deleted_at)\n                 VALUES (?1, ?2, ?3, ?4, NULL)"
            ))
            .bind(&id)
            .bind("hh1")
            .bind(
                AttachmentCategory::for_table(table)
                    .expect("category for table")
                    .as_str(),
            )
            .bind(&initial_relative)
            .execute(&pool)
            .await
            .unwrap_or_else(|_| panic!("insert descriptor for {table}"));

            descriptors.push((table, id));
        }

        let vault_dir = tempdir().expect("tempdir");
        let vault = Arc::new(Vault::new(vault_dir.path()));
        let active = Arc::new(Mutex::new(String::from("hh1")));

        for (table, id) in descriptors {
            let category = AttachmentCategory::for_table(table).expect("category for table");

            let create_relative = format!("incoming/{table}.pdf");
            let mut create_data = Map::new();
            create_data.insert("household_id".into(), Value::String("hh1".into()));
            create_data.insert(
                "category".into(),
                Value::String(category.as_str().to_string()),
            );
            create_data.insert(
                "relative_path".into(),
                Value::String(create_relative.clone()),
            );

            let create_guard = resolve_attachment_for_ipc_create(
                &vault,
                &active,
                table,
                &create_data,
                "integration_create",
            )
            .expect("create guard succeeds")
            .expect("guard present for attachment table");
            assert_eq!(create_guard.household_id(), "hh1");
            assert_eq!(create_guard.category(), category);
            assert_eq!(
                create_guard.normalized_relative_path(),
                Some(create_relative.as_str())
            );
            let resolved = create_guard.resolved_path().expect("resolved path");
            assert!(resolved.starts_with(vault_dir.path()));
            let mut expected_suffix = PathBuf::from("hh1");
            expected_suffix.push(category.as_str());
            expected_suffix.push(Path::new(&create_relative));
            assert!(resolved.ends_with(&expected_suffix));

            let update_relative = format!("updated/{table}.pdf");
            let mut update_data = Map::new();
            update_data.insert(
                "relative_path".into(),
                Value::String(update_relative.clone()),
            );

            let update_guard = resolve_attachment_for_ipc_update(
                &pool,
                &vault,
                &active,
                table,
                &id,
                Some("hh1"),
                &update_data,
                "integration_update",
            )
            .await
            .expect("update guard succeeds")
            .expect("guard present for attachment table");
            assert_eq!(update_guard.household_id(), "hh1");
            assert_eq!(update_guard.category(), category);
            assert_eq!(
                update_guard.normalized_relative_path(),
                Some(update_relative.as_str())
            );
            let resolved = update_guard.resolved_path().expect("resolved path");
            assert!(resolved.starts_with(vault_dir.path()));
            let mut expected_suffix = PathBuf::from("hh1");
            expected_suffix.push(category.as_str());
            expected_suffix.push(Path::new(&update_relative));
            assert!(resolved.ends_with(&expected_suffix));

            sqlx::query(&format!(
                "UPDATE {table} SET relative_path = ?1, category = ?2 WHERE id = ?3"
            ))
            .bind(&update_relative)
            .bind(category.as_str())
            .bind(&id)
            .execute(&pool)
            .await
            .unwrap_or_else(|_| panic!("update descriptor for {table}"));

            let delete_guard = resolve_attachment_for_ipc_delete(
                &pool,
                &vault,
                &active,
                table,
                "hh1",
                &id,
                "integration_delete",
            )
            .await
            .expect("delete guard succeeds")
            .expect("guard present for attachment table");
            assert_eq!(delete_guard.household_id(), "hh1");
            assert_eq!(delete_guard.category(), category);
            assert_eq!(
                delete_guard.normalized_relative_path(),
                Some(update_relative.as_str())
            );
            let resolved = delete_guard.resolved_path().expect("resolved path");
            assert!(resolved.starts_with(vault_dir.path()));
            let mut expected_suffix = PathBuf::from("hh1");
            expected_suffix.push(category.as_str());
            expected_suffix.push(Path::new(&update_relative));
            assert!(resolved.ends_with(&expected_suffix));
        }
    }
}

#[cfg(test)]
mod attachment_ipc_command_tests {
    use super::*;
    use crate::db::health::{DbHealthReport, DbHealthStatus};
    use crate::events_tz_backfill::BackfillCoordinator;
    use crate::household_active::StoreHandle;
    use log::LevelFilter;
    use sqlx::sqlite::{
        SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous,
    };
    use sqlx::ConnectOptions;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Mutex, RwLock};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    use tauri::WebviewWindowBuilder;
    use tempfile::tempdir;
    use tokio::runtime::Runtime;

    fn invoke_request_with_payload(cmd: &str, payload: serde_json::Value) -> InvokeRequest {
        InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().expect("valid url"),
            body: tauri::ipc::InvokeBody::from(payload),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        }
    }

    fn ok_health_report() -> DbHealthReport {
        DbHealthReport {
            status: DbHealthStatus::Ok,
            checks: Vec::new(),
            offenders: Vec::new(),
            schema_hash: String::new(),
            app_version: String::new(),
            generated_at: String::new(),
        }
    }

    fn build_app_state(
        pool: SqlitePool,
        attachments_root: &Path,
        active: String,
        db_path: PathBuf,
    ) -> AppState {
        let vault = Arc::new(Vault::new(attachments_root));
        let migration = Arc::new(
            VaultMigrationManager::new(attachments_root).expect("create vault migration manager"),
        );
        AppState {
            pool: Arc::new(RwLock::new(pool)),
            active_household_id: Arc::new(Mutex::new(active)),
            store: StoreHandle::in_memory(),
            backfill: Arc::new(Mutex::new(BackfillCoordinator::new())),
            db_health: Arc::new(Mutex::new(ok_health_report())),
            db_path: Arc::new(db_path),
            vault,
            vault_migration: migration,
            maintenance: Arc::new(AtomicBool::new(false)),
        }
    }

    #[test]
    fn bills_create_rejects_invalid_category_at_entrypoint() {
        let dir = tempdir().expect("tempdir");
        let attachments_root = dir.path().join("attachments");
        std::fs::create_dir_all(&attachments_root).expect("create attachments root");

        let runtime = Runtime::new().expect("create runtime");
        let pool = runtime.block_on(async {
            SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("connect sqlite")
        });
        drop(runtime);

        let state = build_app_state(
            pool.clone(),
            &attachments_root,
            String::new(),
            attachments_root.join("ipc-create.sqlite3"),
        );

        let app = mock_builder()
            .manage(state)
            .invoke_handler(tauri::generate_handler![super::bills_create])
            .build(mock_context(noop_assets()))
            .expect("build tauri app");

        let window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("create window");

        let payload = serde_json::json!({
            "data": {
                "household_id": "hh1",
                "category": "invalid",
                "relative_path": "docs/a.txt"
            }
        });

        let response = get_ipc_response(
            &window,
            invoke_request_with_payload("bills_create", payload),
        );
        let err = response.expect_err("expected invalid category error");
        let obj = err.as_object().expect("error payload is object");
        assert_eq!(
            obj.get("code").and_then(|v| v.as_str()),
            Some(crate::vault::ERR_INVALID_CATEGORY)
        );
    }

    #[test]
    fn attachment_open_rejects_active_household_mismatch() {
        let dir = tempdir().expect("tempdir");
        let attachments_root = dir.path().join("attachments");
        std::fs::create_dir_all(&attachments_root).expect("create attachments root");

        let runtime = Runtime::new().expect("create runtime");
        let db_path = dir.path().join("ipc-open.sqlite3");
        let pool = runtime
            .block_on(async {
                let options = SqliteConnectOptions::new()
                    .filename(&db_path)
                    .create_if_missing(true)
                    .journal_mode(SqliteJournalMode::Wal)
                    .synchronous(SqliteSynchronous::Full)
                    .foreign_keys(true)
                    .log_statements(LevelFilter::Off);
                let pool = SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect_with(options)
                    .await
                    .expect("connect sqlite");
                sqlx::query(
                    "CREATE TABLE bills (\n                        id TEXT PRIMARY KEY,\n                        household_id TEXT NOT NULL,\n                        category TEXT NOT NULL,\n                        relative_path TEXT NOT NULL,\n                        deleted_at INTEGER\n                    )",
                )
                .execute(&pool)
                .await
                .expect("create bills table");
                sqlx::query(
                    "INSERT INTO bills (id, household_id, category, relative_path, deleted_at) VALUES (?1, 'hh1', 'bills', 'docs/file.txt', NULL)",
                )
                .bind("bill1")
                .execute(&pool)
                .await
                .expect("insert attachment");
                pool
            });
        drop(runtime);

        let state = build_app_state(
            pool.clone(),
            &attachments_root,
            String::from("hh2"),
            db_path,
        );

        let app = mock_builder()
            .manage(state)
            .invoke_handler(tauri::generate_handler![super::attachment_open])
            .build(mock_context(noop_assets()))
            .expect("build tauri app");

        let window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("create window");

        let payload = serde_json::json!({
            "table": "bills",
            "id": "bill1"
        });

        let response = get_ipc_response(
            &window,
            invoke_request_with_payload("attachment_open", payload),
        );
        let err = response.expect_err("expected household guard error");
        let obj = err.as_object().expect("error payload is object");
        assert_eq!(
            obj.get("code").and_then(|v| v.as_str()),
            Some(crate::vault::ERR_INVALID_HOUSEHOLD)
        );
    }
}

#[cfg(test)]
mod write_guard_tests {
    use super::*;
    use log::LevelFilter;
    use sqlx::sqlite::{
        SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous,
    };
    use sqlx::ConnectOptions;
    use std::sync::{Arc, Mutex};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    use tempfile::tempdir;
    use tokio::runtime::Runtime;

    fn invoke_request_with_payload(cmd: &str, payload: serde_json::Value) -> InvokeRequest {
        InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().expect("valid url"),
            body: tauri::ipc::InvokeBody::from(payload),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        }
    }

    #[test]
    fn household_create_is_blocked_when_health_unhealthy() {
        let dir = tempdir().expect("temp dir");
        let db_path = dir.path().join("guard.sqlite3");

        let runtime = Runtime::new().expect("create runtime");
        let (pool, unhealthy_report) = runtime.block_on(async {
            let options = SqliteConnectOptions::new()
                .filename(&db_path)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal)
                .synchronous(SqliteSynchronous::Full)
                .foreign_keys(true)
                .log_statements(LevelFilter::Off);
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await
                .expect("connect sqlite");
            crate::db::apply_migrations(&pool)
                .await
                .expect("apply migrations");

            let mut conn = pool.acquire().await.expect("acquire connection");
            sqlx::query("PRAGMA foreign_keys = OFF;")
                .execute(conn.as_mut())
                .await
                .expect("disable foreign keys");
            sqlx::query("INSERT INTO notes (id, household_id, position, created_at, updated_at, z) VALUES ('n1','missing',0,0,0,0);")
                .execute(conn.as_mut())
                .await
                .expect("insert corrupt note");
            sqlx::query("PRAGMA foreign_keys = ON;")
                .execute(conn.as_mut())
                .await
                .expect("enable foreign keys");
            drop(conn);

            let report = crate::db::health::run_health_checks(&pool, &db_path)
                .await
                .expect("health checks");
            assert!(matches!(report.status, DbHealthStatus::Error));
            (pool, report)
        });
        drop(runtime);

        let attachments_root = dir.path().join("attachments");
        std::fs::create_dir_all(&attachments_root).expect("create attachments dir");
        let app_state = crate::state::AppState {
            pool: Arc::new(RwLock::new(pool.clone())),
            active_household_id: Arc::new(Mutex::new(String::from("test"))),
            store: crate::household_active::StoreHandle::in_memory(),
            backfill: Arc::new(Mutex::new(
                crate::events_tz_backfill::BackfillCoordinator::new(),
            )),
            db_health: Arc::new(Mutex::new(unhealthy_report.clone())),
            db_path: Arc::new(db_path.clone()),
            vault: Arc::new(Vault::new(attachments_root.clone())),
            vault_migration: Arc::new(
                crate::vault_migration::VaultMigrationManager::new(&attachments_root).unwrap(),
            ),
            maintenance: Arc::new(AtomicBool::new(false)),
        };

        let app = mock_builder()
            .manage(app_state)
            .invoke_handler(tauri::generate_handler![super::household_create])
            .build(mock_context(noop_assets()))
            .expect("build tauri app");

        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("create window");

        // Record count before attempting the blocked mutation
        let runtime = Runtime::new().expect("create runtime");
        let before = runtime.block_on(async {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM household")
                .fetch_one(&pool)
                .await
                .expect("query household count (before)")
        });
        drop(runtime);

        let payload = serde_json::json!({
            "data": { "name": "Blocked" }
        });

        let response = get_ipc_response(
            &window,
            invoke_request_with_payload("household_create", payload),
        );
        let err = response.expect_err("expected guard error");
        let obj = err.as_object().expect("error payload is object");
        assert_eq!(
            obj.get("code").and_then(|v| v.as_str()),
            Some(crate::ipc::guard::DB_UNHEALTHY_CODE)
        );
        assert_eq!(
            obj.get("message").and_then(|v| v.as_str()),
            Some(crate::ipc::guard::DB_UNHEALTHY_MESSAGE)
        );
        let health = obj
            .get("health_report")
            .and_then(|v| v.as_object())
            .expect("health report attached");
        assert_eq!(health.get("status").and_then(|v| v.as_str()), Some("error"));

        // Ensure the failed write did not change the household table size.
        let runtime = Runtime::new().expect("create runtime");
        let after = runtime.block_on(async {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM household")
                .fetch_one(&pool)
                .await
                .expect("query household count (after)")
        });
        drop(runtime);
        assert_eq!(after, before, "mutation should not have been applied");
    }
}
