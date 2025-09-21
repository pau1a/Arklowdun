use std::collections::BTreeSet;

use anyhow::Result;
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use tracing::{info, warn};

#[derive(Debug, Clone, Default)]
pub struct ExdateContext {
    pub start: Option<DateTime<Utc>>,
    pub until: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ExdateInspection {
    pub canonical: Option<String>,
    #[serde(skip_serializing)]
    pub valid: Vec<DateTime<Utc>>,
    pub invalid_format: Vec<String>,
    pub non_utc: Vec<String>,
    pub out_of_range: Vec<String>,
    pub duplicates: usize,
    pub total_inputs: usize,
}

impl ExdateInspection {
    pub fn skipped(&self) -> usize {
        self.invalid_format.len() + self.non_utc.len() + self.out_of_range.len()
    }

    pub fn invalid_total(&self) -> usize {
        self.invalid_format.len() + self.non_utc.len()
    }
}

pub fn split_csv_exdates(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
        .collect()
}

pub fn parse_rrule_until(rrule: &str) -> Option<DateTime<Utc>> {
    for part in rrule.split(';') {
        let mut iter = part.splitn(2, '=');
        let key = iter.next()?.trim().to_ascii_uppercase();
        if key == "UNTIL" {
            let value = iter.next()?.trim();
            if !value.ends_with('Z') {
                return None;
            }
            if let Ok(naive) = NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%SZ") {
                return Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc));
            }
        }
    }
    None
}

pub fn inspect_exdates<I>(values: I, context: &ExdateContext) -> ExdateInspection
where
    I: IntoIterator<Item = String>,
{
    let mut inspection = ExdateInspection::default();
    let mut seen = BTreeSet::new();
    inspection.total_inputs = 0;
    let start = context.start;
    let until = context.until;

    for raw in values.into_iter() {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        inspection.total_inputs += 1;
        match DateTime::parse_from_rfc3339(trimmed) {
            Ok(parsed) => {
                if !trimmed.ends_with('Z') || parsed.offset().local_minus_utc() != 0 {
                    inspection.non_utc.push(trimmed.to_string());
                    continue;
                }
                let utc = parsed.with_timezone(&Utc);
                if let Some(start) = start {
                    if utc < start {
                        inspection.out_of_range.push(trimmed.to_string());
                        continue;
                    }
                }
                if let Some(until) = until {
                    if utc > until {
                        inspection.out_of_range.push(trimmed.to_string());
                        continue;
                    }
                }
                if !seen.insert(utc) {
                    inspection.duplicates += 1;
                }
            }
            Err(_) => {
                inspection.invalid_format.push(trimmed.to_string());
            }
        }
    }

    inspection.valid = seen.iter().copied().collect();
    if !inspection.valid.is_empty() {
        let canonical = inspection
            .valid
            .iter()
            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
            .collect::<Vec<_>>()
            .join(",");
        inspection.canonical = Some(canonical);
    }

    inspection
}

const MAX_LOGGED_EXAMPLES: usize = 20;

#[derive(Debug, Default, Serialize)]
pub struct ExdateMigrationStats {
    pub scanned: u64,
    pub updated: u64,
    pub cleared: u64,
    pub total_inputs: u64,
    pub total_valid: u64,
    pub invalid_format: u64,
    pub non_utc: u64,
    pub out_of_range: u64,
    pub duplicates_removed: u64,
}

pub async fn normalize_existing_exdates(pool: &SqlitePool) -> Result<ExdateMigrationStats> {
    let rows = sqlx::query(
        "SELECT id, household_id, start_at_utc, rrule, exdates \
         FROM events \
         WHERE exdates IS NOT NULL",
    )
    .fetch_all(pool)
    .await?;

    let mut stats = ExdateMigrationStats::default();
    let mut invalid_examples = Vec::new();
    let mut range_examples = Vec::new();

    for row in rows {
        stats.scanned += 1;
        let event_id: String = row.try_get("id")?;
        let start_at_utc: Option<i64> = row.try_get("start_at_utc").ok();
        let rrule: Option<String> = row.try_get("rrule").ok();
        let raw_exdates: String = row.try_get("exdates")?;

        let tokens = split_csv_exdates(&raw_exdates);
        if tokens.is_empty() {
            sqlx::query("UPDATE events SET exdates = NULL WHERE id = ?")
                .bind(&event_id)
                .execute(pool)
                .await?;
            stats.updated += 1;
            stats.cleared += 1;
            continue;
        }

        let start = start_at_utc.and_then(DateTime::<Utc>::from_timestamp_millis);
        let until = rrule.as_deref().and_then(parse_rrule_until);
        let context = ExdateContext { start, until };
        let inspection = inspect_exdates(tokens.clone(), &context);

        stats.total_inputs += inspection.total_inputs as u64;
        stats.total_valid += inspection.valid.len() as u64;
        stats.invalid_format += inspection.invalid_format.len() as u64;
        stats.non_utc += inspection.non_utc.len() as u64;
        stats.out_of_range += inspection.out_of_range.len() as u64;
        stats.duplicates_removed += inspection.duplicates as u64;

        if !inspection.invalid_format.is_empty() || !inspection.non_utc.is_empty() {
            for value in inspection
                .invalid_format
                .iter()
                .chain(inspection.non_utc.iter())
            {
                if invalid_examples.len() < MAX_LOGGED_EXAMPLES {
                    invalid_examples.push((event_id.clone(), value.clone()));
                }
            }
        }
        if !inspection.out_of_range.is_empty() {
            for value in &inspection.out_of_range {
                if range_examples.len() < MAX_LOGGED_EXAMPLES {
                    range_examples.push((event_id.clone(), value.clone()));
                }
            }
        }

        match inspection.canonical {
            Some(ref canonical) => {
                if canonical != &raw_exdates {
                    sqlx::query("UPDATE events SET exdates = ? WHERE id = ?")
                        .bind(canonical)
                        .bind(&event_id)
                        .execute(pool)
                        .await?;
                    stats.updated += 1;
                }
            }
            None => {
                sqlx::query("UPDATE events SET exdates = NULL WHERE id = ?")
                    .bind(&event_id)
                    .execute(pool)
                    .await?;
                stats.updated += 1;
                stats.cleared += 1;
            }
        }
    }

    if !invalid_examples.is_empty() {
        let formatted: Vec<String> = invalid_examples
            .into_iter()
            .map(|(id, value)| format!("{id}:{value}"))
            .collect();
        warn!(
            target: "arklowdun",
            event = "exdate_migration_invalid",
            examples = %formatted.join(", " ),
            total_invalid = stats.invalid_format + stats.non_utc
        );
    }

    if !range_examples.is_empty() {
        let formatted: Vec<String> = range_examples
            .into_iter()
            .map(|(id, value)| format!("{id}:{value}"))
            .collect();
        warn!(
            target: "arklowdun",
            event = "exdate_migration_out_of_range",
            examples = %formatted.join(", " ),
            total_out_of_range = stats.out_of_range
        );
    }

    info!(
        target: "arklowdun",
        event = "exdate_migration_summary",
        scanned = stats.scanned,
        updated = stats.updated,
        cleared = stats.cleared,
        total_inputs = stats.total_inputs,
        total_valid = stats.total_valid,
        invalid_format = stats.invalid_format,
        non_utc = stats.non_utc,
        out_of_range = stats.out_of_range,
        duplicates_removed = stats.duplicates_removed
    );

    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn parses_rrule_until() {
        let until = parse_rrule_until("FREQ=DAILY;UNTIL=20250101T000000Z;COUNT=5").unwrap();
        assert_eq!(until, Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap());
        assert!(parse_rrule_until("FREQ=DAILY;COUNT=5").is_none());
        assert!(parse_rrule_until("FREQ=DAILY;UNTIL=20250101T000000").is_none());
    }

    #[test]
    fn inspect_reports_invalid_and_duplicates() {
        let start = Utc.with_ymd_and_hms(2024, 1, 1, 9, 0, 0).unwrap();
        let context = ExdateContext {
            start: Some(start),
            until: None,
        };
        let values = vec![
            "2024-01-01T09:00:00Z".to_string(),
            "2023-12-31T09:00:00Z".to_string(),
            "2024-01-02T09:00:00Z".to_string(),
            "2024-01-01T09:00:00+02:00".to_string(),
            "2024-01-01T09:00:00Z".to_string(),
            "bad".to_string(),
        ];
        let inspection = inspect_exdates(values, &context);
        assert_eq!(inspection.valid.len(), 2);
        assert_eq!(inspection.out_of_range.len(), 1);
        assert_eq!(inspection.non_utc.len(), 1);
        assert_eq!(inspection.invalid_format.len(), 1);
        assert_eq!(inspection.duplicates, 1);
        assert_eq!(
            inspection.canonical.as_deref(),
            Some("2024-01-01T09:00:00Z,2024-01-02T09:00:00Z")
        );
    }
}
