use std::sync::OnceLock;

use chrono::{LocalResult, NaiveDateTime, Offset, TimeZone, Utc};
use chrono_tz::Tz as ChronoTz;
use sqlx::{Row, SqlitePool};

use crate::time::now_ms;

const ENV_VAR: &str = "ARK_TIME_SHADOW_READ";

static INVALID_FLAG_LOGGED: OnceLock<()> = OnceLock::new();

/// Tracks per-query metrics for shadow-read comparisons.
#[derive(Debug, Clone)]
pub struct ShadowAudit {
    enabled: bool,
    total_rows: u64,
    discrepancies: u64,
    last: Option<ShadowDiscrepancyRecord>,
}

#[derive(Debug, Clone, Default)]
pub struct ShadowDiscrepancyRecord {
    pub event_id: String,
    pub household_id: String,
    pub tz: Option<String>,
    pub legacy_start_ms: Option<i64>,
    pub utc_start_ms: Option<i64>,
    pub start_delta_ms: Option<i64>,
    pub legacy_end_ms: Option<i64>,
    pub utc_end_ms: Option<i64>,
    pub end_delta_ms: Option<i64>,
    pub observed_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct ShadowSummary {
    pub total_rows: u64,
    pub discrepancies: u64,
    pub last: Option<ShadowSample>,
}

#[derive(Debug, Clone, Default)]
pub struct ShadowSample {
    pub event_id: String,
    pub household_id: String,
    pub tz: Option<String>,
    pub legacy_start_ms: Option<i64>,
    pub utc_start_ms: Option<i64>,
    pub start_delta_ms: Option<i64>,
    pub legacy_end_ms: Option<i64>,
    pub utc_end_ms: Option<i64>,
    pub end_delta_ms: Option<i64>,
    pub observed_at_ms: Option<i64>,
}

impl ShadowAudit {
    pub fn new() -> Self {
        Self {
            enabled: is_shadow_read_enabled(),
            total_rows: 0,
            discrepancies: 0,
            last: None,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn observe_event(
        &mut self,
        event_id: &str,
        household_id: &str,
        tz: Option<&str>,
        legacy_start_ms: Option<i64>,
        legacy_end_ms: Option<i64>,
        utc_start_ms: Option<i64>,
        utc_end_ms: Option<i64>,
    ) {
        if !self.enabled {
            return;
        }
        self.total_rows = self.total_rows.saturating_add(1);

        if let Some(mut record) = detect_discrepancy(
            event_id,
            household_id,
            tz,
            legacy_start_ms,
            legacy_end_ms,
            utc_start_ms,
            utc_end_ms,
        ) {
            record.observed_at_ms = Some(now_ms());
            log_discrepancy(&record);
            self.discrepancies = self.discrepancies.saturating_add(1);
            self.last = Some(record);
        }
    }

    pub async fn finalize(self, pool: &SqlitePool) {
        if !self.enabled || (self.total_rows == 0 && self.discrepancies == 0) {
            return;
        }
        if let Err(err) = persist_summary(pool, &self).await {
            if is_missing_table(&err) {
                tracing::debug!(
                    target: "arklowdun",
                    event = "time_shadow_persist_skipped",
                    reason = "missing_table"
                );
            } else {
                tracing::warn!(
                    target: "arklowdun",
                    event = "time_shadow_persist_failed",
                    error = %err
                );
            }
        }
    }
}

pub fn is_shadow_read_enabled() -> bool {
    read_flag()
}

pub async fn load_summary(pool: &SqlitePool) -> Result<ShadowSummary, sqlx::Error> {
    let row = match sqlx::query(
        "SELECT total_rows, discrepancies, last_event_id, last_household_id, last_tz,\n                last_legacy_start_ms, last_utc_start_ms, last_start_delta_ms,\n                last_legacy_end_ms, last_utc_end_ms, last_end_delta_ms, last_observed_at_ms\n         FROM shadow_read_audit\n         WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    {
        Ok(row) => row,
        Err(err) => {
            if is_missing_table(&err) {
                return Ok(ShadowSummary::default());
            }
            return Err(err);
        }
    };

    let mut summary = ShadowSummary::default();
    if let Some(row) = row {
        let total_rows: i64 = row.try_get("total_rows").unwrap_or(0);
        let discrepancies: i64 = row.try_get("discrepancies").unwrap_or(0);
        summary.total_rows = clamp_u64(total_rows);
        summary.discrepancies = clamp_u64(discrepancies);

        if let Ok(Some(event_id)) = row.try_get::<Option<String>, _>("last_event_id") {
            let household_id = row
                .try_get::<Option<String>, _>("last_household_id")
                .unwrap_or(None)
                .unwrap_or_default();
            summary.last = Some(ShadowSample {
                event_id,
                household_id,
                tz: row.try_get("last_tz").unwrap_or(None),
                legacy_start_ms: row.try_get("last_legacy_start_ms").unwrap_or(None),
                utc_start_ms: row.try_get("last_utc_start_ms").unwrap_or(None),
                start_delta_ms: row.try_get("last_start_delta_ms").unwrap_or(None),
                legacy_end_ms: row.try_get("last_legacy_end_ms").unwrap_or(None),
                utc_end_ms: row.try_get("last_utc_end_ms").unwrap_or(None),
                end_delta_ms: row.try_get("last_end_delta_ms").unwrap_or(None),
                observed_at_ms: row
                    .try_get::<Option<i64>, _>("last_observed_at_ms")
                    .unwrap_or(None),
            });
        }
    }

    Ok(summary)
}

async fn persist_summary(pool: &SqlitePool, audit: &ShadowAudit) -> Result<(), sqlx::Error> {
    let mut query = sqlx::query(
        "INSERT INTO shadow_read_audit (\n             id, total_rows, discrepancies, last_event_id, last_household_id, last_tz,\n             last_legacy_start_ms, last_utc_start_ms, last_start_delta_ms,\n             last_legacy_end_ms, last_utc_end_ms, last_end_delta_ms, last_observed_at_ms\n         ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n         ON CONFLICT(id) DO UPDATE SET\n             total_rows = shadow_read_audit.total_rows + excluded.total_rows,\n             discrepancies = shadow_read_audit.discrepancies + excluded.discrepancies,\n             last_event_id = COALESCE(excluded.last_event_id, shadow_read_audit.last_event_id),\n             last_household_id = COALESCE(excluded.last_household_id, shadow_read_audit.last_household_id),\n             last_tz = COALESCE(excluded.last_tz, shadow_read_audit.last_tz),\n             last_legacy_start_ms = COALESCE(excluded.last_legacy_start_ms, shadow_read_audit.last_legacy_start_ms),\n             last_utc_start_ms = COALESCE(excluded.last_utc_start_ms, shadow_read_audit.last_utc_start_ms),\n             last_start_delta_ms = COALESCE(excluded.last_start_delta_ms, shadow_read_audit.last_start_delta_ms),\n             last_legacy_end_ms = COALESCE(excluded.last_legacy_end_ms, shadow_read_audit.last_legacy_end_ms),\n             last_utc_end_ms = COALESCE(excluded.last_utc_end_ms, shadow_read_audit.last_utc_end_ms),\n             last_end_delta_ms = COALESCE(excluded.last_end_delta_ms, shadow_read_audit.last_end_delta_ms),\n             last_observed_at_ms = COALESCE(excluded.last_observed_at_ms, shadow_read_audit.last_observed_at_ms)"
    )
    .bind(clamp_i64(audit.total_rows))
    .bind(clamp_i64(audit.discrepancies));

    if let Some(last) = &audit.last {
        query = query
            .bind(Some(last.event_id.as_str()))
            .bind(Some(last.household_id.as_str()))
            .bind(last.tz.as_deref())
            .bind(last.legacy_start_ms)
            .bind(last.utc_start_ms)
            .bind(last.start_delta_ms)
            .bind(last.legacy_end_ms)
            .bind(last.utc_end_ms)
            .bind(last.end_delta_ms)
            .bind(last.observed_at_ms);
    } else {
        query = query
            .bind(Option::<&str>::None)
            .bind(Option::<&str>::None)
            .bind(Option::<&str>::None)
            .bind(Option::<i64>::None)
            .bind(Option::<i64>::None)
            .bind(Option::<i64>::None)
            .bind(Option::<i64>::None)
            .bind(Option::<i64>::None)
            .bind(Option::<i64>::None)
            .bind(Option::<i64>::None);
    }

    query.execute(pool).await.map(|_| ())
}

fn detect_discrepancy(
    event_id: &str,
    household_id: &str,
    tz_name: Option<&str>,
    legacy_start_ms: Option<i64>,
    legacy_end_ms: Option<i64>,
    utc_start_ms: Option<i64>,
    utc_end_ms: Option<i64>,
) -> Option<ShadowDiscrepancyRecord> {
    let tz_name = tz_name.map(str::trim).filter(|s| !s.is_empty());
    let mut tz_for_record = tz_name.map(|s| s.to_string());

    let (legacy_start, legacy_end) = match tz_name {
        Some(name) => match name.parse::<ChronoTz>() {
            Ok(tz) => (
                legacy_start_ms.and_then(|ms| local_ms_to_utc(ms, &tz)),
                legacy_end_ms.and_then(|ms| local_ms_to_utc(ms, &tz)),
            ),
            Err(_) => (None, None),
        },
        None => (legacy_start_ms, legacy_end_ms),
    };

    let start_delta = diff_opt(legacy_start, utc_start_ms);
    let end_delta = diff_opt(legacy_end, utc_end_ms);

    let start_mismatch = start_delta.is_some_and(|d| d > 0);
    let end_mismatch = end_delta.is_some_and(|d| d > 0);

    if !start_mismatch && !end_mismatch {
        return None;
    }

    Some(ShadowDiscrepancyRecord {
        event_id: event_id.to_string(),
        household_id: household_id.to_string(),
        tz: tz_for_record.take(),
        legacy_start_ms: legacy_start,
        utc_start_ms,
        start_delta_ms: start_delta,
        legacy_end_ms: legacy_end,
        utc_end_ms,
        end_delta_ms: end_delta,
        observed_at_ms: None,
    })
}

fn log_discrepancy(record: &ShadowDiscrepancyRecord) {
    let tz_display = record.tz.as_deref().unwrap_or("(none)");
    tracing::warn!(
        target: "arklowdun",
        event = "time_shadow_discrepancy",
        event_id = %record.event_id,
        household_id = %record.household_id,
        tz = %tz_display,
        legacy_start_ms = ?record.legacy_start_ms,
        utc_start_ms = ?record.utc_start_ms,
        start_delta_ms = ?record.start_delta_ms,
        legacy_end_ms = ?record.legacy_end_ms,
        utc_end_ms = ?record.utc_end_ms,
        end_delta_ms = ?record.end_delta_ms,
        observed_at_ms = ?record.observed_at_ms,
        "shadow-read discrepancy detected"
    );
}

fn local_ms_to_utc(ms: i64, tz: &ChronoTz) -> Option<i64> {
    #[allow(deprecated)]
    let naive = NaiveDateTime::from_timestamp_millis(ms)?;
    let local = match tz.from_local_datetime(&naive) {
        LocalResult::Single(dt) => dt,
        LocalResult::Ambiguous(a, _) => a,
        LocalResult::None => tz
            .offset_from_utc_datetime(&naive)
            .fix()
            .from_utc_datetime(&naive)
            .with_timezone(tz),
    };
    Some(local.with_timezone(&Utc).timestamp_millis())
}

fn diff_opt(legacy: Option<i64>, utc: Option<i64>) -> Option<i64> {
    match (legacy, utc) {
        (Some(a), Some(b)) => Some((i128::from(a) - i128::from(b)).abs() as i64),
        _ => None,
    }
}

fn clamp_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn clamp_u64(value: i64) -> u64 {
    if value <= 0 {
        0
    } else {
        value as u64
    }
}

fn read_flag() -> bool {
    match std::env::var(ENV_VAR) {
        Ok(raw) => match parse_flag(&raw) {
            Some(mode) => mode,
            None => {
                if INVALID_FLAG_LOGGED.set(()).is_ok() {
                    tracing::warn!(
                        target: "arklowdun",
                        event = "time_shadow_flag_invalid",
                        value = %raw,
                        default = "on"
                    );
                }
                true
            }
        },
        Err(_) => true,
    }
}

fn parse_flag(raw: &str) -> Option<bool> {
    let normalized = raw.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    match normalized.as_str() {
        "on" => Some(true),
        "off" => Some(false),
        _ => None,
    }
}

fn is_missing_table(err: &sqlx::Error) -> bool {
    matches!(
        err,
        sqlx::Error::Database(db_err)
            if db_err.message().contains("no such table") && db_err.message().contains("shadow_read_audit")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_flag_recognizes_on_off() {
        assert_eq!(parse_flag("on"), Some(true));
        assert_eq!(parse_flag("OFF"), Some(false));
        assert_eq!(parse_flag(""), None);
        assert_eq!(parse_flag("maybe"), None);
    }

    #[test]
    fn diff_opt_handles_missing_values() {
        assert_eq!(diff_opt(Some(10), Some(5)), Some(5));
        assert_eq!(diff_opt(Some(-5), Some(5)), Some(10));
        assert_eq!(diff_opt(None, Some(5)), None);
        assert_eq!(diff_opt(Some(5), None), None);
    }
}
