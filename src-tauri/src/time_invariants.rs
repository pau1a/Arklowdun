use std::{
    collections::BTreeMap,
    fmt::{self, Write},
};

use chrono::{DateTime, Datelike, NaiveDateTime, NaiveTime, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder, SqlitePool};

use crate::{AppError, AppResult};

const OPERATION: &str = "time_invariants";
const MINUTE_MS: i64 = 60_000;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DriftCategory {
    TimedMismatch,
    AlldayBoundaryError,
    TzMissing,
}

impl fmt::Display for DriftCategory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DriftCategory::TimedMismatch => write!(f, "timed_mismatch"),
            DriftCategory::AlldayBoundaryError => write!(f, "allday_boundary_error"),
            DriftCategory::TzMissing => write!(f, "tz_missing"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriftRecord {
    pub event_id: String,
    pub household_id: String,
    pub start_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recomputed_start_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recomputed_end_at: Option<i64>,
    pub delta_ms: i64,
    pub category: DriftCategory,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DriftReport {
    pub total_events: usize,
    pub drift_events: Vec<DriftRecord>,
    pub counts_by_category: BTreeMap<DriftCategory, usize>,
    pub counts_by_household: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Default)]
pub struct DriftCheckOptions {
    pub household_id: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
struct EventRow {
    id: String,
    household_id: String,
    start_at: i64,
    end_at: Option<i64>,
    tz: Option<String>,
    start_at_utc: i64,
    end_at_utc: Option<i64>,
}

fn naive_from_ms(ms: i64) -> AppResult<NaiveDateTime> {
    DateTime::<Utc>::from_timestamp_millis(ms)
        .map(|dt| dt.naive_utc())
        .ok_or_else(|| {
            AppError::new("TIME/INVALID_TIMESTAMP", "Invalid wall-clock timestamp")
                .with_context("operation", OPERATION)
                .with_context("timestamp", ms.to_string())
        })
}

fn utc_from_ms(ms: i64) -> AppResult<DateTime<Utc>> {
    DateTime::<Utc>::from_timestamp_millis(ms).ok_or_else(|| {
        AppError::new("TIME/INVALID_TIMESTAMP", "Invalid UTC timestamp")
            .with_context("operation", OPERATION)
            .with_context("timestamp", ms.to_string())
    })
}

fn diff_ms(a: i64, b: i64) -> i64 {
    (i128::from(a) - i128::from(b)).abs() as i64
}

fn is_all_day(stored_start: &NaiveDateTime, stored_end: Option<&NaiveDateTime>) -> bool {
    let Some(end) = stored_end else {
        return false;
    };
    let midnight = midnight();
    if stored_start.time() != midnight || end.time() != midnight {
        return false;
    }
    let duration = end.signed_duration_since(*stored_start);
    duration.num_hours() >= 24 && duration.num_hours() % 24 == 0
}

fn allow_all_day_shift(stored: &NaiveDateTime, recomputed: &NaiveDateTime) -> bool {
    if recomputed.time() != midnight() {
        return false;
    }
    let stored_days = stored.date().num_days_from_ce();
    let recomputed_days = recomputed.date().num_days_from_ce();
    (recomputed_days - stored_days).abs() <= 1
}

fn midnight() -> NaiveTime {
    NaiveTime::from_hms_opt(0, 0, 0).unwrap_or(NaiveTime::MIN)
}

fn build_record(
    row: &EventRow,
    category: DriftCategory,
    recomputed_start: Option<i64>,
    recomputed_end: Option<i64>,
    delta_ms: i64,
) -> DriftRecord {
    DriftRecord {
        event_id: row.id.clone(),
        household_id: row.household_id.clone(),
        start_at: row.start_at,
        end_at: row.end_at,
        recomputed_start_at: recomputed_start,
        recomputed_end_at: recomputed_end,
        delta_ms,
        category,
    }
}

fn evaluate_row(row: &EventRow) -> AppResult<Option<DriftRecord>> {
    let tz_name = row.tz.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let tz = match tz_name {
        Some(name) => match name.parse::<Tz>() {
            Ok(tz) => Some(tz),
            Err(_) => None,
        },
        None => None,
    };

    let Some(tz) = tz else {
        return Ok(Some(build_record(
            row,
            DriftCategory::TzMissing,
            None,
            None,
            0,
        )));
    };

    let stored_start = naive_from_ms(row.start_at).map_err(|err| {
        err.with_context("event_id", row.id.clone())
            .with_context("household_id", row.household_id.clone())
    })?;
    let computed_start = utc_from_ms(row.start_at_utc)
        .map_err(|err| {
            err.with_context("event_id", row.id.clone())
                .with_context("household_id", row.household_id.clone())
        })?
        .with_timezone(&tz)
        .naive_local();

    let stored_end = match row.end_at {
        Some(ms) => Some(naive_from_ms(ms).map_err(|err| {
            err.with_context("event_id", row.id.clone())
                .with_context("household_id", row.household_id.clone())
        })?),
        None => None,
    };

    let computed_end = match row.end_at_utc {
        Some(ms) => Some(
            utc_from_ms(ms)
                .map_err(|err| {
                    err.with_context("event_id", row.id.clone())
                        .with_context("household_id", row.household_id.clone())
                })?
                .with_timezone(&tz)
                .naive_local(),
        ),
        None => None,
    };

    if is_all_day(&stored_start, stored_end.as_ref()) {
        let mut ok = allow_all_day_shift(&stored_start, &computed_start);
        if let Some(stored_end) = stored_end.as_ref() {
            if let Some(computed_end) = computed_end.as_ref() {
                ok &= allow_all_day_shift(stored_end, computed_end);
            } else {
                ok = false;
            }
        }
        if ok {
            return Ok(None);
        }
        let recomputed_start_ms = computed_start.and_utc().timestamp_millis();
        let recomputed_end_ms = computed_end.map(|dt| dt.and_utc().timestamp_millis());
        let mut delta = diff_ms(row.start_at, recomputed_start_ms);
        if let (Some(end), Some(recomp)) = (row.end_at, recomputed_end_ms) {
            delta = delta.max(diff_ms(end, recomp));
        }
        return Ok(Some(build_record(
            row,
            DriftCategory::AlldayBoundaryError,
            Some(recomputed_start_ms),
            recomputed_end_ms,
            delta,
        )));
    }

    let recomputed_start_ms = computed_start.and_utc().timestamp_millis();
    let mut delta = diff_ms(row.start_at, recomputed_start_ms);
    let mut mismatch = delta >= MINUTE_MS;

    let recomputed_end_ms = if let (Some(end_at), Some(computed_end)) = (row.end_at, computed_end) {
        let recomputed = computed_end.and_utc().timestamp_millis();
        let end_delta = diff_ms(end_at, recomputed);
        if end_delta >= MINUTE_MS {
            mismatch = true;
        }
        delta = delta.max(end_delta);
        Some(recomputed)
    } else {
        None
    };

    if mismatch {
        return Ok(Some(build_record(
            row,
            DriftCategory::TimedMismatch,
            Some(recomputed_start_ms),
            recomputed_end_ms,
            delta,
        )));
    }

    Ok(None)
}

pub async fn run_drift_check(
    pool: &SqlitePool,
    options: DriftCheckOptions,
) -> AppResult<DriftReport> {
    let mut builder = QueryBuilder::new(
        "SELECT id, household_id, start_at, end_at, tz, start_at_utc, end_at_utc \
         FROM events \
         WHERE deleted_at IS NULL \
           AND start_at_utc IS NOT NULL \
           AND (end_at IS NULL OR end_at_utc IS NOT NULL)",
    );
    if let Some(hh) = &options.household_id {
        builder.push(" AND household_id = ");
        builder.push_bind(hh);
    }
    builder.push(" ORDER BY household_id, start_at, id");

    let rows: Vec<EventRow> = builder
        .build_query_as()
        .fetch_all(pool)
        .await
        .map_err(|err| {
            AppError::from(err)
                .with_context("operation", OPERATION)
                .with_context("step", "query_events")
        })?;

    let mut drift_events = Vec::new();
    for row in rows.iter() {
        if let Some(record) = evaluate_row(row)? {
            drift_events.push(record);
        }
    }

    let mut counts_by_category = BTreeMap::new();
    let mut counts_by_household = BTreeMap::new();
    for record in &drift_events {
        *counts_by_category
            .entry(record.category.clone())
            .or_insert(0) += 1;
        *counts_by_household
            .entry(record.household_id.clone())
            .or_insert(0) += 1;
    }

    Ok(DriftReport {
        total_events: rows.len(),
        drift_events,
        counts_by_category,
        counts_by_household,
    })
}

pub fn format_human_summary(report: &DriftReport) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "Time Invariants Drift Report");
    let _ = writeln!(out, "============================");
    let _ = writeln!(out, "Events checked: {}", report.total_events);
    let _ = writeln!(out, "Drift events:   {}", report.drift_events.len());
    if report.drift_events.is_empty() {
        let _ = writeln!(out, "Status:        OK (no drift detected)");
    } else {
        let _ = writeln!(out, "Status:        Drift detected");
    }

    let _ = writeln!(out, "\nBy category:");
    if report.counts_by_category.is_empty() {
        let _ = writeln!(out, "  (none)");
    } else {
        for (category, count) in &report.counts_by_category {
            let _ = writeln!(out, "  {}: {}", category, count);
        }
    }

    let _ = writeln!(out, "\nBy household:");
    if report.counts_by_household.is_empty() {
        let _ = writeln!(out, "  (none)");
    } else {
        for (household, count) in &report.counts_by_household {
            let _ = writeln!(out, "  {}: {}", household, count);
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_ms_handles_large_values() {
        assert_eq!(diff_ms(0, 0), 0);
        assert_eq!(diff_ms(1, -1), 2);
        assert_eq!(diff_ms(i64::MAX, i64::MAX - 10), 10);
    }
}
