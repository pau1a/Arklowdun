// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use once_cell::sync::OnceCell;
use paste::paste;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::{
    io::{self, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};
use thiserror::Error;
use tracing_appender::non_blocking::{NonBlocking, WorkerGuard};
use tracing_appender::non_blocking::NonBlockingBuilder;
use tracing_subscriber::{
    fmt::{self, time::UtcTime, MakeWriter},
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter,
};
use ts_rs::TS;

use crate::state::AppState;

const FILES_INDEX_VERSION: i64 = 1;

const DEFAULT_LOG_MAX_SIZE_BYTES: u64 = 5_000_000;
const DEFAULT_LOG_MAX_FILES: usize = 5;
const LOG_DIR_NAME: &str = "logs";
const LOG_FILE_NAME: &str = "arklowdun.log";

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
        Self { inner, buf: Vec::with_capacity(1024) }
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

mod attachments;
pub mod commands;
pub mod db;
pub mod error;
mod events_tz_backfill;
mod household; // declare module; avoid `use` to prevent name collision
mod id;
mod importer;
pub mod migrate;
mod repo;
pub mod security;
mod state;
mod time;
pub mod util;

pub use error::{AppError, AppResult, ErrorDto};
use events_tz_backfill::events_backfill_timezone;
use security::{error_map::UiError, fs_policy, fs_policy::RootKey, hash_path};
use util::{dispatch_app_result, dispatch_async_app_result};

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
        let file = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
        let len = file.metadata().map(|m| m.len()).unwrap_or(0);
        Ok(Self { path, max_bytes, max_files, file, len })
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
            let src = if i == 1 { self.path.clone() } else { self.suffixed(i - 1) };
            if src.exists() {
                let dst = self.suffixed(i);
                let _ = std::fs::rename(&src, &dst);
            }
        }

        // Create a new current file
        self.file = std::fs::OpenOptions::new().create(true).write(true).truncate(true).open(&self.path)?;
        self.len = 0;
        Ok(())
    }

    fn suffixed(&self, idx: usize) -> PathBuf {
        let mut p = self.path.clone();
        let file_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
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

    fn flush(&mut self) -> io::Result<()> { self.file.flush() }
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
        .with_writer(RotatingFileWriter::default())
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
    app: &tauri::AppHandle<R>,
) -> Result<(), FileLoggingError> {
    if FILE_LOG_WRITER.get().is_some() {
        return Ok(());
    }

    let logs_dir = resolve_logs_dir(app)?;
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
    let rotator = CountRotator::new(log_path.clone(), byte_limit, max_files)
        .map_err(|source| FileLoggingError::CreateFile { path: log_path.clone(), source })?;

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

fn resolve_logs_dir<R: tauri::Runtime>(
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
                    let pool = state.pool.clone();
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
                    let pool = state.pool.clone();
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
                    let pool = state.pool.clone();
                    dispatch_async_app_result(move || {
                        let data = data;
                        async move {
                            commands::create_command(
                                &pool,
                                stringify!($table),
                                data,
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
                    let pool = state.pool.clone();
                    dispatch_async_app_result(move || {
                        let household_id = household_id;
                        let id = id;
                        let data = data;
                        async move {
                            let hh = household_id.as_deref();
                            commands::update_command(
                                &pool,
                                stringify!($table),
                                &id,
                                data,
                                hh,
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
                    let pool = state.pool.clone();
                    dispatch_async_app_result(move || {
                        let household_id = household_id;
                        let id = id;
                        async move {
                            commands::delete_command(
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

                #[tauri::command]
                async fn [<$table _restore>](
                    state: State<'_, AppState>,
                    household_id: String,
                    id: String,
                ) -> AppResult<()> {
                    let pool = state.pool.clone();
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
    household,
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
    notes,
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

// Typed list for Dashboard (rich fields)
#[tauri::command]
async fn vehicles_list(
    state: State<'_, AppState>,
    household_id: String,
) -> AppResult<Vec<Vehicle>> {
    let pool = state.pool.clone();
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
    let pool = state.pool.clone();
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
    let pool = state.pool.clone();
    dispatch_async_app_result(move || {
        let data = data;
        async move { commands::create_command(&pool, "vehicles", data).await }
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
    let pool = state.pool.clone();
    dispatch_async_app_result(move || {
        let id = id;
        let data = data;
        let household_id = household_id;
        async move {
            commands::update_command(&pool, "vehicles", &id, data, household_id.as_deref()).await
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
    let pool = state.pool.clone();
    dispatch_async_app_result(move || {
        let household_id = household_id;
        let id = id;
        async move { commands::delete_command(&pool, "vehicles", &household_id, &id).await }
    })
    .await
}

#[tauri::command]
async fn vehicles_restore(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> AppResult<()> {
    let pool = state.pool.clone();
    dispatch_async_app_result(move || {
        let household_id = household_id;
        let id = id;
        async move { commands::restore_command(&pool, "vehicles", &household_id, &id).await }
    })
    .await
}

#[derive(Serialize, Deserialize, Clone, TS, sqlx::FromRow)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Event {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub household_id: String,
    pub title: String,
    #[ts(type = "number")]
    pub start_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub end_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tz: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub start_at_utc: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub end_at_utc: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[sqlx(default)]
    pub rrule: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[sqlx(default)]
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
    #[sqlx(default)]
    pub series_parent_id: Option<String>,
}

#[tauri::command]
async fn events_list_range(
    state: State<'_, AppState>,
    household_id: String,
    start: i64,
    end: i64,
) -> AppResult<Vec<Event>> {
    let pool = state.pool.clone();
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
    let pool = state.pool.clone();
    dispatch_async_app_result(move || {
        let data = data;
        async move { commands::create_command(&pool, "events", data).await }
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
    let pool = state.pool.clone();
    dispatch_async_app_result(move || {
        let id = id;
        let data = data;
        let household_id = household_id;
        async move { commands::update_command(&pool, "events", &id, data, Some(&household_id)).await }
    })
    .await
}

#[tauri::command]
async fn event_delete(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> AppResult<()> {
    let pool = state.pool.clone();
    dispatch_async_app_result(move || {
        let household_id = household_id;
        let id = id;
        async move { commands::delete_command(&pool, "events", &household_id, &id).await }
    })
    .await
}

#[tauri::command]
async fn event_restore(
    state: State<'_, AppState>,
    household_id: String,
    id: String,
) -> AppResult<()> {
    let pool = state.pool.clone();
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
    let pool = state.pool.clone();
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
async fn get_default_household_id(state: tauri::State<'_, state::AppState>) -> AppResult<String> {
    let state = state.clone();
    dispatch_async_app_result(move || async move {
        let guard = state.default_household_id.lock().map_err(|_| {
            AppError::new(
                "STATE/LOCK_POISONED",
                "Failed to access default household id",
            )
        })?;
        Ok(guard.clone())
    })
    .await
}

#[tauri::command]
fn set_default_household_id(state: tauri::State<state::AppState>, id: String) -> AppResult<()> {
    dispatch_app_result(move || {
        let requested_id = id.clone();
        let mut guard = state.default_household_id.lock().map_err(|_| {
            AppError::new(
                "STATE/LOCK_POISONED",
                "Failed to update default household id",
            )
            .with_context("requested_id", requested_id)
        })?;
        *guard = id;
        Ok(())
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportArgs {
    #[serde(alias = "household_id")]
    household_id: String,
    #[serde(alias = "dry_run")]
    dry_run: bool,
}

#[tauri::command]
async fn import_run_legacy(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
    args: ImportArgs,
) -> AppResult<()> {
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
    let pool = state.pool.clone();
    dispatch_async_app_result(move || async move { Ok(table_exists(&pool, &name).await) }).await
}

#[tauri::command]
async fn db_has_files_index(state: State<'_, AppState>) -> AppResult<bool> {
    let pool = state.pool.clone();
    dispatch_async_app_result(move || async move { Ok(table_exists(&pool, "files_index").await) })
        .await
}

#[tauri::command]
async fn db_files_index_ready(state: State<'_, AppState>, household_id: String) -> AppResult<bool> {
    let pool = state.pool.clone();
    dispatch_async_app_result(
        move || async move { Ok(files_index_ready(&pool, &household_id).await) },
    )
    .await
}

#[tauri::command]
async fn db_has_vehicle_columns(state: State<'_, AppState>) -> AppResult<bool> {
    let pool = state.pool.clone();
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
    let pool = state.pool.clone();
    dispatch_async_app_result(move || async move {
        if !table_exists(&pool, "pets").await {
            return Ok(false);
        }
        let cols = table_columns(&pool, "pets").await;
        Ok(cols.contains("name") || cols.contains("species") || cols.contains("type"))
    })
    .await
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
    let pool = state.pool.clone();
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

#[tauri::command]
async fn attachment_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    table: String,
    id: String,
) -> AppResult<()> {
    let pool = state.pool.clone();
    let app = app.clone();
    dispatch_async_app_result(move || {
        let table = table;
        let id = id;
        async move {
            let (root_key, rel) = attachments::load_attachment_columns(&pool, &table, &id).await?;
            let root = match root_key.as_str() {
                "attachments" => RootKey::Attachments,
                "appData" => RootKey::AppData,
                _ => RootKey::AppData,
            };
            let res = match fs_policy::canonicalize_and_verify(&rel, root, &app) {
                Ok(r) => r,
                Err(e) => {
                    let reason = e.name();
                    let ui: UiError = e.into();
                    log_fs_deny(root, &ui, reason);
                    return Err(AppError::from(ui)
                        .with_context("operation", "attachment_open")
                        .with_context("table", table.clone())
                        .with_context("id", id.clone()));
                }
            };
            if let Err(e) = fs_policy::reject_symlinks(&res.real_path) {
                let reason = e.name();
                let ui: UiError = e.into();
                log_fs_deny(root, &ui, reason);
                return Err(AppError::from(ui)
                    .with_context("operation", "attachment_open")
                    .with_context("table", table.clone())
                    .with_context("id", id.clone()));
            }
            log_fs_ok(root, &res.real_path);
            attachments::open_with_os(&res.real_path)
        }
    })
    .await
}

#[tauri::command]
async fn attachment_reveal(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    table: String,
    id: String,
) -> AppResult<()> {
    let pool = state.pool.clone();
    let app = app.clone();
    dispatch_async_app_result(move || {
        let table = table;
        let id = id;
        async move {
            let (root_key, rel) = attachments::load_attachment_columns(&pool, &table, &id).await?;
            let root = match root_key.as_str() {
                "attachments" => RootKey::Attachments,
                "appData" => RootKey::AppData,
                _ => RootKey::AppData,
            };
            let res = match fs_policy::canonicalize_and_verify(&rel, root, &app) {
                Ok(r) => r,
                Err(e) => {
                    let reason = e.name();
                    let ui: UiError = e.into();
                    log_fs_deny(root, &ui, reason);
                    return Err(AppError::from(ui)
                        .with_context("operation", "attachment_reveal")
                        .with_context("table", table.clone())
                        .with_context("id", id.clone()));
                }
            };
            if let Err(e) = fs_policy::reject_symlinks(&res.real_path) {
                let reason = e.name();
                let ui: UiError = e.into();
                log_fs_deny(root, &ui, reason);
                return Err(AppError::from(ui)
                    .with_context("operation", "attachment_reveal")
                    .with_context("table", table.clone())
                    .with_context("id", id.clone()));
            }
            log_fs_ok(root, &res.real_path);
            attachments::reveal_with_os(&res.real_path)
        }
    })
    .await
}

#[tauri::command]
async fn open_path(app: tauri::AppHandle, path: String) -> AppResult<()> {
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

#[macro_export]
macro_rules! app_commands {
    ($($extra:ident),* $(,)?) => {
        tauri::generate_handler![
            events_backfill_timezone,
            events_list_range,
            event_create,
            event_update,
            event_delete,
            event_restore,
            get_default_household_id,
            household_list,
            household_get,
            household_create,
            household_update,
            household_delete,
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
            notes_list,
            notes_get,
            notes_create,
            notes_update,
            notes_delete,
            notes_restore,
            shopping_items_list,
            shopping_items_get,
            shopping_items_create,
            shopping_items_update,
            shopping_items_delete,
            shopping_items_restore,
            attachment_open,
            attachment_reveal,
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
        .setup(|app| {
            let handle = app.handle();
            if let Err(err) = crate::init_file_logging(&handle) {
                tracing::warn!(
                    target: "arklowdun",
                    event = "file_logging_disabled",
                    error = %err
                );
            }
            #[allow(clippy::needless_borrow)]
            let pool = tauri::async_runtime::block_on(crate::db::open_sqlite_pool(&handle))?;
            tauri::async_runtime::block_on(crate::db::apply_migrations(&pool))?;
            tauri::async_runtime::block_on(async {
                if let Ok(cols) = sqlx::query("PRAGMA table_info(events);").fetch_all(&pool).await {
                    let names: Vec<String> = cols
                        .into_iter()
                        .filter_map(|r| r.try_get::<String, _>("name").ok())
                        .collect();
                    let has_start = names.iter().any(|n| n == "start_at");
                    let has_end = names.iter().any(|n| n == "end_at");
                    tracing::info!(target: "arklowdun", event = "events_table_columns", has_start_at=%has_start, has_end_at=%has_end);
                }
            });
            let hh = tauri::async_runtime::block_on(crate::household::default_household_id(&pool))?;
            app.manage(crate::state::AppState {
                pool: pool.clone(),
                default_household_id: Arc::new(Mutex::new(hh)),
            });
            Ok(())
        })
        .invoke_handler(app_commands![
            search_entities,
            import_run_legacy,
            open_path,
            get_default_household_id,
            set_default_household_id,
            db_table_exists,
            db_has_files_index,
            db_files_index_ready,
            db_has_vehicle_columns,
            db_has_pet_columns
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
