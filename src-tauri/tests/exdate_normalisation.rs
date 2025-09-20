use arklowdun_lib::{commands, exdate::normalize_existing_exdates};
use chrono::{TimeZone, Utc};
use serde_json::{Map, Value};
use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};

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
    let pool = SqlitePoolOptions::new()
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

fn base_event_payload() -> Map<String, Value> {
    let mut data = Map::new();
    data.insert("household_id".into(), Value::String("HH".into()));
    data.insert("title".into(), Value::String("Recurring".into()));
    let start_ms = Utc
        .with_ymd_and_hms(2023, 11, 1, 9, 0, 0)
        .unwrap()
        .timestamp_millis();
    data.insert("start_at".into(), Value::from(start_ms));
    data.insert("start_at_utc".into(), Value::from(start_ms));
    data.insert("rrule".into(), Value::String("FREQ=DAILY;COUNT=5".into()));
    data.insert("tz".into(), Value::String("UTC".into()));
    data
}

#[tokio::test]
async fn create_normalises_and_deduplicates_exdates() {
    let pool = setup_pool().await;
    let mut data = base_event_payload();
    data.insert(
        "exdates".into(),
        Value::String("2023-11-02T09:00:00Z, 2023-11-01T09:00:00Z,2023-11-02T09:00:00Z".into()),
    );
    commands::create_command(&pool, "events", data)
        .await
        .unwrap();

    let row = sqlx::query("SELECT exdates FROM events")
        .fetch_one(&pool)
        .await
        .unwrap();
    let exdates: Option<String> = row.try_get("exdates").unwrap();
    assert_eq!(
        exdates.as_deref(),
        Some("2023-11-01T09:00:00Z,2023-11-02T09:00:00Z")
    );
}

#[tokio::test]
async fn create_rejects_invalid_format() {
    let pool = setup_pool().await;
    let mut data = base_event_payload();
    data.insert("exdates".into(), Value::String("2023-11-01".into()));
    let err = commands::create_command(&pool, "events", data)
        .await
        .expect_err("invalid exdates should fail");
    assert_eq!(err.code, "E_EXDATE_INVALID_FORMAT");
}

#[tokio::test]
async fn create_rejects_out_of_range_values() {
    let pool = setup_pool().await;
    let mut data = base_event_payload();
    data.insert(
        "exdates".into(),
        Value::String("2023-10-25T09:00:00Z".into()),
    );
    let err = commands::create_command(&pool, "events", data)
        .await
        .expect_err("out of range exdates should fail");
    assert_eq!(err.code, "E_EXDATE_OUT_OF_RANGE");
}

#[tokio::test]
async fn update_normalises_and_sorts_exdates() {
    let pool = setup_pool().await;
    let mut data = base_event_payload();
    data.insert("exdates".into(), Value::Null);
    let created = commands::create_command(&pool, "events", data)
        .await
        .unwrap();
    let event_id = created
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap()
        .to_string();

    let mut update = Map::new();
    update.insert(
        "exdates".into(),
        Value::String("2023-11-04T09:00:00Z,2023-11-02T09:00:00Z".into()),
    );
    commands::update_command(&pool, "events", &event_id, update, Some("HH"))
        .await
        .unwrap();

    let row = sqlx::query("SELECT exdates FROM events WHERE id = ?")
        .bind(&event_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let exdates: Option<String> = row.try_get("exdates").unwrap();
    assert_eq!(
        exdates.as_deref(),
        Some("2023-11-02T09:00:00Z,2023-11-04T09:00:00Z")
    );
}

#[tokio::test]
async fn update_rejects_invalid_payloads() {
    let pool = setup_pool().await;
    let mut data = base_event_payload();
    data.insert("exdates".into(), Value::Null);
    let created = commands::create_command(&pool, "events", data)
        .await
        .unwrap();
    let event_id = created
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap()
        .to_string();

    let mut update = Map::new();
    update.insert("exdates".into(), Value::String("bad".into()));
    let err = commands::update_command(&pool, "events", &event_id, update, Some("HH"))
        .await
        .expect_err("invalid exdates should fail");
    assert_eq!(err.code, "E_EXDATE_INVALID_FORMAT");
}

#[tokio::test]
async fn migration_cleans_existing_rows() {
    let pool = setup_pool().await;
    let start_ms = Utc
        .with_ymd_and_hms(2023, 11, 1, 9, 0, 0)
        .unwrap()
        .timestamp_millis();
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, start_at_utc, rrule, exdates, created_at, updated_at)\
         VALUES ('ev1','HH','Recurring',?1,?1,'FREQ=DAILY;UNTIL=20231105T090000Z',?2,0,0)"
    )
    .bind(start_ms)
    .bind("2023-11-04T09:00:00Z, 2023-11-04T09:00:00Z,2023-10-30T09:00:00Z,2023-11-06T09:00:00Z,not-a-date")
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, start_at_utc, rrule, exdates, created_at, updated_at)\
         VALUES ('ev2','HH','Blank',?1,?1,'FREQ=DAILY;COUNT=2','   ',0,0)"
    )
    .bind(start_ms)
    .execute(&pool)
    .await
    .unwrap();

    let stats = normalize_existing_exdates(&pool).await.unwrap();
    assert_eq!(stats.scanned, 2);
    assert_eq!(stats.updated, 2);
    assert_eq!(stats.cleared, 1);
    assert_eq!(stats.invalid_format, 1);
    assert_eq!(stats.out_of_range, 2);
    assert_eq!(stats.duplicates_removed, 1);

    let row = sqlx::query("SELECT exdates FROM events WHERE id = 'ev1'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let exdates: Option<String> = row.try_get("exdates").unwrap();
    assert_eq!(exdates.as_deref(), Some("2023-11-04T09:00:00Z"));

    let row = sqlx::query("SELECT exdates FROM events WHERE id = 'ev2'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let exdates: Option<String> = row.try_get("exdates").unwrap();
    assert!(exdates.is_none());
}
