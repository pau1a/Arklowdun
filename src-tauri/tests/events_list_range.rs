use arklowdun::commands;
use sqlx::{SqlitePool, sqlite::SqlitePoolOptions};

#[tokio::test]
async fn events_list_range_tolerates_missing_series_parent_id() {
    let pool: SqlitePool = SqlitePoolOptions::new()
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
            rrule TEXT,
            exdates TEXT,
            reminder INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            deleted_at INTEGER
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, created_at, updated_at)
         VALUES ('e1', 'HH', 't', 0, 0, 0)"
    )
    .execute(&pool)
    .await
    .unwrap();
    let res = commands::events_list_range_command(&pool, "HH", -1, 1)
        .await
        .unwrap();
    assert_eq!(res.len(), 1);
}

#[tokio::test]
async fn expanded_instance_strips_recurrence_fields() {
    let pool: SqlitePool = SqlitePoolOptions::new()
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
            rrule TEXT,
            exdates TEXT,
            reminder INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            deleted_at INTEGER
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, rrule, created_at, updated_at)
         VALUES ('r1', 'HH', 't', 0, 3600000, 'UTC', 0, 3600000, 'FREQ=DAILY;COUNT=2', 0, 0)"
    )
    .execute(&pool)
    .await
    .unwrap();
    let res = commands::events_list_range_command(&pool, "HH", -1, 2 * 86_400_000)
        .await
        .unwrap();
    assert_eq!(res.len(), 2);
    let inst = &res[0];
    assert!(inst.rrule.is_none());
    assert!(inst.exdates.is_none());
    assert_eq!(inst.series_parent_id.as_deref(), Some("r1"));
}
