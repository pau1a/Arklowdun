use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use arklowdun_lib::{commands, migrate};
use chrono::{DateTime, LocalResult, NaiveDateTime, Offset, SecondsFormat, TimeZone, Utc};
use chrono_tz::Tz;
#[cfg(chrono_tz_has_iana_version)]
use chrono_tz::IANA_TZDB_VERSION;
use serde::{Deserialize, Serialize};
use similar::TextDiff;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};

#[derive(Debug, Clone)]
struct Scenario {
    name: &'static str,
    description: &'static str,
    timezone: &'static str,
    local_start: &'static str,
    local_end: &'static str,
    rrule: &'static str,
    range_start_utc: &'static str,
    range_end_utc: &'static str,
}

impl Scenario {
    fn tz(&self) -> Tz {
        self.timezone
            .parse()
            .unwrap_or_else(|_| panic!("unknown timezone: {}", self.timezone))
    }

    fn event_id(&self) -> String {
        format!("series-{}", self.name)
    }

    fn household_id(&self) -> String {
        format!("HH-{}", self.name)
    }

    fn snapshot_path(&self) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/rrule_snapshots")
            .join(format!("{}.json", self.name))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct SnapshotData {
    scenario: String,
    description: String,
    timezone: String,
    tzdb: String,
    dtstart_local: String,
    dtend_local: String,
    rrule: String,
    range_start_utc: String,
    range_end_utc: String,
    expected_count: usize,
    instances: Vec<InstanceRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct InstanceRecord {
    index: usize,
    id: String,
    start_utc: String,
    end_utc: String,
    local_start: String,
    local_end: String,
    weekday: String,
    offset_seconds: i32,
    duration_minutes: i64,
}

static SCENARIOS: &[Scenario] = &[
    Scenario {
        name: "daily_london_dst",
        description: "Daily 22:15 meeting spanning the Europe/London spring DST change",
        timezone: "Europe/London",
        local_start: "2024-03-29T22:15",
        local_end: "2024-03-29T23:00",
        rrule: "FREQ=DAILY;COUNT=5",
        range_start_utc: "2024-03-29T00:00:00Z",
        range_end_utc: "2024-04-04T00:00:00Z",
    },
    Scenario {
        name: "weekly_new_york_byday",
        description: "Bi-weekly Sunday 01:30 event across the America/New_York fall DST transition",
        timezone: "America/New_York",
        local_start: "2024-10-20T01:30",
        local_end: "2024-10-20T02:30",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SU;UNTIL=20241117T063000Z",
        range_start_utc: "2024-10-01T00:00:00Z",
        range_end_utc: "2024-11-30T00:00:00Z",
    },
    Scenario {
        name: "monthly_tokyo_bymonthday",
        description: "Monthly series on the 10th and 20th in Asia/Tokyo exercising BYMONTHDAY/BYHOUR/BYMINUTE",
        timezone: "Asia/Tokyo",
        local_start: "2024-01-10T09:30",
        local_end: "2024-01-10T11:00",
        rrule: "FREQ=MONTHLY;INTERVAL=1;COUNT=6;BYMONTHDAY=10,20;BYHOUR=9;BYMINUTE=30",
        range_start_utc: "2023-12-31T15:00:00Z",
        range_end_utc: "2024-03-31T23:59:59Z",
    },
    Scenario {
        name: "yearly_london_leap",
        description: "Leap day tradition anchored to 29 February using BYMONTH/BYMONTHDAY",
        timezone: "Europe/London",
        local_start: "2024-02-29T08:00",
        local_end: "2024-02-29T10:00",
        rrule: "FREQ=YEARLY;COUNT=4;BYMONTH=2;BYMONTHDAY=29",
        range_start_utc: "2024-01-01T00:00:00Z",
        range_end_utc: "2036-03-02T00:00:00Z",
    },
];

#[tokio::test]
async fn rrule_matrix_matches_snapshots() -> Result<()> {
    for scenario in SCENARIOS {
        run_scenario(scenario).await?;
    }
    Ok(())
}

async fn run_scenario(scenario: &Scenario) -> Result<()> {
    let pool = setup_pool().await?;
    seed_event(&pool, scenario).await?;

    let range_start = parse_utc(scenario.range_start_utc)?;
    let range_end = parse_utc(scenario.range_end_utc)?;

    let household_id = scenario.household_id();
    let first = commands::events_list_range_command(&pool, &household_id, range_start, range_end)
        .await
        .with_context(|| format!("expand recurrence for {}", scenario.name))?;
    let second = commands::events_list_range_command(&pool, &household_id, range_start, range_end)
        .await
        .with_context(|| format!("second expansion for {}", scenario.name))?;
    assert!(
        !first.truncated,
        "scenario {} unexpectedly truncated first expansion",
        scenario.name
    );
    assert!(
        !second.truncated,
        "scenario {} unexpectedly truncated second expansion",
        scenario.name
    );
    assert_eq!(
        first.items.len(),
        second.items.len(),
        "{} count drift",
        scenario.name
    );

    let tz = scenario.tz();
    let first_records = records_from_instances(&first.items, &tz)?;
    let second_records = records_from_instances(&second.items, &tz)?;
    assert_eq!(
        first_records, second_records,
        "{} ordering drift",
        scenario.name
    );

    let snapshot = SnapshotData {
        scenario: scenario.name.to_string(),
        description: scenario.description.to_string(),
        timezone: scenario.timezone.to_string(),
        tzdb: tzdb_label(),
        dtstart_local: scenario.local_start.to_string(),
        dtend_local: scenario.local_end.to_string(),
        rrule: scenario.rrule.to_string(),
        range_start_utc: scenario.range_start_utc.to_string(),
        range_end_utc: scenario.range_end_utc.to_string(),
        expected_count: first_records.len(),
        instances: first_records,
    };

    compare_with_snapshot(&snapshot, &scenario.snapshot_path())
        .with_context(|| format!("compare snapshot for {}", scenario.name))?;

    Ok(())
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

fn parse_local_naive(s: &str) -> Result<NaiveDateTime> {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M"))
        .with_context(|| format!("parse local naive datetime: {s}"))
}

fn resolve_local(tz: &Tz, naive: NaiveDateTime) -> DateTime<Tz> {
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

fn parse_utc(s: &str) -> Result<i64> {
    Ok(DateTime::parse_from_rfc3339(s)
        .with_context(|| format!("parse utc instant: {s}"))?
        .with_timezone(&Utc)
        .timestamp_millis())
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

async fn seed_event(pool: &SqlitePool, scenario: &Scenario) -> Result<()> {
    let tz = scenario.tz();
    let start_local = resolve_local(&tz, parse_local_naive(scenario.local_start)?);
    let end_local = resolve_local(&tz, parse_local_naive(scenario.local_end)?);
    let start_at = start_local.naive_local().and_utc().timestamp_millis();
    let end_at = end_local.naive_local().and_utc().timestamp_millis();
    let start_at_utc = start_local.with_timezone(&Utc).timestamp_millis();
    let end_at_utc = end_local.with_timezone(&Utc).timestamp_millis();

    sqlx::query(
        "INSERT INTO household (id, name, tz, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, 0, 0, NULL)",
    )
    .bind(&scenario.household_id())
    .bind(format!("Fixture household {}", scenario.name))
    .bind(scenario.timezone)
    .execute(pool)
    .await
    .with_context(|| format!("insert household for {}", scenario.name))?;

    let has_start = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM pragma_table_info('events') WHERE name='start_at'",
    )
    .fetch_optional(pool)
    .await?
    .is_some();
    let has_end = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM pragma_table_info('events') WHERE name='end_at'",
    )
    .fetch_optional(pool)
    .await?
    .is_some();

    match (has_start, has_end) {
        (true, true) => {
            sqlx::query(
                "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, rrule, exdates, reminder, created_at, updated_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, 0, 0, NULL)",
            )
            .bind(&scenario.event_id())
            .bind(&scenario.household_id())
            .bind(format!("Scenario {}", scenario.name))
            .bind(start_at)
            .bind(end_at)
            .bind(scenario.timezone)
            .bind(start_at_utc)
            .bind(end_at_utc)
            .bind(scenario.rrule)
            .execute(pool)
            .await
        }
        (true, false) => {
            sqlx::query(
                "INSERT INTO events (id, household_id, title, start_at, tz, start_at_utc, end_at_utc, rrule, exdates, reminder, created_at, updated_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, 0, 0, NULL)",
            )
            .bind(&scenario.event_id())
            .bind(&scenario.household_id())
            .bind(format!("Scenario {}", scenario.name))
            .bind(start_at)
            .bind(scenario.timezone)
            .bind(start_at_utc)
            .bind(end_at_utc)
            .bind(scenario.rrule)
            .execute(pool)
            .await
        }
        (false, true) => {
            sqlx::query(
                "INSERT INTO events (id, household_id, title, end_at, tz, start_at_utc, end_at_utc, rrule, exdates, reminder, created_at, updated_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, 0, 0, NULL)",
            )
            .bind(&scenario.event_id())
            .bind(&scenario.household_id())
            .bind(format!("Scenario {}", scenario.name))
            .bind(end_at)
            .bind(scenario.timezone)
            .bind(start_at_utc)
            .bind(end_at_utc)
            .bind(scenario.rrule)
            .execute(pool)
            .await
        }
        (false, false) => {
            sqlx::query(
                "INSERT INTO events (id, household_id, title, tz, start_at_utc, end_at_utc, rrule, exdates, reminder, created_at, updated_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, 0, 0, NULL)",
            )
            .bind(&scenario.event_id())
            .bind(&scenario.household_id())
            .bind(format!("Scenario {}", scenario.name))
            .bind(scenario.timezone)
            .bind(start_at_utc)
            .bind(end_at_utc)
            .bind(scenario.rrule)
            .execute(pool)
            .await
        }
    }
    .with_context(|| format!("insert event for {}", scenario.name))?;

    Ok(())
}

fn records_from_instances(
    instances: &[arklowdun_lib::Event],
    tz: &Tz,
) -> Result<Vec<InstanceRecord>> {
    let mut out = Vec::with_capacity(instances.len());
    for (index, instance) in instances.iter().enumerate() {
        let start_utc = DateTime::<Utc>::from_timestamp_millis(instance.start_at_utc)
            .with_context(|| format!("instance {} missing start", instance.id))?;
        let end_ms = instance.end_at_utc.unwrap_or(instance.start_at_utc);
        let end_utc = DateTime::<Utc>::from_timestamp_millis(end_ms)
            .with_context(|| format!("instance {} invalid end", instance.id))?;

        if let Some(instance_tz) = &instance.tz {
            assert_eq!(
                instance_tz,
                tz.name(),
                "instance tz drift for {}",
                instance.id
            );
        }

        let local_start = start_utc.with_timezone(tz);
        let local_end = end_utc.with_timezone(tz);
        let offset_seconds = local_start.offset().fix().local_minus_utc();
        let duration_minutes = (end_utc.timestamp_millis() - start_utc.timestamp_millis()) / 60_000;

        out.push(InstanceRecord {
            index,
            id: instance.id.clone(),
            start_utc: start_utc.to_rfc3339_opts(SecondsFormat::Secs, true),
            end_utc: end_utc.to_rfc3339_opts(SecondsFormat::Secs, true),
            local_start: local_start.format("%Y-%m-%dT%H:%M:%S%:z").to_string(),
            local_end: local_end.format("%Y-%m-%dT%H:%M:%S%:z").to_string(),
            weekday: local_start.format("%A").to_string(),
            offset_seconds,
            duration_minutes,
        });
    }

    Ok(out)
}

fn compare_with_snapshot(snapshot: &SnapshotData, path: &Path) -> Result<()> {
    let actual = serde_json::to_string_pretty(snapshot)?;
    if std::env::var_os("UPDATE_RRULE_SNAPSHOTS").is_some() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("create snapshot dir {parent:?}"))?;
        }
        fs::write(path, &actual).with_context(|| format!("write snapshot {}", path.display()))?;
        return Ok(());
    }

    let expected =
        fs::read_to_string(path).with_context(|| format!("read snapshot {}", path.display()))?;
    if expected != actual {
        let diff = TextDiff::from_lines(&expected, &actual)
            .iter_all_changes()
            .map(|change| {
                let marker = match change.tag() {
                    similar::ChangeTag::Delete => '-',
                    similar::ChangeTag::Insert => '+',
                    similar::ChangeTag::Equal => ' ',
                };
                format!("{marker}{}", change.value())
            })
            .collect::<String>();
        anyhow::bail!(
            "snapshot mismatch for {} at {}\n{}",
            snapshot.scenario,
            path.display(),
            diff
        );
    }

    Ok(())
}
