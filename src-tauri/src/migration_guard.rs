use anyhow::{anyhow, Result};
use sqlx::{Row, SqlitePool};
use std::collections::HashSet;
use tracing::{error, info, warn};

pub const BACKFILL_GUARD_BYPASS_ENV: &str = "ARKLOWDUN_SKIP_BACKFILL_GUARD";

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

pub async fn ensure_events_indexes(pool: &SqlitePool) -> Result<()> {
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

pub async fn check_events_backfill(pool: &SqlitePool) -> Result<BackfillGuardStatus> {
    let rows = sqlx::query(
        "SELECT household_id,
                SUM(CASE WHEN start_at_utc IS NULL THEN 1 ELSE 0 END) AS missing_start,
                SUM(CASE WHEN end_at IS NOT NULL AND end_at_utc IS NULL THEN 1 ELSE 0 END) AS missing_end,
                COUNT(*) AS missing_total
           FROM events
          WHERE start_at_utc IS NULL
             OR (end_at IS NOT NULL AND end_at_utc IS NULL)
          GROUP BY household_id
          ORDER BY missing_total DESC, household_id",
    )
    .fetch_all(pool)
    .await?;

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
        return Err(anyhow!(message));
    }

    Ok(status)
}
