use arklowdun_lib::{
    commands::{
        self, EVENTS_LIST_RANGE_PER_SERIES_LIMIT, EVENTS_LIST_RANGE_TOTAL_LIMIT,
    },
    time_shadow,
};
use chrono::{DateTime, Datelike, NaiveDateTime, Offset, TimeZone, Utc, Weekday};
use chrono_tz::Tz;
use std::collections::HashSet;
use once_cell::sync::Lazy;
use proptest::prelude::*;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::io::Write;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Mutex;
use tracing::subscriber;
use tracing_subscriber::EnvFilter;

const CREATE_EVENTS_TABLE: &str = "\
    CREATE TABLE events (\
        id TEXT PRIMARY KEY,\
        household_id TEXT NOT NULL,\
        title TEXT NOT NULL,\
        start_at INTEGER NOT NULL,\
        end_at INTEGER,\
        tz TEXT,\
        start_at_utc INTEGER,\
        end_at_utc INTEGER,\
        rrule TEXT,\
        exdates TEXT,\
        reminder INTEGER,\
        created_at INTEGER NOT NULL,\
        updated_at INTEGER NOT NULL,\
        deleted_at INTEGER\
    )\
";

const CREATE_SHADOW_TABLE: &str = "\
    CREATE TABLE shadow_read_audit (\
        id INTEGER PRIMARY KEY CHECK (id = 1),\
        total_rows INTEGER NOT NULL DEFAULT 0,\
        discrepancies INTEGER NOT NULL DEFAULT 0,\
        last_event_id TEXT,\
        last_household_id TEXT,\
        last_tz TEXT,\
        last_legacy_start_ms INTEGER,\
        last_utc_start_ms INTEGER,\
        last_start_delta_ms INTEGER,\
        last_legacy_end_ms INTEGER,\
        last_utc_end_ms INTEGER,\
        last_end_delta_ms INTEGER,\
        last_observed_at_ms INTEGER\
    )\
";

static ENV_GUARD: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

async fn setup_pool() -> SqlitePool {
    let pool: SqlitePool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::query(CREATE_EVENTS_TABLE)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(CREATE_SHADOW_TABLE)
        .execute(&pool)
        .await
        .unwrap();
    pool
}

fn parse_local_datetime(value: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M"))
        .unwrap_or_else(|_| panic!("invalid local datetime: {value}"))
}

fn resolve_local_datetime(tz: &Tz, naive: NaiveDateTime) -> DateTime<Tz> {
    match tz.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) => dt,
        chrono::LocalResult::Ambiguous(first, _second) => first,
        chrono::LocalResult::None => tz
            .offset_from_utc_datetime(&naive)
            .fix()
            .from_utc_datetime(&naive)
            .with_timezone(tz),
    }
}

async fn seed_recurring_event(
    pool: &SqlitePool,
    id: &str,
    household_id: &str,
    tz_name: &str,
    local_start: &str,
    local_end: &str,
    rrule: &str,
) {
    let tz: Tz = tz_name.parse().unwrap_or_else(|_| panic!("unknown tz: {tz_name}"));
    let start_local = resolve_local_datetime(&tz, parse_local_datetime(local_start));
    let end_local = resolve_local_datetime(&tz, parse_local_datetime(local_end));
    let start_at = start_local.naive_local().and_utc().timestamp_millis();
    let end_at = end_local.naive_local().and_utc().timestamp_millis();
    let start_at_utc = start_local.with_timezone(&Utc).timestamp_millis();
    let end_at_utc = end_local.with_timezone(&Utc).timestamp_millis();

    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, rrule, exdates, reminder, created_at, updated_at, deleted_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, 0, 0, NULL)",
    )
    .bind(id)
    .bind(household_id)
    .bind(format!("Scenario {id}"))
    .bind(start_at)
    .bind(end_at)
    .bind(tz_name)
    .bind(start_at_utc)
    .bind(end_at_utc)
    .bind(rrule)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn range_start_must_be_before_end() {
    let pool = setup_pool().await;
    let result = commands::events_list_range_command(&pool, "HH", 1_000, 1_000).await;
    let err = result.expect_err("range with identical start/end should error");
    assert_eq!(err.code(), "E_RANGE_INVALID");
    assert_eq!(
        err.context().get("start").map(|ctx| ctx.as_str()),
        Some("1000")
    );
    assert_eq!(err.context().get("end").map(|ctx| ctx.as_str()), Some("1000"));
    assert_eq!(
        err.context()
            .get("operation")
            .map(|ctx| ctx.as_str()),
        Some("events_list_range")
    );
}

#[tokio::test]
async fn events_list_range_tolerates_missing_series_parent_id() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, start_at_utc, created_at, updated_at)\
         VALUES ('e1', 'HH', 't', 0, 0, 0, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();
    let res = commands::events_list_range_command(&pool, "HH", -1, 1)
        .await
        .unwrap();
    assert_eq!(res.items.len(), 1);
    assert!(!res.truncated);
    assert_eq!(res.limit, EVENTS_LIST_RANGE_TOTAL_LIMIT);
}

#[tokio::test]
async fn expanded_instance_strips_recurrence_fields() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, rrule, created_at, updated_at)\
         VALUES ('r1', 'HH', 't', 0, 3600000, 'UTC', 0, 3600000, 'FREQ=DAILY;COUNT=2', 0, 0)"
    )
    .execute(&pool)
    .await
    .unwrap();
    let res = commands::events_list_range_command(&pool, "HH", -1, 2 * 86_400_000)
        .await
        .unwrap();
    assert_eq!(res.items.len(), 2);
    assert!(!res.truncated);
    let inst = &res.items[0];
    assert!(inst.rrule.is_none());
    assert!(inst.exdates.is_none());
    assert_eq!(inst.series_parent_id.as_deref(), Some("r1"));
}

#[tokio::test]
async fn series_under_limit_reports_not_truncated() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, rrule, created_at, updated_at)\
         VALUES ('s1', 'HH', 'Daily standup', 0, 1800000, 'UTC', 0, 1800000, 'FREQ=DAILY;COUNT=20', 0, 0)"
    )
    .execute(&pool)
    .await
    .unwrap();
    let res = commands::events_list_range_command(&pool, "HH", -1, 40 * 86_400_000)
        .await
        .unwrap();
    println!(
        "series_under_limit count={} truncated={}",
        res.items.len(),
        res.truncated
    );
    assert_eq!(res.items.len(), 20);
    assert!(!res.truncated);
    assert_eq!(res.limit, EVENTS_LIST_RANGE_TOTAL_LIMIT);
}

#[tokio::test]
async fn series_limit_truncates_after_500() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, rrule, created_at, updated_at)\
         VALUES ('s500', 'HH', 'Big series', 0, 3600000, 'UTC', 0, 3600000, 'FREQ=DAILY;COUNT=600', 0, 0)"
    )
    .execute(&pool)
    .await
    .unwrap();
    let res = commands::events_list_range_command(&pool, "HH", -1, 1_000 * 86_400_000)
        .await
        .unwrap();
    println!(
        "series_limit count={} truncated={}",
        res.items.len(),
        res.truncated
    );
    assert_eq!(res.items.len(), 500);
    assert!(res.truncated);
    assert_eq!(res.limit, EVENTS_LIST_RANGE_TOTAL_LIMIT);
}

#[tokio::test]
async fn query_limit_truncates_after_10000() {
    let pool = setup_pool().await;
    {
        let mut tx = pool.begin().await.unwrap();
        for i in 0..10_050 {
            let start = i as i64 * 3_600_000;
            sqlx::query(
                "INSERT INTO events (id, household_id, title, start_at, start_at_utc, created_at, updated_at)\
                 VALUES (?1, 'HH', ?2, ?3, ?3, 0, 0)"
            )
            .bind(format!("bulk-{i}"))
            .bind(format!("Event {i}"))
            .bind(start)
            .execute(&mut *tx)
            .await
            .unwrap();
        }
        tx.commit().await.unwrap();
    }
    let horizon = 10_051_i64 * 3_600_000;
    let res = commands::events_list_range_command(&pool, "HH", -1, horizon)
        .await
        .unwrap();
    println!(
        "query_limit count={} truncated={}",
        res.items.len(),
        res.truncated
    );
    assert_eq!(res.items.len(), EVENTS_LIST_RANGE_TOTAL_LIMIT);
    assert!(res.truncated);
    assert_eq!(res.limit, EVENTS_LIST_RANGE_TOTAL_LIMIT);
}

#[tokio::test]
async fn limit_is_non_zero_even_when_untruncated() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, start_at_utc, created_at, updated_at)\
         VALUES ('single', 'HH', 'Single event', 0, 0, 0, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let res = commands::events_list_range_command(&pool, "HH", -1, 10)
        .await
        .unwrap();
    assert_eq!(res.items.len(), 1);
    assert!(!res.truncated);
    assert_eq!(res.limit, EVENTS_LIST_RANGE_TOTAL_LIMIT);
    assert!(res.limit > 0);
}

#[tokio::test]
async fn household_scope_excludes_other_households() {
    let pool = setup_pool().await;
    {
        let mut tx = pool.begin().await.unwrap();
        for i in 0..20 {
            let start = i as i64 * 86_400_000;
            sqlx::query(
                "INSERT INTO events (id, household_id, title, start_at, start_at_utc, created_at, updated_at)\
                 VALUES (?1, 'A', ?2, ?3, ?3, 0, 0)"
            )
            .bind(format!("a-{i}"))
            .bind(format!("Series A {i}"))
            .bind(start)
            .execute(&mut *tx)
            .await
            .unwrap();
        }
        for i in 0..5 {
            let start = 1_000_000 + i as i64 * 86_400_000;
            sqlx::query(
                "INSERT INTO events (id, household_id, title, start_at, start_at_utc, created_at, updated_at)\
                 VALUES (?1, 'B', ?2, ?3, ?3, 0, 0)"
            )
            .bind(format!("b-{i}"))
            .bind(format!("Series B {i}"))
            .bind(start)
            .execute(&mut *tx)
            .await
            .unwrap();
        }
        tx.commit().await.unwrap();
    }

    let res = commands::events_list_range_command(&pool, "B", -1, 10_000)
        .await
        .unwrap();
    assert_eq!(res.items.len(), 5);
    assert!(!res.truncated);
    assert!(res.items.iter().all(|ev| ev.household_id == "B"));
    assert_eq!(res.limit, EVENTS_LIST_RANGE_TOTAL_LIMIT);
}

#[tokio::test]
async fn exdate_normalization_skips_duplicates_and_malformed_tokens() {
    let pool = setup_pool().await;
    let start = DateTime::parse_from_rfc3339("2024-05-10T09:00:00Z")
        .unwrap()
        .timestamp_millis();
    let end = start + 3_600_000;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, rrule, exdates, created_at, updated_at)\
         VALUES (?1, 'HH', ?2, ?3, ?4, 'Europe/London', ?5, ?6, 'FREQ=DAILY;COUNT=4', ?7, 0, 0)"
    )
    .bind("series-exdate")
    .bind("Series")
    .bind(start)
    .bind(end)
    .bind(start)
    .bind(end)
    .bind(" 2024-05-10T09:00:00Z,2024-05-10T09:00:00Z,not-a-date,2024-05-12T09:00:00Z ")
    .execute(&pool)
    .await
    .unwrap();

    let horizon = 5 * 86_400_000;
    let res = commands::events_list_range_command(&pool, "HH", -1, horizon)
        .await
        .unwrap();

    let starts: Vec<_> = res.items.iter().map(|ev| ev.start_at_utc).collect();
    assert_eq!(
        starts.len(),
        2,
        "two occurrences remain after EXDATE filtering"
    );
    assert_eq!(
        starts,
        vec![start + 86_400_000, start + 3 * 86_400_000],
        "expected remaining UTC start times",
    );
    assert!(res
        .items
        .iter()
        .all(|ev| ev.series_parent_id.as_deref() == Some("series-exdate")));
    assert!(!res.truncated);
    assert_eq!(res.limit, EVENTS_LIST_RANGE_TOTAL_LIMIT);
}

#[tokio::test]
async fn dst_forward_series_produces_unique_instances() {
    let pool = setup_pool().await;
    seed_recurring_event(
        &pool,
        "dst-forward",
        "HH",
        "Europe/London",
        "2024-03-29T22:15",
        "2024-03-29T23:00",
        "FREQ=DAILY;COUNT=5",
    )
    .await;

    let range_start = DateTime::parse_from_rfc3339("2024-03-29T00:00:00Z")
        .unwrap()
        .timestamp_millis();
    let range_end = DateTime::parse_from_rfc3339("2024-04-04T00:00:00Z")
        .unwrap()
        .timestamp_millis();

    let res = commands::events_list_range_command(&pool, "HH", range_start, range_end)
        .await
        .unwrap();

    assert_eq!(res.items.len(), 5);
    assert!(!res.truncated);

    let mut seen = HashSet::new();
    for inst in &res.items {
        assert!(seen.insert(inst.start_at_utc), "duplicate start {}", inst.start_at_utc);
        assert_eq!(inst.tz.as_deref(), Some("Europe/London"));
        assert!(inst.start_at_utc >= range_start && inst.start_at_utc <= range_end);
    }
    assert!(res
        .items
        .windows(2)
        .all(|window| window[0].start_at_utc <= window[1].start_at_utc));
}

#[tokio::test]
async fn dst_fallback_series_produces_unique_instances() {
    let pool = setup_pool().await;
    seed_recurring_event(
        &pool,
        "dst-fallback",
        "HH",
        "America/New_York",
        "2024-10-20T01:30",
        "2024-10-20T02:30",
        "FREQ=WEEKLY;INTERVAL=2;BYDAY=SU;UNTIL=20241117T063000Z",
    )
    .await;

    let range_start = DateTime::parse_from_rfc3339("2024-10-01T00:00:00Z")
        .unwrap()
        .timestamp_millis();
    let range_end = DateTime::parse_from_rfc3339("2024-11-30T00:00:00Z")
        .unwrap()
        .timestamp_millis();

    let res = commands::events_list_range_command(&pool, "HH", range_start, range_end)
        .await
        .unwrap();

    assert!(!res.items.is_empty());
    assert!(!res.truncated);

    let mut seen = HashSet::new();
    for inst in &res.items {
        assert!(seen.insert(inst.start_at_utc));
        assert_eq!(inst.tz.as_deref(), Some("America/New_York"));
        let ts = DateTime::<Utc>::from_timestamp_millis(inst.start_at_utc).unwrap();
        let weekday = ts.with_timezone(&chrono_tz::America::New_York).weekday();
        assert!(matches!(weekday, Weekday::Sun));
    }
}

#[tokio::test]
async fn leap_day_series_includes_feb_29_instances() {
    let pool = setup_pool().await;
    seed_recurring_event(
        &pool,
        "leap-day",
        "HH",
        "Europe/London",
        "2024-02-29T08:00",
        "2024-02-29T10:00",
        "FREQ=YEARLY;COUNT=4;BYMONTH=2;BYMONTHDAY=29",
    )
    .await;

    let range_start = DateTime::parse_from_rfc3339("2024-01-01T00:00:00Z")
        .unwrap()
        .timestamp_millis();
    let range_end = DateTime::parse_from_rfc3339("2036-03-02T00:00:00Z")
        .unwrap()
        .timestamp_millis();

    let res = commands::events_list_range_command(&pool, "HH", range_start, range_end)
        .await
        .unwrap();

    assert_eq!(res.items.len(), 4);
    for inst in &res.items {
        let local = DateTime::<Utc>::from_timestamp_millis(inst.start_at_utc)
            .unwrap()
            .with_timezone(&chrono_tz::Europe::London);
        assert_eq!(local.month(), 2);
        assert_eq!(local.day(), 29);
    }
}

#[tokio::test]
async fn byday_until_interval_respects_requested_window() {
    let pool = setup_pool().await;
    seed_recurring_event(
        &pool,
        "byday-interval",
        "HH",
        "UTC",
        "2024-02-05T09:00",
        "2024-02-05T10:00",
        "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20240430T170000Z",
    )
    .await;

    let range_start = DateTime::parse_from_rfc3339("2024-02-01T00:00:00Z")
        .unwrap()
        .timestamp_millis();
    let range_end = DateTime::parse_from_rfc3339("2024-05-01T00:00:00Z")
        .unwrap()
        .timestamp_millis();

    let res = commands::events_list_range_command(&pool, "HH", range_start, range_end)
        .await
        .unwrap();

    assert!(!res.items.is_empty());
    assert!(!res.truncated);
    for inst in &res.items {
        assert!(inst.start_at_utc >= range_start && inst.start_at_utc <= range_end);
        let utc_dt = DateTime::<Utc>::from_timestamp_millis(inst.start_at_utc).unwrap();
        let weekday = utc_dt.weekday();
        assert!(matches!(weekday, Weekday::Mon | Weekday::Wed));
    }
}

#[tokio::test]
async fn series_truncation_preserves_ordering() {
    let pool = setup_pool().await;
    let count = EVENTS_LIST_RANGE_PER_SERIES_LIMIT + 25;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, rrule, created_at, updated_at)\
         VALUES ('trunc-series', 'HH', 'Minutely truncation', 0, 60_000, 'UTC', 0, 60_000, ?1, 0, 0)",
    )
    .bind(format!("FREQ=MINUTELY;COUNT={count}"))
    .execute(&pool)
    .await
    .unwrap();

    let range_start = -60_000;
    let range_end = ((EVENTS_LIST_RANGE_PER_SERIES_LIMIT as i64) + 100) * 60_000;

    let res = commands::events_list_range_command(&pool, "HH", range_start, range_end)
        .await
        .unwrap();

    assert_eq!(res.items.len(), EVENTS_LIST_RANGE_PER_SERIES_LIMIT);
    assert!(res.truncated);

    let mut seen = HashSet::new();
    let mut tuples: Vec<(i64, String, String)> = Vec::new();
    for inst in &res.items {
        assert!(seen.insert(inst.start_at_utc));
        tuples.push((inst.start_at_utc, inst.title.clone(), inst.id.clone()));
    }
    let mut sorted = tuples.clone();
    sorted.sort();
    assert_eq!(tuples, sorted, "instances should remain sorted after truncation");
}

#[tokio::test]
async fn ordering_breaks_ties_by_title_and_id() {
    let pool = setup_pool().await;
    for (id, title) in [
        ("tie-3", "Omega"),
        ("tie-1", "Alpha"),
        ("tie-2", "Alpha"),
    ] {
        sqlx::query(
            "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, created_at, updated_at)\
             VALUES (?1, 'HH', ?2, 1_000, 4_000, 'UTC', 1_000, 4_000, 0, 0)",
        )
        .bind(id)
        .bind(title)
        .execute(&pool)
        .await
        .unwrap();
    }

    let res = commands::events_list_range_command(&pool, "HH", 0, 10_000)
        .await
        .unwrap();

    let tuples: Vec<(i64, String, String)> = res
        .items
        .iter()
        .map(|inst| (inst.start_at_utc, inst.title.clone(), inst.id.clone()))
        .collect();
    let mut sorted = tuples.clone();
    sorted.sort();
    assert_eq!(tuples, sorted);
    let titles: Vec<_> = res.items.iter().map(|inst| inst.title.as_str()).collect();
    assert_eq!(titles, vec!["Alpha", "Alpha", "Omega"]);
    let ids: Vec<_> = res.items.iter().map(|inst| inst.id.as_str()).collect();
    assert_eq!(ids, vec!["tie-1", "tie-2", "tie-3"]);
}

proptest! {
    #[test]
    fn random_daily_rules_remain_unique(
        interval in 1u32..=6,
        count in 1u32..=64,
        offset_days in 0i32..30,
    ) {
        let runtime = tokio::runtime::Runtime::new().expect("create tokio runtime");
        runtime.block_on(async move {
            let pool = setup_pool().await;
            let rule = format!("FREQ=DAILY;INTERVAL={interval};COUNT={count}");
            seed_recurring_event(
                &pool,
                "prop-series",
                "HH",
                "UTC",
                "2024-01-01T00:00",
                "2024-01-01T01:00",
                &rule,
            )
            .await;

            let base_start = DateTime::parse_from_rfc3339("2024-01-01T00:00:00Z")
                .unwrap()
                .timestamp_millis();
            let range_start = base_start + (offset_days as i64) * 86_400_000;
            let range_end = range_start + 180 * 86_400_000;

            let res = commands::events_list_range_command(&pool, "HH", range_start, range_end)
                .await
                .unwrap();

            let mut seen = HashSet::new();
            for inst in &res.items {
                assert!(inst.start_at_utc >= range_start && inst.start_at_utc <= range_end);
                assert!(seen.insert(inst.start_at_utc));
            }
            let starts: Vec<_> = res.items.iter().map(|inst| inst.start_at_utc).collect();
            let mut sorted = starts.clone();
            sorted.sort();
            assert_eq!(starts, sorted);
        });
    }
}

#[tokio::test]
async fn invalid_timezone_surfaces_taxonomy_error() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, rrule, created_at, updated_at) \
         VALUES ('bad-tz', 'HH', 'Broken timezone', 0, 3_600_000, 'Mars/Olympus', 0, 3_600_000, 'FREQ=DAILY;COUNT=2', 0, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let res = commands::events_list_range_command(&pool, "HH", -1, 86_400_000).await;
    let err = match res {
        Ok(_) => panic!("invalid timezone should error"),
        Err(e) => e,
    };

    assert_eq!(err.code(), "E_TZ_UNKNOWN");
    assert_eq!(
        err.context().get("timezone").map(|tz| tz.as_str()),
        Some("Mars/Olympus")
    );
    assert_eq!(
        err.context().get("operation").map(|op| op.as_str()),
        Some("events_list_range")
    );
}

#[tokio::test]
async fn malformed_rrule_reports_parse_error() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, rrule, created_at, updated_at) \
         VALUES ('bad-parse', 'HH', 'Bad parse', 0, 3_600_000, 'UTC', 0, 3_600_000, 'NOT_A_RULE', 0, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let res = commands::events_list_range_command(&pool, "HH", -1, 86_400_000).await;
    let err = match res {
        Ok(_) => panic!("malformed RRULE should error"),
        Err(e) => e,
    };

    assert_eq!(err.code(), "E_RRULE_PARSE");
    assert_eq!(
        err.context().get("event_id").map(|id| id.as_str()),
        Some("bad-parse")
    );
    assert_eq!(
        err.context().get("rrule").map(|rule| rule.as_str()),
        Some("NOT_A_RULE")
    );
    assert!(
        err.context().get("error").is_some(),
        "parse error should include error context"
    );
}

#[tokio::test]
async fn unsupported_rrule_surfaces_taxonomy_error() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, rrule, created_at, updated_at) \
         VALUES ('bad-rrule', 'HH', 'Unsupported rule', 0, 3_600_000, 'UTC', 0, 3_600_000, 'FREQ=DAILY;FOO=BAR', 0, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let res = commands::events_list_range_command(&pool, "HH", -1, 86_400_000).await;
    let err = match res {
        Ok(_) => panic!("unsupported rrule should error"),
        Err(e) => e,
    };

    assert_eq!(err.code(), "E_RRULE_UNSUPPORTED_FIELD");
    assert_eq!(
        err.context().get("event_id").map(|id| id.as_str()),
        Some("bad-rrule")
    );
    assert_eq!(
        err.context().get("rrule").map(|rule| rule.as_str()),
        Some("FREQ=DAILY;FOO=BAR")
    );
}

#[tokio::test]
async fn shadow_read_counts_discrepancies_and_logs() {
    let _env_guard = ENV_GUARD.lock().await;
    std::env::set_var("ARK_TIME_SHADOW_READ", "on");

    let buffer: Arc<StdMutex<Vec<u8>>> = Arc::new(StdMutex::new(Vec::new()));
    let writer = buffer.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::new("arklowdun=info"))
        .with_writer(move || BufferWriter(writer.clone()))
        .json()
        .finish();
    let _subscriber_guard = subscriber::set_default(subscriber);

    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, created_at, updated_at) \
         VALUES ('shadow-1', 'HH', 'shadow', 0, 3_600_000, 'UTC', 60_000, 3_660_000, 0, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let res = commands::events_list_range_command(&pool, "HH", -1, 120_000)
        .await
        .unwrap();
    assert_eq!(res.items.len(), 1);

    let summary = time_shadow::load_summary(&pool).await.unwrap();
    assert_eq!(summary.total_rows, 1);
    assert_eq!(summary.discrepancies, 1);
    let sample = summary.last.expect("expected discrepancy sample");
    assert_eq!(sample.event_id, "shadow-1");
    assert_eq!(sample.household_id, "HH");
    assert_eq!(sample.start_delta_ms, Some(60_000));

    let log = String::from_utf8(buffer.lock().unwrap().clone()).unwrap();
    assert!(log.contains("\"event\":\"time_shadow_discrepancy\""));
    assert!(log.contains("\"start_delta_ms\":60000"));

    std::env::remove_var("ARK_TIME_SHADOW_READ");
}

#[tokio::test]
async fn shadow_read_disabled_skips_audit() {
    let _env_guard = ENV_GUARD.lock().await;
    std::env::set_var("ARK_TIME_SHADOW_READ", "off");

    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, created_at, updated_at) \
         VALUES ('shadow-off', 'HH', 'shadow', 0, 3_600_000, 'UTC', 60_000, 3_660_000, 0, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let res = commands::events_list_range_command(&pool, "HH", -1, 120_000)
        .await
        .unwrap();
    assert_eq!(res.items.len(), 1);

    let summary = time_shadow::load_summary(&pool).await.unwrap();
    assert_eq!(summary.total_rows, 0);
    assert_eq!(summary.discrepancies, 0);

    std::env::remove_var("ARK_TIME_SHADOW_READ");
}

struct BufferWriter(Arc<StdMutex<Vec<u8>>>);

impl Write for BufferWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
