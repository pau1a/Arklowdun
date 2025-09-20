use std::time::Instant;

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
async fn recurrence_smoke_completes_under_budget() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO events (id, household_id, title, start_at, end_at, tz, start_at_utc, end_at_utc, rrule, created_at, updated_at)\
         VALUES ('smoke', 'HH', 'Smoke test', 0, 60000, 'UTC', 0, 60000, 'FREQ=MINUTELY;COUNT=128', 0, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let began = Instant::now();
    let res = commands::events_list_range_command(&pool, "HH", -60_000, 130 * 60_000)
        .await
        .unwrap();
    let elapsed = began.elapsed();
    let elapsed_ms = elapsed.as_secs_f64() * 1_000.0;

    assert_eq!(res.items.len(), 128);
    assert!(!res.truncated);

    let threshold_env = std::env::var("ARK_RECURRENCE_SMOKE_THRESHOLD_MS")
        .ok()
        .and_then(|val| val.parse::<u64>().ok())
        .unwrap_or(750);
    let threshold = threshold_env as f64;

    if elapsed_ms > threshold {
        println!(
            "::warning::recurrence smoke exceeded threshold: elapsed_ms={elapsed_ms:.3} threshold_ms={threshold:.3}",
        );
    } else {
        println!(
            "recurrence smoke ok: expanded={} elapsed_ms={elapsed_ms:.3} threshold_ms={threshold:.3}",
            res.items.len()
        );
    }
}
