#![allow(clippy::await_holding_lock)]
use arklowdun_lib::{commands, time_shadow};
use once_cell::sync::Lazy;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::io::Write;
use std::sync::{Arc, Mutex};
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

const CREATE_EVENTS_TABLE_START_ONLY: &str = "\
    CREATE TABLE events (\
        id TEXT PRIMARY KEY,\
        household_id TEXT NOT NULL,\
        title TEXT NOT NULL,\
        start_at INTEGER NOT NULL,\
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

const CREATE_EVENTS_TABLE_END_ONLY: &str = "\
    CREATE TABLE events (\
        id TEXT PRIMARY KEY,\
        household_id TEXT NOT NULL,\
        title TEXT NOT NULL,\
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

const CREATE_EVENTS_TABLE_NO_LEGACY: &str = "\
    CREATE TABLE events (\
        id TEXT PRIMARY KEY,\
        household_id TEXT NOT NULL,\
        title TEXT NOT NULL,\
        tz TEXT,\
        start_at_utc INTEGER NOT NULL,\
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

async fn setup_pool_with_schema(schema: &str) -> SqlitePool {
    let pool: SqlitePool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::query(schema).execute(&pool).await.unwrap();
    sqlx::query(CREATE_SHADOW_TABLE)
        .execute(&pool)
        .await
        .unwrap();
    pool
}

async fn setup_pool() -> SqlitePool {
    setup_pool_with_schema(CREATE_EVENTS_TABLE).await
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
    assert_eq!(res.items.len(), 10_000);
    assert!(res.truncated);
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
    let _guard = ENV_GUARD.lock().unwrap();
    std::env::set_var("ARK_TIME_SHADOW_READ", "on");

    let buffer: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
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
    let _guard = ENV_GUARD.lock().unwrap();
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

#[tokio::test]
async fn shadow_read_skips_when_legacy_columns_absent() {
    let _guard = ENV_GUARD.lock().unwrap();
    std::env::set_var("ARK_TIME_SHADOW_READ", "on");

    let buffer: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let writer = buffer.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::new("arklowdun=info"))
        .with_writer(move || BufferWriter(writer.clone()))
        .json()
        .finish();
    let _subscriber_guard = subscriber::set_default(subscriber);

    let pool = setup_pool_with_schema(CREATE_EVENTS_TABLE_NO_LEGACY).await;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, tz, start_at_utc, end_at_utc, created_at, updated_at) \
         VALUES ('utc-only', 'HH', 'shadow', 'UTC', 60_000, 3_660_000, 0, 0)",
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

    let log = String::from_utf8(buffer.lock().unwrap().clone()).unwrap();
    assert!(log.contains("\"event\":\"time_shadow_audit_skipped\""));
    assert!(log.contains("\"reason\":\"missing_legacy_columns\""));

    std::env::remove_var("ARK_TIME_SHADOW_READ");
}

#[tokio::test]
async fn shadow_read_skips_when_only_start_at_present() {
    let _guard = ENV_GUARD.lock().unwrap();
    std::env::set_var("ARK_TIME_SHADOW_READ", "on");

    let pool = setup_pool_with_schema(CREATE_EVENTS_TABLE_START_ONLY).await;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, tz, start_at_utc, end_at_utc, created_at, updated_at) \
         VALUES ('legacy-start', 'HH', 'shadow', 0, 'UTC', 60_000, 3_660_000, 0, 0)",
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

#[tokio::test]
async fn shadow_read_skips_when_only_end_at_present() {
    let _guard = ENV_GUARD.lock().unwrap();
    std::env::set_var("ARK_TIME_SHADOW_READ", "on");

    let pool = setup_pool_with_schema(CREATE_EVENTS_TABLE_END_ONLY).await;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, end_at, tz, start_at_utc, end_at_utc, created_at, updated_at) \
         VALUES ('legacy-end', 'HH', 'shadow', 3_660_000, 'UTC', 60_000, 3_660_000, 0, 0)",
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

struct BufferWriter(Arc<Mutex<Vec<u8>>>);

impl Write for BufferWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
