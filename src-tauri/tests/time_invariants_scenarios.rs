use std::collections::BTreeMap;
use std::path::Path;
use std::sync::OnceLock;

use anyhow::{anyhow, Context, Result};
use arklowdun_lib::time_invariants::{
    self, DriftCategory, ALL_DAY_BOUNDARY_SLACK_DAYS, TIMED_DRIFT_THRESHOLD_MS,
};
use chrono::{DateTime, Duration, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc};
#[cfg(chrono_tz_has_iana_version)]
use chrono_tz::IANA_TZDB_VERSION;
use chrono_tz::{Tz, TZ_VARIANTS};
use serde::Deserialize;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};

macro_rules! fixture_data {
    ($name:literal) => {{
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../fixtures/time/invariants")
            .join($name);
        if !path.exists() {
            panic!("fixture {} missing at {}", $name, path.display());
        }
        const DATA: &str = include_str!(concat!("../../fixtures/time/invariants/", $name));
        if DATA.is_empty() {
            panic!("fixture {name} is empty", name = $name);
        }
        DATA
    }};
}

fn chrono_tz_version() -> &'static str {
    option_env!("CHRONO_TZ_CRATE_VERSION").unwrap_or("unknown")
}

#[cfg(chrono_tz_has_iana_version)]
fn tzdb_revision() -> Option<&'static str> {
    Some(IANA_TZDB_VERSION)
}

#[cfg(not(chrono_tz_has_iana_version))]
fn tzdb_revision() -> Option<&'static str> {
    None
}

fn tzdb_label() -> String {
    match tzdb_revision() {
        Some(rev) => format!("{rev} (chrono-tz {})", chrono_tz_version()),
        None => format!("chrono-tz {}", chrono_tz_version()),
    }
}

#[derive(Debug, Deserialize)]
struct Fixture {
    description: String,
    #[serde(default)]
    reference: Option<String>,
    events: Vec<FixtureEvent>,
}

#[derive(Debug, Deserialize)]
struct FixtureEvent {
    id: String,
    household_id: String,
    title: String,
    #[serde(default)]
    tz: Option<String>,
    local_start: String,
    #[serde(default)]
    local_end: Option<String>,
    #[serde(default)]
    start_at_utc: Option<String>,
    #[serde(default)]
    end_at_utc: Option<String>,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    expected_drift: Option<DriftCategory>,
}

#[derive(Debug, Clone)]
struct MaterializedFixture {
    description: String,
    reference: Option<String>,
    events: Vec<MaterializedEvent>,
}

#[derive(Debug, Clone)]
struct MaterializedEvent {
    id: String,
    household_id: String,
    title: String,
    tz: Option<String>,
    note: Option<String>,
    expected_drift: Option<DriftCategory>,
    requested_local_start: String,
    requested_local_end: Option<String>,
    local_start: NaiveDateTime,
    local_end: Option<NaiveDateTime>,
    start_at: i64,
    end_at: Option<i64>,
    start_at_utc: i64,
    end_at_utc: Option<i64>,
    created_at: i64,
    updated_at: i64,
}

async fn setup_pool() -> Result<SqlitePool> {
    log_environment();
    let opts = SqliteConnectOptions::new()
        .filename(":memory:")
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .context("connect in-memory sqlite")?;
    arklowdun_lib::migrate::apply_migrations(&pool)
        .await
        .context("apply schema migrations")?;
    Ok(pool)
}

fn log_environment() {
    static INIT: OnceLock<()> = OnceLock::new();
    INIT.get_or_init(|| {
        println!(
            "time-invariants runtime: arklowdun={} tzdb={} (variants={})",
            env!("CARGO_PKG_VERSION"),
            tzdb_label(),
            TZ_VARIANTS.len()
        );
        println!(
            "policies: nonexistent->forward first valid minute, ambiguous->earlier offset, timed_threshold={}ms, all_day_midnight_slack={}d",
            TIMED_DRIFT_THRESHOLD_MS,
            ALL_DAY_BOUNDARY_SLACK_DAYS
        );
    });
}

async fn ensure_households(pool: &SqlitePool, events: &[FixtureEvent]) -> Result<()> {
    let mut households: BTreeMap<String, Option<String>> = BTreeMap::new();
    for event in events {
        households
            .entry(event.household_id.clone())
            .and_modify(|tz| {
                if tz.is_none() {
                    *tz = event.tz.clone();
                }
            })
            .or_insert_with(|| event.tz.clone());
    }

    for (household_id, tz) in households {
        sqlx::query(
            "INSERT OR IGNORE INTO household (id, name, tz, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, 0, 0, NULL)",
        )
        .bind(&household_id)
        .bind(format!("Fixture household {household_id}"))
        .bind(tz.as_deref())
        .execute(pool)
        .await
        .with_context(|| format!("insert household {household_id}"))?;
    }

    Ok(())
}

async fn seed_fixture(pool: &SqlitePool, json: &str) -> Result<MaterializedFixture> {
    let fixture: Fixture = serde_json::from_str(json).context("parse fixture json")?;
    let Fixture {
        description,
        reference,
        events,
    } = fixture;

    ensure_households(pool, &events).await?;

    let mut seeded = Vec::with_capacity(events.len());
    for event in events {
        let materialized = event.materialize()?;
        sqlx::query(
            "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, reminder, created_at, updated_at, deleted_at, rrule, exdates)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, NULL, NULL, NULL)",
        )
        .bind(&materialized.id)
        .bind(&materialized.household_id)
        .bind(&materialized.title)
        .bind(materialized.start_at)
        .bind(materialized.end_at)
        .bind(materialized.tz.as_deref())
        .bind(materialized.start_at_utc)
        .bind(materialized.end_at_utc)
        .bind(materialized.created_at)
        .bind(materialized.updated_at)
        .execute(pool)
        .await
        .with_context(|| format!("insert event {}", materialized.id))?;
        seeded.push(materialized);
    }

    Ok(MaterializedFixture {
        description,
        reference,
        events: seeded,
    })
}

impl FixtureEvent {
    fn materialize(self) -> Result<MaterializedEvent> {
        let FixtureEvent {
            id,
            household_id,
            title,
            tz,
            local_start,
            local_end,
            start_at_utc,
            end_at_utc,
            note,
            expected_drift,
        } = self;

        let requested_local_start = local_start.clone();
        let requested_local_end = local_end.clone();
        let mut local_start_dt = parse_naive(&local_start)
            .with_context(|| format!("event {id}: invalid local_start {local_start}"))?;
        let mut local_end_dt = match local_end.as_ref() {
            Some(value) => Some(
                parse_naive(value)
                    .with_context(|| format!("event {id}: invalid local_end {value}"))?,
            ),
            None => None,
        };

        let tz_resolved = match tz.as_deref() {
            Some(name) => Some(
                name.parse::<Tz>()
                    .with_context(|| format!("event {id}: invalid timezone {name}"))?,
            ),
            None => None,
        };

        let start_at_utc_ms = match (&start_at_utc, tz_resolved) {
            (Some(value), _) => parse_utc_ms(value)
                .with_context(|| format!("event {id}: invalid start_at_utc {value}"))?,
            (None, Some(tz)) => {
                let resolved = resolve_local_datetime(&tz, &local_start_dt).with_context(|| {
                    format!("event {id}: local start {local_start_dt} missing in {tz}")
                })?;
                local_start_dt = resolved.naive_local();
                resolved.with_timezone(&Utc).timestamp_millis()
            }
            (None, None) => {
                return Err(anyhow!(
                    "event {id} missing timezone and start_at_utc override"
                ))
            }
        };

        let end_at_utc_ms = match (&end_at_utc, local_end_dt.as_ref(), tz_resolved) {
            (Some(value), _, _) => Some(
                parse_utc_ms(value)
                    .with_context(|| format!("event {id}: invalid end_at_utc {value}"))?,
            ),
            (None, Some(end_local), Some(tz)) => {
                let resolved = resolve_local_datetime(&tz, end_local).with_context(|| {
                    format!("event {id}: local end {end_local} missing in {tz}")
                })?;
                local_end_dt = Some(resolved.naive_local());
                Some(resolved.with_timezone(&Utc).timestamp_millis())
            }
            (None, None, _) => None,
            (None, Some(_), None) => {
                return Err(anyhow!(
                    "event {id} missing timezone and end_at_utc override"
                ))
            }
        };

        let start_at = encode_local_ms(&local_start_dt);
        let end_at = local_end_dt.as_ref().map(encode_local_ms);

        let created_at = start_at_utc_ms;
        let updated_at = end_at_utc_ms.unwrap_or(start_at_utc_ms);

        Ok(MaterializedEvent {
            id,
            household_id,
            title,
            tz,
            note,
            expected_drift,
            requested_local_start,
            requested_local_end,
            local_start: local_start_dt,
            local_end: local_end_dt,
            start_at,
            end_at,
            start_at_utc: start_at_utc_ms,
            end_at_utc: end_at_utc_ms,
            created_at,
            updated_at,
        })
    }
}

fn parse_naive(value: &str) -> Result<NaiveDateTime> {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S")
        .with_context(|| format!("invalid naive datetime {value}"))
}

/// Encode a naive local datetime into the millisecond representation stored in
/// the `events.start_at` column. The production schema persists local
/// wall-clock values without timezone context; it is equivalent to
/// `NaiveDateTime::timestamp_millis`.
#[allow(deprecated)]
fn encode_local_ms(naive: &NaiveDateTime) -> i64 {
    naive.timestamp_millis()
}

fn parse_utc_ms(value: &str) -> Result<i64> {
    let dt = DateTime::parse_from_rfc3339(value)
        .with_context(|| format!("invalid RFC3339 datetime {value}"))?;
    Ok(dt.with_timezone(&Utc).timestamp_millis())
}

fn resolve_local_datetime(tz: &Tz, naive: &NaiveDateTime) -> Result<DateTime<Tz>> {
    match tz.from_local_datetime(naive) {
        LocalResult::Single(dt) => Ok(dt),
        LocalResult::Ambiguous(first, second) => Ok(first.min(second)),
        LocalResult::None => map_nonexistent_forward(tz, naive),
    }
}

fn map_nonexistent_forward(tz: &Tz, naive: &NaiveDateTime) -> Result<DateTime<Tz>> {
    let mut probe = *naive;
    for _ in 0..120 {
        probe += Duration::minutes(1);
        match tz.from_local_datetime(&probe) {
            LocalResult::Single(dt) => return Ok(dt),
            LocalResult::Ambiguous(first, second) => return Ok(first.min(second)),
            LocalResult::None => continue,
        }
    }
    Err(anyhow!(
        "{naive} does not occur in {tz} and no valid local time within +120 minutes"
    ))
}

fn format_utc_ms(ms: i64) -> String {
    match Utc.timestamp_millis_opt(ms) {
        LocalResult::Single(dt) => dt.to_rfc3339(),
        LocalResult::Ambiguous(first, second) => {
            format!("ambiguous:{}|{}", first.to_rfc3339(), second.to_rfc3339())
        }
        LocalResult::None => format!("invalid({ms})"),
    }
}

fn format_opt_utc(ms: Option<i64>) -> String {
    ms.map(format_utc_ms).unwrap_or_else(|| "NULL".to_string())
}

fn format_local(naive: &NaiveDateTime) -> String {
    naive.format("%Y-%m-%d %H:%M:%S").to_string()
}

fn recompute_local_label(tz_name: &str, utc_ms: i64) -> Option<String> {
    let tz: Tz = tz_name.parse().ok()?;
    let utc = Utc.timestamp_millis_opt(utc_ms).single()?;
    Some(
        utc.with_timezone(&tz)
            .format("%Y-%m-%d %H:%M:%S")
            .to_string(),
    )
}

fn log_fixture(label: &str, fixture: &MaterializedFixture) {
    println!("=== {label} fixture ===");
    println!("description: {}", fixture.description);
    if let Some(reference) = &fixture.reference {
        println!("reference: {reference}");
    }
    for event in &fixture.events {
        let tz_label = event.tz.as_deref().unwrap_or("<missing>");
        println!(
            "  - {id} [{tz_label}] start_at_utc={start_utc} end_at_utc={end_utc}",
            id = event.id,
            start_utc = format_utc_ms(event.start_at_utc),
            end_utc = format_opt_utc(event.end_at_utc),
        );
        println!(
            "      requested local start: {}",
            event.requested_local_start
        );
        println!(
            "      stored local start:    {} (start_at={})",
            format_local(&event.local_start),
            event.start_at
        );
        if let Some(requested_end) = &event.requested_local_end {
            println!("      requested local end:   {requested_end}");
        }
        if let Some(local_end) = &event.local_end {
            let end_at_label = event
                .end_at
                .map(|ms| ms.to_string())
                .unwrap_or_else(|| "NULL".into());
            println!(
                "      stored local end:      {} (end_at={})",
                format_local(local_end),
                end_at_label
            );
        }
        if let Some(tz_name) = event.tz.as_deref() {
            if let Some(local) = recompute_local_label(tz_name, event.start_at_utc) {
                println!("      recomputed local start: {local}");
            }
            if let (Some(end_ms), Some(local_end)) = (event.end_at_utc, event.local_end) {
                if let Some(recomputed) = recompute_local_label(tz_name, end_ms) {
                    println!(
                        "      recomputed local end:   {recomputed} (stored {stored})",
                        stored = format_local(&local_end)
                    );
                }
            }
        }
        if let Some(expected) = &event.expected_drift {
            println!("      expected drift: {expected}");
        }
        if let Some(note) = &event.note {
            println!("      note: {note}");
        }
    }
}

fn log_report(label: &str, report: &time_invariants::DriftReport) {
    println!("=== {label} report ===");
    println!("{}", time_invariants::format_human_summary(report));
}

#[tokio::test]
async fn dst_spring_forward_keeps_nine_am_meeting() -> Result<()> {
    let pool = setup_pool().await?;
    let fixture = seed_fixture(&pool, fixture_data!("dst_spring_forward.json")).await?;
    log_fixture("DST spring forward", &fixture);

    let report = time_invariants::run_drift_check(&pool, Default::default()).await?;
    log_report("DST spring forward", &report);

    assert_eq!(report.total_events, fixture.events.len());
    assert!(report.drift_events.is_empty());
    Ok(())
}

#[tokio::test]
async fn nonexistent_local_times_map_forward() -> Result<()> {
    let pool = setup_pool().await?;
    let fixture = seed_fixture(&pool, fixture_data!("nonexistent_local.json")).await?;
    log_fixture("DST gap forward", &fixture);

    let report = time_invariants::run_drift_check(&pool, Default::default()).await?;
    log_report("DST gap forward", &report);

    assert_eq!(report.total_events, fixture.events.len());
    assert!(report.drift_events.is_empty());

    let gap_event = fixture
        .events
        .iter()
        .find(|event| event.id == "dst-gap-2025-03-09")
        .expect("gap event seeded");
    assert_eq!(format_local(&gap_event.local_start), "2025-03-09 03:00:00");
    if let Some(end) = &gap_event.local_end {
        assert_eq!(format_local(end), "2025-03-09 03:15:00");
    }

    Ok(())
}

#[tokio::test]
async fn dst_fall_back_keeps_single_instances() -> Result<()> {
    let pool = setup_pool().await?;
    let fixture = seed_fixture(&pool, fixture_data!("dst_fall_back.json")).await?;
    log_fixture("DST fall back", &fixture);

    let report = time_invariants::run_drift_check(&pool, Default::default()).await?;
    log_report("DST fall back", &report);

    assert_eq!(report.total_events, fixture.events.len());
    assert!(report.drift_events.is_empty());
    assert!(
        report
            .drift_events
            .iter()
            .all(|record| record.event_id != "dst-back-ambiguous-0130"),
        "ambiguous fall-back event should retain earlier offset"
    );
    Ok(())
}

#[tokio::test]
async fn leap_day_span_remains_stable() -> Result<()> {
    let pool = setup_pool().await?;
    let fixture = seed_fixture(&pool, fixture_data!("leap_day.json")).await?;
    log_fixture("Leap day", &fixture);

    let report = time_invariants::run_drift_check(&pool, Default::default()).await?;
    log_report("Leap day", &report);

    assert_eq!(report.total_events, fixture.events.len());
    assert!(report.drift_events.is_empty());
    Ok(())
}

#[tokio::test]
async fn cross_timezone_recompute_matches_local_wall_clock() -> Result<()> {
    let pool = setup_pool().await?;
    let fixture = seed_fixture(&pool, fixture_data!("cross_timezone.json")).await?;
    log_fixture("Cross timezone", &fixture);

    let report = time_invariants::run_drift_check(&pool, Default::default()).await?;
    log_report("Cross timezone", &report);

    assert_eq!(report.total_events, fixture.events.len());
    assert!(report.drift_events.is_empty());

    let utc_event = fixture
        .events
        .iter()
        .find(|event| event.id == "cross-tz-utc")
        .expect("UTC event seeded");
    let tokyo_event = fixture
        .events
        .iter()
        .find(|event| event.id == "cross-tz-tokyo")
        .expect("Tokyo event seeded");
    assert_eq!(utc_event.start_at_utc, tokyo_event.start_at_utc);
    let offset = tokyo_event
        .local_start
        .signed_duration_since(utc_event.local_start);
    assert_eq!(offset.num_hours(), 9);
    assert_eq!(offset.num_minutes(), 9 * 60);

    Ok(())
}

#[tokio::test]
async fn timed_vs_all_day_thresholds_are_enforced() -> Result<()> {
    let pool = setup_pool().await?;
    let fixture = seed_fixture(&pool, fixture_data!("all_day_vs_timed.json")).await?;
    log_fixture("Timed vs all-day", &fixture);

    let report = time_invariants::run_drift_check(&pool, Default::default()).await?;
    log_report("Timed vs all-day", &report);
    assert_eq!(report.total_events, fixture.events.len());

    let mut expected: BTreeMap<String, DriftCategory> = fixture
        .events
        .iter()
        .filter_map(|event| {
            event
                .expected_drift
                .as_ref()
                .map(|cat| (event.id.clone(), cat.clone()))
        })
        .collect();

    for record in &report.drift_events {
        println!(
            "  drift detected: {} -> {} ({} ms)",
            record.event_id, record.category, record.delta_ms
        );
        match expected.remove(&record.event_id) {
            Some(expected_cat) => assert_eq!(record.category, expected_cat),
            None => panic!("unexpected drift for event {}", record.event_id),
        }
    }

    assert!(
        expected.is_empty(),
        "expected drift events missing: {:?}",
        expected.keys().collect::<Vec<_>>()
    );
    Ok(())
}

#[cfg(test)]
mod policy_tests {
    use super::*;

    #[test]
    fn nonexistent_local_forward_policy_maps_to_next_valid_minute() {
        let tz: Tz = "America/New_York".parse().expect("valid timezone");
        let naive = NaiveDate::from_ymd_opt(2025, 3, 9)
            .unwrap()
            .and_hms_opt(2, 15, 0)
            .unwrap();
        let resolved = map_nonexistent_forward(&tz, &naive).expect("mapping succeeds");
        let expected = NaiveDate::from_ymd_opt(2025, 3, 9)
            .unwrap()
            .and_hms_opt(3, 0, 0)
            .unwrap();
        assert_eq!(resolved.naive_local(), expected);
    }
}
