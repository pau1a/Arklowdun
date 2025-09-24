//! Guard that prevents database mutations when the cached health report indicates an
//! error.
//!
//! When the guard rejects a command it surfaces `DB_UNHEALTHY_CODE` and the CLI uses
//! `DB_UNHEALTHY_EXIT_CODE` so automation can detect the failure uniformly.
//!
//! The cached [`DbHealthReport`] is populated at startup and refreshed by the
//! `db_recheck` flow introduced in PR-01. Any new maintenance tasks that can heal
//! corruption (VACUUM, crash recovery, etc.) must trigger a recheck so this guard sees
//! fresh state before permitting writes.

use std::ops::Deref;

use tracing::warn;

use crate::{db::health::DbHealthStatus, state::AppState, AppError, AppResult};

/// Stable error code returned when database health prevents write operations.
pub const DB_UNHEALTHY_CODE: &str = "DB_UNHEALTHY_WRITE_BLOCKED";
/// User-facing message presented when writes are blocked for health reasons.
pub const DB_UNHEALTHY_MESSAGE: &str =
    "Database integrity checks failed. Editing is disabled until repair completes.";
/// CLI guidance surfaced when a mutating command is blocked due to database health.
pub const DB_UNHEALTHY_CLI_HINT: &str = "Run 'arklowdun db status' or repair.";
/// Exit status used by CLI subcommands when writes are rejected.
pub const DB_UNHEALTHY_EXIT_CODE: i32 = 2;

#[must_use = "Database health must be checked before executing a mutation"]
#[derive(Debug)]
pub struct DbWriteGuard {
    _private: (),
}

impl DbWriteGuard {
    fn new() -> Self {
        Self { _private: () }
    }
}

/// Ensure the cached database health permits write operations.
///
/// When the health report indicates any error, an [`AppError`] is returned with the
/// [`DbHealthReport`] attached so callers can surface detailed diagnostics to the UI.
pub trait AppStateRef {
    fn as_app_state(&self) -> &AppState;
}

impl AppStateRef for AppState {
    fn as_app_state(&self) -> &AppState {
        self
    }
}

impl<T> AppStateRef for T
where
    T: Deref<Target = AppState>,
{
    fn as_app_state(&self) -> &AppState {
        self.deref()
    }
}

#[allow(clippy::result_large_err)]
#[must_use = "Database health must be checked before executing a mutation"]
pub fn ensure_db_writable(state: &(impl AppStateRef + ?Sized)) -> AppResult<DbWriteGuard> {
    let state = state.as_app_state();
    let report = state
        .db_health
        .lock()
        .expect("db health cache poisoned")
        .clone();

    if !matches!(report.status, DbHealthStatus::Ok) {
        warn!(
            target: "arklowdun",
            event = "db_write_blocked",
            status = ?report.status
        );
        let error = AppError::new(DB_UNHEALTHY_CODE, DB_UNHEALTHY_MESSAGE)
            .with_context("status", format!("{:?}", report.status))
            .with_health_report(report);
        return Err(error);
    }

    Ok(DbWriteGuard::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::health::DbHealthReport;
    use crate::events_tz_backfill::BackfillCoordinator;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex},
    };

    fn app_state_with_report(report: DbHealthReport) -> AppState {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_lazy("sqlite::memory:")
            .expect("create sqlite pool");
        AppState {
            pool,
            default_household_id: Arc::new(Mutex::new(String::new())),
            backfill: Arc::new(Mutex::new(BackfillCoordinator::new())),
            db_health: Arc::new(Mutex::new(report)),
            db_path: Arc::new(PathBuf::from("test.sqlite3")),
        }
    }

    fn sample_report(status: DbHealthStatus) -> DbHealthReport {
        DbHealthReport {
            status,
            checks: Vec::new(),
            offenders: Vec::new(),
            schema_hash: "hash".into(),
            app_version: "test".into(),
            generated_at: "2024-01-01T00:00:00Z".into(),
        }
    }

    #[tokio::test]
    async fn allows_mutations_when_health_ok() {
        let state = app_state_with_report(sample_report(DbHealthStatus::Ok));
        assert!(ensure_db_writable(&state).is_ok());
    }

    #[tokio::test]
    async fn blocks_mutations_when_health_not_ok() {
        let state = app_state_with_report(sample_report(DbHealthStatus::Error));
        let err = ensure_db_writable(&state).expect_err("expected guard to block writes");
        assert_eq!(err.code(), DB_UNHEALTHY_CODE);
        assert_eq!(err.message(), DB_UNHEALTHY_MESSAGE);
        let report = err.health_report().expect("health report attached");
        assert_eq!(report.status, DbHealthStatus::Error);
    }
}
