use anyhow::Result;
use arklowdun_lib::time_invariants::{self, DriftCategory, DriftRecord, DriftReport};
use chrono::{Duration, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

async fn setup_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::query(
        "CREATE TABLE events (
            id TEXT PRIMARY KEY,
            household_id TEXT NOT NULL,
            title TEXT NOT NULL,
            start_at INTEGER NOT NULL,
            end_at INTEGER,
            tz TEXT,
            start_at_utc INTEGER,
            end_at_utc INTEGER,
            deleted_at INTEGER
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool
}

#[tokio::test]
async fn timed_mismatch_is_detected() -> Result<()> {
    let pool = setup_pool().await;
    let start = NaiveDate::from_ymd_opt(2024, 3, 10)
        .unwrap()
        .and_hms_opt(9, 0, 0)
        .unwrap();
    let end = start + Duration::hours(1);
    let start_ms = start.and_utc().timestamp_millis();
    let end_ms = end.and_utc().timestamp_millis();
    let start_utc = start_ms - 3_600_000;
    let end_utc = end_ms - 3_600_000;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, deleted_at)
         VALUES (?1, ?2, 'Timed', ?3, ?4, 'UTC', ?5, ?6, NULL)",
    )
    .bind("timed")
    .bind("hh1")
    .bind(start_ms)
    .bind(end_ms)
    .bind(start_utc)
    .bind(end_utc)
    .execute(&pool)
    .await?;

    let report = time_invariants::run_drift_check(&pool, Default::default()).await?;
    assert_eq!(report.total_events, 1);
    assert_eq!(report.drift_events.len(), 1);
    assert_eq!(
        report.drift_events[0].category,
        DriftCategory::TimedMismatch
    );
    Ok(())
}

#[tokio::test]
async fn all_day_shift_within_one_day_is_allowed() -> Result<()> {
    let pool = setup_pool().await;
    let tz: Tz = "America/New_York".parse().unwrap();
    let start = NaiveDate::from_ymd_opt(2024, 3, 10)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap();
    let end = NaiveDate::from_ymd_opt(2024, 3, 11)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap();
    let start_ms = start.and_utc().timestamp_millis();
    let end_ms = end.and_utc().timestamp_millis();
    let start_utc = tz
        .with_ymd_and_hms(2024, 3, 9, 0, 0, 0)
        .unwrap()
        .with_timezone(&Utc)
        .timestamp_millis();
    let end_utc = tz
        .with_ymd_and_hms(2024, 3, 10, 0, 0, 0)
        .unwrap()
        .with_timezone(&Utc)
        .timestamp_millis();
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, deleted_at)
         VALUES (?1, ?2, 'All-day ok', ?3, ?4, ?5, ?6, ?7, NULL)",
    )
    .bind("allday_ok")
    .bind("hh2")
    .bind(start_ms)
    .bind(end_ms)
    .bind(tz.name())
    .bind(start_utc)
    .bind(end_utc)
    .execute(&pool)
    .await?;

    let report = time_invariants::run_drift_check(&pool, Default::default()).await?;
    assert_eq!(report.total_events, 1);
    assert!(report.drift_events.is_empty());
    Ok(())
}

#[tokio::test]
async fn all_day_boundary_violation_is_reported() -> Result<()> {
    let pool = setup_pool().await;
    let tz: Tz = "America/New_York".parse().unwrap();
    let start = NaiveDate::from_ymd_opt(2024, 3, 10)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap();
    let end = NaiveDate::from_ymd_opt(2024, 3, 11)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap();
    let start_ms = start.and_utc().timestamp_millis();
    let end_ms = end.and_utc().timestamp_millis();
    let start_utc = tz
        .with_ymd_and_hms(2024, 3, 8, 0, 0, 0)
        .unwrap()
        .with_timezone(&Utc)
        .timestamp_millis();
    let end_utc = tz
        .with_ymd_and_hms(2024, 3, 9, 0, 0, 0)
        .unwrap()
        .with_timezone(&Utc)
        .timestamp_millis();
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, deleted_at)
         VALUES (?1, ?2, 'All-day bad', ?3, ?4, ?5, ?6, ?7, NULL)",
    )
    .bind("allday_bad")
    .bind("hh3")
    .bind(start_ms)
    .bind(end_ms)
    .bind(tz.name())
    .bind(start_utc)
    .bind(end_utc)
    .execute(&pool)
    .await?;

    let report = time_invariants::run_drift_check(&pool, Default::default()).await?;
    assert_eq!(report.total_events, 1);
    assert_eq!(report.drift_events.len(), 1);
    assert_eq!(
        report.drift_events[0].category,
        DriftCategory::AlldayBoundaryError
    );
    Ok(())
}

#[tokio::test]
async fn missing_timezone_is_flagged() -> Result<()> {
    let pool = setup_pool().await;
    let start = NaiveDate::from_ymd_opt(2024, 4, 1)
        .unwrap()
        .and_hms_opt(12, 0, 0)
        .unwrap();
    let start_ms = start.and_utc().timestamp_millis();
    let start_utc = start_ms;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, deleted_at)
         VALUES (?1, ?2, 'No TZ', ?3, NULL, NULL, ?4, NULL, NULL)",
    )
    .bind("missing_tz")
    .bind("hh4")
    .bind(start_ms)
    .bind(start_utc)
    .execute(&pool)
    .await?;

    let report = time_invariants::run_drift_check(&pool, Default::default()).await?;
    assert_eq!(report.total_events, 1);
    assert_eq!(report.drift_events.len(), 1);
    assert_eq!(report.drift_events[0].category, DriftCategory::TzMissing);
    Ok(())
}

#[test]
fn drift_report_maps_to_taxonomy_error() {
    let report = DriftReport {
        total_events: 1,
        drift_events: vec![DriftRecord {
            event_id: "evt-1".into(),
            household_id: "hh-test".into(),
            start_at: 0,
            end_at: None,
            recomputed_start_at: Some(1_000),
            recomputed_end_at: None,
            delta_ms: 65_000,
            category: DriftCategory::TimedMismatch,
        }],
        counts_by_category: Default::default(),
        counts_by_household: Default::default(),
    };

    let err = time_invariants::drift_report_to_error(&report, Some("hh-test"))
        .expect("drift should produce error");
    assert_eq!(err.code(), "E_TZ_DRIFT_DETECTED");
    assert_eq!(
        err.context().get("household_id").map(String::as_str),
        Some("hh-test")
    );
    assert_eq!(
        err.context().get("drift_count").map(String::as_str),
        Some("1")
    );
    assert_eq!(
        err.context().get("sample_event_ids").map(String::as_str),
        Some("evt-1")
    );
}
