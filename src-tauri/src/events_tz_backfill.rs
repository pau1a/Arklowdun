use chrono::{LocalResult, NaiveDateTime, Offset, TimeZone, Utc};
use chrono_tz::Tz;
use serde::Serialize;
use serde_json::json;
use sqlx::{Error as SqlxError, Row, Sqlite, SqlitePool, Transaction};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::{fmt, path::PathBuf, sync::Arc, time::Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::time::{sleep, Duration};
use tracing::{info, warn};

use crate::{state::AppState, time::now_ms, util::dispatch_async_app_result, AppError, AppResult};

const OPERATION: &str = "events_backfill_timezone";
const CHECKPOINT_TABLE: &str = "events_backfill_checkpoint";
pub const MIN_CHUNK_SIZE: usize = 100;
pub const MAX_CHUNK_SIZE: usize = 5_000;
pub const MIN_PROGRESS_INTERVAL_MS: u64 = 250;
pub const MAX_PROGRESS_INTERVAL_MS: u64 = 60_000;
const DEFAULT_CHUNK_SIZE: usize = 500;
const MAX_SKIP_LOG_EXAMPLES: usize = 50;
const BUSY_RETRY_MAX_ATTEMPTS: usize = 5;
const BUSY_RETRY_BASE_DELAY_MS: u64 = 150;

#[derive(Debug, Clone)]
pub struct BackfillOptions {
    pub household_id: String,
    pub default_tz: Option<String>,
    pub chunk_size: usize,
    pub progress_interval_ms: u64,
    pub dry_run: bool,
    pub reset_checkpoint: bool,
}

pub type ProgressCallback = Arc<dyn Fn(BackfillProgress) + Send + Sync + 'static>;

#[derive(Debug, Clone, Serialize)]
pub struct BackfillProgress {
    pub household_id: String,
    pub scanned: u64,
    pub updated: u64,
    pub skipped: u64,
    pub remaining: u64,
    pub elapsed_ms: u64,
    pub chunk_size: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackfillSummary {
    pub household_id: String,
    pub total_scanned: u64,
    pub total_updated: u64,
    pub total_skipped: u64,
    pub elapsed_ms: u64,
    pub status: BackfillStatus,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BackfillStatus {
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackfillCheckpointStatus {
    pub processed: u64,
    pub updated: u64,
    pub skipped: u64,
    pub total: u64,
    pub remaining: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackfillStatusReport {
    pub running: Option<String>,
    pub checkpoint: Option<BackfillCheckpointStatus>,
    pub pending: u64,
}

#[derive(Debug, Clone)]
pub struct BackfillControl {
    id: u64,
    cancelled: Arc<AtomicBool>,
}

impl BackfillControl {
    fn next_id() -> u64 {
        static NEXT_ID: AtomicU64 = AtomicU64::new(1);
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    }

    pub fn new() -> Self {
        Self {
            id: Self::next_id(),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn id(&self) -> u64 {
        self.id
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Default)]
pub struct BackfillCoordinator {
    active: Option<ActiveBackfill>,
}

#[derive(Debug)]
struct ActiveBackfill {
    control: BackfillControl,
    household_id: String,
}

impl BackfillCoordinator {
    pub fn new() -> Self {
        Self { active: None }
    }

    pub fn try_start(&mut self, household_id: &str) -> AppResult<BackfillControl> {
        if self.active.is_some() {
            return Err(AppError::new(
                "BACKFILL/ALREADY_RUNNING",
                "Timezone backfill already running",
            )
            .with_context("operation", OPERATION)
            .with_context("household_id", household_id.to_string()));
        }
        let control = BackfillControl::new();
        self.active = Some(ActiveBackfill {
            control: control.clone(),
            household_id: household_id.to_string(),
        });
        Ok(control)
    }

    pub fn finish(&mut self, control_id: u64) {
        if let Some(active) = &self.active {
            if active.control.id() == control_id {
                self.active = None;
            }
        }
    }

    pub fn cancel(&mut self) -> bool {
        if let Some(active) = &self.active {
            active.control.cancel();
            return true;
        }
        false
    }

    pub fn running_household(&self) -> Option<String> {
        self.active
            .as_ref()
            .map(|active| active.household_id.clone())
    }

    pub fn control_clone(&self) -> Option<BackfillControl> {
        self.active.as_ref().map(|active| active.control.clone())
    }
}

#[derive(Debug, Clone)]
struct Checkpoint {
    last_rowid: i64,
    processed: u64,
    updated: u64,
    skipped: u64,
    total: u64,
}

#[derive(Debug)]
enum SkipReason {
    MissingTimezone,
    InvalidTimezone { value: String },
    InvalidTimestamp { field: &'static str, error: String },
}

impl fmt::Display for SkipReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SkipReason::MissingTimezone => write!(f, "no timezone available"),
            SkipReason::InvalidTimezone { value } => {
                write!(f, "invalid timezone '{value}' and no fallback provided")
            }
            SkipReason::InvalidTimestamp { field, error } => {
                write!(f, "invalid {field} timestamp: {error}")
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
struct SkipLogEntry {
    event_id: String,
    rowid: i64,
    reason: String,
}

fn capture_skip_example(
    samples: &mut Vec<SkipLogEntry>,
    event_id: &str,
    rowid: i64,
    reason: &SkipReason,
) {
    if samples.len() >= MAX_SKIP_LOG_EXAMPLES {
        return;
    }
    samples.push(SkipLogEntry {
        event_id: event_id.to_string(),
        rowid,
        reason: reason.to_string(),
    });
}

fn sanitize_chunk_size(requested: usize) -> AppResult<usize> {
    if !(MIN_CHUNK_SIZE..=MAX_CHUNK_SIZE).contains(&requested) {
        return Err(AppError::new(
            "BACKFILL/INVALID_CHUNK_SIZE",
            format!(
                "Chunk size {requested} is outside the supported range ({min}-{max}).",
                min = MIN_CHUNK_SIZE,
                max = MAX_CHUNK_SIZE
            ),
        )
        .with_context("operation", OPERATION)
        .with_context("step", "validate_options")
        .with_context("chunk_size", requested.to_string()));
    }
    Ok(requested)
}

fn sanitize_progress_interval(requested: u64) -> AppResult<u64> {
    if requested == 0 {
        return Ok(1_000);
    }
    if !(MIN_PROGRESS_INTERVAL_MS..=MAX_PROGRESS_INTERVAL_MS).contains(&requested) {
        return Err(AppError::new(
            "BACKFILL/INVALID_PROGRESS_INTERVAL",
            format!(
                "Progress interval {requested}ms is outside the supported range ({min}-{max}ms).",
                min = MIN_PROGRESS_INTERVAL_MS,
                max = MAX_PROGRESS_INTERVAL_MS
            ),
        )
        .with_context("operation", OPERATION)
        .with_context("step", "validate_options")
        .with_context("progress_interval", requested.to_string()));
    }
    Ok(requested)
}

fn is_sqlite_locked(err: &SqlxError) -> bool {
    match err {
        SqlxError::Database(db_err) => {
            if let Some(code) = db_err.code().as_deref() {
                if code == "5" || code == "6" {
                    return true;
                }
            }
            let message = db_err.message();
            message.contains("database is locked") || message.contains("database table is locked")
        }
        _ => false,
    }
}

async fn begin_tx_with_retry<'a>(
    pool: &'a SqlitePool,
    household_id: &str,
) -> AppResult<Transaction<'a, Sqlite>> {
    let mut attempt = 0usize;
    loop {
        match pool.begin().await {
            Ok(tx) => return Ok(tx),
            Err(err) => {
                if is_sqlite_locked(&err) && attempt < BUSY_RETRY_MAX_ATTEMPTS {
                    attempt += 1;
                    let wait = Duration::from_millis(BUSY_RETRY_BASE_DELAY_MS * attempt as u64);
                    warn!(
                        target: "arklowdun",
                        event = "events_backfill_retry",
                        household_id = %household_id,
                        attempt = attempt,
                        wait_ms = wait.as_millis(),
                        "database is locked; retrying..."
                    );
                    sleep(wait).await;
                    continue;
                }
                return Err(AppError::from(err)
                    .with_context("operation", OPERATION)
                    .with_context("step", "begin_tx")
                    .with_context("household_id", household_id.to_string()));
            }
        }
    }
}

/// Legacy `start_at` values were stored as local wall-clock milliseconds with no
/// timezone. Interpret `local_ms` using `tz` and return the corresponding UTC
/// instant. Ambiguous times during a DST fall-back choose the earlier
/// occurrence; gaps choose the earliest valid instant after the gap.
fn to_utc_ms(local_ms: i64, tz: Tz) -> AppResult<i64> {
    #[allow(deprecated)]
    let naive = NaiveDateTime::from_timestamp_millis(local_ms).ok_or_else(|| {
        AppError::new("TIME/INVALID_TIMESTAMP", "Invalid local timestamp")
            .with_context("local_ms", local_ms.to_string())
    })?;
    let local = match tz.from_local_datetime(&naive) {
        LocalResult::Single(dt) => dt,
        LocalResult::Ambiguous(a, _b) => a,
        LocalResult::None => tz
            .offset_from_utc_datetime(&naive)
            .fix()
            .from_utc_datetime(&naive)
            .with_timezone(&tz),
    };
    Ok(local.with_timezone(&Utc).timestamp_millis())
}

fn sanitize_tz(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn parse_named_timezone(name: &str) -> AppResult<Tz> {
    name.parse().map_err(|_| {
        AppError::new("BACKFILL/INVALID_TIMEZONE", "Invalid timezone identifier")
            .with_context("operation", OPERATION)
            .with_context("step", "parse_timezone")
            .with_context("timezone", name.to_string())
    })
}

async fn fetch_household_tz(pool: &SqlitePool, household_id: &str) -> AppResult<Option<String>> {
    let row = sqlx::query("SELECT tz FROM household WHERE id = ?1")
        .bind(household_id)
        .fetch_optional(pool)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", OPERATION)
                .with_context("step", "fetch_household_tz")
                .with_context("household_id", household_id.to_string())
        })?;

    let Some(row) = row else {
        return Err(
            AppError::new("BACKFILL/UNKNOWN_HOUSEHOLD", "Household does not exist")
                .with_context("operation", OPERATION)
                .with_context("household_id", household_id.to_string()),
        );
    };

    row.try_get::<Option<String>, _>("tz")
        .map(sanitize_tz)
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", OPERATION)
                .with_context("step", "read_household_tz")
                .with_context("household_id", household_id.to_string())
        })
}

fn choose_timezone(row_tz: Option<&str>, fallback: Option<Tz>) -> Result<Tz, SkipReason> {
    if let Some(name) = row_tz {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            match trimmed.parse::<Tz>() {
                Ok(tz) => return Ok(tz),
                Err(_) => {
                    if let Some(fallback) = fallback {
                        return Ok(fallback);
                    }
                    return Err(SkipReason::InvalidTimezone {
                        value: trimmed.to_string(),
                    });
                }
            }
        }
    }
    fallback.ok_or(SkipReason::MissingTimezone)
}

async fn ensure_checkpoint_table(pool: &SqlitePool) -> AppResult<()> {
    let sql = format!(
        "CREATE TABLE IF NOT EXISTS {CHECKPOINT_TABLE} (
            household_id TEXT PRIMARY KEY,
            last_rowid INTEGER NOT NULL DEFAULT 0,
            processed INTEGER NOT NULL DEFAULT 0,
            updated INTEGER NOT NULL DEFAULT 0,
            skipped INTEGER NOT NULL DEFAULT 0,
            total INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        )"
    );
    sqlx::query(&sql)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", OPERATION)
                .with_context("step", "ensure_checkpoint_table")
        })
}

async fn reset_checkpoint(pool: &SqlitePool, household_id: &str) -> AppResult<()> {
    let sql = format!("DELETE FROM {CHECKPOINT_TABLE} WHERE household_id=?1");
    sqlx::query(&sql)
        .bind(household_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", OPERATION)
                .with_context("step", "reset_checkpoint")
                .with_context("household_id", household_id.to_string())
        })
}

fn to_u64(value: i64, field: &'static str, household_id: &str) -> AppResult<u64> {
    u64::try_from(value).map_err(|_| {
        AppError::new(
            "BACKFILL/INVALID_CHECKPOINT",
            "Checkpoint value became negative",
        )
        .with_context("operation", OPERATION)
        .with_context("step", "load_checkpoint")
        .with_context("field", field.to_string())
        .with_context("household_id", household_id.to_string())
    })
}

fn to_i64(value: u64, field: &'static str, household_id: &str) -> AppResult<i64> {
    i64::try_from(value).map_err(|_| {
        AppError::new(
            "BACKFILL/CHECKPOINT_OVERFLOW",
            "Checkpoint value overflowed i64",
        )
        .with_context("operation", OPERATION)
        .with_context("step", "store_checkpoint")
        .with_context("field", field.to_string())
        .with_context("household_id", household_id.to_string())
    })
}

async fn fetch_checkpoint(pool: &SqlitePool, household_id: &str) -> AppResult<Option<Checkpoint>> {
    let sql = format!(
        "SELECT last_rowid, processed, updated, skipped, total FROM {CHECKPOINT_TABLE} WHERE household_id=?1"
    );
    let row = sqlx::query(&sql)
        .bind(household_id)
        .fetch_optional(pool)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", OPERATION)
                .with_context("step", "fetch_checkpoint")
                .with_context("household_id", household_id.to_string())
        })?;

    let Some(row) = row else {
        return Ok(None);
    };

    let last_rowid: i64 = row.try_get("last_rowid").map_err(|err| {
        AppError::from(err)
            .with_context("operation", OPERATION)
            .with_context("step", "read_checkpoint_last_rowid")
            .with_context("household_id", household_id.to_string())
    })?;
    let processed = to_u64(
        row.try_get("processed").map_err(|err| {
            AppError::from(err)
                .with_context("operation", OPERATION)
                .with_context("step", "read_checkpoint_processed")
                .with_context("household_id", household_id.to_string())
        })?,
        "processed",
        household_id,
    )?;
    let updated = to_u64(
        row.try_get("updated").map_err(|err| {
            AppError::from(err)
                .with_context("operation", OPERATION)
                .with_context("step", "read_checkpoint_updated")
                .with_context("household_id", household_id.to_string())
        })?,
        "updated",
        household_id,
    )?;
    let skipped = to_u64(
        row.try_get("skipped").map_err(|err| {
            AppError::from(err)
                .with_context("operation", OPERATION)
                .with_context("step", "read_checkpoint_skipped")
                .with_context("household_id", household_id.to_string())
        })?,
        "skipped",
        household_id,
    )?;
    let total = to_u64(
        row.try_get("total").map_err(|err| {
            AppError::from(err)
                .with_context("operation", OPERATION)
                .with_context("step", "read_checkpoint_total")
                .with_context("household_id", household_id.to_string())
        })?,
        "total",
        household_id,
    )?;

    Ok(Some(Checkpoint {
        last_rowid,
        processed,
        updated,
        skipped,
        total,
    }))
}

async fn insert_checkpoint(
    pool: &SqlitePool,
    household_id: &str,
    total: u64,
) -> AppResult<Checkpoint> {
    let sql = format!(
        "INSERT INTO {CHECKPOINT_TABLE} (household_id, last_rowid, processed, updated, skipped, total, updated_at)
         VALUES (?1, 0, 0, 0, 0, ?2, ?3)"
    );
    sqlx::query(&sql)
        .bind(household_id)
        .bind(to_i64(total, "total", household_id)?)
        .bind(now_ms())
        .execute(pool)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", OPERATION)
                .with_context("step", "insert_checkpoint")
                .with_context("household_id", household_id.to_string())
        })?;

    Ok(Checkpoint {
        last_rowid: 0,
        processed: 0,
        updated: 0,
        skipped: 0,
        total,
    })
}

async fn update_checkpoint_total(
    pool: &SqlitePool,
    household_id: &str,
    total: u64,
) -> AppResult<()> {
    let sql =
        format!("UPDATE {CHECKPOINT_TABLE} SET total=?1, updated_at=?2 WHERE household_id=?3");
    sqlx::query(&sql)
        .bind(to_i64(total, "total", household_id)?)
        .bind(now_ms())
        .bind(household_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", OPERATION)
                .with_context("step", "update_checkpoint_total")
                .with_context("household_id", household_id.to_string())
        })
}

async fn update_checkpoint_record(
    tx: &mut Transaction<'_, Sqlite>,
    household_id: &str,
    checkpoint: &Checkpoint,
) -> AppResult<()> {
    let sql = format!(
        "UPDATE {CHECKPOINT_TABLE}
            SET last_rowid=?1,
                processed=?2,
                updated=?3,
                skipped=?4,
                total=?5,
                updated_at=?6
          WHERE household_id=?7"
    );
    sqlx::query(&sql)
        .bind(checkpoint.last_rowid)
        .bind(to_i64(checkpoint.processed, "processed", household_id)?)
        .bind(to_i64(checkpoint.updated, "updated", household_id)?)
        .bind(to_i64(checkpoint.skipped, "skipped", household_id)?)
        .bind(to_i64(checkpoint.total, "total", household_id)?)
        .bind(now_ms())
        .bind(household_id)
        .execute(&mut **tx)
        .await
        .map(|_| ())
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", OPERATION)
                .with_context("step", "update_checkpoint")
                .with_context("household_id", household_id.to_string())
        })
}

async fn count_pending_after(
    pool: &SqlitePool,
    household_id: &str,
    after_rowid: i64,
) -> AppResult<u64> {
    let sql = "SELECT COUNT(*) as cnt FROM events
        WHERE household_id=?1
          AND rowid > ?2
          AND (
            start_at_utc IS NULL
            OR (end_at IS NOT NULL AND end_at_utc IS NULL)
            OR tz IS NULL
            OR COALESCE(LENGTH(TRIM(tz)), 0) = 0
          )";
    let count: i64 = sqlx::query_scalar(sql)
        .bind(household_id)
        .bind(after_rowid)
        .fetch_one(pool)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", OPERATION)
                .with_context("step", "count_pending")
                .with_context("household_id", household_id.to_string())
        })?;
    to_u64(count, "pending", household_id)
}

fn log_skip(household_id: &str, event_id: &str, rowid: i64, reason: &SkipReason) {
    warn!(
        target: "arklowdun",
        event = "events_backfill_skip",
        household_id = %household_id,
        event_id = %event_id,
        rowid = rowid,
        reason = %reason
    );
}

fn emit_progress(callback: Option<&ProgressCallback>, progress: BackfillProgress) {
    if let Some(cb) = callback {
        (**cb)(progress);
    }
}

fn make_progress(
    household_id: &str,
    scanned: u64,
    updated: u64,
    skipped: u64,
    total: u64,
    elapsed_ms: u64,
    chunk_size: usize,
) -> BackfillProgress {
    let remaining = total.saturating_sub(scanned);
    BackfillProgress {
        household_id: household_id.to_string(),
        scanned,
        updated,
        skipped,
        remaining,
        elapsed_ms,
        chunk_size,
    }
}

fn map_row_error(
    err: sqlx::Error,
    field: &'static str,
    household_id: &str,
    event_id: Option<&str>,
) -> AppError {
    let mut app_err = AppError::from(err)
        .with_context("operation", OPERATION)
        .with_context("step", "read_event_row")
        .with_context("field", field.to_string())
        .with_context("household_id", household_id.to_string());
    if let Some(id) = event_id {
        app_err = app_err.with_context("event_id", id.to_string());
    }
    app_err
}

async fn run_dry_run(
    pool: &SqlitePool,
    options: &BackfillOptions,
    fallback: Option<Tz>,
    chunk_size: usize,
    progress_interval: Duration,
    control: Option<&BackfillControl>,
    progress_cb: Option<&ProgressCallback>,
) -> AppResult<(BackfillSummary, Vec<SkipLogEntry>)> {
    let mut scanned = 0u64;
    let mut updated = 0u64;
    let mut skipped = 0u64;
    let mut last_rowid = 0i64;
    let total = count_pending_after(pool, &options.household_id, 0).await?;
    let mut skip_examples = Vec::new();

    let start = Instant::now();
    let mut last_emit = Instant::now();

    emit_progress(
        progress_cb,
        make_progress(
            &options.household_id,
            scanned,
            updated,
            skipped,
            total,
            0,
            chunk_size,
        ),
    );

    loop {
        let sql = r#"
            SELECT rowid, id, start_at, end_at, tz
            FROM events
            WHERE household_id = ?1
              AND rowid > ?2
              AND (
                start_at_utc IS NULL
                OR (end_at IS NOT NULL AND end_at_utc IS NULL)
                OR tz IS NULL
                OR COALESCE(LENGTH(TRIM(tz)), 0) = 0
              )
            ORDER BY rowid
            LIMIT ?3
        "#;
        let rows = sqlx::query(sql)
            .bind(&options.household_id)
            .bind(last_rowid)
            .bind(chunk_size as i64)
            .fetch_all(pool)
            .await
            .map_err(|err| {
                AppError::from(err)
                    .with_context("operation", OPERATION)
                    .with_context("step", "load_chunk")
                    .with_context("household_id", options.household_id.clone())
            })?;

        if rows.is_empty() {
            break;
        }

        let mut chunk_last_rowid = last_rowid;

        for row in rows {
            let rowid: i64 = row
                .try_get("rowid")
                .map_err(|err| map_row_error(err, "rowid", &options.household_id, None))?;
            let event_id: String = row
                .try_get("id")
                .map_err(|err| map_row_error(err, "id", &options.household_id, None))?;
            let start_at: i64 = row.try_get("start_at").map_err(|err| {
                map_row_error(err, "start_at", &options.household_id, Some(&event_id))
            })?;
            let end_at: Option<i64> = row.try_get("end_at").map_err(|err| {
                map_row_error(err, "end_at", &options.household_id, Some(&event_id))
            })?;
            let tz_str: Option<String> = row
                .try_get("tz")
                .map_err(|err| map_row_error(err, "tz", &options.household_id, Some(&event_id)))?;

            scanned += 1;
            chunk_last_rowid = rowid;

            let tz = match choose_timezone(tz_str.as_deref(), fallback) {
                Ok(tz) => tz,
                Err(reason) => {
                    skipped += 1;
                    log_skip(&options.household_id, &event_id, rowid, &reason);
                    capture_skip_example(&mut skip_examples, &event_id, rowid, &reason);
                    continue;
                }
            };

            let start_utc = match to_utc_ms(start_at, tz) {
                Ok(v) => v,
                Err(err) => {
                    skipped += 1;
                    let reason = SkipReason::InvalidTimestamp {
                        field: "start_at",
                        error: err.to_string(),
                    };
                    log_skip(&options.household_id, &event_id, rowid, &reason);
                    capture_skip_example(&mut skip_examples, &event_id, rowid, &reason);
                    continue;
                }
            };

            if let Some(end_local) = end_at {
                if let Err(err) = to_utc_ms(end_local, tz) {
                    skipped += 1;
                    let reason = SkipReason::InvalidTimestamp {
                        field: "end_at",
                        error: err.to_string(),
                    };
                    log_skip(&options.household_id, &event_id, rowid, &reason);
                    capture_skip_example(&mut skip_examples, &event_id, rowid, &reason);
                    continue;
                }
            }

            let _ = start_utc;
            updated += 1;

            if last_emit.elapsed() >= progress_interval {
                let elapsed = start.elapsed().as_millis() as u64;
                emit_progress(
                    progress_cb,
                    make_progress(
                        &options.household_id,
                        scanned,
                        updated,
                        skipped,
                        total,
                        elapsed,
                        chunk_size,
                    ),
                );
                last_emit = Instant::now();
            }

            if control.map(|c| c.is_cancelled()).unwrap_or(false) {
                break;
            }
        }

        if chunk_last_rowid != last_rowid {
            last_rowid = chunk_last_rowid;
        }

        if control.map(|c| c.is_cancelled()).unwrap_or(false) {
            break;
        }
    }

    let elapsed_ms = start.elapsed().as_millis() as u64;

    emit_progress(
        progress_cb,
        make_progress(
            &options.household_id,
            scanned,
            updated,
            skipped,
            total,
            elapsed_ms,
            chunk_size,
        ),
    );

    let mut status = BackfillStatus::Completed;
    if control.map(|c| c.is_cancelled()).unwrap_or(false) {
        status = BackfillStatus::Cancelled;
    }

    let summary = BackfillSummary {
        household_id: options.household_id.clone(),
        total_scanned: scanned,
        total_updated: updated,
        total_skipped: skipped,
        elapsed_ms,
        status,
    };

    info!(
        target: "arklowdun",
        event = "events_backfill_summary",
        household_id = %summary.household_id,
        dry_run = options.dry_run,
        total_scanned = summary.total_scanned,
        total_updated = summary.total_updated,
        total_skipped = summary.total_skipped,
        elapsed_ms = summary.elapsed_ms
    );

    Ok((summary, skip_examples))
}

fn write_summary_log(
    log_dir: Option<PathBuf>,
    summary: &BackfillSummary,
    dry_run: bool,
    skip_examples: &[SkipLogEntry],
) {
    if let Some(mut dir) = log_dir {
        dir.push("logs");
        if let Err(err) = std::fs::create_dir_all(&dir) {
            warn!(
                target: "arklowdun",
                event = "events_backfill_log_dir_failed",
                path = %dir.display(),
                error = %err
            );
            return;
        }
        let file = dir.join(format!(
            "events_tz_backfill_{}_{}.json",
            summary.household_id,
            now_ms()
        ));
        let payload = if skip_examples.is_empty() {
            json!({
                "dry_run": dry_run,
                "summary": summary,
            })
        } else {
            json!({
                "dry_run": dry_run,
                "summary": summary,
                "skip_examples": skip_examples,
            })
        };
        match serde_json::to_vec_pretty(&payload) {
            Ok(data) => {
                if let Err(err) = std::fs::write(&file, data) {
                    warn!(
                        target: "arklowdun",
                        event = "events_backfill_log_write_failed",
                        path = %file.display(),
                        error = %err
                    );
                }
            }
            Err(err) => warn!(
                target: "arklowdun",
                event = "events_backfill_log_encode_failed",
                error = %err
            ),
        }
    }
}

async fn resolve_fallback_tz(
    pool: &SqlitePool,
    options: &BackfillOptions,
) -> AppResult<(Option<Tz>, Option<String>)> {
    let household_tz = fetch_household_tz(pool, &options.household_id).await?;
    if let Some(ref explicit) = options.default_tz {
        let tz = parse_named_timezone(explicit)?;
        return Ok((Some(tz), Some(explicit.clone())));
    }
    if let Some(ref stored) = household_tz {
        let tz = parse_named_timezone(stored)?;
        return Ok((Some(tz), Some(stored.clone())));
    }
    Ok((None, None))
}

pub async fn run_events_backfill(
    pool: &SqlitePool,
    options: BackfillOptions,
    log_dir: Option<PathBuf>,
    control: Option<BackfillControl>,
    progress_cb: Option<ProgressCallback>,
) -> AppResult<BackfillSummary> {
    let chunk_size = sanitize_chunk_size(options.chunk_size)?;
    let progress_ms = sanitize_progress_interval(options.progress_interval_ms)?;
    let progress_interval = Duration::from_millis(progress_ms);

    let (fallback_tz, fallback_label) = resolve_fallback_tz(pool, &options).await?;

    info!(
        target: "arklowdun",
        event = "events_backfill_start",
        household_id = %options.household_id,
        chunk_size,
        progress_interval_ms = progress_ms,
        dry_run = options.dry_run,
        fallback_tz = fallback_label.as_deref().unwrap_or("<none>")
    );

    let progress_cb_ref = progress_cb.as_ref();
    let control_ref = control.as_ref();

    if options.dry_run {
        let (summary, skip_examples) = run_dry_run(
            pool,
            &options,
            fallback_tz,
            chunk_size,
            progress_interval,
            control_ref,
            progress_cb_ref,
        )
        .await?;
        write_summary_log(log_dir, &summary, true, &skip_examples);
        return Ok(summary);
    }

    ensure_checkpoint_table(pool).await?;
    if options.reset_checkpoint {
        reset_checkpoint(pool, &options.household_id).await?;
    }

    let mut checkpoint = match fetch_checkpoint(pool, &options.household_id).await? {
        Some(cp) => cp,
        None => {
            let total = count_pending_after(pool, &options.household_id, 0).await?;
            insert_checkpoint(pool, &options.household_id, total).await?
        }
    };

    let processed_at_start = checkpoint.processed;

    let pending_after =
        count_pending_after(pool, &options.household_id, checkpoint.last_rowid).await?;
    checkpoint.total = checkpoint.processed + pending_after;
    if checkpoint.total < checkpoint.processed {
        checkpoint.total = checkpoint.processed;
    }
    update_checkpoint_total(pool, &options.household_id, checkpoint.total).await?;

    emit_progress(
        progress_cb_ref,
        make_progress(
            &options.household_id,
            checkpoint.processed,
            checkpoint.updated,
            checkpoint.skipped,
            checkpoint.total,
            0,
            chunk_size,
        ),
    );

    let start = Instant::now();
    let mut last_emit = Instant::now();
    let mut updated_this_run = 0u64;
    let mut skipped_this_run = 0u64;
    let mut skip_examples = Vec::new();

    loop {
        if control_ref.map(|c| c.is_cancelled()).unwrap_or(false) {
            break;
        }

        let mut tx = begin_tx_with_retry(pool, &options.household_id).await?;

        let sql = r#"
            SELECT rowid, id, start_at, end_at, tz
            FROM events
            WHERE household_id = ?1
              AND rowid > ?2
              AND (
                start_at_utc IS NULL
                OR (end_at IS NOT NULL AND end_at_utc IS NULL)
                OR tz IS NULL
                OR COALESCE(LENGTH(TRIM(tz)), 0) = 0
              )
            ORDER BY rowid
            LIMIT ?3
        "#;
        let rows = sqlx::query(sql)
            .bind(&options.household_id)
            .bind(checkpoint.last_rowid)
            .bind(chunk_size as i64)
            .fetch_all(&mut *tx)
            .await
            .map_err(|err| {
                AppError::from(err)
                    .with_context("operation", OPERATION)
                    .with_context("step", "load_chunk")
                    .with_context("household_id", options.household_id.clone())
            })?;

        if rows.is_empty() {
            let _ = tx.rollback().await;
            break;
        }

        let mut chunk_last_rowid = checkpoint.last_rowid;

        for row in rows {
            let rowid: i64 = row
                .try_get("rowid")
                .map_err(|err| map_row_error(err, "rowid", &options.household_id, None))?;
            let event_id: String = row
                .try_get("id")
                .map_err(|err| map_row_error(err, "id", &options.household_id, None))?;
            let start_at: i64 = row.try_get("start_at").map_err(|err| {
                map_row_error(err, "start_at", &options.household_id, Some(&event_id))
            })?;
            let end_at: Option<i64> = row.try_get("end_at").map_err(|err| {
                map_row_error(err, "end_at", &options.household_id, Some(&event_id))
            })?;
            let tz_str: Option<String> = row
                .try_get("tz")
                .map_err(|err| map_row_error(err, "tz", &options.household_id, Some(&event_id)))?;

            checkpoint.processed += 1;
            chunk_last_rowid = rowid;

            let tz = match choose_timezone(tz_str.as_deref(), fallback_tz) {
                Ok(tz) => tz,
                Err(reason) => {
                    checkpoint.skipped += 1;
                    skipped_this_run += 1;
                    log_skip(&options.household_id, &event_id, rowid, &reason);
                    capture_skip_example(&mut skip_examples, &event_id, rowid, &reason);
                    continue;
                }
            };

            let start_utc = match to_utc_ms(start_at, tz) {
                Ok(v) => v,
                Err(err) => {
                    checkpoint.skipped += 1;
                    skipped_this_run += 1;
                    let reason = SkipReason::InvalidTimestamp {
                        field: "start_at",
                        error: err.to_string(),
                    };
                    log_skip(&options.household_id, &event_id, rowid, &reason);
                    capture_skip_example(&mut skip_examples, &event_id, rowid, &reason);
                    continue;
                }
            };

            let end_utc = match end_at {
                Some(end_local) => match to_utc_ms(end_local, tz) {
                    Ok(v) => Some(v),
                    Err(err) => {
                        checkpoint.skipped += 1;
                        skipped_this_run += 1;
                        let reason = SkipReason::InvalidTimestamp {
                            field: "end_at",
                            error: err.to_string(),
                        };
                        log_skip(&options.household_id, &event_id, rowid, &reason);
                        capture_skip_example(&mut skip_examples, &event_id, rowid, &reason);
                        continue;
                    }
                },
                None => None,
            };

            sqlx::query(
                "UPDATE events SET tz = ?1, start_at_utc = ?2, end_at_utc = ?3 WHERE rowid = ?4",
            )
            .bind(tz.name())
            .bind(start_utc)
            .bind(end_utc)
            .bind(rowid)
            .execute(&mut *tx)
            .await
            .map_err(|err| {
                AppError::from(err)
                    .with_context("operation", OPERATION)
                    .with_context("step", "update_event")
                    .with_context("household_id", options.household_id.clone())
                    .with_context("event_id", event_id.clone())
            })?;

            checkpoint.updated += 1;
            updated_this_run += 1;
        }

        if chunk_last_rowid != checkpoint.last_rowid {
            checkpoint.last_rowid = chunk_last_rowid;
        }
        if checkpoint.total < checkpoint.processed {
            checkpoint.total = checkpoint.processed;
        }

        update_checkpoint_record(&mut tx, &options.household_id, &checkpoint).await?;
        tx.commit().await.map_err(|err| {
            AppError::from(err)
                .with_context("operation", OPERATION)
                .with_context("step", "commit_tx")
                .with_context("household_id", options.household_id.clone())
        })?;

        if last_emit.elapsed() >= progress_interval {
            let elapsed = start.elapsed().as_millis() as u64;
            emit_progress(
                progress_cb_ref,
                make_progress(
                    &options.household_id,
                    checkpoint.processed,
                    checkpoint.updated,
                    checkpoint.skipped,
                    checkpoint.total,
                    elapsed,
                    chunk_size,
                ),
            );
            last_emit = Instant::now();
        }
    }

    let elapsed_ms = start.elapsed().as_millis() as u64;
    emit_progress(
        progress_cb_ref,
        make_progress(
            &options.household_id,
            checkpoint.processed,
            checkpoint.updated,
            checkpoint.skipped,
            checkpoint.total,
            elapsed_ms,
            chunk_size,
        ),
    );

    let status = if control_ref.map(|c| c.is_cancelled()).unwrap_or(false) {
        BackfillStatus::Cancelled
    } else {
        BackfillStatus::Completed
    };

    let total_scanned = checkpoint.processed.saturating_sub(processed_at_start);

    let summary = BackfillSummary {
        household_id: options.household_id.clone(),
        total_scanned: total_scanned,
        total_updated: updated_this_run,
        total_skipped: skipped_this_run,
        elapsed_ms,
        status,
    };

    info!(
        target: "arklowdun",
        event = "events_backfill_summary",
        household_id = %summary.household_id,
        dry_run = options.dry_run,
        total_scanned = summary.total_scanned,
        total_updated = summary.total_updated,
        total_skipped = summary.total_skipped,
        elapsed_ms = summary.elapsed_ms,
        status = ?summary.status,
    );

    write_summary_log(log_dir, &summary, false, &skip_examples);

    Ok(summary)
}

#[tauri::command]
pub async fn events_backfill_timezone(
    app: AppHandle,
    household_id: String,
    default_tz: Option<String>,
    dry_run: bool,
    chunk_size: Option<u32>,
    progress_interval_ms: Option<u64>,
    reset_checkpoint: Option<bool>,
) -> AppResult<BackfillSummary> {
    let app = app.clone();
    dispatch_async_app_result(move || {
        let app = app.clone();
        let household_id = household_id.clone();
        let default_tz = default_tz.clone();
        async move {
            let state: State<AppState> = app.state();
            let pool = state.pool.clone();
            let control = {
                let mut guard = state.backfill.lock().unwrap();
                guard.try_start(&household_id)?
            };
            let log_dir = app.path().app_data_dir().ok();
            let emitter = app.clone();
            let progress_emitter = emitter.clone();
            let progress_cb: ProgressCallback = Arc::new(move |progress: BackfillProgress| {
                let payload = json!({
                    "type": "progress",
                    "household_id": progress.household_id,
                    "scanned": progress.scanned,
                    "updated": progress.updated,
                    "skipped": progress.skipped,
                    "remaining": progress.remaining,
                    "elapsed_ms": progress.elapsed_ms,
                    "chunk_size": progress.chunk_size,
                });
                let _ = progress_emitter.emit("events_tz_backfill_progress", payload);
            });

            let result = run_events_backfill(
                &pool,
                BackfillOptions {
                    household_id,
                    default_tz,
                    chunk_size: chunk_size.map(|v| v as usize).unwrap_or(DEFAULT_CHUNK_SIZE),
                    progress_interval_ms: progress_interval_ms.unwrap_or(0),
                    dry_run,
                    reset_checkpoint: reset_checkpoint.unwrap_or(false),
                },
                log_dir,
                Some(control.clone()),
                Some(progress_cb),
            )
            .await;

            {
                let state: State<AppState> = app.state();
                let mut guard = state.backfill.lock().unwrap();
                guard.finish(control.id());
            }

            match result {
                Ok(summary) => {
                    let payload = json!({
                        "type": "summary",
                        "household_id": summary.household_id,
                        "scanned": summary.total_scanned,
                        "updated": summary.total_updated,
                        "skipped": summary.total_skipped,
                        "elapsed_ms": summary.elapsed_ms,
                        "status": summary.status,
                    });
                    let _ = emitter.emit("events_tz_backfill_progress", payload);
                    Ok(summary)
                }
                Err(err) => {
                    let payload = json!({
                        "type": "summary",
                        "status": "failed",
                        "error": {
                            "code": err.code().to_string(),
                            "message": err.message().to_string(),
                        },
                    });
                    let _ = emitter.emit("events_tz_backfill_progress", payload);
                    Err(err)
                }
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn events_backfill_timezone_cancel(app: AppHandle) -> AppResult<bool> {
    let state: State<AppState> = app.state();
    let cancelled = {
        let mut guard = state.backfill.lock().unwrap();
        guard.cancel()
    };
    Ok(cancelled)
}

#[tauri::command]
pub async fn events_backfill_timezone_status(
    app: AppHandle,
    household_id: String,
) -> AppResult<BackfillStatusReport> {
    let state: State<AppState> = app.state();
    let pool = state.pool.clone();
    let running = {
        let guard = state.backfill.lock().unwrap();
        guard.running_household()
    };

    let checkpoint = fetch_checkpoint(&pool, &household_id).await?;
    let checkpoint_status = checkpoint.map(|cp| BackfillCheckpointStatus {
        processed: cp.processed,
        updated: cp.updated,
        skipped: cp.skipped,
        total: cp.total,
        remaining: cp.total.saturating_sub(cp.processed),
    });
    let pending = count_pending_after(&pool, &household_id, 0).await?;

    Ok(BackfillStatusReport {
        running,
        checkpoint: checkpoint_status,
        pending,
    })
}

#[cfg(test)]
mod tests {
    use super::to_utc_ms;
    use chrono::{TimeZone, Utc};
    use chrono_tz::Tz;

    #[test]
    fn london_conversion() {
        let tz: Tz = "Europe/London".parse().unwrap();
        let local_ms = chrono::NaiveDate::from_ymd_opt(2025, 9, 7)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis();
        let expected = tz
            .with_ymd_and_hms(2025, 9, 7, 10, 0, 0)
            .unwrap()
            .with_timezone(&Utc)
            .timestamp_millis();
        let actual = to_utc_ms(local_ms, tz).expect("tz conversion succeeds");
        assert_eq!(actual, expected);
    }

    #[test]
    fn new_york_conversion_dst() {
        let tz: Tz = "America/New_York".parse().unwrap();
        let local_ms = chrono::NaiveDate::from_ymd_opt(2025, 3, 9)
            .unwrap()
            .and_hms_opt(3, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis();
        let expected = tz
            .with_ymd_and_hms(2025, 3, 9, 3, 0, 0)
            .unwrap()
            .with_timezone(&Utc)
            .timestamp_millis();
        let actual = to_utc_ms(local_ms, tz).expect("tz conversion succeeds");
        assert_eq!(actual, expected);
    }

    #[test]
    fn tokyo_conversion() {
        let tz: Tz = "Asia/Tokyo".parse().unwrap();
        let local_ms = chrono::NaiveDate::from_ymd_opt(2025, 9, 7)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis();
        let expected = tz
            .with_ymd_and_hms(2025, 9, 7, 10, 0, 0)
            .unwrap()
            .with_timezone(&Utc)
            .timestamp_millis();
        let actual = to_utc_ms(local_ms, tz).expect("tz conversion succeeds");
        assert_eq!(actual, expected);
    }
}
