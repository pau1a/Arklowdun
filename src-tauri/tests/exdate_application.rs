use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use arklowdun_lib::{commands, migrate};
use chrono::{
    DateTime, Duration, LocalResult, NaiveDateTime, Offset, SecondsFormat, TimeZone, Utc,
};
use chrono_tz::Tz as ChronoTz;
use rrule::{RRule, RRuleSet, Tz, Unvalidated};
use serde::{Deserialize, Serialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};

#[derive(Debug, Deserialize, Clone)]
struct ScenarioConfig {
    name: String,
    description: String,
    timezone: String,
    local_start: String,
    local_end: String,
    rrule: String,
    exdates: Vec<String>,
    range_start_utc: String,
    range_end_utc: String,
}

#[derive(Debug, Deserialize)]
struct ScenarioList {
    scenarios: Vec<ScenarioConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct InstanceSnapshot {
    start_utc: String,
    end_utc: String,
    local_start: String,
    local_end: String,
    offset_seconds: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ScenarioSnapshot {
    expected_count: usize,
    instances: Vec<InstanceSnapshot>,
}

type SnapshotMap = BTreeMap<String, ScenarioSnapshot>;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/exdate_fixtures")
}

fn load_scenarios() -> Result<Vec<ScenarioConfig>> {
    let path = fixtures_dir().join("exdate_scenarios.json");
    let data = fs::read_to_string(&path).with_context(|| format!("read {path:?}"))?;
    let list: ScenarioList =
        serde_json::from_str(&data).with_context(|| format!("parse {path:?}"))?;
    Ok(list.scenarios)
}

fn load_expected_snapshots() -> Result<SnapshotMap> {
    let path = fixtures_dir().join("exdate_expected.json");
    let data = fs::read_to_string(&path).with_context(|| format!("read {path:?}"))?;
    let map: SnapshotMap =
        serde_json::from_str(&data).with_context(|| format!("parse {path:?}"))?;
    Ok(map)
}

fn parse_local(s: &str) -> Result<NaiveDateTime> {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M"))
        .with_context(|| format!("parse local naive datetime: {s}"))
}

fn resolve_local(tz: &ChronoTz, naive: NaiveDateTime) -> DateTime<ChronoTz> {
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(dt) => dt,
        LocalResult::Ambiguous(first, _second) => first,
        LocalResult::None => tz
            .offset_from_utc_datetime(&naive)
            .fix()
            .from_utc_datetime(&naive)
            .with_timezone(tz),
    }
}

fn parse_utc(s: &str) -> Result<DateTime<Utc>> {
    Ok(DateTime::parse_from_rfc3339(s)
        .with_context(|| format!("parse utc instant: {s}"))?
        .with_timezone(&Utc))
}

fn scenario_rrule_snapshots(scenario: &ScenarioConfig) -> Result<Vec<InstanceSnapshot>> {
    let tz_chrono: ChronoTz = scenario
        .timezone
        .parse()
        .with_context(|| format!("unknown timezone {}", scenario.timezone))?;
    let tz_rrule: Tz = tz_chrono.into();
    let start_naive = parse_local(&scenario.local_start)?;
    let end_naive = parse_local(&scenario.local_end)?;
    let start_local_chrono = resolve_local(&tz_chrono, start_naive);
    let end_local_chrono = resolve_local(&tz_chrono, end_naive);
    let start_local = start_local_chrono.with_timezone(&tz_rrule);
    let end_local = end_local_chrono.with_timezone(&tz_rrule);
    let duration = end_local - start_local;
    let duration_ms = duration.num_milliseconds();
    let rrule_unvalidated: RRule<Unvalidated> = scenario
        .rrule
        .parse()
        .with_context(|| format!("parse rrule {}", scenario.rrule))?;
    let validated = rrule_unvalidated
        .validate(start_local)
        .with_context(|| format!("validate rrule {}", scenario.rrule))?;
    let mut set = RRuleSet::new(start_local).rrule(validated);
    for raw in &scenario.exdates {
        if raw.trim().is_empty() {
            continue;
        }
        let ex_utc = parse_utc(raw)?;
        let ex_local = ex_utc.with_timezone(&tz_rrule);
        set = set.exdate(ex_local);
    }
    let after = parse_utc(&scenario.range_start_utc)?.with_timezone(&tz_rrule);
    let before = parse_utc(&scenario.range_end_utc)?.with_timezone(&tz_rrule);
    set = set.after(after).before(before);
    let occurrences = set.all(600);
    let mut snapshots = Vec::new();
    let range_start_ms = parse_utc(&scenario.range_start_utc)?.timestamp_millis();
    let range_end_ms = parse_utc(&scenario.range_end_utc)?.timestamp_millis();
    for occ in occurrences.dates {
        let start_utc = occ.with_timezone(&Utc);
        let end_utc = (occ + Duration::milliseconds(duration_ms)).with_timezone(&Utc);
        if end_utc.timestamp_millis() < range_start_ms {
            continue;
        }
        if start_utc.timestamp_millis() > range_end_ms {
            continue;
        }
        let local_start = start_utc.with_timezone(&tz_chrono);
        let local_end = end_utc.with_timezone(&tz_chrono);
        snapshots.push(InstanceSnapshot {
            start_utc: start_utc.to_rfc3339_opts(SecondsFormat::Secs, true),
            end_utc: end_utc.to_rfc3339_opts(SecondsFormat::Secs, true),
            local_start: local_start.to_rfc3339_opts(SecondsFormat::Secs, true),
            local_end: local_end.to_rfc3339_opts(SecondsFormat::Secs, true),
            offset_seconds: local_start.offset().fix().local_minus_utc(),
        });
    }
    snapshots.sort_by(|a, b| a.start_utc.cmp(&b.start_utc));
    Ok(snapshots)
}

#[tokio::test]
async fn exdate_rrule_engine_matches_snapshots() -> Result<()> {
    let scenarios = load_scenarios()?;
    let expected = load_expected_snapshots()?;
    for scenario in scenarios {
        let actual = scenario_rrule_snapshots(&scenario)
            .with_context(|| format!("expand {} via rrule engine", scenario.name))?;
        let expected_snapshot = expected.get(&scenario.name).unwrap_or_else(|| {
            println!(
                "missing snapshot for {} ({}). add entry:\n{}",
                scenario.name,
                scenario.description,
                serde_json::to_string_pretty(&ScenarioSnapshot {
                    expected_count: actual.len(),
                    instances: actual.clone(),
                })
                .unwrap()
            );
            panic!(
                "missing expected snapshot for scenario {}. generate fixtures via REGEN_EXDATE_SNAPSHOT=1 cargo test --test exdate_application -- --nocapture",
                scenario.name
            )
        });
        assert_eq!(
            expected_snapshot.instances, actual,
            "scenario {} snapshot drift",
            scenario.name
        );
        assert_eq!(
            expected_snapshot.expected_count,
            actual.len(),
            "scenario {} expected count mismatch",
            scenario.name
        );
        if scenario.name == "duplicate_exdates_are_idempotent" {
            let unique_exdates: BTreeSet<_> = scenario.exdates.iter().collect();
            assert!(
                unique_exdates.len() < scenario.exdates.len(),
                "scenario {} is expected to contain duplicate exdates",
                scenario.name
            );
        }
        if scenario.name == "single_exdate_removal" {
            assert!(
                scenario.exdates.len() == 1,
                "scenario {} must only provide one exdate",
                scenario.name
            );
        }
    }
    Ok(())
}

async fn setup_pool() -> Result<SqlitePool> {
    let opts = SqliteConnectOptions::new()
        .filename(":memory:")
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .context("connect sqlite memory pool")?;
    migrate::apply_migrations(&pool)
        .await
        .context("apply migrations")?;
    Ok(pool)
}

async fn seed_event(pool: &SqlitePool, scenario: &ScenarioConfig) -> Result<()> {
    let tz: ChronoTz = scenario
        .timezone
        .parse()
        .with_context(|| format!("unknown timezone {}", scenario.timezone))?;
    let start_naive = parse_local(&scenario.local_start)?;
    let end_naive = parse_local(&scenario.local_end)?;
    let start_local = resolve_local(&tz, start_naive);
    let end_local = resolve_local(&tz, end_naive);
    let start_at_local = start_local.naive_local().and_utc().timestamp_millis();
    let end_at_local = end_local.naive_local().and_utc().timestamp_millis();
    let start_at_utc = start_local.with_timezone(&Utc).timestamp_millis();
    let end_at_utc = end_local.with_timezone(&Utc).timestamp_millis();
    let hh_id = format!("HH-{}", scenario.name);
    let event_id = format!("EXDATE-{}", scenario.name);

    sqlx::query(
        "INSERT INTO household (id, name, tz, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, 0, 0, NULL)",
    )
    .bind(&hh_id)
    .bind(format!("Fixture household {}", scenario.name))
    .bind(&scenario.timezone)
    .execute(pool)
    .await
    .with_context(|| format!("insert household for {}", scenario.name))?;

    let exdates = if scenario.exdates.is_empty() {
        None
    } else {
        Some(scenario.exdates.join(","))
    };

    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, rrule, exdates, reminder, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, 0, 0, NULL)",
    )
    .bind(&event_id)
    .bind(&hh_id)
    .bind(format!("Scenario {}", scenario.name))
    .bind(start_at_local)
    .bind(end_at_local)
    .bind(&scenario.timezone)
    .bind(start_at_utc)
    .bind(end_at_utc)
    .bind(&scenario.rrule)
    .bind(exdates)
    .execute(pool)
    .await
    .with_context(|| format!("insert event for {}", scenario.name))?;

    Ok(())
}

fn events_to_snapshots(
    events: &[arklowdun_lib::Event],
    scenario: &ScenarioConfig,
) -> Result<Vec<InstanceSnapshot>> {
    let tz: ChronoTz = scenario
        .timezone
        .parse()
        .with_context(|| format!("unknown timezone {}", scenario.timezone))?;
    let mut snapshots = Vec::with_capacity(events.len());
    for event in events {
        let start_utc = DateTime::<Utc>::from_timestamp_millis(event.start_at)
            .with_context(|| format!("event {} missing start", event.id))?;
        let end_ms = event
            .end_at
            .or(event.end_at_utc)
            .with_context(|| format!("event {} missing end", event.id))?;
        let end_utc = DateTime::<Utc>::from_timestamp_millis(end_ms)
            .with_context(|| format!("event {} invalid end", event.id))?;
        let local_start = start_utc.with_timezone(&tz);
        let local_end = end_utc.with_timezone(&tz);
        snapshots.push(InstanceSnapshot {
            start_utc: start_utc.to_rfc3339_opts(SecondsFormat::Secs, true),
            end_utc: end_utc.to_rfc3339_opts(SecondsFormat::Secs, true),
            local_start: local_start.to_rfc3339_opts(SecondsFormat::Secs, true),
            local_end: local_end.to_rfc3339_opts(SecondsFormat::Secs, true),
            offset_seconds: local_start.offset().fix().local_minus_utc(),
        });
    }
    snapshots.sort_by(|a, b| a.start_utc.cmp(&b.start_utc));
    Ok(snapshots)
}

#[tokio::test]
async fn exdate_events_list_range_matches_snapshots() -> Result<()> {
    let scenarios = load_scenarios()?;
    let expected = load_expected_snapshots()?;
    for scenario in scenarios {
        let pool = setup_pool().await?;
        seed_event(&pool, &scenario).await?;
        let hh_id = format!("HH-{}", scenario.name);
        let range_start = parse_utc(&scenario.range_start_utc)?.timestamp_millis();
        let range_end = parse_utc(&scenario.range_end_utc)?.timestamp_millis();
        let via_rrule = scenario_rrule_snapshots(&scenario)?;
        let response = commands::events_list_range_command(&pool, &hh_id, range_start, range_end)
            .await
            .with_context(|| format!("invoke events_list_range for {}", scenario.name))?;
        assert!(
            !response.truncated,
            "scenario {} unexpectedly truncated",
            scenario.name
        );
        let from_command = events_to_snapshots(&response.items, &scenario)?;
        let expected_snapshot = expected.get(&scenario.name).unwrap_or_else(|| {
            println!(
                "missing snapshot for {} ({}). add entry:\n{}",
                scenario.name,
                scenario.description,
                serde_json::to_string_pretty(&ScenarioSnapshot {
                    expected_count: from_command.len(),
                    instances: from_command.clone(),
                })
                .unwrap()
            );
            panic!(
                "missing expected snapshot for scenario {}. generate fixtures via REGEN_EXDATE_SNAPSHOT=1 cargo test --test exdate_application -- --nocapture",
                scenario.name
            )
        });
        assert_eq!(
            expected_snapshot.instances, via_rrule,
            "rrule engine drift for scenario {}",
            scenario.name
        );
        assert_eq!(
            via_rrule, from_command,
            "IPC mismatch for scenario {}",
            scenario.name
        );
        assert_eq!(
            expected_snapshot.instances, from_command,
            "events_list_range output drift for scenario {}",
            scenario.name
        );
        assert_eq!(
            expected_snapshot.expected_count,
            response.items.len(),
            "scenario {} count mismatch",
            scenario.name
        );
    }
    Ok(())
}

#[test]
#[ignore]
fn regenerate_exdate_snapshots() {
    let scenarios = load_scenarios().expect("load scenarios");
    let mut out = BTreeMap::new();
    for scenario in scenarios {
        let actual = scenario_rrule_snapshots(&scenario)
            .unwrap_or_else(|err| panic!("expand {} via rrule engine: {err:?}", scenario.name));
        out.insert(
            scenario.name.clone(),
            ScenarioSnapshot {
                expected_count: actual.len(),
                instances: actual,
            },
        );
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&out).expect("serialize snapshots")
    );
}
