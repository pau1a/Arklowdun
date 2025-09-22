use anyhow::{anyhow, Result};
use sqlx::{Row, SqlitePool};
use std::{collections::HashSet, fmt};
use tracing::{error, info, warn};

pub const BACKFILL_GUARD_BYPASS_ENV: &str = "ARKLOWDUN_SKIP_BACKFILL_GUARD";

pub const USER_RECOVERY_MESSAGE: &str =
    "Arklowdun needs to finish a database update. Close the app and run the migration tool from Settings → Maintenance.";

#[derive(Debug)]
pub struct GuardError {
    user_message: &'static str,
    operator_message: String,
}

impl GuardError {
    pub fn new(user_message: &'static str, operator_message: String) -> Self {
        Self {
            user_message,
            operator_message,
        }
    }

    pub fn user_message(&self) -> &'static str {
        self.user_message
    }

    pub fn operator_message(&self) -> &str {
        &self.operator_message
    }
}

impl fmt::Display for GuardError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.user_message)
    }
}

impl std::error::Error for GuardError {}

#[derive(Debug, Clone)]
pub struct HouseholdBackfillStatus {
    pub household_id: String,
    pub missing_start_at_utc: i64,
    pub missing_end_at_utc: i64,
    pub missing_total: i64,
}

#[derive(Debug, Clone)]
pub struct BackfillGuardStatus {
    pub total_missing: i64,
    pub total_missing_start_at_utc: i64,
    pub total_missing_end_at_utc: i64,
    pub households: Vec<HouseholdBackfillStatus>,
}

impl BackfillGuardStatus {
    #[inline]
    pub fn is_ready(&self) -> bool {
        self.total_missing == 0
    }

    fn summarize_households(&self, limit: usize) -> (Vec<String>, usize) {
        let mut summaries = Vec::new();
        for household in self.households.iter().take(limit) {
            let mut parts = Vec::new();
            if household.missing_start_at_utc > 0 {
                parts.push(format!(
                    "start_at_utc missing {}",
                    household.missing_start_at_utc
                ));
            }
            if household.missing_end_at_utc > 0 {
                parts.push(format!(
                    "end_at_utc missing {}",
                    household.missing_end_at_utc
                ));
            }
            if parts.is_empty() {
                // We should never reach this branch (a household entry implies missing rows),
                // but keep a defensive label in case of future query changes.
                parts.push("pending counts unavailable".to_string());
            }
            summaries.push(format!("{} ({})", household.household_id, parts.join(", ")));
        }

        let additional = self.households.len().saturating_sub(summaries.len());
        (summaries, additional)
    }
}

#[derive(Debug, Clone)]
pub struct LegacyEventsColumnsStatus {
    pub has_start_at: bool,
    pub has_end_at: bool,
}

impl LegacyEventsColumnsStatus {
    #[inline]
    pub fn is_clear(&self) -> bool {
        !self.has_start_at && !self.has_end_at
    }

    pub fn legacy_columns(&self) -> Vec<&'static str> {
        let mut cols = Vec::new();
        if self.has_start_at {
            cols.push("start_at");
        }
        if self.has_end_at {
            cols.push("end_at");
        }
        cols
    }
}

pub fn format_guard_failure(status: &BackfillGuardStatus) -> String {
    let event_word = if status.total_missing == 1 {
        "event"
    } else {
        "events"
    };
    let mut message = format!(
        "Backfill required: {} {} missing UTC values",
        status.total_missing, event_word
    );

    let mut breakdown = Vec::new();
    if status.total_missing_start_at_utc > 0 {
        let word = if status.total_missing_start_at_utc == 1 {
            "event"
        } else {
            "events"
        };
        breakdown.push(format!(
            "{} {} missing start_at_utc",
            status.total_missing_start_at_utc, word
        ));
    }
    if status.total_missing_end_at_utc > 0 {
        let word = if status.total_missing_end_at_utc == 1 {
            "event"
        } else {
            "events"
        };
        breakdown.push(format!(
            "{} {} missing end_at_utc",
            status.total_missing_end_at_utc, word
        ));
    }
    if !breakdown.is_empty() {
        message.push_str(&format!(" ({})", breakdown.join(", ")));
    }
    message.push('.');

    if !status.households.is_empty() {
        let (households, additional) = status.summarize_households(5);
        message.push(' ');
        message.push_str("Affected households: ");
        message.push_str(&households.join("; "));
        if additional > 0 {
            message.push_str(&format!("; +{} more", additional));
        }
        message.push('.');
    }

    message.push(' ');
    message.push_str("Run backfill --apply before continuing.");
    message
}

fn guard_bypass_enabled() -> bool {
    let value = match std::env::var(BACKFILL_GUARD_BYPASS_ENV) {
        Ok(value) => value,
        Err(_) => return false,
    };
    let enabled = matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES");
    if cfg!(debug_assertions) {
        enabled
    } else {
        if enabled {
            warn!(
                target: "arklowdun",
                event = "backfill_guard_bypass_ignored",
                env = BACKFILL_GUARD_BYPASS_ENV,
                reason = "release_build"
            );
        }
        false
    }
}

/// Ensures the rebuilt events table still carries the supporting UTC indexes.
pub async fn ensure_events_indexes(pool: &SqlitePool) -> Result<()> {
    // Idempotently create the required indexes; existing ones are preserved.
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS events_household_start_at_utc_idx \
         ON events(household_id, start_at_utc)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS events_household_end_at_utc_idx \
         ON events(household_id, end_at_utc)",
    )
    .execute(pool)
    .await?;

    let rows = sqlx::query("PRAGMA index_list('events');")
        .fetch_all(pool)
        .await?;
    let mut names = HashSet::new();
    for row in rows {
        if let Ok(name) = row.try_get::<String, _>("name") {
            names.insert(name);
        }
    }
    let has_start = names.contains("events_household_start_at_utc_idx");
    let has_end = names.contains("events_household_end_at_utc_idx");
    info!(
        target: "arklowdun",
        event = "events_index_check",
        has_start_at_utc = has_start,
        has_end_at_utc = has_end
    );
    let mut missing = Vec::new();
    if !has_start {
        missing.push("events_household_start_at_utc_idx");
    }
    if !has_end {
        missing.push("events_household_end_at_utc_idx");
    }
    if missing.is_empty() {
        Ok(())
    } else {
        error!(
            target: "arklowdun",
            event = "events_index_missing",
            missing = %missing.join(", ")
        );
        Err(anyhow!(format!(
            "Missing required events index(es): {}. Run migrations before continuing.",
            missing.join(", ")
        )))
    }
}

/// Computes aggregate counts of events that still need UTC backfill work.
pub async fn check_events_backfill(pool: &SqlitePool) -> Result<BackfillGuardStatus> {
    let legacy_end_present = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM pragma_table_info('events') WHERE name='end_at'",
    )
    .fetch_optional(pool)
    .await?
    .is_some();

    let sql = if legacy_end_present {
        "SELECT household_id,
                SUM(CASE WHEN start_at_utc IS NULL THEN 1 ELSE 0 END) AS missing_start,
                SUM(CASE WHEN end_at IS NOT NULL AND end_at_utc IS NULL THEN 1 ELSE 0 END) AS missing_end,
                COUNT(*) AS missing_total
           FROM events
          WHERE start_at_utc IS NULL
             OR (end_at IS NOT NULL AND end_at_utc IS NULL)
          GROUP BY household_id
          ORDER BY missing_total DESC, household_id"
            .to_string()
    } else {
        "SELECT household_id,
                SUM(CASE WHEN start_at_utc IS NULL THEN 1 ELSE 0 END) AS missing_start,
                0 AS missing_end,
                SUM(CASE WHEN start_at_utc IS NULL THEN 1 ELSE 0 END) AS missing_total
           FROM events
          WHERE start_at_utc IS NULL
          GROUP BY household_id
          ORDER BY missing_total DESC, household_id"
            .to_string()
    };

    let rows = sqlx::query(&sql).fetch_all(pool).await?;

    let mut households = Vec::with_capacity(rows.len());
    let mut total_missing = 0i64;
    let mut missing_start_total = 0i64;
    let mut missing_end_total = 0i64;
    for row in rows {
        let household_id: String = row.try_get("household_id")?;
        let missing_start: i64 = row.try_get("missing_start")?;
        let missing_end: i64 = row.try_get("missing_end")?;
        let missing_total: i64 = row.try_get("missing_total")?;
        total_missing += missing_total;
        missing_start_total += missing_start;
        missing_end_total += missing_end;
        households.push(HouseholdBackfillStatus {
            household_id,
            missing_start_at_utc: missing_start,
            missing_end_at_utc: missing_end,
            missing_total,
        });
    }

    Ok(BackfillGuardStatus {
        total_missing,
        total_missing_start_at_utc: missing_start_total,
        total_missing_end_at_utc: missing_end_total,
        households,
    })
}

/// Fails fast when any events still lack canonical UTC timestamps.
pub async fn enforce_events_backfill_guard(pool: &SqlitePool) -> Result<BackfillGuardStatus> {
    let status = check_events_backfill(pool).await?;
    let (pending_details, pending_additional) = status.summarize_households(5);
    let ready = status.is_ready();

    info!(
        target: "arklowdun",
        event = "backfill_guard_status",
        ready,
        total_missing = status.total_missing,
        missing_start_total = status.total_missing_start_at_utc,
        missing_end_total = status.total_missing_end_at_utc,
        households_with_pending = status.households.len(),
        pending = %pending_details.join("; "),
        pending_additional
    );

    if guard_bypass_enabled() {
        warn!(
            target: "arklowdun",
            event = "backfill_guard_bypassed",
            env = BACKFILL_GUARD_BYPASS_ENV,
            total_missing = status.total_missing
        );
        return Ok(status);
    }

    if status.total_missing > 0 {
        let message = format_guard_failure(&status);
        error!(
            target: "arklowdun",
            event = "backfill_guard_blocked",
            total_missing = status.total_missing,
            missing_start_total = status.total_missing_start_at_utc,
            missing_end_total = status.total_missing_end_at_utc,
            message = %message
        );
        return Err(GuardError::new(USER_RECOVERY_MESSAGE, message).into());
    }

    Ok(status)
}

/// Verifies whether any legacy `start_at` / `end_at` columns remain on the events table.
pub async fn check_events_legacy_columns(pool: &SqlitePool) -> Result<LegacyEventsColumnsStatus> {
    let rows = sqlx::query("PRAGMA table_info('events');")
        .fetch_all(pool)
        .await?;
    let mut has_start_at = false;
    let mut has_end_at = false;
    for row in rows {
        let name: String = row.try_get("name")?;
        match name.as_str() {
            "start_at" => has_start_at = true,
            "end_at" => has_end_at = true,
            _ => {}
        }
    }
    Ok(LegacyEventsColumnsStatus {
        has_start_at,
        has_end_at,
    })
}

/// Fails when the legacy wall-clock columns persist after the rebuild.
pub async fn enforce_events_legacy_columns_removed(
    pool: &SqlitePool,
) -> Result<LegacyEventsColumnsStatus> {
    let status = check_events_legacy_columns(pool).await?;
    let legacy_columns = status.legacy_columns();
    let ready = status.is_clear();

    info!(
        target: "arklowdun",
        event = "events_legacy_column_check",
        ready,
        has_start_at = status.has_start_at,
        has_end_at = status.has_end_at,
        legacy_columns = %legacy_columns.join(", ")
    );

    if ready {
        return Ok(status);
    }

    error!(
        target: "arklowdun",
        event = "events_legacy_columns_present",
        legacy_columns = %legacy_columns.join(", ")
    );

    let message = if legacy_columns.len() == 1 {
        format!(
            "Legacy events column still exists: {}. Run migrations before launching the desktop app.",
            legacy_columns[0]
        )
    } else {
        format!(
            "Legacy events columns still exist: {}. Run migrations before launching the desktop app.",
            legacy_columns.join(", ")
        )
    };

    Err(GuardError::new(USER_RECOVERY_MESSAGE, message).into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

    #[test]
    fn guard_error_exposes_messages() {
        let error = GuardError::new("user", "operator details".into());
        assert_eq!(error.user_message(), "user");
        assert_eq!(error.operator_message(), "operator details");
        assert_eq!(error.to_string(), "user");
    }

    async fn memory_db() -> SqlitePool {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn detects_legacy_columns() {
        let pool = memory_db().await;
        sqlx::query(
            "CREATE TABLE events (id TEXT PRIMARY KEY, start_at INTEGER, end_at INTEGER, start_at_utc INTEGER, end_at_utc INTEGER)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let status = check_events_legacy_columns(&pool).await.unwrap();
        assert!(status.has_start_at);
        assert!(status.has_end_at);
        assert!(!status.is_clear());
        let err = enforce_events_legacy_columns_removed(&pool)
            .await
            .unwrap_err();
        let guard = err.downcast::<GuardError>().unwrap();
        assert_eq!(
            guard.operator_message(),
            "Legacy events columns still exist: start_at, end_at. Run migrations before launching the desktop app."
        );
        assert_eq!(guard.user_message(), USER_RECOVERY_MESSAGE);
    }

    #[tokio::test]
    async fn passes_when_legacy_columns_removed() {
        let pool = memory_db().await;
        sqlx::query(
            "CREATE TABLE events (id TEXT PRIMARY KEY, start_at_utc INTEGER NOT NULL, end_at_utc INTEGER)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let status = enforce_events_legacy_columns_removed(&pool)
            .await
            .expect("guard should pass");
        assert!(status.is_clear());
    }

    #[tokio::test]
    async fn flags_when_only_start_at_remains() {
        let pool = memory_db().await;
        sqlx::query(
            "CREATE TABLE events (id TEXT PRIMARY KEY, start_at INTEGER, start_at_utc INTEGER NOT NULL, end_at_utc INTEGER)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let err = enforce_events_legacy_columns_removed(&pool)
            .await
            .expect_err("guard should flag start_at");
        let guard = err.downcast::<GuardError>().unwrap();
        assert_eq!(
            guard.operator_message(),
            "Legacy events column still exists: start_at. Run migrations before launching the desktop app."
        );
    }

    #[tokio::test]
    async fn flags_when_only_end_at_remains() {
        let pool = memory_db().await;
        sqlx::query(
            "CREATE TABLE events (id TEXT PRIMARY KEY, end_at INTEGER, start_at_utc INTEGER NOT NULL, end_at_utc INTEGER)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let err = enforce_events_legacy_columns_removed(&pool)
            .await
            .expect_err("guard should flag end_at");
        let guard = err.downcast::<GuardError>().unwrap();
        assert_eq!(
            guard.operator_message(),
            "Legacy events column still exists: end_at. Run migrations before launching the desktop app."
        );
    }
}
