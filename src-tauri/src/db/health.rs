use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::sqlite::SqliteRow;
use sqlx::{pool::PoolConnection, Row, Sqlite, SqlitePool};
use ts_rs::TS;

const EXPECTED_JOURNAL_MODE: &str = "wal";
const EXPECTED_PAGE_SIZE: i64 = 4096;
const WAL_HEADER_MAGIC: &[u8; 4] = b"WAL\0";

pub const STORAGE_SANITY_HEAL_NOTE: &str = "wal header healed after checkpoint";

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DbHealthStatus {
    Ok,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DbHealthCheck {
    pub name: String,
    pub passed: bool,
    #[serde(default)]
    #[ts(type = "number")]
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DbHealthOffender {
    pub table: String,
    #[ts(type = "number")]
    pub rowid: i64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct DbHealthReport {
    pub status: DbHealthStatus,
    pub checks: Vec<DbHealthCheck>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub offenders: Vec<DbHealthOffender>,
    pub schema_hash: String,
    pub app_version: String,
    pub generated_at: String,
}

pub async fn run_health_checks(pool: &SqlitePool, db_path: &Path) -> Result<DbHealthReport> {
    let mut conn = pool
        .acquire()
        .await
        .context("acquire connection for health checks")?;

    let mut checks: Vec<DbHealthCheck> = Vec::new();
    let mut offenders: Vec<DbHealthOffender> = Vec::new();
    let mut overall_ok = true;

    let quick_check = run_quick_check(&mut conn).await;
    overall_ok &= quick_check.passed;
    checks.push(quick_check);

    let integrity_check = run_integrity_check(&mut conn).await;
    overall_ok &= integrity_check.passed;
    checks.push(integrity_check);

    let fk_result = run_foreign_key_check(&mut conn).await;
    overall_ok &= fk_result.check.passed;
    offenders.extend(fk_result.offenders);
    checks.push(fk_result.check);

    let storage_check = run_storage_sanity(&mut conn, db_path).await;
    overall_ok &= storage_check.passed;
    checks.push(storage_check);

    let schema_hash = compute_schema_hash(&mut conn).await.unwrap_or_default();

    let status = if overall_ok {
        DbHealthStatus::Ok
    } else {
        DbHealthStatus::Error
    };

    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let report = DbHealthReport {
        status,
        checks,
        offenders,
        schema_hash,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        generated_at,
    };

    Ok(report)
}

struct ForeignKeyCheckResult {
    check: DbHealthCheck,
    offenders: Vec<DbHealthOffender>,
}

async fn run_quick_check(conn: &mut PoolConnection<Sqlite>) -> DbHealthCheck {
    let start = Instant::now();
    let mut check = DbHealthCheck {
        name: "quick_check".to_string(),
        passed: true,
        duration_ms: 0,
        details: None,
    };

    match sqlx::query_scalar::<_, String>("PRAGMA quick_check;")
        .fetch_one(conn.as_mut())
        .await
    {
        Ok(result) => {
            if !result.eq_ignore_ascii_case("ok") {
                check.passed = false;
                check.details = Some(result);
            }
        }
        Err(err) => {
            check.passed = false;
            check.details = Some(format!("quick_check failed: {err}"));
        }
    }

    check.duration_ms = start.elapsed().as_millis() as u64;
    check
}

async fn run_integrity_check(conn: &mut PoolConnection<Sqlite>) -> DbHealthCheck {
    let start = Instant::now();
    let mut check = DbHealthCheck {
        name: "integrity_check".to_string(),
        passed: true,
        duration_ms: 0,
        details: None,
    };

    match sqlx::query_scalar::<_, String>("PRAGMA integrity_check(1);")
        .fetch_one(conn.as_mut())
        .await
    {
        Ok(result) => {
            if !result.eq_ignore_ascii_case("ok") {
                check.passed = false;
                check.details = Some(result);
            }
        }
        Err(err) => {
            check.passed = false;
            check.details = Some(format!("integrity_check failed: {err}"));
        }
    }

    check.duration_ms = start.elapsed().as_millis() as u64;
    check
}

async fn run_foreign_key_check(conn: &mut PoolConnection<Sqlite>) -> ForeignKeyCheckResult {
    let start = Instant::now();
    let mut check = DbHealthCheck {
        name: "foreign_key_check".to_string(),
        passed: true,
        duration_ms: 0,
        details: None,
    };

    let rows = sqlx::query("PRAGMA foreign_key_check;")
        .fetch_all(conn.as_mut())
        .await;

    let mut offenders = Vec::new();
    match rows {
        Ok(rows) => {
            for row in rows {
                if let Some(offender) = offender_from_row(&row) {
                    offenders.push(offender);
                }
            }
            if !offenders.is_empty() {
                check.passed = false;
                check.details = Some(format!("{} foreign key violation(s)", offenders.len()));
            }
        }
        Err(err) => {
            check.passed = false;
            check.details = Some(format!("foreign_key_check failed: {err}"));
        }
    }

    check.duration_ms = start.elapsed().as_millis() as u64;
    ForeignKeyCheckResult { check, offenders }
}

fn offender_from_row(row: &SqliteRow) -> Option<DbHealthOffender> {
    let table: String = row.try_get("table").ok()?;
    let rowid: i64 = row.try_get("rowid").ok()?;
    let parent: Option<String> = row.try_get("parent").ok();
    let fkid: Option<i64> = row.try_get("fkid").ok();

    let mut message = String::new();
    if let Some(parent) = parent {
        message.push_str(&format!("missing parent '{parent}'"));
    }
    if let Some(fkid) = fkid {
        if !message.is_empty() {
            message.push_str(", ");
        }
        message.push_str(&format!("constraint #{fkid}"));
    }
    if message.is_empty() {
        message.push_str("foreign key violation");
    }

    Some(DbHealthOffender {
        table,
        rowid,
        message,
    })
}

async fn run_storage_sanity(conn: &mut PoolConnection<Sqlite>, db_path: &Path) -> DbHealthCheck {
    let start = Instant::now();
    let mut check = DbHealthCheck {
        name: "storage_sanity".to_string(),
        passed: true,
        duration_ms: 0,
        details: None,
    };

    let mut messages: Vec<String> = Vec::new();

    let journal_mode = sqlx::query_scalar::<_, String>("PRAGMA journal_mode;")
        .fetch_one(conn.as_mut())
        .await;
    let page_size = sqlx::query_scalar::<_, i64>("PRAGMA page_size;")
        .fetch_one(conn.as_mut())
        .await;

    match journal_mode {
        Ok(mode) => {
            if !mode.eq_ignore_ascii_case(EXPECTED_JOURNAL_MODE) {
                check.passed = false;
                messages.push(format!(
                    "journal_mode mismatch: expected {EXPECTED_JOURNAL_MODE}, got {mode}"
                ));
            } else {
                messages.push(format!("journal_mode={mode}"));
            }
        }
        Err(err) => {
            check.passed = false;
            messages.push(format!("journal_mode query failed: {err}"));
        }
    }

    match page_size {
        Ok(size) => {
            if size != EXPECTED_PAGE_SIZE {
                check.passed = false;
                messages.push(format!(
                    "page_size mismatch: expected {EXPECTED_PAGE_SIZE}, got {size}"
                ));
            } else {
                messages.push(format!("page_size={size}"));
            }

            let mut wal_outcome = inspect_wal_file(db_path, size);
            let mut heal_summary: Option<WalHealSummary> = None;
            let mut wal_checkpoint_error: Option<String> = None;

            if !wal_outcome.passed && wal_outcome.healable {
                messages.push(format!("wal anomaly detected: {}", wal_outcome.details));
                match attempt_wal_self_heal(conn).await {
                    Ok(summary) => {
                        if let Some(ref full_error) = summary.full_error {
                            messages.push(format!(
                                "wal checkpoint FULL failed: {full_error}; applied TRUNCATE fallback"
                            ));
                        }
                        wal_outcome = inspect_wal_file(db_path, size);
                        heal_summary = Some(summary);
                    }
                    Err(err) => {
                        wal_checkpoint_error = Some(format!("wal checkpoint repair failed: {err}"));
                    }
                }
            } else if !wal_outcome.passed {
                check.passed = false;
            }

            if let Some(error) = wal_checkpoint_error {
                messages.push(error);
                check.passed = false;
            }

            let final_message = if let Some(summary) = heal_summary.as_ref() {
                let method = summary.method();
                if wal_outcome.passed {
                    format!(
                        "{STORAGE_SANITY_HEAL_NOTE} ({method}); final wal state: {}",
                        wal_outcome.details
                    )
                } else {
                    check.passed = false;
                    format!(
                        "wal anomaly persists after checkpoint ({method}); final wal state: {}",
                        wal_outcome.details
                    )
                }
            } else {
                wal_outcome.details.clone()
            };

            messages.push(final_message);

            if !wal_outcome.passed {
                check.passed = false;
            }
        }
        Err(err) => {
            check.passed = false;
            messages.push(format!("page_size query failed: {err}"));
        }
    }

    check.duration_ms = start.elapsed().as_millis() as u64;
    if !messages.is_empty() {
        check.details = Some(messages.join("; "));
    }
    check
}

struct WalOutcome {
    passed: bool,
    details: String,
    healable: bool,
}

#[derive(Clone)]
struct WalHealSummary {
    kind: WalHealKind,
    full_error: Option<String>,
}

impl WalHealSummary {
    fn method(&self) -> &'static str {
        match self.kind {
            WalHealKind::Full => "FULL",
            WalHealKind::FullThenTruncate => "FULL+TRUNCATE",
            WalHealKind::TruncateAfterFullError => "TRUNCATE (after FULL error)",
        }
    }
}

#[derive(Clone, Copy)]
enum WalHealKind {
    Full,
    FullThenTruncate,
    TruncateAfterFullError,
}

async fn attempt_wal_self_heal(conn: &mut PoolConnection<Sqlite>) -> Result<WalHealSummary> {
    match sqlx::query_as::<_, (i64, i64, i64)>("PRAGMA wal_checkpoint(FULL);")
        .fetch_one(conn.as_mut())
        .await
    {
        Ok((_, frames_after_full, _)) => {
            if frames_after_full > 0 {
                sqlx::query_as::<_, (i64, i64, i64)>("PRAGMA wal_checkpoint(TRUNCATE);")
                    .fetch_one(conn.as_mut())
                    .await?;
                Ok(WalHealSummary {
                    kind: WalHealKind::FullThenTruncate,
                    full_error: None,
                })
            } else {
                Ok(WalHealSummary {
                    kind: WalHealKind::Full,
                    full_error: None,
                })
            }
        }
        Err(err) => {
            sqlx::query_as::<_, (i64, i64, i64)>("PRAGMA wal_checkpoint(TRUNCATE);")
                .fetch_one(conn.as_mut())
                .await?;
            Ok(WalHealSummary {
                kind: WalHealKind::TruncateAfterFullError,
                full_error: Some(err.to_string()),
            })
        }
    }
}

fn inspect_wal_file(db_path: &Path, page_size: i64) -> WalOutcome {
    let wal_path = wal_path(db_path);
    match std::fs::metadata(&wal_path) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => WalOutcome {
            passed: true,
            details: "wal=absent".to_string(),
            healable: false,
        },
        Err(err) => WalOutcome {
            passed: false,
            details: format!("wal metadata error: {err}"),
            healable: false,
        },
        Ok(meta) => {
            let len = meta.len();
            if len == 0 {
                return WalOutcome {
                    passed: true,
                    details: "wal=empty".to_string(),
                    healable: false,
                };
            }
            if len < 32 {
                return WalOutcome {
                    passed: false,
                    details: format!("wal too small: {len} bytes"),
                    healable: true,
                };
            }

            let mut header = [0u8; 32];
            if let Err(err) = File::open(&wal_path).and_then(|mut f| f.read_exact(&mut header)) {
                return WalOutcome {
                    passed: false,
                    details: format!("wal read error: {err}"),
                    healable: false,
                };
            }

            if &header[0..4] != WAL_HEADER_MAGIC {
                return WalOutcome {
                    passed: false,
                    details: "wal magic header mismatch".to_string(),
                    healable: true,
                };
            }

            let wal_page_size = u32::from_be_bytes([header[8], header[9], header[10], header[11]]);
            let wal_page_size = match wal_page_size {
                0 | 1 => page_size as u32,
                value => value,
            } as i64;

            if wal_page_size != page_size {
                return WalOutcome {
                    passed: false,
                    details: format!(
                        "wal page size mismatch: expected {page_size}, header {wal_page_size}"
                    ),
                    healable: false,
                };
            }

            let frame_size = (wal_page_size as u64) + 24;
            let payload = len - 32;
            if payload % frame_size != 0 {
                return WalOutcome {
                    passed: false,
                    details: format!("wal size misaligned: len={len}, frame_size={frame_size}"),
                    healable: true,
                };
            }
            let frames = payload / frame_size;
            WalOutcome {
                passed: true,
                details: format!("wal frames={frames}"),
                healable: false,
            }
        }
    }
}

fn wal_path(db_path: &Path) -> PathBuf {
    let mut os_string = db_path.as_os_str().to_os_string();
    os_string.push("-wal");
    PathBuf::from(os_string)
}

async fn compute_schema_hash(conn: &mut PoolConnection<Sqlite>) -> Result<String> {
    let rows = sqlx::query(
        "SELECT type, name, tbl_name, sql FROM sqlite_master\n         WHERE type IN ('table','index','trigger','view')\n         ORDER BY type, name",
    )
    .fetch_all(conn.as_mut())
    .await?;

    let mut hasher = Sha256::new();
    for row in rows {
        let ty: String = row.try_get("type")?;
        let name: String = row.try_get("name")?;
        let tbl: String = row.try_get("tbl_name")?;
        let sql: Option<String> = row.try_get("sql").ok();

        hasher.update(ty.as_bytes());
        hasher.update(&[0]);
        hasher.update(name.as_bytes());
        hasher.update(&[0]);
        hasher.update(tbl.as_bytes());
        hasher.update(&[0]);
        if let Some(sql) = sql {
            hasher.update(sql.as_bytes());
        }
        hasher.update(&[0]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}
