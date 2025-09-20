use arklowdun_lib::commands;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

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
    pool
}

#[tokio::test]
async fn events_list_range_tolerates_missing_series_parent_id() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, created_at, updated_at)\
         VALUES ('e1', 'HH', 't', 0, 0, 0)",
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

    let err = match commands::events_list_range_command(&pool, "HH", -1, 86_400_000).await {
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

    let err = match commands::events_list_range_command(&pool, "HH", -1, 86_400_000).await {
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
